const prisma = require('../config/prisma');
const { mapFeToDb, mapDbToFe } = require('../utils/room-type-mapper');
const {
    expandCity,
    expandDistrict,
    extractLocationTermsFromQuery,
} = require('../data/legacy-location-map');
const { getPopularityScoresForRooms } = require('./interaction.service');
const { resolveAmenityIds } = require('../utils/resolve-amenity-ids');

const placeholderImage = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';
const VIP_LANDLORD_SEARCH_BOOST = Number(process.env.VIP_LANDLORD_SEARCH_BOOST || 8);
const SEARCH_FREE_TIER_MIN_RATIO = Number(process.env.SEARCH_FREE_TIER_MIN_RATIO || 0.2);
const SEARCH_FREE_TIER_MIN_TOP_SLOTS = Number(process.env.SEARCH_FREE_TIER_MIN_TOP_SLOTS || 2);

function applyFairnessGuard(scored) {
    if (!Array.isArray(scored) || scored.length === 0) return scored;

    const topWindow = Math.min(10, scored.length);
    const safeRatio = Math.max(0, Math.min(1, SEARCH_FREE_TIER_MIN_RATIO));
    const minTopSlots = Math.max(0, SEARCH_FREE_TIER_MIN_TOP_SLOTS);
    const requiredFreeInTop = Math.max(minTopSlots, Math.ceil(topWindow * safeRatio));

    const freePool = scored.filter((item) => !item.isVipLandlord);
    if (freePool.length === 0) return scored;

    const actualRequiredFree = Math.min(requiredFreeInTop, freePool.length, topWindow);
    if (actualRequiredFree <= 0) return scored;

    const topSlice = scored.slice(0, topWindow);
    const topFreeCount = topSlice.filter((item) => !item.isVipLandlord).length;
    if (topFreeCount >= actualRequiredFree) return scored;

    const selectedTopIds = new Set(topSlice.map((item) => item.id));
    const candidateFreeOutsideTop = scored
        .slice(topWindow)
        .filter((item) => !item.isVipLandlord)
        .sort((a, b) => b.matchScore - a.matchScore);

    const adjustedTop = [...topSlice];
    let missing = actualRequiredFree - topFreeCount;

    for (const freeCandidate of candidateFreeOutsideTop) {
        if (missing <= 0) break;

        let replaceIndex = -1;
        let replaceScore = Number.POSITIVE_INFINITY;
        for (let i = 0; i < adjustedTop.length; i += 1) {
            const item = adjustedTop[i];
            if (!item.isVipLandlord) continue;
            if (item.matchScore < replaceScore) {
                replaceScore = item.matchScore;
                replaceIndex = i;
            }
        }

        if (replaceIndex < 0) break;
        adjustedTop[replaceIndex] = freeCandidate;
        selectedTopIds.add(freeCandidate.id);
        missing -= 1;
    }

    adjustedTop.sort((a, b) => b.matchScore - a.matchScore);

    const remainder = scored.filter((item) => !selectedTopIds.has(item.id));
    return [...adjustedTop, ...remainder];
}

/**
 * Compute match score (0–100) for a room.
 */
