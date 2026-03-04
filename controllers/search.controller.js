const prisma = require('../config/prisma');
const { mapFeToDb, mapDbToFe } = require('../utils/room-type-mapper');
const { expandCity, expandDistrict, extractLocationTermsFromQuery } = require('../data/legacy-location-map');

/**
 * Compute match score (0–100) for a room.
 * @param {object} room - Room with rentals, roomAmenities
 * @param {object} params - { q, district, city, minPrice, maxPrice, roomType, minArea, maxArea, amenityIds }
 * @param {object|null} preference - UserPreference if logged in
 * @param {number} avgRating - Avg feedback rating 0–5 for this room
 */
function computeMatchScore(room, params, preference, avgRating) {
    let score = 50; // base

    const price = Number(room.price) || 0;
    const area = room.size_m2 != null ? Number(room.size_m2) : null;
    const roomType = room.room_type ? mapDbToFe(room.room_type, 'apartment') : null;
    const amenityNames = (room.roomAmenities || []).map((ra) => ra.amenity?.name).filter(Boolean);
    const amenityIds = (room.roomAmenities || []).map((ra) => ra.amenityId).filter(Boolean);
    const rental = room.rentals;
    const loc = rental?.location;
    const district = loc?.district || '';
    const city = loc?.city || '';
    const title = rental?.title || '';
    const desc = rental?.description || '';
    const addr = loc?.address || '';

    // Search params match
    if (params.minPrice != null && !Number.isNaN(params.minPrice) && price >= params.minPrice) score += 5;
    if (params.maxPrice != null && !Number.isNaN(params.maxPrice) && price <= params.maxPrice) score += 5;
    if (params.roomType && roomType === params.roomType) score += 10;
    if (params.minArea != null && area != null && area >= params.minArea) score += 5;
    if (params.maxArea != null && area != null && area <= params.maxArea) score += 5;
    if (params.amenityIds?.length) {
        const matchCount = params.amenityIds.filter((id) => amenityIds.includes(id) || amenityNames.some((n) => id.toLowerCase() === (n || '').toLowerCase())).length;
        if (matchCount > 0) score += Math.min(15, matchCount * 5);
    }
    if (params.district && district.toLowerCase().includes((params.district || '').toLowerCase())) score += 10;
    if (params.city && city.toLowerCase().includes((params.city || '').toLowerCase())) score += 10;
    if (params.q) {
        const q = params.q.toLowerCase();
        if (title.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || district.toLowerCase().includes(q) || city.toLowerCase().includes(q) || addr.toLowerCase().includes(q)) {
            score += 15;
        }
    }

    // User preference (logged in)
    if (preference) {
        const budgetMin = preference.budget_min != null ? Number(preference.budget_min) : null;
        const budgetMax = preference.budget_max != null ? Number(preference.budget_max) : null;
        if (budgetMin != null && price >= budgetMin) score += 8;
        if (budgetMax != null && price <= budgetMax) score += 8;
        const prefsDistricts = Array.isArray(preference.preferred_districts) ? preference.preferred_districts : [];
        if (prefsDistricts.length > 0 && prefsDistricts.some((d) => district.toLowerCase().includes((d || '').toLowerCase()))) score += 12;
        const prefsType = preference.room_type ? preference.room_type.toLowerCase() : null;
        if (prefsType && roomType === prefsType) score += 10;
        const prefsAmenities = Array.isArray(preference.preferred_amenities) ? preference.preferred_amenities : [];
        if (prefsAmenities.length > 0) {
            const prefMatch = prefsAmenities.filter((p) =>
                amenityNames.some((n) => (n || '').toLowerCase().includes((p || '').toLowerCase())) ||
                amenityIds.includes(p)
            ).length;
            score += Math.min(12, prefMatch * 4);
        }
        const mustHave = Array.isArray(preference.must_have_amenities) ? preference.must_have_amenities : [];
        if (mustHave.length > 0) {
            const allMatch = mustHave.every((m) =>
                amenityNames.some((n) => (n || '').toLowerCase().includes((m || '').toLowerCase())) || amenityIds.includes(m)
            );
            if (allMatch) score += 20;
            else score -= 15; // penalty if must-haves missing
        }
    }

    // Feedback rating (0–5 scale -> up to 25 points)
    if (avgRating != null && !Number.isNaN(avgRating) && avgRating > 0) {
        score += Math.min(25, (avgRating / 5) * 25);
    }

    return Math.min(100, Math.max(0, score));
}

/**
 * GET /public/search – Room-based recommendation search.
 * Returns ROOMS (not rentals) sorted by match score. Each room includes rental info and other rooms in same rental.
 * Supports optional Authorization for user preference scoring.
 */
