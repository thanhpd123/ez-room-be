const prisma = require('../config/prisma');
const { mapFeToDb, mapDbToFe } = require('../utils/room-type-mapper');
const { expandCity, expandDistrict, extractLocationTermsFromQuery } = require('../data/legacy-location-map');
const { getTextEmbedding, isEmbeddingAvailable } = require('../utils/embedding');
const { analyzeQuery, computeLifestyleCompatibility } = require('../utils/smart-query-analyzer');
const { parseQueryWithLlm, mergeLlmIntoAnalysis, isLlmAvailable } = require('../utils/llm-query-parser');
const { haversineDistance, distanceToScore, computeNearbyPOIScore, getNearbyPOIs, isGoogleMapsAvailable } = require('../utils/google-maps');
const { getClipImageEmbedding, getClipTextEmbedding } = require('../utils/clip');
const { getPopularityScoresForRooms } = require('../services/interaction.service');
const { isClipImageSearchVipOnly, isClipTextSearchVipOnly } = require('../utils/search-feature-flags');
const { runClipDiagnostics } = require('../utils/clip-diagnostics');
const { resolveAmenityIds } = require('../utils/resolve-amenity-ids');

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';

// ───────────────────── Scoring weights ─────────────────────
const WEIGHTS = {
    textMatch: 15,
    embeddingSimilarity: 25,
    preferenceMatch: 20,
    lifestyleMatch: 15,
    ratingScore: 15,
    amenityMatch: 10,
};

const WEIGHTS_WITH_LOCATION = {
    textMatch: 10,
    embeddingSimilarity: 20,
    preferenceMatch: 15,
    lifestyleMatch: 10,
    ratingScore: 10,
    amenityMatch: 8,
    distanceScore: 15,
    nearbyPOIScore: 12,
};

const WEIGHTS_NO_EMBEDDING = {
    textMatch: 25,
    preferenceMatch: 25,
    lifestyleMatch: 20,
    ratingScore: 15,
    amenityMatch: 15,
};

const WEIGHTS_NO_EMBEDDING_WITH_LOCATION = {
    textMatch: 18,
    preferenceMatch: 18,
    lifestyleMatch: 14,
    ratingScore: 10,
    amenityMatch: 10,
    distanceScore: 18,
    nearbyPOIScore: 12,
};

// Hybrid: 50% keyword + 50% semantic (combined as queryScore)
const WEIGHTS_HYBRID = {
    queryScore: 40,
    preferenceMatch: 20,
    lifestyleMatch: 15,
    ratingScore: 15,
    amenityMatch: 10,
};

const WEIGHTS_HYBRID_WITH_LOCATION = {
    queryScore: 30,
    preferenceMatch: 15,
    lifestyleMatch: 10,
    ratingScore: 10,
    amenityMatch: 8,
    distanceScore: 15,
    nearbyPOIScore: 12,
};

const VI_STOPWORDS = new Set([
    'co', 'có', 'la', 'là', 'va', 'và', 'hay', 'hoac', 'hoặc', 'toi', 'tôi',
    'can', 'cần', 'tim', 'tìm', 'muon', 'muốn', 'phong', 'phòng',
]);