function computeMatchScore(room, params, preference, avgRating) {
    let score = 50;

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

    if (params.minPrice != null && !Number.isNaN(params.minPrice) && price >= params.minPrice)
        score += 5;
    if (params.maxPrice != null && !Number.isNaN(params.maxPrice) && price <= params.maxPrice)
        score += 5;
    if (params.roomType && roomType === params.roomType) score += 10;
    if (params.minArea != null && area != null && area >= params.minArea) score += 5;
    if (params.maxArea != null && area != null && area <= params.maxArea) score += 5;
    if (params.amenityIds?.length) {
        const matchCount = params.amenityIds.filter(
            (id) =>
                amenityIds.includes(id) ||
                amenityNames.some((n) => id.toLowerCase() === (n || '').toLowerCase())
        ).length;
        if (matchCount > 0) score += Math.min(15, matchCount * 5);
    }
    if (params.district && district.toLowerCase().includes((params.district || '').toLowerCase()))
        score += 10;
    if (params.city && city.toLowerCase().includes((params.city || '').toLowerCase())) score += 10;
    if (params.q) {
        const q = params.q.toLowerCase();
        const roomName = (room.room_name || '').toLowerCase();
        const roomDesc = (room.description || '').toLowerCase();
        if (
            title.toLowerCase().includes(q) ||
            desc.toLowerCase().includes(q) ||
            roomName.includes(q) ||
            roomDesc.includes(q) ||
            district.toLowerCase().includes(q) ||
            city.toLowerCase().includes(q) ||
            addr.toLowerCase().includes(q)
        ) {
            score += 15;
        }
    }

    if (preference) {
        const budgetMin = preference.budget_min != null ? Number(preference.budget_min) : null;
        const budgetMax = preference.budget_max != null ? Number(preference.budget_max) : null;
        if (budgetMin != null && price >= budgetMin) score += 8;
        if (budgetMax != null && price <= budgetMax) score += 8;
        const prefsDistricts = Array.isArray(preference.preferred_districts)
            ? preference.preferred_districts
            : [];
        if (
            prefsDistricts.length > 0 &&
            prefsDistricts.some((d) =>
                district.toLowerCase().includes((d || '').toLowerCase())
            )
        )
            score += 12;
        const prefsType = preference.room_type ? preference.room_type.toLowerCase() : null;
        if (prefsType && roomType === prefsType) score += 10;
        const prefsAmenities = Array.isArray(preference.preferred_amenities)
            ? preference.preferred_amenities
            : [];
        if (prefsAmenities.length > 0) {
            const prefMatch = prefsAmenities.filter(
                (p) =>
                    amenityNames.some((n) =>
                        (n || '').toLowerCase().includes((p || '').toLowerCase())
                    ) || amenityIds.includes(p)
            ).length;
            score += Math.min(12, prefMatch * 4);
        }
        const mustHave = Array.isArray(preference.must_have_amenities)
            ? preference.must_have_amenities
            : [];
        if (mustHave.length > 0) {
            const allMatch = mustHave.every(
                (m) =>
                    amenityNames.some((n) =>
                        (n || '').toLowerCase().includes((m || '').toLowerCase())
                    ) || amenityIds.includes(m)
            );
            if (allMatch) score += 20;
            else score -= 15;
        }
    }

    if (avgRating != null && !Number.isNaN(avgRating) && avgRating > 0) {
        score += Math.min(25, (avgRating / 5) * 25);
    }

    return Math.min(100, Math.max(0, score));
}

/**
 * Compute bonus score for room similar to user's favourite rooms.
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
        if (favPrice > 0 && roomPrice >= favPrice * 0.7 && roomPrice <= favPrice * 1.3)
            bonus += 10;
    }
    return Math.min(40, bonus);
}

/**
 * Room-based recommendation search
 */