async function getPublicSearch(req, res) {
    try {
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
        const amenityIds = amenitiesParam ? amenitiesParam.split(',').map((s) => s.trim()).filter(Boolean) : [];

        const params = { q, district, city, address, minPrice, maxPrice, roomType, minArea, maxArea, amenityIds };

        // Optional user preference (if Authorization header present)
        let preference = null;
        const userId = req.auth?.user?.id;
        if (userId) {
            const prefs = await prisma.userPreference.findUnique({
                where: { userId },
            });
            if (prefs) preference = prefs;
        }

        // Rental-level conditions
        const rentalAnd = [{ status: 'AVAILABLE' }];
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
            rentalAnd.push({ location: { is: locConditions.length === 1 ? locConditions[0] : { AND: locConditions } } });
        }
        if (q.length > 0) {
            const textOr = [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { location: { is: { district: { contains: q, mode: 'insensitive' } } } },
                { location: { is: { city: { contains: q, mode: 'insensitive' } } } },
                { location: { is: { address: { contains: q, mode: 'insensitive' } } } },
            ];
            const { cities: qCities, districts: qDistricts } = extractLocationTermsFromQuery(q);
            if (qCities.length > 0) textOr.push({ location: { is: { OR: qCities.map((c) => ({ city: { equals: c, mode: 'insensitive' } })) } } });
            if (qDistricts.length > 0) textOr.push({ location: { is: { OR: qDistricts.map((d) => ({ district: { equals: d, mode: 'insensitive' } })) } } });
            rentalAnd.push({ OR: textOr });
        }
        const rentalWhere = rentalAnd.length === 1 ? { status: 'AVAILABLE' } : { AND: rentalAnd };

        // Room filters
        const roomWhere = { rentals: rentalWhere };
        if ((minPrice != null && !Number.isNaN(minPrice)) || (maxPrice != null && !Number.isNaN(maxPrice))) {
            roomWhere.price = {};
            if (minPrice != null && !Number.isNaN(minPrice)) roomWhere.price.gte = minPrice;
            if (maxPrice != null && !Number.isNaN(maxPrice)) roomWhere.price.lte = maxPrice;
        }
        if (roomType) roomWhere.room_type = roomType;
        if ((minArea != null && !Number.isNaN(minArea)) || (maxArea != null && !Number.isNaN(maxArea))) {
            roomWhere.size_m2 = {};
            if (minArea != null && !Number.isNaN(minArea)) roomWhere.size_m2.gte = minArea;
            if (maxArea != null && !Number.isNaN(maxArea)) roomWhere.size_m2.lte = maxArea;
        }
        if (amenityIds.length > 0) roomWhere.roomAmenities = { some: { amenityId: { in: amenityIds } } };

        // Fetch all matching rooms (we need to score and sort in memory)
        const rooms = await prisma.rooms.findMany({
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
        });

        // Fetch avg ratings for rooms
        const roomIds = rooms.map((r) => r.id);
        const ratingRows = await prisma.feedback.groupBy({
            by: ['target_id'],
            where: {
                target_type: 'ROOM',
                target_id: { in: roomIds },
                rating: { not: null },
            },
            _avg: { rating: true },
            _count: { id: true },
        });
        const ratingByRoom = Object.fromEntries(
            ratingRows.map((r) => [r.target_id, r._avg.rating != null ? Number(r._avg.rating) : null])
        );

        const placeholderImage = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';

        const scored = rooms.map((room) => {
            const avgRating = ratingByRoom[room.id] ?? null;
            const score = computeMatchScore(room, { ...params, roomType: params.roomType ? mapDbToFe(params.roomType, 'apartment') : null }, preference, avgRating);
            const rental = room.rentals;
            const loc = rental?.location;
            const allRooms = rental?.rooms || [];
            const roomImgs = (room.images || []).map((img) => img.imageUrl);
            const rentalImgs = (rental?.images || []).map((img) => img.imageUrl);
            const imgs = roomImgs.length > 0 ? roomImgs : rentalImgs;
            const amenityNames = (room.roomAmenities || []).map((ra) => ra.amenity?.name).filter(Boolean);

            const otherRooms = allRooms
                .filter((r) => r.id !== room.id)
                .map((r) => ({
                    id: r.id,
                    roomName: r.room_name,
                    price: Number(r.price),
                    area: r.size_m2 != null ? Number(r.size_m2) : null,
                    roomType: mapDbToFe(r.room_type, 'apartment'),
                    image: (r.images || [])[0]?.imageUrl || rentalImgs[0] || placeholderImage,
                }));

            return {
                id: room.id,
                rentalId: rental?.id,
                roomName: room.room_name,
                title: rental?.title || room.room_name || 'Phòng trọ',
                price: Number(room.price),
                area: room.size_m2 != null ? Number(room.size_m2) : null,
                roomType: mapDbToFe(room.room_type, 'apartment'),
                amenities: amenityNames,
                images: imgs.length > 0 ? imgs : [placeholderImage],
                location: loc ? { district: loc.district, city: loc.city, address: loc.address } : null,
                matchScore: Math.round(score * 10) / 10,
                rating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
                otherRoomsInRental: otherRooms,
            };
        });

        scored.sort((a, b) => b.matchScore - a.matchScore);

        const total = scored.length;
        const paginated = scored.slice((page - 1) * limit, page * limit);

        return res.json({
            success: true,
            data: paginated,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Room search error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tìm kiếm',
            error: err.message,
        });
    }
}

