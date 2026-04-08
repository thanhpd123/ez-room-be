const prisma = require('../config/prisma');

const strEq = (a, b) =>
    a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function tokenize(text) {
    if (!text) return [];
    return String(text)
        .trim()
        .toLowerCase()
        .split(/[,，、;\s]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 1);
}

function countDealBreakerViolations(dealBreakerText, otherLifestyle) {
    if (!dealBreakerText || !otherLifestyle) return 0;
    const db = String(dealBreakerText).trim().toLowerCase();
    if (!db) return 0;
    let violations = 0;
    if (/hút thuốc|thuốc lá|smoking|khói thuốc/.test(db) && otherLifestyle.smoking) violations++;
    if (/rượu|bia|uống rượu|drinking|nhậu/.test(db) && otherLifestyle.drinking) violations++;
    if (/dơ|bẩn|không sạch|ở bẩn|mất vệ sinh/.test(db)) {
        const low = String(otherLifestyle.cleanliness || '').trim().toLowerCase();
        if (low === 'bình thường' || low === 'không quan tâm') violations++;
    }
    if (/ồn|ồn ào|tiếng ồn|noise|gây ồn/.test(db)) {
        const low = String(otherLifestyle.noise_tolerance || '').trim().toLowerCase();
        if (low === 'cao') violations++;
    }
    if (/thú cưng|chó|mèo|pet|nuôi/.test(db) && otherLifestyle.pets_allowed) violations++;
    if (/khách|đưa người lạ|dẫn bạn|guest/.test(db)) {
        const low = String(otherLifestyle.guest_frequency || '').trim().toLowerCase();
        if (low === 'thường xuyên') violations++;
    }
    if (/thức khuya|về khuya|ngủ muộn|khuya/.test(db)) {
        const low = String(otherLifestyle.sleep_schedule || '').trim().toLowerCase();
        if (low.includes('sau 0h') || low.includes('khuya')) violations++;
    }
    return violations;
}

/**
 * Compute lifestyle compatibility score (0–100)
 *
 * Scoring breakdown:
 *   Thói quen  – smoking(10), drinking(8), pets_allowed(10), wfh(6) ........ 34 pts
 *   Sinh hoạt  – sleep_schedule(10), cleanliness(10),
 *                noise_tolerance(8), guest_frequency(6),
 *                personalityType(6), social_level(6) ........................ 46 pts
 *   Sở thích   – interests overlap ....................................... 15 pts
 */
function computeLifestyleScore(myLifestyle, candidateLifestyle, myPrefs, candidatePrefs) {
    let score = 0;
    let maxPossible = 0;
    let totalPenalties = 0;

    if (myLifestyle && candidateLifestyle) {
        const boolPairs = [
            [myLifestyle.smoking, candidateLifestyle.smoking, 10, 'smoking'],
            [myLifestyle.drinking, candidateLifestyle.drinking, 8, 'drinking'],
            [myLifestyle.pets_allowed, candidateLifestyle.pets_allowed, 10, 'pets'],
            [myLifestyle.work_from_home, candidateLifestyle.work_from_home, 6, 'wfh'],
        ];
        boolPairs.forEach(([a, b, pts, type]) => {
            maxPossible += pts;
            if (a === b) {
                score += pts;
            } else if (a !== undefined && a !== null && b !== undefined && b !== null) {
                if (type === 'smoking') totalPenalties += 10;
                if (type === 'pets') totalPenalties += 10;
            }
        });

        const strPairs = [
            [myLifestyle.sleep_schedule, candidateLifestyle.sleep_schedule, 10, 'sleep'],
            [myLifestyle.cleanliness, candidateLifestyle.cleanliness, 10, 'cleanliness'],
            [myLifestyle.noise_tolerance, candidateLifestyle.noise_tolerance, 8, 'noise'],
            [myLifestyle.guest_frequency, candidateLifestyle.guest_frequency, 6, 'guest'],
            [myLifestyle.personalityType, candidateLifestyle.personalityType, 6, 'personality'],
            [myLifestyle.social_level, candidateLifestyle.social_level, 6, 'social'],
        ];
        strPairs.forEach(([a, b, pts, type]) => {
            maxPossible += pts;
            if (strEq(a, b)) {
                score += pts;
            } else if (a && b) {
                if (type === 'sleep') totalPenalties += 10;
                if (type === 'cleanliness') totalPenalties += 10;
                if (type === 'guest') totalPenalties += 10;
            }
        });

        const myInterests = Array.isArray(myLifestyle.interests) ? myLifestyle.interests : [];
        const candInterests = Array.isArray(candidateLifestyle.interests) ? candidateLifestyle.interests : [];
        if (myInterests.length > 0 || candInterests.length > 0) {
            maxPossible += 15;
            if (myInterests.length > 0 && candInterests.length > 0) {
                const myTokens = new Set(myInterests.flatMap((s) => tokenize(s)));
                const candTokens = new Set(candInterests.flatMap((s) => tokenize(s)));
                let overlapCount = 0;
                for (const t of myTokens) {
                    if (candTokens.has(t)) overlapCount++;
                }
                const unionSize = new Set([...myTokens, ...candTokens]).size;
                if (unionSize > 0) {
                    score += Math.round(15 * (overlapCount / unionSize));
                }
            }
        }
    }

    if (maxPossible === 0) return 0;
    const computedPercentage = Math.round((score / maxPossible) * 100);
    return Math.min(100, Math.max(0, computedPercentage - totalPenalties));
}