function buildQueryTerms(rawQuery = '', analysis = {}) {
    const terms = new Set();
    const addTerm = (value) => {
        const t = String(value || '').toLowerCase().trim();
        if (t.length < 2 || VI_STOPWORDS.has(t)) return;
        terms.add(t);
    };

    const qTerms = String(rawQuery || '')
        .toLowerCase()
        .split(/[\s,.;:!?/\\\-_|()[\]{}]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
    qTerms.forEach(addTerm);

    (analysis.keywords || []).forEach(addTerm);
    (analysis.amenityHints || []).forEach(addTerm);
    (analysis.locationHints || []).forEach(addTerm);

    return Array.from(terms).slice(0, 12);
}

// ───────────────────── Score helpers ─────────────────────

function computeTextMatchScore(room, analysis, rawQuery = '') {
    let score = 0;
    const rental = room.rentals;
    const title = (rental?.title || '').toLowerCase();
    const desc = (rental?.description || '').toLowerCase();
    const roomDesc = (room.description || '').toLowerCase();
    const roomName = (room.room_name || '').toLowerCase();
    const loc = rental?.location;
    const district = (loc?.district || '').toLowerCase();
    const city = (loc?.city || '').toLowerCase();
    const address = (loc?.address || '').toLowerCase();

    const searchable = `${title} ${desc} ${roomDesc} ${roomName} ${district} ${city} ${address}`;

    const qRaw = (rawQuery || '').toLowerCase().trim();
    if (qRaw.length >= 2 && searchable.includes(qRaw)) {
        score += 35;
    }

    for (const kw of analysis.keywords) {
        if (searchable.includes(kw)) score += 20;
    }

    if (analysis.roomTypeHint && room.room_type === analysis.roomTypeHint) score += 25;

    if (analysis.extractedPrice) {
        const price = Number(room.price) || 0;
        const { min, max } = analysis.extractedPrice;
        if (min && max && price >= min && price <= max) score += 30;
        else if (min && !max && price >= min * 0.7 && price <= min * 1.5) score += 20;
    }
    if (analysis.priceHint === 'low') {
        const price = Number(room.price) || 0;
        if (price <= 3_000_000) score += 15;
        else if (price <= 5_000_000) score += 8;
    } else if (analysis.priceHint === 'high') {
        const price = Number(room.price) || 0;
        if (price >= 8_000_000) score += 15;
    }

    for (const locHint of analysis.locationHints) {
        const h = locHint.toLowerCase();
        if (district.includes(h) || city.includes(h) || address.includes(h)) score += 20;
    }

    return Math.min(100, score);
}

function computePreferenceScore(room, preference) {
    if (!preference) return 50;
    let score = 50;

    const price = Number(room.price) || 0;
    const budgetMin = preference.budget_min != null ? Number(preference.budget_min) : null;
    const budgetMax = preference.budget_max != null ? Number(preference.budget_max) : null;

    if (budgetMin != null && budgetMax != null) {
        if (price >= budgetMin && price <= budgetMax) score += 25;
        else if (price < budgetMin * 0.8 || price > budgetMax * 1.2) score -= 15;
    } else if (budgetMax != null && price <= budgetMax) {
        score += 15;
    }

    const loc = room.rentals?.location;
    const district = (loc?.district || '').toLowerCase();
    const prefsDistricts = Array.isArray(preference.preferred_districts) ? preference.preferred_districts : [];
    if (prefsDistricts.length > 0 && prefsDistricts.some((d) => district.includes((d || '').toLowerCase()))) {
        score += 20;
    }

    const prefsType = preference.room_type ? preference.room_type.toUpperCase() : null;
    if (prefsType && room.room_type === prefsType) score += 15;

    const amenityNames = (room.roomAmenities || []).map((ra) => (ra.amenity?.name || '').toLowerCase());
    const prefsAmenities = Array.isArray(preference.preferred_amenities) ? preference.preferred_amenities : [];
    if (prefsAmenities.length > 0) {
        const matchCount = prefsAmenities.filter((p) => amenityNames.some((n) => n.includes((p || '').toLowerCase()))).length;
        score += Math.min(15, matchCount * 5);
    }

    const mustHave = Array.isArray(preference.must_have_amenities) ? preference.must_have_amenities : [];
    if (mustHave.length > 0) {
        const allMatch = mustHave.every((m) => amenityNames.some((n) => n.includes((m || '').toLowerCase())));
        if (allMatch) score += 20;
        else score -= 20;
    }

    return Math.min(100, Math.max(0, score));
}

function computeAmenityMatchScore(room, analysis) {
    if (!analysis.amenityHints?.length) return 50;

    const amenityNames = (room.roomAmenities || []).map((ra) => (ra.amenity?.name || '').toLowerCase());
    let matched = 0;
    for (const hint of analysis.amenityHints) {
        if (amenityNames.some((n) => n.includes(hint.toLowerCase()))) matched++;
    }
    const ratio = matched / analysis.amenityHints.length;
    return Math.round(ratio * 100);
}

function computeFinalScore(components, weights) {
    let totalWeight = 0;
    let weighted = 0;
    for (const [key, weight] of Object.entries(weights)) {
        if (components[key] != null) {
            weighted += components[key] * weight;
            totalWeight += weight;
        }
    }
    return totalWeight > 0 ? Math.round((weighted / totalWeight) * 10) / 10 : 50;
}

function formatRoom(room, score, ratingByRoom, extra = {}) {
    const rental = room.rentals;
    const loc = rental?.location;
    const roomImgs = (room.images || []).map((img) => img.imageUrl);
    const rentalImgs = (rental?.images || []).map((img) => img.imageUrl);
    const imgs = roomImgs.length > 0 ? roomImgs : rentalImgs;
    const amenityNames = (room.roomAmenities || []).map((ra) => ra.amenity?.name).filter(Boolean);
    const avgRating = ratingByRoom[room.id] ?? null;

    const allRooms = rental?.rooms || [];
    const otherRooms = allRooms
        .filter((r) => r.id !== room.id)
        .map((r) => ({
            id: r.id,
            roomName: r.room_name,
            price: Number(r.price),
            area: r.size_m2 != null ? Number(r.size_m2) : null,
            roomType: mapDbToFe(r.room_type, 'apartment'),
            image: (r.images || [])[0]?.imageUrl || rentalImgs[0] || PLACEHOLDER_IMAGE,
        }));

    const result = {
        id: room.id,
        rentalId: rental?.id,
        roomName: room.room_name,
        title: rental?.title || room.room_name || 'Phòng trọ',
        price: Number(room.price),
        area: room.size_m2 != null ? Number(room.size_m2) : null,
        roomType: mapDbToFe(room.room_type, 'apartment'),
        amenities: amenityNames,
        images: imgs.length > 0 ? imgs : [PLACEHOLDER_IMAGE],
        location: loc ? {
            district: loc.district,
            city: loc.city,
            address: loc.address,
            latitude: loc.latitude,
            longitude: loc.longitude,
        } : null,
        matchScore: score,
        rating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
        otherRoomsInRental: otherRooms,
        roomStatus: room.status,
        available: room.status === 'AVAILABLE',
    };

    if (extra.distanceKm != null) result.distanceKm = Math.round(extra.distanceKm * 100) / 100;
    if (extra.nearbyPOIs) result.nearbyPOIs = extra.nearbyPOIs;

    return result;
}

// ───────────────── GET /search/advanced ─────────────────
/**
 * Advanced AI-powered search for logged-in users.
 * Uses text embeddings, user preferences, lifestyle matching, and ratings.
 */
async function getAdvancedSearch(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập để sử dụng tìm kiếm nâng cao' });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const district = typeof req.query.district === 'string' ? req.query.district.trim() : '';
        const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
        const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';
        const minPrice = req.query.minPrice != null ? parseInt(req.query.minPrice, 10) : null;
        const maxPrice = req.query.maxPrice != null ? parseInt(req.query.maxPrice, 10) : null;
        const roomType = mapFeToDb(req.query.roomType, { returnNullForInvalid: true });
        const minArea = req.query.minArea != null ? parseFloat(req.query.minArea) : null;
        const maxArea = req.query.maxArea != null ? parseFloat(req.query.maxArea) : null;
        const amenitiesParam = typeof req.query.amenities === 'string' ? req.query.amenities.trim() : '';
        let amenityIds = amenitiesParam ? amenitiesParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
        amenityIds = await resolveAmenityIds(amenityIds);
        const userLat = req.query.lat != null ? parseFloat(req.query.lat) : null;
        const userLng = req.query.lng != null ? parseFloat(req.query.lng) : null;
        const hasUserLocation = userLat != null && userLng != null && !Number.isNaN(userLat) && !Number.isNaN(userLng);

        // 1. Fetch user context
        const [preference, lifestyle] = await Promise.all([
            prisma.userPreference.findUnique({ where: { userId } }),
            prisma.lifestyleProfile.findUnique({ where: { userId } }),
        ]);

        // 2. Analyze query: regex-based + optional LLM parsing
        let analysis = analyzeQuery(q);
        if (q && isLlmAvailable()) {
            try {
                const llmResult = await parseQueryWithLlm(q);
                analysis = mergeLlmIntoAnalysis(analysis, llmResult);
            } catch (_) {
                // keep regex-only analysis
            }
        }
        const queryTerms = buildQueryTerms(q, analysis);

        // Apply LLM-extracted price to filters when not provided by query
        let minPriceFilter = minPrice;
        let maxPriceFilter = maxPrice;
        if (analysis.extractedPrice) {
            if (minPriceFilter == null && analysis.extractedPrice.min != null) minPriceFilter = analysis.extractedPrice.min;
            if (maxPriceFilter == null && analysis.extractedPrice.max != null) maxPriceFilter = analysis.extractedPrice.max;
        }

        // 3. Try embedding-based search
        let embeddingSimilarityMap = {};
        if (q && isEmbeddingAvailable()) {
            try {
                const queryEmbedding = await getTextEmbedding(q);
                if (queryEmbedding) {
                    const vecStr = `[${queryEmbedding.join(',')}]`;
                    const similarRows = await prisma.$queryRawUnsafe(`
                        SELECT room_id, 1 - (embedding::vector <=> '${vecStr}'::vector) as similarity
                        FROM room_text_embeddings
                        ORDER BY embedding::vector <=> '${vecStr}'::vector
                        LIMIT 200
                    `);
                    for (const row of similarRows) {
                        const rid = row.room_id != null ? String(row.room_id) : '';
                        if (rid) embeddingSimilarityMap[rid] = Number(row.similarity) * 100;
                    }
                }
            } catch (embErr) {
                console.warn('Embedding search fallback to keyword:', embErr.message);
            }
        }

        const hasEmbeddings = Object.keys(embeddingSimilarityMap).length > 0;

        // 4. Build Prisma filters (room must be AVAILABLE; text matches rental OR room fields)
        const rentalBaseAnd = [{ status: 'AVAILABLE' }];
        if (district || city || address) {
            const locConditions = [];
            if (district) {
                const terms = expandDistrict(district);
                locConditions.push(terms.length === 1
                    ? { district: { equals: terms[0], mode: 'insensitive' } }
                    : { OR: terms.map((t) => ({ district: { equals: t, mode: 'insensitive' } })) });
            }
            if (city) {
                const terms = expandCity(city);
                locConditions.push(terms.length === 1
                    ? { city: { equals: terms[0], mode: 'insensitive' } }
                    : { OR: terms.map((t) => ({ city: { equals: t, mode: 'insensitive' } })) });
            }
            if (address) locConditions.push({ address: { contains: address, mode: 'insensitive' } });
            rentalBaseAnd.push({ location: { is: locConditions.length === 1 ? locConditions[0] : { AND: locConditions } } });
        }

        let textOr = [];
        if (q.length > 0) {
            textOr = [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { location: { is: { district: { contains: q, mode: 'insensitive' } } } },
                { location: { is: { city: { contains: q, mode: 'insensitive' } } } },
                { location: { is: { address: { contains: q, mode: 'insensitive' } } } },
            ];
            for (const term of queryTerms) {
                textOr.push(
                    { title: { contains: term, mode: 'insensitive' } },
                    { description: { contains: term, mode: 'insensitive' } },
                    { location: { is: { district: { contains: term, mode: 'insensitive' } } } },
                    { location: { is: { city: { contains: term, mode: 'insensitive' } } } },
                    { location: { is: { address: { contains: term, mode: 'insensitive' } } } },
                );
            }
            const { cities: qCities, districts: qDistricts } = extractLocationTermsFromQuery(q);
            if (qCities.length > 0) textOr.push({ location: { is: { OR: qCities.map((c) => ({ city: { equals: c, mode: 'insensitive' } })) } } });
            if (qDistricts.length > 0) textOr.push({ location: { is: { OR: qDistricts.map((d) => ({ district: { equals: d, mode: 'insensitive' } })) } } });
        }

        let roomWhere;
        if (q.length > 0) {
            const rentalBaseWhere = rentalBaseAnd.length === 1 ? rentalBaseAnd[0] : { AND: rentalBaseAnd };
            roomWhere = {
                status: 'AVAILABLE',
                AND: [
                    { rentals: rentalBaseWhere },
                    {
                        OR: [
                            { rentals: { OR: textOr } },
                            { room_name: { contains: q, mode: 'insensitive' } },
                            { description: { contains: q, mode: 'insensitive' } },
                            ...queryTerms.map((term) => ({ room_name: { contains: term, mode: 'insensitive' } })),
                            ...queryTerms.map((term) => ({ description: { contains: term, mode: 'insensitive' } })),
                        ],
                    },
                ],
            };
        } else {
            const rentalWhere = rentalBaseAnd.length === 1 ? rentalBaseAnd[0] : { AND: rentalBaseAnd };
            roomWhere = { rentals: rentalWhere, status: 'AVAILABLE' };
        }
        if ((minPriceFilter != null && !Number.isNaN(minPriceFilter)) || (maxPriceFilter != null && !Number.isNaN(maxPriceFilter))) {
            roomWhere.price = {};
            if (minPriceFilter != null && !Number.isNaN(minPriceFilter)) roomWhere.price.gte = minPriceFilter;
            if (maxPriceFilter != null && !Number.isNaN(maxPriceFilter)) roomWhere.price.lte = maxPriceFilter;
        }
        if (roomType) roomWhere.room_type = roomType;
        if ((minArea != null && !Number.isNaN(minArea)) || (maxArea != null && !Number.isNaN(maxArea))) {
            roomWhere.size_m2 = {};
            if (minArea != null && !Number.isNaN(minArea)) roomWhere.size_m2.gte = minArea;
            if (maxArea != null && !Number.isNaN(maxArea)) roomWhere.size_m2.lte = maxArea;
        }
        if (amenityIds.length > 0) roomWhere.roomAmenities = { some: { amenityId: { in: amenityIds } } };

        // If embedding search returned results, also fetch those rooms even if they don't match text filters
        let embeddingRoomIds = [];
        if (hasEmbeddings) {
            embeddingRoomIds = Object.keys(embeddingSimilarityMap);
        }

        // 5. Fetch rooms
        const [filteredRooms, embeddingRooms] = await Promise.all([
            prisma.rooms.findMany({
                where: roomWhere,
                include: {
                    rentals: {
                        include: {
                            location: true,
                            images: true,
                            rooms: {
                                include: {
                                    roomAmenities: { include: { amenity: true } },
                                    images: true,
                                },
                            },
                        },
                    },
                    roomAmenities: { include: { amenity: true } },
                    images: true,
                },
            }),
            embeddingRoomIds.length > 0
                ? prisma.rooms.findMany({
                    where: {
                        id: { in: embeddingRoomIds },
                        status: 'AVAILABLE',
                        rentals: { status: 'AVAILABLE' },
                    },
                    include: {
                        rentals: {
                            include: {
                                location: true,
                                images: true,
                                rooms: {
                                    include: {
                                        roomAmenities: { include: { amenity: true } },
                                        images: true,
                                    },
                                },
                            },
                        },
                        roomAmenities: { include: { amenity: true } },
                        images: true,
                    },
                })
                : [],
        ]);

        // Merge and deduplicate
        const roomMap = new Map();
        for (const r of filteredRooms) roomMap.set(r.id, r);
        for (const r of embeddingRooms) {
            if (!roomMap.has(r.id)) roomMap.set(r.id, r);
        }
        const rooms = Array.from(roomMap.values());

        // 6. Fetch ratings and popularity (engagement) scores
        const roomIds = rooms.map((r) => r.id);
        const [ratingRows, popularityByRoom] = await Promise.all([
            prisma.feedback.groupBy({
                by: ['target_id'],
                where: {
                    target_type: 'ROOM',
                    target_id: { in: roomIds },
                    rating: { not: null },
                },
                _avg: { rating: true },
            }),
            getPopularityScoresForRooms(roomIds),
        ]);
        const ratingByRoom = Object.fromEntries(
            ratingRows.map((r) => [r.target_id, r._avg.rating != null ? Number(r._avg.rating) : null])
        );

        // 7. Pre-compute nearby POI scores for rooms with coordinates (batched, cached)
        const nearbyPOIScores = {};
        const nearbyPOIData = {};
        if (hasUserLocation && isGoogleMapsAvailable()) {
            const locationsToQuery = new Map();
            for (const room of rooms) {
                const loc = room.rentals?.location;
                if (loc?.latitude && loc?.longitude) {
                    const key = `${loc.latitude},${loc.longitude}`;
                    if (!locationsToQuery.has(key)) locationsToQuery.set(key, { lat: loc.latitude, lng: loc.longitude });
                }
            }
            const poiPromises = Array.from(locationsToQuery.entries()).slice(0, 20).map(async ([key, { lat, lng }]) => {
                const result = await getNearbyPOIs(lat, lng, 1000);
                return [key, result];
            });
            const poiResults = await Promise.all(poiPromises);
            for (const [key, result] of poiResults) {
                nearbyPOIScores[key] = result.score;
                nearbyPOIData[key] = result.categories;
            }
        }

        // 8. Score each room (hybrid: 50% keyword + 50% semantic when both available)
        let activeWeights;
        if (hasEmbeddings && q.length > 0) {
            activeWeights = hasUserLocation ? WEIGHTS_HYBRID_WITH_LOCATION : WEIGHTS_HYBRID;
        } else if (hasUserLocation) {
            activeWeights = hasEmbeddings ? WEIGHTS_WITH_LOCATION : WEIGHTS_NO_EMBEDDING_WITH_LOCATION;
        } else {
            activeWeights = hasEmbeddings ? WEIGHTS : WEIGHTS_NO_EMBEDDING;
        }

        const scored = rooms.map((room) => {
            const avgRating = ratingByRoom[room.id] ?? null;
            const loc = room.rentals?.location;

            const textMatch = computeTextMatchScore(room, analysis, q);
            const embeddingSim = embeddingSimilarityMap[room.id] ?? 0;

            const components = {
                preferenceMatch: computePreferenceScore(room, preference),
                lifestyleMatch: computeLifestyleCompatibility(analysis.lifestyleHints, lifestyle),
                ratingScore: avgRating != null ? (avgRating / 5) * 100 : 50,
                amenityMatch: computeAmenityMatchScore(room, analysis),
            };

            if (activeWeights.queryScore != null) {
                components.queryScore = hasEmbeddings ? 0.5 * textMatch + 0.5 * embeddingSim : textMatch;
            } else {
                components.textMatch = textMatch;
                if (hasEmbeddings) components.embeddingSimilarity = embeddingSim;
            }

            const extra = {};
            if (hasUserLocation && loc?.latitude && loc?.longitude) {
                const dist = haversineDistance(userLat, userLng, loc.latitude, loc.longitude);
                components.distanceScore = distanceToScore(dist);
                extra.distanceKm = dist;

                const locKey = `${loc.latitude},${loc.longitude}`;
                components.nearbyPOIScore = nearbyPOIScores[locKey] ?? 50;
                if (nearbyPOIData[locKey]) extra.nearbyPOIs = nearbyPOIData[locKey];
            }

            let finalScore = computeFinalScore(components, activeWeights);
            const popularityScore = popularityByRoom[room.id] ?? 0;
            finalScore = 0.8 * finalScore + 0.2 * popularityScore;
            return formatRoom(room, Math.round(finalScore * 10) / 10, ratingByRoom, extra);
        });

        scored.sort((a, b) => b.matchScore - a.matchScore);

        const total = scored.length;
        const paginated = scored.slice((page - 1) * limit, page * limit);

        const searchMode = hasEmbeddings && q.length > 0 ? 'hybrid' : hasEmbeddings ? 'ai_embedding' : 'smart_keyword';
        return res.json({
            success: true,
            data: paginated,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
            searchMode,
        });
    } catch (err) {
        console.error('Advanced search error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tìm kiếm nâng cao',
            error: err.message,
        });
    }
}