/**
 * Compute bonus score for a room being "similar" to user's favourite rooms.
 * @param {object} room - Room with rentals.location, room_type, price
 * @param {array} favoriteRooms - List of favourited rooms with rental.location, room_type, price
 */
function computeSimilarToFavoritesBonus(room, favoriteRooms) {
    if (!favoriteRooms || favoriteRooms.length === 0) return 0;
    const roomPrice = Number(room.price) || 0;
    const roomDistrict = (room.rentals?.location?.district || '').toLowerCase();
    const roomCity = (room.rentals?.location?.city || '').toLowerCase();
    const roomType = room.room_type;

    let bonus = 0;
    for (const fav of favoriteRooms) {
        const favLoc = fav.rentals?.location;
        const favDistrict = (favLoc?.district || '').toLowerCase();
        const favCity = (favLoc?.city || '').toLowerCase();
        const favPrice = Number(fav.price) || 0;
        if (roomDistrict && favDistrict && roomDistrict === favDistrict) bonus += 15;
        if (roomCity && favCity && roomCity === favCity) bonus += 8;
        if (roomType && fav.room_type && roomType === fav.room_type) bonus += 12;
        if (favPrice > 0 && roomPrice >= favPrice * 0.7 && roomPrice <= favPrice * 1.3) bonus += 10;
    }
    return Math.min(40, bonus); // cap bonus from favourites
}

/**
 * GET /search/recommend – Personalized room recommendations (auth required).
 * Based on lifestyle/preferences and rooms similar to user's favourites.
 */
async function getRecommend(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập để xem gợi ý' });
        }

        const [preference, favoriteRows] = await Promise.all([
            prisma.userPreference.findUnique({ where: { userId } }),
            prisma.favoriteRoom.findMany({
                where: { userId },
                include: {
                    room: {
                        include: {
                            rentals: { include: { location: true } },
                        },
                    },
                },
            }),
        ]);

        const favoriteRooms = favoriteRows.map((f) => f.room).filter(Boolean);
        const favoriteRoomIds = new Set(favoriteRooms.map((r) => r.id));

        const rooms = await prisma.rooms.findMany({
            where: {
                status: 'AVAILABLE',
                rentals: { status: 'AVAILABLE' },
            },
            include: {
                rentals: {
                    include: {
                        location: true,
                        images: true,
                    },
                },
                roomAmenities: { include: { amenity: true } },
                images: true,
            },
            take: 80,
        });

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

        const placeholderImage = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';
        const params = { q: '', district: '', city: '', address: '', minPrice: null, maxPrice: null, roomType: null, minArea: null, maxArea: null, amenityIds: [] };

        const scored = rooms
            .filter((room) => !favoriteRoomIds.has(room.id)) // exclude already favourited
            .map((room) => {
                const avgRating = ratingByRoom[room.id] ?? null;
                let score = computeMatchScore(room, params, preference, avgRating);
                score += computeSimilarToFavoritesBonus(room, favoriteRooms);
                const rental = room.rentals;
                const loc = rental?.location;
                const roomImgs = (room.images || []).map((img) => img.imageUrl);
                const rentalImgs = (rental?.images || []).map((img) => img.imageUrl);
                const imgs = roomImgs.length > 0 ? roomImgs : rentalImgs;
                const amenityNames = (room.roomAmenities || []).map((ra) => ra.amenity?.name).filter(Boolean);

                return {
                    id: room.id,
                    rentalId: rental?.id || room.id,
                    title: rental?.title || room.room_name || 'Phòng trọ',
                    price: Number(room.price),
                    area: room.size_m2 != null ? Number(room.size_m2) : null,
                    roomType: room.room_type ? mapDbToFe(room.room_type, 'single') : null,
                    amenities: amenityNames,
                    images: imgs.length > 0 ? imgs : [placeholderImage],
                    location: loc ? { district: loc.district, city: loc.city } : null,
                    matchScore: score,
                };
            });

        scored.sort((a, b) => b.matchScore - a.matchScore);
        const data = scored.slice(0, 12);

        let hint = 'Phòng phổ biến';
        if (favoriteRooms.length > 0 && preference) hint = 'Dựa trên sở thích và phòng bạn đã lưu';
        else if (favoriteRooms.length > 0) hint = 'Gợi ý tương tự phòng bạn đã lưu';
        else if (preference) hint = 'Dựa trên sở thích của bạn';

        return res.json({
            success: true,
            data,
            hint,
        });
    } catch (err) {
        console.error('Recommend error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tải gợi ý',
            error: err.message,
        });
    }
}

module.exports = { getPublicSearch, getRecommend };