// ─── Collaborative Filtering helpers ─────────────────────────────────────────

/**
 * Build roommate interaction matrix from RoommateMatch table.
 * PENDING: one-way (requester → target)
 * ACCEPTED: two-way
 * Returns Map<userId, Set<userId>>
 */
async function buildRoommateInteractionMatrix() {
    const matches = await prisma.roommateMatch.findMany({
        where: { status: { in: ['PENDING', 'ACCEPTED'] } },
        select: { requester_id: true, target_id: true, status: true },
    });
    const matrix = new Map();
    const addEdge = (from, to) => {
        if (!matrix.has(from)) matrix.set(from, new Set());
        matrix.get(from).add(to);
    };
    for (const m of matches) {
        addEdge(m.requester_id, m.target_id);
        if (m.status === 'ACCEPTED') addEdge(m.target_id, m.requester_id);
    }
    return matrix;
}

/**
 * Build room favorite matrix from FavoriteRoom table.
 * Returns Map<userId, Set<roomId>>
 */
async function buildRoomFavMatrix() {
    const favs = await prisma.favoriteRoom.findMany({
        select: { userId: true, roomId: true },
    });
    const matrix = new Map();
    for (const f of favs) {
        if (!matrix.has(f.userId)) matrix.set(f.userId, new Set());
        matrix.get(f.userId).add(f.roomId);
    }
    return matrix;
}

/**
 * Jaccard similarity between two Sets.
 * Returns number in [0.0, 1.0]
 */