// ───────────────── POST /search/by-image ─────────────────
/**
 * Image-based search (CLIP + pgvector). VIP gated by default; set CLIP_IMAGE_SEARCH_VIP_ONLY=false for all logged-in users.
 */
async function searchByImage(req, res) {
    try {
        const userId = req.auth?.user?.id;
        const isVip = req.auth?.user?.isVip === true;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập để tìm kiếm bằng ảnh' });
        }
        if (isClipImageSearchVipOnly() && !isVip) {
            return res.status(403).json({ success: false, message: 'Tính năng tìm kiếm bằng ảnh chỉ dành cho VIP' });
        }
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, message: 'Vui lòng gửi ảnh (field: file)' });
        }

        // 1. Generate CLIP embedding for uploaded image
        const imageEmbedding = await getClipImageEmbedding(req.file.buffer);
        if (!imageEmbedding || imageEmbedding.length === 0) {
            return res.status(500).json({ success: false, message: 'Không thể phân tích ảnh' });
        }

        // Blend image embedding with optional text hint (CLIP multimodal: same embedding space)
        // text_hint guides visual search toward specific attributes without overriding the image signal.
        let clipEmbedding = imageEmbedding;
        const textHint = (req.body?.text_hint || '').trim();
        if (textHint) {
            const textEmbedding = await getClipTextEmbedding(textHint);
            if (textEmbedding && textEmbedding.length === imageEmbedding.length) {
                // Image-dominant blend: 70% image + 30% text, then re-normalize
                const alpha = 0.7;
                const blended = imageEmbedding.map((v, i) => alpha * v + (1 - alpha) * textEmbedding[i]);
                const norm = Math.sqrt(blended.reduce((s, v) => s + v * v, 0));
                clipEmbedding = norm > 0 ? blended.map((v) => v / norm) : blended;
            }
        }

        // 2. CLIP image-to-image similarity (pgvector cosine distance)
        // NOTE: the vector literal is embedded directly in the SQL string (not a $1 param) because
        // Prisma's $queryRawUnsafe keeps $N params as text, breaking the pgvector <=> operator.
        // This is safe: clipEmbedding is always a float[] we generated, never user input.
        let clipSimilarityMap = {};
        let vectorSearchError = null;
        try {
            const vecStr = `[${clipEmbedding.join(',')}]`;
            const clipRows = await prisma.$queryRawUnsafe(`
                SELECT cv.room_image_id, ri.room_id,
                       1 - (cv.embedding::vector <=> '${vecStr}'::vector) as similarity
                FROM clip_vectors cv
                JOIN room_images ri ON ri.id = cv.room_image_id
                ORDER BY cv.embedding::vector <=> '${vecStr}'::vector
                LIMIT 100
            `);
            for (const row of clipRows) {
                const roomId = row.room_id;
                const sim = Number(row.similarity);
                if (!clipSimilarityMap[roomId] || sim > clipSimilarityMap[roomId]) {
                    clipSimilarityMap[roomId] = sim;
                }
            }
        } catch (err) {
            vectorSearchError = err.message;
            console.warn('CLIP search error (run generate-clip-embeddings.js first):', err.message);
        }

        const candidateIds = Object.keys(clipSimilarityMap);

        if (candidateIds.length === 0) {
            const checks = [];
            if (isClipImageSearchVipOnly() && !isVip) {
                checks.push('VIP required for image search, or set CLIP_IMAGE_SEARCH_VIP_ONLY=false in .env');
            }
            checks.push('Confirm clip_vectors has rows: node scripts/diagnose-clip.js');
            checks.push('Full pipeline check (auth): GET /search/clip-diagnostics');
            if (vectorSearchError) {
                checks.push(`Last vector query error: ${vectorSearchError}`);
            }
            return res.json({
                success: true,
                data: [],
                message: vectorSearchError
                    ? 'Lỗi truy vấn vector (xem troubleshoot).'
                    : 'Không tìm thấy phòng phù hợp. Chạy: node scripts/generate-clip-embeddings.js',
                troubleshoot: {
                    clipEmbeddingOk: true,
                    embeddingDimensions: clipEmbedding.length,
                    vectorQueryError: vectorSearchError,
                    checks,
                    diagnosticsEndpoint: 'GET /search/clip-diagnostics',
                },
            });
        }

        // 3. Fetch candidate rooms
        const rooms = await prisma.rooms.findMany({
            where: {
                id: { in: candidateIds },
                status: 'AVAILABLE',
                rentals: { status: 'AVAILABLE' },
            },
            include: {
                rentals: {
                    include: {
                        location: true,
                        images: true,
                        rooms: {
                            include: {
                                roomAmenities: { include: { amenity: true } },
                                images: true,
                            },
                        },
                    },
                },
                roomAmenities: { include: { amenity: true } },
                images: true,
            },
        });

        // 4. Fetch ratings
        const roomIds = rooms.map((r) => r.id);
        const ratingRows = await prisma.feedback.groupBy({
            by: ['target_id'],
            where: {
                target_type: 'ROOM',
                target_id: { in: roomIds },
                rating: { not: null },
            },
            _avg: { rating: true },
        });
        const ratingByRoom = Object.fromEntries(
            ratingRows.map((r) => [r.target_id, r._avg.rating != null ? Number(r._avg.rating) : null])
        );

        // 5. Get user preferences
        const preference = await prisma.userPreference.findUnique({ where: { userId } });

        // 6. Score: CLIP similarity 50%, preference 30%, rating 20%
        const scored = rooms.map((room) => {
            const clipSim = (clipSimilarityMap[room.id] || 0) * 100;
            const avgRating = ratingByRoom[room.id] ?? null;
            const prefScore = computePreferenceScore(room, preference);
            const ratingScoreVal = avgRating != null ? (avgRating / 5) * 100 : 50;

            const finalScore = clipSim * 0.50 + prefScore * 0.30 + ratingScoreVal * 0.20;

            const formatted = formatRoom(room, Math.round(finalScore * 10) / 10, ratingByRoom);
            // Expose raw CLIP cosine similarity (0–100) so the UI can show "Visual match: X%"
            formatted.clipSimilarity = Math.round((clipSimilarityMap[room.id] || 0) * 10000) / 100;
            return formatted;
        });

        scored.sort((a, b) => b.matchScore - a.matchScore);

        const rawSims = Object.values(clipSimilarityMap);
        const topClipCosine = rawSims.length ? Math.round(Math.max(...rawSims) * 10000) / 10000 : null;

        return res.json({
            success: true,
            data: scored.slice(0, 50),
            searchMode: textHint ? 'clip_multimodal' : 'clip_visual',
            meta: {
                /** Raw CLIP cosine similarity (0–1) of best-matching stored image vs your upload */
                topClipCosineSimilarity: topClipCosine,
                roomsWithClipHits: candidateIds.length,
                textHintUsed: textHint ? true : false,
                effectivenessHint:
                    topClipCosine == null
                        ? null
                        : topClipCosine >= 0.35
                          ? 'Strong visual match in CLIP space.'
                          : topClipCosine >= 0.22
                            ? 'Moderate match; try another photo angle or check room image quality in DB.'
                            : 'Weak match; CLIP is working but this image may not resemble listings — see docs/AI-SEARCH-SETUP.md',
            },
        });
    } catch (err) {
        console.error('Image search error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tìm kiếm bằng ảnh',
            error: err.message,
        });
    }
}