async function getPublicSearch(params, userId) {
    const {
        page = 1,
        limit = 20,
        q = '',
        district = '',
        city = '',
        address = '',
        minPrice,
        maxPrice,
        roomType,
        minArea,
        maxArea,
        amenityIds = [],
    } = params;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 20), 100);
    const roomTypeDb = mapFeToDb(roomType, { returnNullForInvalid: true });

    const searchParams = {
        q: typeof q === 'string' ? q.trim() : '',
        district: typeof district === 'string' ? district.trim() : '',
        city: typeof city === 'string' ? city.trim() : '',
        address: typeof address === 'string' ? address.trim() : '',
        minPrice: minPrice != null ? parseInt(minPrice, 10) : null,
        maxPrice: maxPrice != null ? parseInt(maxPrice, 10) : null,
        roomType: roomTypeDb,
        minArea: minArea != null ? parseFloat(minArea) : null,
        maxArea: maxArea != null ? parseFloat(maxArea) : null,
        amenityIds: Array.isArray(amenityIds)
            ? amenityIds
            : typeof amenityIds === 'string'
                ? amenityIds
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
    };

    let preference = null;
    if (userId) {
        const prefs = await prisma.userPreference.findUnique({
            where: { userId },
        });
        if (prefs) preference = prefs;
    }

    searchParams.amenityIds = await resolveAmenityIds(searchParams.amenityIds);

    /** Base rental filter: AVAILABLE + optional location (no text query here). */
    const rentalBaseAnd = [{ status: 'AVAILABLE' }];
    if (searchParams.district || searchParams.city || searchParams.address) {
        const locConditions = [];
        if (searchParams.district) {
            const terms = expandDistrict(searchParams.district);
            locConditions.push(
                terms.length === 1
                    ? { district: { equals: terms[0], mode: 'insensitive' } }
                    : {
                        OR: terms.map((t) => ({
                            district: { equals: t, mode: 'insensitive' },
                        })),
                    }
            );
        }
        if (searchParams.city) {
            const terms = expandCity(searchParams.city);
            locConditions.push(
                terms.length === 1
                    ? { city: { equals: terms[0], mode: 'insensitive' } }
                    : {
                        OR: terms.map((t) => ({
                            city: { equals: t, mode: 'insensitive' },
                        })),
                    }
            );
        }
        if (searchParams.address)
            locConditions.push({
                address: { contains: searchParams.address, mode: 'insensitive' },
            });
        rentalBaseAnd.push({
            location: {
                is:
                    locConditions.length === 1 ? locConditions[0] : { AND: locConditions },
            },
        });
    }

    const hasQ = searchParams.q.length > 0;
    let textOr = [];
    if (hasQ) {
        textOr = [
            { title: { contains: searchParams.q, mode: 'insensitive' } },
            { description: { contains: searchParams.q, mode: 'insensitive' } },
            {
                location: {
                    is: { district: { contains: searchParams.q, mode: 'insensitive' } },
                },
            },
            {
                location: {
                    is: { city: { contains: searchParams.q, mode: 'insensitive' } },
                },
            },
            {
                location: {
                    is: { address: { contains: searchParams.q, mode: 'insensitive' } },
                },
            },
        ];
        const { cities: qCities, districts: qDistricts } =
            extractLocationTermsFromQuery(searchParams.q);
        if (qCities.length > 0)
            textOr.push({
                location: {
                    is: {
                        OR: qCities.map((c) => ({
                            city: { equals: c, mode: 'insensitive' },
                        })),
                    },
                },
            });
        if (qDistricts.length > 0)
            textOr.push({
                location: {
                    is: {
                        OR: qDistricts.map((d) => ({
                            district: { equals: d, mode: 'insensitive' },
                        })),
                    },
                },
            });
    }

    let roomWhere;
    if (hasQ) {
        const rentalBaseWhere =
            rentalBaseAnd.length === 1 ? rentalBaseAnd[0] : { AND: rentalBaseAnd };
        roomWhere = {
            status: { in: ['AVAILABLE', 'RENTED'] },
            AND: [
                { rentals: rentalBaseWhere },
                {
                    OR: [
                        { rentals: { OR: textOr } },
                        {
                            room_name: {
                                contains: searchParams.q,
                                mode: 'insensitive',
                            },
                        },
                        {
                            description: {
                                contains: searchParams.q,
                                mode: 'insensitive',
                            },
                        },
                    ],
                },
            ],
        };
    } else {
        const rentalWhere =
            rentalBaseAnd.length === 1 ? rentalBaseAnd[0] : { AND: rentalBaseAnd };
        roomWhere = { status: { in: ['AVAILABLE', 'RENTED'] }, rentals: rentalWhere };
    }
    if (
        (searchParams.minPrice != null && !Number.isNaN(searchParams.minPrice)) ||
        (searchParams.maxPrice != null && !Number.isNaN(searchParams.maxPrice))
    ) {
        roomWhere.price = {};
        if (searchParams.minPrice != null && !Number.isNaN(searchParams.minPrice))
            roomWhere.price.gte = searchParams.minPrice;
        if (searchParams.maxPrice != null && !Number.isNaN(searchParams.maxPrice))
            roomWhere.price.lte = searchParams.maxPrice;
    }
    if (searchParams.roomType) roomWhere.room_type = searchParams.roomType;
    if (
        (searchParams.minArea != null && !Number.isNaN(searchParams.minArea)) ||
        (searchParams.maxArea != null && !Number.isNaN(searchParams.maxArea))
    ) {
        roomWhere.size_m2 = {};
        if (searchParams.minArea != null && !Number.isNaN(searchParams.minArea))
            roomWhere.size_m2.gte = searchParams.minArea;
        if (searchParams.maxArea != null && !Number.isNaN(searchParams.maxArea))
            roomWhere.size_m2.lte = searchParams.maxArea;
    }
    if (searchParams.amenityIds.length > 0)
        roomWhere.roomAmenities = { some: { amenityId: { in: searchParams.amenityIds } } };

    const rooms = await prisma.rooms.findMany({
        where: roomWhere,
        include: {
            rentals: {
                include: {
                    location: true,
                    images: true,
                    users: {
                        select: { id: true, role: true, isVip: true },
                    },
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
        ratingRows.map((r) => [
            r.target_id,
            r._avg.rating != null ? Number(r._avg.rating) : null,
        ])
    );

    const scored = rooms.map((room) => {
        const avgRating = ratingByRoom[room.id] ?? null;
        const score = computeMatchScore(
            room,
            {
                ...searchParams,
                roomType: searchParams.roomType
                    ? mapDbToFe(searchParams.roomType, 'apartment')
                    : null,
            },
            preference,
            avgRating
        );
        const rental = room.rentals;
        const loc = rental?.location;
        const allRooms = rental?.rooms || [];
        const roomImgs = (room.images || []).map((img) => img.imageUrl);
        const rentalImgs = (rental?.images || []).map((img) => img.imageUrl);
        const imgs = roomImgs.length > 0 ? roomImgs : rentalImgs;
        const amenityNames = (room.roomAmenities || [])
            .map((ra) => ra.amenity?.name)
            .filter(Boolean);
        const owner = rental?.users || null;
        const isVipLandlord = owner?.role === 'LANDLORD' && owner?.isVip === true;

        const boostedScore = isVipLandlord
            ? Math.min(100, score + VIP_LANDLORD_SEARCH_BOOST)
            : score;

        const otherRooms = allRooms
            .filter((r) => r.id !== room.id)
            .map((r) => ({
                id: r.id,
                roomName: r.room_name,
                price: Number(r.price),
                area: r.size_m2 != null ? Number(r.size_m2) : null,
                roomType: mapDbToFe(r.room_type, 'apartment'),
                image:
                    (r.images || [])[0]?.imageUrl ||
                    rentalImgs[0] ||
                    placeholderImage,
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
            location: loc
                ? { district: loc.district, city: loc.city, address: loc.address }
                : null,
            matchScore: Math.round(boostedScore * 10) / 10,
            rating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
            otherRoomsInRental: otherRooms,
            isVipLandlord,
        };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);
    const ranked = applyFairnessGuard(scored);

    const total = ranked.length;
    const paginated = ranked.slice(
        (pageNum - 1) * limitNum,
        pageNum * limitNum
    ).map(({ isVipLandlord, ...item }) => item);

    return {
        data: paginated,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    };
}

/**
 * Personalized room recommendations
 */
async function getRecommend(userId) {
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
                    users: {
                        select: { id: true, role: true, isVip: true },
                    },
                },
            },
            roomAmenities: { include: { amenity: true } },
            images: true,
        },
        take: 80,
    });

    const roomIds = rooms.map((r) => r.id);
    const [ratingRows, popularityByRoom, similarUserFavorites] = await Promise.all([
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
        favoriteRoomIds.size > 0
            ? prisma.favoriteRoom.findMany({
                where: {
                    roomId: { in: Array.from(favoriteRoomIds) },
                    userId: { not: userId },
                },
                select: { userId: true },
            })
            : [],
    ]);
    const ratingByRoom = Object.fromEntries(
        ratingRows.map((r) => [
            r.target_id,
            r._avg.rating != null ? Number(r._avg.rating) : null,
        ])
    );

    const similarUserIds = [...new Set(similarUserFavorites.map((f) => f.userId))];
    let collaborativeByRoom = {};
    if (similarUserIds.length > 0) {
        const favs = await prisma.favoriteRoom.findMany({
            where: { userId: { in: similarUserIds }, roomId: { in: roomIds } },
            select: { roomId: true },
        });
        for (const f of favs) {
            collaborativeByRoom[f.roomId] = (collaborativeByRoom[f.roomId] || 0) + 1;
        }
        const maxCol = Math.max(1, ...Object.values(collaborativeByRoom));
        for (const rid of Object.keys(collaborativeByRoom)) {
            collaborativeByRoom[rid] = Math.min(100, Math.round((collaborativeByRoom[rid] / maxCol) * 100));
        }
    }

    const params = {
        q: '',
        district: '',
        city: '',
        address: '',
        minPrice: null,
        maxPrice: null,
        roomType: null,
        minArea: null,
        maxArea: null,
        amenityIds: [],
    };

    const scored = rooms
        .filter((room) => !favoriteRoomIds.has(room.id))
        .map((room) => {
            const avgRating = ratingByRoom[room.id] ?? null;
            let contentScore = computeMatchScore(room, params, preference, avgRating);
            contentScore += computeSimilarToFavoritesBonus(room, favoriteRooms);
            const collaborativeScore = collaborativeByRoom[room.id] ?? 0;
            const popularityScore = popularityByRoom[room.id] ?? 0;
            const contentNorm = Math.min(100, contentScore);
            const score = 0.4 * contentNorm + 0.4 * collaborativeScore + 0.2 * popularityScore;
            const rental = room.rentals;
            const loc = rental?.location;
            const roomImgs = (room.images || []).map((img) => img.imageUrl);
            const rentalImgs = (rental?.images || []).map((img) => img.imageUrl);
            const imgs = roomImgs.length > 0 ? roomImgs : rentalImgs;
            const amenityNames = (room.roomAmenities || [])
                .map((ra) => ra.amenity?.name)
                .filter(Boolean);

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
    if (favoriteRooms.length > 0 && preference)
        hint = 'Dựa trên sở thích và phòng bạn đã lưu';
    else if (favoriteRooms.length > 0) hint = 'Gợi ý tương tự phòng bạn đã lưu';
    else if (preference) hint = 'Dựa trên sở thích của bạn';

    return { data, hint };
}

module.exports = {
    getPublicSearch,
    getRecommend,
    applyFairnessGuard,
};