function jaccardSimilarity(setA, setB) {
    if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Compute CF boost for a (userId, candidateId) pair using full CF algorithm.
 * roommateSim = max(directJaccard, maxNeighborJaccard)
 * roomFavSim  = jaccard(myFavSet, candFavSet)
 * combinedSim = min(1.0, 0.6 * roommateSim + 0.4 * roomFavSim)
 * cfBoost     = round(15 * combinedSim)  → [0, 15]
 */
function computeCFBoost(userId, candidateId, roommateMatrix, roomFavMatrix) {
    const myRoommateSet = roommateMatrix.get(userId) || new Set();
    const candRoommateSet = roommateMatrix.get(candidateId) || new Set();
    const myFavSet = roomFavMatrix.get(userId) || new Set();
    const candFavSet = roomFavMatrix.get(candidateId) || new Set();

    // Cold start: no data at all
    if (myRoommateSet.size === 0 && myFavSet.size === 0) return 0;

    // Direct jaccard between user and candidate
    const directJaccard = jaccardSimilarity(myRoommateSet, candRoommateSet);

    // Neighbor-based: find max jaccard between any neighbor of userId and candidateId
    let maxNeighborJaccard = 0;
    for (const [neighborId, neighborSet] of roommateMatrix) {
        if (neighborId === userId || neighborId === candidateId) continue;
        if (!myRoommateSet.has(neighborId)) continue; // only neighbors of userId
        const sim = jaccardSimilarity(candRoommateSet, neighborSet);
        if (sim > maxNeighborJaccard) maxNeighborJaccard = sim;
    }

    const roommateSim = Math.max(directJaccard, maxNeighborJaccard);
    const roomFavSim = jaccardSimilarity(myFavSet, candFavSet);
    const combinedSim = Math.min(1.0, 0.6 * roommateSim + 0.4 * roomFavSim);
    return Math.round(15 * combinedSim);
}

/**
 * Compute experience boost from roommate ratings for a list of candidate IDs.
 * experienceBoost = clamp(round(10 * (avgRating - 1) / 4), 0, 10)
 * wouldLiveAgainRate = round(countTrue / total * 100), null if no ratings
 * Returns Map<candidateId, { avgRating, experienceBoost, wouldLiveAgainRate }>
 */
async function computeExperienceData(candidateIds) {
    if (!candidateIds || candidateIds.length === 0) return new Map();

    const ratings = await prisma.roommateRating.findMany({
        where: { target_id: { in: candidateIds } },
        select: { target_id: true, overall_rating: true, would_live_again: true },
    });

    const grouped = new Map();
    for (const r of ratings) {
        if (!grouped.has(r.target_id)) grouped.set(r.target_id, []);
        grouped.get(r.target_id).push(r);
    }

    const result = new Map();
    for (const [targetId, list] of grouped) {
        const total = list.length;
        const avgRating = list.reduce((sum, r) => sum + r.overall_rating, 0) / total;
        const experienceBoost = Math.min(10, Math.max(0, Math.round(10 * (avgRating - 1) / 4)));
        const countTrue = list.filter((r) => r.would_live_again === true).length;
        const wouldLiveAgainRate = total > 0 ? Math.round((countTrue / total) * 100) : null;
        result.set(targetId, { avgRating, experienceBoost, wouldLiveAgainRate });
    }
    return result;
}

// ─── Core suggestion logic ────────────────────────────────────────────────────

/**
 * Lấy gợi ý roommate
 * matchScore = min(100, lifestyleScore + cfBoost + experienceBoost)
 */
async function getSuggestions(userId, params) {
    const limit = Math.min(50, Math.max(1, parseInt(params.limit) || 20));

    const me = await prisma.user.findUnique({
        where: { id: userId },
        include: { lifestyleProfile: true, preference: true },
    });
    if (!me) {
        throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const existingMatches = await prisma.roommateMatch.findMany({
        where: { OR: [{ requester_id: userId }, { target_id: userId }] },
        select: { requester_id: true, target_id: true, status: true },
    });

    const matchStatusMap = new Map();
    existingMatches.forEach((m) => {
        const otherId = m.requester_id === userId ? m.target_id : m.requester_id;
        matchStatusMap.set(otherId, m.status);
    });

    // Exclude self and BLOCKED users only
    const excludeIds = new Set([userId]);
    existingMatches.forEach((m) => {
        if (m.status === 'BLOCKED') {
            const otherId = m.requester_id === userId ? m.target_id : m.requester_id;
            excludeIds.add(otherId);
        }
    });

    const genderNorm = (g) => {
        if (!g) return null;
        const s = String(g).trim().toLowerCase();
        if (s === 'nam' || s === 'male') return 'nam';
        if (s === 'nữ' || s === 'female' || s === 'nu') return 'nữ';
        if (s === 'khác' || s === 'other') return 'khác';
        return s;
    };
    const myGenderNorm = genderNorm(me.gender);
    const hasUsableGender =
        !!myGenderNorm &&
        myGenderNorm !== 'không tiết lộ' &&
        myGenderNorm !== 'khong tiet lo';

    let candidates = await prisma.user.findMany({
        where: {
            id: { notIn: Array.from(excludeIds) },
            status: 'ACTIVE',
            role: 'TENANT',
        },
        include: { lifestyleProfile: true, preference: true },
    });

    if (hasUsableGender && (myGenderNorm === 'nam' || myGenderNorm === 'nữ')) {
        candidates = candidates.filter((u) => genderNorm(u.gender) === myGenderNorm);
    }

    const candidateIds = candidates.map((u) => u.id);

    // Load all CF and experience data in parallel (single batch per source)
    const [roommateMatrix, roomFavMatrix, experienceMap] = await Promise.all([
        buildRoommateInteractionMatrix().catch(() => new Map()),
        buildRoomFavMatrix().catch(() => new Map()),
        computeExperienceData(candidateIds).catch(() => new Map()),
    ]);

    const scored = candidates.map((u) => {
        const candidateGenderNorm = genderNorm(u.gender);
        const isSameGender = hasUsableGender && candidateGenderNorm === myGenderNorm;

        const lifestyleScore = computeLifestyleScore(
            me.lifestyleProfile,
            u.lifestyleProfile,
            me.preference,
            u.preference
        );
        const cfBoost = computeCFBoost(userId, u.id, roommateMatrix, roomFavMatrix);
        const expData = experienceMap.get(u.id) || { experienceBoost: 0, wouldLiveAgainRate: null };
        const matchScore = Math.min(100, lifestyleScore + cfBoost + expData.experienceBoost);

        return {
            user: {
                id: u.id,
                fullName: u.fullName,
                avatarUrl: u.avatarUrl,
                gender: u.gender,
            },
            lifestyle: u.lifestyleProfile
                ? {
                      smoking: u.lifestyleProfile.smoking,
                      drinking: u.lifestyleProfile.drinking,
                      pets_allowed: u.lifestyleProfile.pets_allowed,
                      sleep_schedule: u.lifestyleProfile.sleep_schedule,
                      work_from_home: u.lifestyleProfile.work_from_home,
                      personalityType: u.lifestyleProfile.personalityType,
                      social_level: u.lifestyleProfile.social_level,
                      cleanliness: u.lifestyleProfile.cleanliness,
                      noise_tolerance: u.lifestyleProfile.noise_tolerance,
                      guest_frequency: u.lifestyleProfile.guest_frequency,
                      interests: u.lifestyleProfile.interests || [],
                      deal_breakers: u.lifestyleProfile.deal_breakers || null,
                  }
                : null,
            preference: u.preference
                ? {
                      preferred_districts: u.preference.preferred_districts || [],
                      room_type: u.preference.room_type,
                      budget_min: u.preference.budget_min ? Number(u.preference.budget_min) : null,
                      budget_max: u.preference.budget_max ? Number(u.preference.budget_max) : null,
                      preferredLocation: u.preference.preferredLocation || null,
                  }
                : null,
            matchScore,
            cfScore: cfBoost,
            experienceScore: expData.experienceBoost,
            wouldLiveAgainRate: expData.wouldLiveAgainRate,
            isSameGender,
            matchStatus: matchStatusMap.get(u.id) || null,
        };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);
    return {
        data: scored.slice(0, limit),
        message: hasUsableGender
            ? undefined
            : 'Bạn chưa cập nhật giới tính, đang gợi ý roommate từ toàn bộ tenant theo điểm phù hợp.',
    };
}

// ─── Match management ─────────────────────────────────────────────────────────

async function sendRequest(requesterId, targetId) {
    if (requesterId === targetId) {
        throw Object.assign(new Error('Không thể gửi lời mời cho chính mình'), { statusCode: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target || target.status !== 'ACTIVE' || target.role !== 'TENANT') {
        throw Object.assign(
            new Error('Người dùng không tồn tại hoặc không phải tenant'),
            { statusCode: 404 }
        );
    }

    const existing = await prisma.roommateMatch.findUnique({
        where: { requester_id_target_id: { requester_id: requesterId, target_id: targetId } },
    });
    if (existing) {
        if (existing.status === 'PENDING')
            throw Object.assign(new Error('Bạn đã gửi lời mời trước đó'), { statusCode: 400 });
        if (existing.status === 'ACCEPTED')
            throw Object.assign(new Error('Hai bạn đã là match'), { statusCode: 400 });
        if (existing.status === 'REJECTED' || existing.status === 'BLOCKED')
            throw Object.assign(new Error('Không thể gửi lời mời'), { statusCode: 400 });
    }

    const reverse = await prisma.roommateMatch.findUnique({
        where: { requester_id_target_id: { requester_id: targetId, target_id: requesterId } },
    });
    if (reverse && reverse.status === 'PENDING') {
        throw Object.assign(
            new Error('Người này đã gửi lời mời cho bạn. Hãy xem trong "Lời mời nhận được" và chấp nhận.'),
            { statusCode: 400 }
        );
    }

    const match = await prisma.roommateMatch.create({
        data: { requester_id: requesterId, target_id: targetId, status: 'PENDING' },
    });

    return {
        data: {
            id: match.id,
            requesterId: match.requester_id,
            targetId: match.target_id,
            status: match.status,
            createdAt: match.created_at,
        },
    };
}

async function getMyMatches(userId) {
    const matches = await prisma.roommateMatch.findMany({
        where: { OR: [{ requester_id: userId }, { target_id: userId }] },
        orderBy: { created_at: 'desc' },
    });

    const otherIds = [
        ...new Set(matches.map((m) => (m.requester_id === userId ? m.target_id : m.requester_id))),
    ];
    const users =
        otherIds.length > 0
            ? await prisma.user.findMany({
                  where: { id: { in: otherIds } },
                  select: { id: true, fullName: true, avatarUrl: true, gender: true },
              })
            : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const allUserIds = [...new Set([userId, ...otherIds])];
    const inviteNotifs =
        allUserIds.length > 0
            ? await prisma.notification.findMany({
                  where: { userId: { in: allUserIds }, type: 'ROOMMATE_INVITE' },
                  orderBy: { createdAt: 'desc' },
                  select: { userId: true, body: true, createdAt: true },
              })
            : [];

    const roomIdByUser = new Map();
    for (const n of inviteNotifs) {
        if (!roomIdByUser.has(n.userId) && n.body) {
            const m = n.body.match(/\|\|ROOM_ID:([a-f0-9-]+)\|\|/i);
            if (m) roomIdByUser.set(n.userId, m[1]);
        }
    }

    const list = matches.map((m) => {
        const isRequester = m.requester_id === userId;
        const otherId = isRequester ? m.target_id : m.requester_id;
        const other = userMap.get(otherId) || null;
        const roomId = roomIdByUser.get(userId) || roomIdByUser.get(otherId) || null;
        return {
            id: m.id,
            status: m.status,
            createdAt: m.created_at,
            isRequester,
            roomId,
            otherUser: other
                ? { id: other.id, fullName: other.fullName, avatarUrl: other.avatarUrl, gender: other.gender }
                : null,
        };
    });

    return { data: list };
}

async function updateMatchStatus(userId, matchId, body) {
    const { status } = body;
    if (!status || !['ACCEPTED', 'REJECTED'].includes(status)) {
        throw Object.assign(new Error('status phải là ACCEPTED hoặc REJECTED'), { statusCode: 400 });
    }

    const match = await prisma.roommateMatch.findUnique({ where: { id: matchId } });
    if (!match) throw Object.assign(new Error('Không tìm thấy lời mời'), { statusCode: 404 });
    if (match.target_id !== userId)
        throw Object.assign(new Error('Chỉ người nhận mới có thể chấp nhận/từ chối'), { statusCode: 403 });
    if (match.status !== 'PENDING')
        throw Object.assign(new Error('Lời mời đã được xử lý'), { statusCode: 400 });

    const updated = await prisma.roommateMatch.update({ where: { id: matchId }, data: { status } });
    return {
        message: status === 'ACCEPTED' ? 'Đã chấp nhận lời mời' : 'Đã từ chối lời mời',
        data: { id: updated.id, status: updated.status },
    };
}

// ─── Profile & Room helpers ───────────────────────────────────────────────────

async function getPublicProfile(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            gender: true,
            createdAt: true,
            lifestyleProfile: true,
            preference: {
                select: {
                    preferred_districts: true,
                    room_type: true,
                    budget_min: true,
                    budget_max: true,
                    preferred_amenities: true,
                    must_have_amenities: true,
                    preferred_lease_months: true,
                    pet_friendly: true,
                    transport_nearby: true,
                },
            },
        },
    });

    if (!user) throw Object.assign(new Error('Không tìm thấy người dùng'), { statusCode: 404 });

    const lp = user.lifestyleProfile;
    return {
        data: {
            user: {
                id: user.id,
                fullName: user.fullName,
                avatarUrl: user.avatarUrl,
                gender: user.gender,
                memberSince: user.createdAt,
            },
            lifestyle: lp
                ? {
                      smoking: lp.smoking,
                      drinking: lp.drinking,
                      pets_allowed: lp.pets_allowed,
                      sleep_schedule: lp.sleep_schedule,
                      work_from_home: lp.work_from_home,
                      personalityType: lp.personalityType,
                      social_level: lp.social_level,
                      cleanliness: lp.cleanliness,
                      noise_tolerance: lp.noise_tolerance,
                      guest_frequency: lp.guest_frequency,
                      cooking_frequency: lp.cooking_frequency,
                      wake_time: lp.wake_time,
                      bedtime: lp.bedtime,
                      occupation_type: lp.occupation_type,
                      temperature_preference: lp.temperature_preference,
                      quiet_hours_preference: lp.quiet_hours_preference,
                      interests: lp.interests || [],
                      deal_breakers: lp.deal_breakers || null,
                      languages: lp.languages || [],
                      preferred_lease_months: lp.preferred_lease_months,
                  }
                : null,
            preference: user.preference
                ? {
                      preferred_districts: user.preference.preferred_districts || [],
                      room_type: user.preference.room_type,
                      budget_min: user.preference.budget_min ? Number(user.preference.budget_min) : null,
                      budget_max: user.preference.budget_max ? Number(user.preference.budget_max) : null,
                      preferred_amenities: user.preference.preferred_amenities || [],
                      must_have_amenities: user.preference.must_have_amenities || [],
                      preferred_lease_months: user.preference.preferred_lease_months,
                      pet_friendly: user.preference.pet_friendly,
                      transport_nearby: user.preference.transport_nearby,
                  }
                : null,
        },
    };
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

async function getMyActiveRooms(userId) {
    const periods = await prisma.roomRentalPeriod.findMany({
        where: { userId, status: 'ACTIVE' },
        include: {
            room: {
                include: {
                    images: { take: 1 },
                    rentals: { include: { location: true, images: { take: 1 } } },
                },
            },
        },
        orderBy: { startDate: 'desc' },
    });

    return {
        data: periods.map((p) => {
            const room = p.room;
            const rental = room?.rentals;
            const loc = rental?.location;
            const address = loc ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ') : '';
            return {
                rentalPeriodId: p.id,
                roomId: room?.id,
                roomName: room?.room_name || 'Phòng',
                propertyName: rental?.title || 'Nhà trọ',
                price: room?.price ? Number(room.price) : null,
                address,
                image: room?.images?.[0]?.imageUrl || rental?.images?.[0]?.imageUrl || null,
                startDate: p.startDate,
                endDate: p.endDate,
            };
        }),
    };
}

async function inviteRoommate(inviterId, targetUserId, roomId) {
    if (inviterId === targetUserId) {
        throw Object.assign(new Error('Không thể mời chính mình'), { statusCode: 400 });
    }

    const match = await prisma.roommateMatch.findFirst({
        where: {
            OR: [
                { requester_id: inviterId, target_id: targetUserId },
                { requester_id: targetUserId, target_id: inviterId },
            ],
            status: 'ACCEPTED',
        },
    });
    if (!match) {
        throw Object.assign(
            new Error('Hai bạn chưa kết bạn roommate hoặc lời mời chưa được chấp nhận'),
            { statusCode: 400 }
        );
    }

    const rentalPeriod = await prisma.roomRentalPeriod.findFirst({
        where: { userId: inviterId, roomId, status: 'ACTIVE' },
    });
    if (!rentalPeriod) {
        throw Object.assign(
            new Error('Bạn không có hợp đồng thuê phòng này đang hoạt động'),
            { statusCode: 400 }
        );
    }

    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
            images: { take: 1 },
            rentals: { include: { location: true, images: { take: 1 } } },
        },
    });
    if (!room) throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });

    const [inviter, targetUser] = await Promise.all([
        prisma.user.findUnique({ where: { id: inviterId }, select: { id: true, fullName: true } }),
        prisma.user.findUnique({
            where: { id: targetUserId },
            select: { id: true, fullName: true, email: true, status: true },
        }),
    ]);
    if (!targetUser || targetUser.status !== 'ACTIVE') {
        throw Object.assign(new Error('Người dùng không tồn tại hoặc không hoạt động'), { statusCode: 404 });
    }

    const rental = room.rentals;
    const loc = rental?.location;
    const roomTitle = room.room_name || rental?.title || 'Phòng trọ';
    const address = loc ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ') : '';
    const price = room.price ? Number(room.price).toLocaleString('vi-VN') + ' VNĐ/tháng' : '';
    const roomUrl = `${FRONTEND_URL.replace(/\/$/, '')}/room/${room.id}`;

    const notifBody = `${inviter.fullName} mời bạn ở ghép phòng "${roomTitle}" tại ${address}. Giá: ${price}. Xem chi tiết phòng để quyết định.||ROOM_ID:${room.id}||`;
    await prisma.notification.create({
        data: {
            userId: targetUserId,
            type: 'ROOMMATE_INVITE',
            title: `${inviter.fullName} mời bạn ở ghép`,
            body: notifBody,
            status: 'UNREAD',
        },
    });

    const { sendEmail } = require('../utils/email');
    const subject = `EZRoom – ${inviter.fullName} mời bạn ở ghép phòng "${roomTitle}"`;
    const text = `Chào ${targetUser.fullName},\n\n${inviter.fullName} mời bạn ở ghép phòng "${roomTitle}".\n\nĐịa chỉ: ${address}\nGiá: ${price}\n\nXem chi tiết phòng: ${roomUrl}\n\n— EZRoom`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <h2 style="color:#2d8a6e">🏠 Lời mời ở ghép từ ${inviter.fullName}</h2>
            <p>Chào <strong>${targetUser.fullName}</strong>,</p>
            <p><strong>${inviter.fullName}</strong> mời bạn ở ghép phòng:</p>
            <div style="background:#f7faf9;border:1px solid #d4e8e0;border-radius:12px;padding:16px;margin:16px 0">
                ${room.images?.[0]?.imageUrl ? `<img src="${room.images[0].imageUrl}" alt="${roomTitle}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:12px">` : ''}
                <h3 style="margin:0 0 8px;color:#1a1a1a">${roomTitle}</h3>
                <p style="margin:4px 0;color:#666">📍 ${address}</p>
                <p style="margin:4px 0;color:#666">💰 ${price}</p>
            </div>
            <a href="${roomUrl}" style="display:inline-block;background:#2d8a6e;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;margin-top:8px">Xem chi tiết phòng</a>
            <p style="margin-top:24px;color:#999;font-size:13px">— EZRoom</p>
        </div>
    `;
    await sendEmail(targetUser.email, subject, text, html).catch((err) =>
        console.error('Send roommate invite email error:', err)
    );

    return { message: `Đã gửi lời mời ở ghép đến ${targetUser.fullName}` };
}

// ─── Area search ──────────────────────────────────────────────────────────────

async function getTopSearchersInArea(currentUserId, areaQuery, limit = 10) {
    const area = (areaQuery || '').trim();
    if (!area || area.length < 1) {
        throw Object.assign(new Error('Vui lòng nhập khu vực'), { statusCode: 400 });
    }

    const roomsInArea = await prisma.rooms.findMany({
        where: {
            rentals: {
                OR: [
                    {
                        location: {
                            OR: [
                                { district: { contains: area, mode: 'insensitive' } },
                                { city: { contains: area, mode: 'insensitive' } },
                                { address: { contains: area, mode: 'insensitive' } },
                            ],
                        },
                    },
                    { title: { contains: area, mode: 'insensitive' } },
                ],
            },
        },
        select: {
            id: true,
            rentals: {
                select: {
                    title: true,
                    location: { select: { address: true, district: true, city: true } },
                },
            },
        },
    });

    const roomIdsInArea = roomsInArea.map((r) => r.id);
    if (roomIdsInArea.length === 0) {
        return { data: [], area, totalRoomsInArea: 0 };
    }

    const [viewCounts, favCounts, preorderCounts] = await Promise.all([
        prisma.user_room_interactions.groupBy({
            by: ['user_id'],
            where: { room_id: { in: roomIdsInArea }, interaction_type: 'VIEW' },
            _count: { user_id: true },
        }),
        prisma.favoriteRoom.groupBy({
            by: ['userId'],
            where: { roomId: { in: roomIdsInArea } },
            _count: { userId: true },
        }),
        prisma.preorder.groupBy({
            by: ['userId'],
            where: { roomId: { in: roomIdsInArea } },
            _count: { userId: true },
        }),
    ]);

    const activityMap = new Map();
    for (const row of viewCounts) {
        const uid = row.user_id;
        if (!activityMap.has(uid)) activityMap.set(uid, { views: 0, fav: 0, preorder: 0, total: 0 });
        const entry = activityMap.get(uid);
        entry.views = row._count.user_id;
        entry.total += row._count.user_id * 1;
    }
    for (const row of favCounts) {
        const uid = row.userId;
        if (!activityMap.has(uid)) activityMap.set(uid, { views: 0, fav: 0, preorder: 0, total: 0 });
        const entry = activityMap.get(uid);
        entry.fav = row._count.userId;
        entry.total += row._count.userId * 3;
    }
    for (const row of preorderCounts) {
        const uid = row.userId;
        if (!activityMap.has(uid)) activityMap.set(uid, { views: 0, fav: 0, preorder: 0, total: 0 });
        const entry = activityMap.get(uid);
        entry.preorder = row._count.userId;
        entry.total += row._count.userId * 5;
    }

    activityMap.delete(currentUserId);
    if (activityMap.size === 0) {
        return { data: [], area, totalRoomsInArea: roomIdsInArea.length };
    }

    const sortedUserIds = [...activityMap.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, Math.min(50, limit))
        .map(([uid]) => uid);

    const [users, currentUser] = await Promise.all([
        prisma.user.findMany({
            where: { id: { in: sortedUserIds }, status: 'ACTIVE', role: 'TENANT' },
            include: { lifestyleProfile: true, preference: true },
        }),
        prisma.user.findUnique({
            where: { id: currentUserId },
            include: { lifestyleProfile: true, preference: true },
        }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const genderNorm = (g) => {
        if (!g) return null;
        const s = String(g).trim().toLowerCase();
        if (s === 'nam' || s === 'male') return 'nam';
        if (s === 'nữ' || s === 'female' || s === 'nu') return 'nữ';
        if (s === 'khác' || s === 'other') return 'khác';
        return s;
    };
    const myGenderNorm = currentUser ? genderNorm(currentUser.gender) : null;
    const hasUsableGender = !!myGenderNorm && myGenderNorm !== 'không tiết lộ';

    const data = sortedUserIds
        .map((uid) => {
            const u = userMap.get(uid);
            if (!u) return null;
            const activity = activityMap.get(uid);
            const candidateGenderNorm = genderNorm(u.gender);
            const isSameGender = hasUsableGender && candidateGenderNorm === myGenderNorm;
            const baseScore = currentUser
                ? computeLifestyleScore(
                      currentUser.lifestyleProfile,
                      u.lifestyleProfile,
                      currentUser.preference,
                      u.preference
                  )
                : 0;
            return {
                user: { id: u.id, fullName: u.fullName, avatarUrl: u.avatarUrl, gender: u.gender },
                lifestyle: u.lifestyleProfile
                    ? {
                          smoking: u.lifestyleProfile.smoking,
                          drinking: u.lifestyleProfile.drinking,
                          pets_allowed: u.lifestyleProfile.pets_allowed,
                          sleep_schedule: u.lifestyleProfile.sleep_schedule,
                          personalityType: u.lifestyleProfile.personalityType,
                          cleanliness: u.lifestyleProfile.cleanliness,
                          noise_tolerance: u.lifestyleProfile.noise_tolerance,
                          guest_frequency: u.lifestyleProfile.guest_frequency,
                          interests: u.lifestyleProfile.interests || [],
                          deal_breakers: u.lifestyleProfile.deal_breakers || null,
                      }
                    : null,
                preference: u.preference
                    ? {
                          preferred_districts: u.preference.preferred_districts || [],
                          room_type: u.preference.room_type,
                          budget_min: u.preference.budget_min ? Number(u.preference.budget_min) : null,
                          budget_max: u.preference.budget_max ? Number(u.preference.budget_max) : null,
                          preferredLocation: u.preference.preferredLocation || null,
                      }
                    : null,
                matchScore: Math.min(100, baseScore),
                isSameGender,
                activityInArea: {
                    views: activity.views,
                    favorites: activity.fav,
                    preorders: activity.preorder,
                    totalScore: activity.total,
                },
            };
        })
        .filter(Boolean)
        .slice(0, limit);

    return { data, area, totalRoomsInArea: roomIdsInArea.length };
}

// ─── Roommate Rating ──────────────────────────────────────────────────────────

function periodsOverlap(startA, endA, startB, endB) {
    const endAEff = endA || new Date('9999-12-31');
    const endBEff = endB || new Date('9999-12-31');
    return startA <= endBEff && startB <= endAEff;
}

async function createRoommateRating(reviewerId, body) {
    const { targetId, rentalPeriodId, overallRating, wouldLiveAgain, comment } = body;

    if (!targetId || !rentalPeriodId || overallRating == null || wouldLiveAgain == null) {
        const err = new Error('Thiếu thông tin bắt buộc (targetId, rentalPeriodId, overallRating, wouldLiveAgain)');
        err.statusCode = 400;
        throw err;
    }
    if (overallRating < 1 || overallRating > 5) {
        const err = new Error('Rating phải trong khoảng 1–5');
        err.statusCode = 400;
        throw err;
    }
    if (typeof wouldLiveAgain !== 'boolean') {
        const err = new Error('wouldLiveAgain phải là true hoặc false');
        err.statusCode = 400;
        throw err;
    }

    const [reviewerPeriods, targetPeriods] = await Promise.all([
        prisma.roomRentalPeriod.findMany({
            where: { userId: reviewerId },
            select: { id: true, roomId: true, startDate: true, endDate: true },
        }),
        prisma.roomRentalPeriod.findMany({
            where: { userId: targetId },
            select: { id: true, roomId: true, startDate: true, endDate: true },
        }),
    ]);

    const hasSharedPeriod = reviewerPeriods.some((rp) =>
        targetPeriods.some(
            (tp) => tp.roomId === rp.roomId && periodsOverlap(rp.startDate, rp.endDate, tp.startDate, tp.endDate)
        )
    );
    if (!hasSharedPeriod) {
        const err = new Error('Bạn chưa từng ở cùng người này');
        err.statusCode = 403;
        throw err;
    }

    // Enforce: chỉ được đánh giá 1 lần duy nhất cho mỗi target
    const existingAny = await prisma.roommateRating.findFirst({
        where: { reviewer_id: reviewerId, target_id: targetId },
    });
    if (existingAny) {
        const err = new Error('Bạn đã đánh giá người này rồi');
        err.statusCode = 409;
        throw err;
    }

    const rating = await prisma.roommateRating.create({
        data: {
            reviewer_id: reviewerId,
            target_id: targetId,
            rental_period_id: rentalPeriodId,
            overall_rating: overallRating,
            would_live_again: wouldLiveAgain,
            comment: comment || null,
        },
    });

    return { data: rating };
}

async function checkRoommateRating(reviewerId, targetId, rentalPeriodId) {
    const existing = await prisma.roommateRating.findFirst({
        where: { reviewer_id: reviewerId, target_id: targetId },
        select: {
            id: true,
            overall_rating: true,
            would_live_again: true,
            comment: true,
            created_at: true,
        },
    });
    return { data: existing || null };
}

module.exports = {
    computeLifestyleScore,
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
    getPublicProfile,
    getMyActiveRooms,
    inviteRoommate,
    getTopSearchersInArea,
    createRoommateRating,
    checkRoommateRating,
    // helpers exported for testing
    jaccardSimilarity,
    computeCFBoost,
    computeExperienceData,
    buildRoommateInteractionMatrix,
    buildRoomFavMatrix,
};