// ───────────────── GET /search/nearby ─────────────────
/**
 * Find available rooms near the user's current location.
 * Query: lat, lng, radius (km, default 5), page, limit
 */
async function searchNearby(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập để tìm phòng gần bạn' });
        }

        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ success: false, message: 'Cần cung cấp tọa độ (lat, lng)' });
        }

        const radiusKm = Math.min(Math.max(parseFloat(req.query.radius) || 5, 0.5), 50);
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);

        // Fetch all available rooms with their locations
        const rooms = await prisma.rooms.findMany({
            where: {
                status: 'AVAILABLE',
                rentals: {
                    status: 'AVAILABLE',
                    location: {
                        latitude: { not: null },
                        longitude: { not: null },
                    },
                },
            },
            include: {
                rentals: {
                    include: {
                        location: true,
                        images: true,
                        rooms: {
                            include: {
                                roomAmenities: { include: { amenity: true } },
                                images: true,
                            },
                        },
                    },
                },
                roomAmenities: { include: { amenity: true } },
                images: true,
            },
        });

        // Filter by distance and compute scores
        const withinRadius = [];
        for (const room of rooms) {
            const loc = room.rentals?.location;
            if (!loc?.latitude || !loc?.longitude) continue;
            const dist = haversineDistance(lat, lng, loc.latitude, loc.longitude);
            if (dist <= radiusKm) {
                withinRadius.push({ room, distanceKm: dist });
            }
        }

        if (withinRadius.length === 0) {
            return res.json({
                success: true,
                data: [],
                pagination: { page, limit, total: 0, totalPages: 0 },
                searchMode: 'nearby',
                radius: radiusKm,
            });
        }

        // Fetch ratings
        const roomIds = withinRadius.map((r) => r.room.id);
        const ratingRows = await prisma.feedback.groupBy({
            by: ['target_id'],
            where: {
                target_type: 'ROOM',
                target_id: { in: roomIds },
                rating: { not: null },
            },
            _avg: { rating: true },
        });
        const ratingByRoom = Object.fromEntries(
            ratingRows.map((r) => [r.target_id, r._avg.rating != null ? Number(r._avg.rating) : null])
        );

        // Fetch user preference
        const preference = await prisma.userPreference.findUnique({ where: { userId } });

        // Compute nearby POI scores (top 20 unique locations)
        const nearbyPOIScores = {};
        const nearbyPOIData = {};
        if (isGoogleMapsAvailable()) {
            const uniqueLocations = new Map();
            for (const { room } of withinRadius) {
                const loc = room.rentals?.location;
                if (loc?.latitude && loc?.longitude) {
                    const key = `${loc.latitude},${loc.longitude}`;
                    if (!uniqueLocations.has(key)) uniqueLocations.set(key, { lat: loc.latitude, lng: loc.longitude });
                }
            }
            const poiPromises = Array.from(uniqueLocations.entries()).slice(0, 20).map(async ([key, { lat: pLat, lng: pLng }]) => {
                const result = await getNearbyPOIs(pLat, pLng, 1000);
                return [key, result];
            });
            const poiResults = await Promise.all(poiPromises);
            for (const [key, result] of poiResults) {
                nearbyPOIScores[key] = result.score;
                nearbyPOIData[key] = result.categories;
            }
        }

        // Score: distance 40%, nearby POI 25%, preference 20%, rating 15%
        const scored = withinRadius.map(({ room, distanceKm }) => {
            const loc = room.rentals?.location;
            const dScore = distanceToScore(distanceKm);
            const locKey = loc ? `${loc.latitude},${loc.longitude}` : '';
            const poiScore = nearbyPOIScores[locKey] ?? 50;
            const prefScore = computePreferenceScore(room, preference);
            const avgRating = ratingByRoom[room.id] ?? null;
            const rScore = avgRating != null ? (avgRating / 5) * 100 : 50;

            const finalScore = dScore * 0.40 + poiScore * 0.25 + prefScore * 0.20 + rScore * 0.15;

            const extra = {
                distanceKm,
                nearbyPOIs: nearbyPOIData[locKey] || null,
            };

            return formatRoom(room, Math.round(finalScore * 10) / 10, ratingByRoom, extra);
        });

        scored.sort((a, b) => b.matchScore - a.matchScore);

        const total = scored.length;
        const paginated = scored.slice((page - 1) * limit, page * limit);

        return res.json({
            success: true,
            data: paginated,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
            searchMode: 'nearby',
            radius: radiusKm,
            googleMapsEnabled: isGoogleMapsAvailable(),
        });
    } catch (err) {
        console.error('Nearby search error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tìm kiếm gần bạn',
            error: err.message,
        });
    }
}

// ───────────────── GET /search/nearby-pois ─────────────────
/**
 * Get nearby POIs for a specific location (for room detail or map view).
 * Query: lat, lng, radius (meters, default 1000)
 */
async function getNearbyPOIsEndpoint(req, res) {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ success: false, message: 'Cần cung cấp tọa độ (lat, lng)' });
        }

        if (!isGoogleMapsAvailable()) {
            return res.status(503).json({ success: false, message: 'Google Maps API chưa được cấu hình' });
        }

        const radius = Math.min(Math.max(parseInt(req.query.radius) || 1000, 100), 5000);
        const result = await getNearbyPOIs(lat, lng, radius);

        return res.json({
            success: true,
            data: result.categories,
            score: result.score,
            cached: result.cached,
        });
    } catch (err) {
        console.error('Nearby POIs error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi lấy thông tin tiện ích xung quanh',
            error: err.message,
        });
    }
}

// ───────────────── GET /search/by-text ─────────────────
/**
 * Text-to-image search: find rooms whose images match a text description (e.g. "phòng có cửa sổ lớn").
 * Uses CLIP text encoder + pgvector clip_vectors. VIP gated by default; set CLIP_TEXT_SEARCH_VIP_ONLY=false for all logged-in users.
 */
async function searchByText(req, res) {
    try {
        const userId = req.auth?.user?.id;
        const isVip = req.auth?.user?.isVip === true;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập để tìm kiếm bằng mô tả' });
        }
        if (isClipTextSearchVipOnly() && !isVip) {
            return res.status(403).json({
                success: false,
                message: 'Tìm phòng bằng mô tả hình ảnh chỉ dành cho VIP',
            });
        }
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!q) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập mô tả (query: q)' });
        }

        const textEmbedding = await getClipTextEmbedding(q);
        if (!textEmbedding || textEmbedding.length === 0) {
            return res.status(500).json({ success: false, message: 'Không thể mã hóa mô tả. Thử lại sau.' });
        }

        let clipSimilarityMap = {};
        try {
            const vecStr = `[${textEmbedding.join(',')}]`;
            const clipRows = await prisma.$queryRawUnsafe(`
                SELECT cv.room_image_id, ri.room_id,
                       1 - (cv.embedding::vector <=> '${vecStr}'::vector) as similarity
                FROM clip_vectors cv
                JOIN room_images ri ON ri.id = cv.room_image_id
                ORDER BY cv.embedding::vector <=> '${vecStr}'::vector
                LIMIT 100
            `);
            for (const row of clipRows) {
                const roomId = row.room_id;
                const sim = Number(row.similarity);
                if (!clipSimilarityMap[roomId] || sim > clipSimilarityMap[roomId]) {
                    clipSimilarityMap[roomId] = sim;
                }
            }
        } catch (err) {
            console.warn('CLIP text search error (run generate-clip-embeddings):', err.message);
        }

        const candidateIds = Object.keys(clipSimilarityMap);
        if (candidateIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                message: 'Không tìm thấy phòng phù hợp. Chạy script generate-clip-embeddings.',
            });
        }

        const rooms = await prisma.rooms.findMany({
            where: {
                id: { in: candidateIds },
                status: 'AVAILABLE',
                rentals: { status: 'AVAILABLE' },
            },
            include: {
                rentals: {
                    include: {
                        location: true,
                        images: true,
                        rooms: {
                            include: {
                                roomAmenities: { include: { amenity: true } },
                                images: true,
                            },
                        },
                    },
                },
                roomAmenities: { include: { amenity: true } },
                images: true,
            },
        });

        const ratingRows = await prisma.feedback.groupBy({
            by: ['target_id'],
            where: {
                target_type: 'ROOM',
                target_id: { in: rooms.map((r) => r.id) },
                rating: { not: null },
            },
            _avg: { rating: true },
        });
        const ratingByRoom = Object.fromEntries(
            ratingRows.map((r) => [r.target_id, r._avg.rating != null ? Number(r._avg.rating) : null])
        );

        const preference = await prisma.userPreference.findUnique({ where: { userId } });

        const scored = rooms.map((room) => {
            const clipSim = (clipSimilarityMap[room.id] || 0) * 100;
            const avgRating = ratingByRoom[room.id] ?? null;
            const prefScore = computePreferenceScore(room, preference);
            const ratingScoreVal = avgRating != null ? (avgRating / 5) * 100 : 50;
            const finalScore = clipSim * 0.50 + prefScore * 0.30 + ratingScoreVal * 0.20;
            return formatRoom(room, Math.round(finalScore * 10) / 10, ratingByRoom);
        });

        scored.sort((a, b) => b.matchScore - a.matchScore);

        return res.json({
            success: true,
            data: scored.slice(0, 50),
            searchMode: 'clip_text_to_image',
        });
    } catch (err) {
        console.error('Text-to-image search error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tìm kiếm bằng mô tả',
            error: err.message,
        });
    }
}

/**
 * GET /search/clip-diagnostics
 * Auth required. Verifies ONNX CLIP vision, pgvector, clip_vectors count, and a sample ANN query.
 */
async function getClipDiagnostics(req, res) {
    try {
        const skipDb = req.query?.skipDb === 'true' || req.query?.skipDb === '1';
        const report = await runClipDiagnostics(prisma, { skipDb });
        return res.json({
            success: true,
            ...report,
        });
    } catch (err) {
        console.error('CLIP diagnostics error:', err);
        return res.status(500).json({
            success: false,
            message: 'CLIP diagnostics failed',
            error: err.message,
        });
    }
}

// ───────────────── POST /search/transcribe ─────────────────
/**
 * Voice → text transcription using OpenAI Whisper.
 * Input: multipart/form-data with field `file` (audio/webm, audio/wav, audio/mpeg, etc.)
 * Output: { success: true, text: "..." }
 */
async function transcribeVoice(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập để dùng tìm kiếm bằng giọng nói' });
        }

        if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_API_KEY.trim()) {
            return res.status(503).json({
                success: false,
                message: 'Chưa cấu hình OPENAI_API_KEY để chuyển giọng nói thành văn bản',
            });
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, message: 'Vui lòng gửi audio (field: file)' });
        }

        const OpenAI = require('openai');
        let toFile = null;
        try {
            ({ toFile } = require('openai/uploads'));
        } catch (_) {
            // Older/newer SDK layouts: try fallback below.
        }

        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });

        // Convert Buffer to a File-like object accepted by the OpenAI SDK.
        let fileObj = null;
        if (typeof toFile === 'function') {
            fileObj = await toFile(
                req.file.buffer,
                req.file.originalname || 'audio.webm',
                { type: req.file.mimetype || 'application/octet-stream' }
            );
        } else if (globalThis.File) {
            fileObj = new globalThis.File(
                [req.file.buffer],
                req.file.originalname || 'audio.webm',
                { type: req.file.mimetype || 'application/octet-stream' }
            );
        } else {
            return res.status(500).json({
                success: false,
                message: 'Không thể xử lý file audio trên runtime hiện tại (thiếu File/toFile)',
            });
        }

        const result = await client.audio.transcriptions.create({
            model: 'whisper-1',
            file: fileObj,
            language: 'vi',
        });

        const text = (result && (result.text || result?.data?.text)) || '';
        return res.json({
            success: true,
            text: typeof text === 'string' ? text : '',
        });
    } catch (err) {
        console.error('Voice transcription error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi chuyển giọng nói thành văn bản',
            error: err.message,
        });
    }
}

module.exports = {
    getAdvancedSearch,
    searchByImage,
    searchNearby,
    getNearbyPOIsEndpoint,
    searchByText,
    getClipDiagnostics,
    transcribeVoice,
};
