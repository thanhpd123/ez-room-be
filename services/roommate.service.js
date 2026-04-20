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



// ─── Vector-based Weighted Cosine Similarity ─────────────────────────────────

/**
 * Quantization maps: convert categorical/ordinal lifestyle values to [0, 1].
 * For ordinal scales, values are evenly spaced so that "nearby" options
 * produce vectors that are close together (unlike simple matching where
 * "Sạch" vs "Rất sạch" would score 0).
 */


const QUANT_MAPS = {
    sleep_schedule: {
        'sớm (trước 22h)': 0.0,
        'bình thường (22h-0h)': 0.5,
        'khuya (sau 0h)': 1.0,
    },
    cleanliness: {
        'không quan tâm': 0.0,
        'bình thường': 0.33,
        'sạch': 0.67,
        'rất sạch': 1.0,
    },
    noise_tolerance: {
        'thấp': 0.0,
        'trung bình': 0.5,
        'cao': 1.0,
    },
    social_level: {
        'thấp': 0.0,
        'trung bình': 0.5,
        'cao': 1.0,
    },
    guest_frequency: {
        'không bao giờ': 0.0,
        'hiếm': 0.33,
        'thỉnh thoảng': 0.67,
        'thường xuyên': 1.0,
    },
    cooking_frequency: {
        'không nấu': 0.0,
        'ít': 0.33,
        'thường xuyên': 0.67,
        'hàng ngày': 1.0,
    },
};

/**
 * Weights for each lifestyle criterion, summing to 1.0.
 * Higher weights = more influence on compatibility score.
 * Weights are based on real-world roommate conflict potential.
 */
const LIFESTYLE_WEIGHTS = {
    smoking:            0.15,   
    sleep_schedule:     0.14,   
    pets_allowed:       0.12,   
    noise_tolerance:    0.10,  
    guest_frequency:    0.08,  
    drinking:           0.07,   
    social_level:       0.06,   
    cooking_frequency:  0.04,  
    work_from_home:     0.04,  
    personalityType:    0.04,  
    interests:          0.03,   
};

/**
 * Quantize a single lifestyle field value to [0, 1].
 * Returns null if value is missing or not found in the map.
 */
function quantize(fieldName, rawValue) {
    if (rawValue === undefined || rawValue === null) return null;

    // Binary fields: true → 1, false → 0
    if (typeof rawValue === 'boolean') return rawValue ? 1.0 : 0.0;

    // Ordinal/categorical fields: lookup in QUANT_MAPS
    const map = QUANT_MAPS[fieldName];
    if (!map) return null;

    const key = String(rawValue).trim().toLowerCase();
    const val = map[key];
    return val !== undefined ? val : null;
}

/**
 * Build a feature vector from a LifestyleProfile.
 * Each entry: { key, value, weight }.
 * Only includes dimensions where the user has data (non-null).
 */
function vectorizeLifestyle(lifestyle) {
    if (!lifestyle) return [];

    const features = [];

    // Binary fields
    const binaryFields = ['smoking', 'drinking', 'pets_allowed', 'work_from_home'];
    for (const field of binaryFields) {
        const val = quantize(field, lifestyle[field]);
        if (val !== null) {
            features.push({ key: field, value: val, weight: LIFESTYLE_WEIGHTS[field] || 0 });
        }
    }

    // Ordinal fields
    const ordinalFields = [
        'sleep_schedule', 'cleanliness', 'noise_tolerance',
        'social_level', 'guest_frequency', 'cooking_frequency',
    ];
    for (const field of ordinalFields) {
        const val = quantize(field, lifestyle[field]);
        if (val !== null) {
            features.push({ key: field, value: val, weight: LIFESTYLE_WEIGHTS[field] || 0 });
        }
    }

    // Personality type: same → 1.0, different → 0.0 (categorical, no ordinal proximity)
    if (lifestyle.personalityType) {
        features.push({
            key: 'personalityType',
            value: lifestyle.personalityType,  // stored as string, compared later
            weight: LIFESTYLE_WEIGHTS.personalityType || 0,
        });
    }

    // Interests: stored as Jaccard similarity (computed during comparison, not here)
    const interests = Array.isArray(lifestyle.interests) ? lifestyle.interests : [];
    if (interests.length > 0) {
        features.push({
            key: 'interests',
            value: interests,  // stored as array, Jaccard computed later
            weight: LIFESTYLE_WEIGHTS.interests || 0,
        });
    }

    return features;
}



/**
 * Compute Weighted Cosine Similarity between two lifestyle vectors.
 *
 * For numeric dimensions:  similarity_i = 1 - |aᵢ - bᵢ|  (distance-based, [0,1])
 * For categorical (personalityType): similarity_i = (same → 1, different → 0)
 * For interests: similarity_i = Jaccard(A_interests, B_interests)
 *
 * Final score = Σ(wᵢ * simᵢ) / Σ(wᵢ)  for shared dimensions only
 * This gives a weighted average of per-dimension similarities ∈ [0, 1].
 */
function weightedCosineSimilarity(vecA, vecB) {
    // Build lookup maps
    const mapA = new Map();
    for (const f of vecA) mapA.set(f.key, f);
    const mapB = new Map();
    for (const f of vecB) mapB.set(f.key, f);

    let weightedSimSum = 0;
    let totalWeight = 0;

    // Iterate over all possible dimensions (union of both vectors)
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    for (const key of allKeys) {
        const a = mapA.get(key);
        const b = mapB.get(key);

        // Only score dimensions where BOTH users have data
        if (!a || !b) continue;

        const w = a.weight || b.weight || 0;
        if (w === 0) continue;

        let sim = 0;

        if (key === 'interests') {
            // Jaccard similarity for interests
            const tokensA = new Set((a.value || []).flatMap((s) => tokenize(s)));
            const tokensB = new Set((b.value || []).flatMap((s) => tokenize(s)));
            if (tokensA.size === 0 && tokensB.size === 0) {
                sim = 1.0; // Both empty = identical
            } else {
                let overlap = 0;
                for (const t of tokensA) {
                    if (tokensB.has(t)) overlap++;
                }
                const unionSize = new Set([...tokensA, ...tokensB]).size;
                sim = unionSize > 0 ? overlap / unionSize : 0;
            }
        } else if (key === 'personalityType') {
            // Categorical: exact match = 1, else = 0
            sim = strEq(a.value, b.value) ? 1.0 : 0.0;
        } else {
            // Numeric ordinal/binary: similarity = 1 - |a - b|
            sim = 1.0 - Math.abs(a.value - b.value);
        }

        weightedSimSum += w * sim;
        totalWeight += w;
    }

    if (totalWeight === 0) return 0;
    return weightedSimSum / totalWeight; // ∈ [0, 1]
}

/**
 * Compute lifestyle compatibility score (0–100) using Vector-based
 * Weighted Cosine Similarity.
 *
 * Architecture (3 layers):
 *   Layer 1 — Quantization: convert all lifestyle values to [0, 1] scale
 *   Layer 2 — Vectorization + Weighting: build weighted feature vectors
 *   Layer 3 — Weighted Cosine Similarity: compute overall compatibility
 */
function computeLifestyleScore(myLifestyle, candidateLifestyle, myPrefs, candidatePrefs) {
    if (!myLifestyle || !candidateLifestyle) return 0;

    // Layer 1 & 2: Vectorize both profiles
    const vecA = vectorizeLifestyle(myLifestyle);
    const vecB = vectorizeLifestyle(candidateLifestyle);

    if (vecA.length === 0 || vecB.length === 0) return 0;

    // Layer 3: Weighted Cosine Similarity → [0, 1]
    const similarity = weightedCosineSimilarity(vecA, vecB);

    // Convert to percentage [0, 100]
    let score = Math.round(similarity * 100);

    return Math.min(100, Math.max(0, score));
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
        select: { target_id: true, overall_rating: true },
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
        const wouldLiveAgainRate = null;
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
        // Giữ lại: cùng giới HOẶC chưa khai báo giới tính (null/undefined/rỗng)
        // Loại bỏ: rõ ràng khác giới
        candidates = candidates.filter((u) => {
            const cg = genderNorm(u.gender);
            return cg === myGenderNorm || cg === null;
        });
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
    if (reverse) {
        if (reverse.status === 'PENDING') {
            throw Object.assign(
                new Error('Người này đã gửi lời mời cho bạn. Hãy xem trong "Lời mời nhận được" và chấp nhận.'),
                { statusCode: 400 }
            );
        }
        if (reverse.status === 'ACCEPTED') {
            throw Object.assign(new Error('Hai bạn đã là match'), { statusCode: 400 });
        }
        if (reverse.status === 'REJECTED' || reverse.status === 'BLOCKED') {
            throw Object.assign(new Error('Không thể gửi lời mời'), { statusCode: 400 });
        }
    }

    const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { fullName: true } });

    const match = await prisma.roommateMatch.create({
        data: { requester_id: requesterId, target_id: targetId, status: 'PENDING' },
    });

    await prisma.notification.create({
        data: {
            userId: targetId,
            type: 'ROOMMATE_INVITE',
            title: 'Lời mời ở ghép mới',
            body: `${requester?.fullName || 'Ai đó'} đã gửi cho bạn một lời mời kết bạn ở ghép.`,
            status: 'UNREAD',
        },
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

    try {
        const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
        const targetName = targetUser?.fullName || 'Người dùng';
        
        let notifTitle = '';
        let notifBody = '';
        
        if (status === 'ACCEPTED') {
            notifTitle = 'Lời mời ở ghép được chấp nhận';
            notifBody = `${targetName} đã chấp nhận lời mời kết bạn ở ghép của bạn.`;
        } else {
            notifTitle = 'Lời mời ở ghép bị từ chối';
            notifBody = `${targetName} đã từ chối lời mời kết bạn ở ghép của bạn.`;
        }
    
        await prisma.notification.create({
            data: {
                userId: match.requester_id,
                type: 'ROOMMATE_INVITE',
                title: notifTitle,
                body: notifBody,
                status: 'UNREAD',
            },
        });
    } catch (err) {
        console.error('Lỗi khi gửi thông báo chấp nhận/từ chối roommate:', err);
    }

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

    const [users, currentUser, myMatchesForArea] = await Promise.all([
        prisma.user.findMany({
            where: { id: { in: sortedUserIds }, status: 'ACTIVE', role: 'TENANT' },
            include: { lifestyleProfile: true, preference: true },
        }),
        prisma.user.findUnique({
            where: { id: currentUserId },
            include: { lifestyleProfile: true, preference: true },
        }),
        prisma.roommateMatch.findMany({
            where: {
                OR: [{ requester_id: currentUserId }, { target_id: currentUserId }],
            },
            select: { requester_id: true, target_id: true, status: true },
        }),
    ]);

    const matchStatusMap = new Map();
    for (const m of myMatchesForArea) {
        const otherId = m.requester_id === currentUserId ? m.target_id : m.requester_id;
        matchStatusMap.set(otherId, m.status);
    }

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
                matchStatus: matchStatusMap.get(uid) || null,
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
    const { targetId, rentalPeriodId, overallRating, comment } = body;

    if (!targetId || !rentalPeriodId || overallRating == null) {
        const err = new Error('Thiếu thông tin bắt buộc (targetId, rentalPeriodId, overallRating)');
        err.statusCode = 400;
        throw err;
    }
    if (overallRating < 1 || overallRating > 5) {
        const err = new Error('Rating phải trong khoảng 1–5');
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
            comment: true,
            created_at: true,
        },
    });
    return { data: existing || null };
}

// ─── People You May Know ──────────────────────────────────────────────────────

/**
 * Gợi ý "Có thể bạn quan tâm" dựa trên hành vi tìm phòng thực tế.
 * Tối ưu: tất cả queries chạy song song, không có sequential loop.
 */
async function getPeopleYouMayKnow(userId) {
    // ── Bước 1: Load song song user info + match status + interactions của user ──
    const [me, myMatches, myInteractions] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            include: { lifestyleProfile: true, preference: true },
        }),
        prisma.roommateMatch.findMany({
            where: { OR: [{ requester_id: userId }, { target_id: userId }] },
            select: { requester_id: true, target_id: true, status: true },
        }),
        prisma.user_room_interactions.findMany({
            where: { user_id: userId },
            select: { room_id: true },
        }),
    ]);

    if (!me) return { data: [] };

    const matchStatusMap = new Map();
    const excludeIds = new Set([userId]);
    for (const m of myMatches) {
        const otherId = m.requester_id === userId ? m.target_id : m.requester_id;
        matchStatusMap.set(otherId, m.status);
        if (m.status === 'BLOCKED') excludeIds.add(otherId);
    }

    // ── Bước 2: Nếu chưa có interaction → random 5 người (song song với CF matrices) ──
    if (myInteractions.length === 0) {
        const [randomUsers, roommateMatrix, roomFavMatrix] = await Promise.all([
            prisma.user.findMany({
                where: { id: { notIn: Array.from(excludeIds) }, status: 'ACTIVE', role: 'TENANT' },
                include: { lifestyleProfile: true, preference: true },
                take: 50,
            }),
            buildRoommateInteractionMatrix().catch(() => new Map()),
            buildRoomFavMatrix().catch(() => new Map()),
        ]);

        const shuffled = randomUsers.sort(() => Math.random() - 0.5).slice(0, 5);
        const data = shuffled.map((u) => {
            const lifestyleScore = computeLifestyleScore(me.lifestyleProfile, u.lifestyleProfile, me.preference, u.preference);
            const cfBoost = computeCFBoost(userId, u.id, roommateMatrix, roomFavMatrix);
            return {
                user: { id: u.id, fullName: u.fullName, avatarUrl: u.avatarUrl, gender: u.gender },
                reasons: [{ type: 'random_suggestion' }],
                matchStatus: matchStatusMap.get(u.id) || null,
                matchScore: Math.min(100, lifestyleScore + cfBoost),
                areaName: null,
            };
        });
        return { data, isRandom: true };
    }

    // ── Bước 3: Tính top 3 quận/xã từ interactions ──
    const myRoomIds = [...new Set(myInteractions.map((i) => i.room_id))];

    const roomsWithLocation = await prisma.rooms.findMany({
        where: { id: { in: myRoomIds } },
        select: {
            id: true,
            rentals: { select: { location: { select: { district: true, address: true } } } },
        },
    });

    const districtViewCount = new Map();
    for (const room of roomsWithLocation) {
        const loc = room.rentals?.location;
        if (!loc) continue;
        const area = (loc.district || '').trim() || extractAreaFromAddress(loc.address || '');
        if (!area) continue;
        districtViewCount.set(area, (districtViewCount.get(area) || 0) + 1);
    }

    if (districtViewCount.size === 0) return { data: [], isRandom: false };

    const top3Areas = [...districtViewCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([area]) => area);

    // ── Bước 4: Song song — tìm rooms của cả 3 quận cùng lúc ──
    const roomsPerAreaResults = await Promise.all(
        top3Areas.map((area) =>
            prisma.rooms.findMany({
                where: {
                    rentals: {
                        location: {
                            OR: [
                                { district: { contains: area, mode: 'insensitive' } },
                                { address: { contains: area, mode: 'insensitive' } },
                            ],
                        },
                    },
                },
                select: { id: true },
            })
        )
    );

    // ── Bước 5: Song song — tính điểm tổng hợp (view×1 + fav×3 + preorder×5) cho cả 3 quận ──
    const seenUserIds = new Set(excludeIds);
    const activityPerAreaResults = await Promise.all(
        top3Areas.map(async (area, idx) => {
            const roomIdsInArea = roomsPerAreaResults[idx].map((r) => r.id);
            if (roomIdsInArea.length === 0) return [];

            const excludeArr = Array.from(seenUserIds);
            const [viewCounts, favCounts, preorderCounts] = await Promise.all([
                prisma.user_room_interactions.groupBy({
                    by: ['user_id'],
                    where: { room_id: { in: roomIdsInArea }, user_id: { notIn: excludeArr } },
                    _count: { user_id: true },
                }),
                prisma.favoriteRoom.groupBy({
                    by: ['userId'],
                    where: { roomId: { in: roomIdsInArea }, userId: { notIn: excludeArr } },
                    _count: { userId: true },
                }),
                prisma.preorder.groupBy({
                    by: ['userId'],
                    where: { roomId: { in: roomIdsInArea }, userId: { notIn: excludeArr } },
                    _count: { userId: true },
                }),
            ]);

            // Gộp điểm
            const scoreMap = new Map();
            for (const r of viewCounts) {
                if (!scoreMap.has(r.user_id)) scoreMap.set(r.user_id, { views: 0, favorites: 0, preorders: 0, totalScore: 0 });
                const e = scoreMap.get(r.user_id);
                e.views = r._count.user_id;
                e.totalScore += r._count.user_id * 1;
            }
            for (const r of favCounts) {
                if (!scoreMap.has(r.userId)) scoreMap.set(r.userId, { views: 0, favorites: 0, preorders: 0, totalScore: 0 });
                const e = scoreMap.get(r.userId);
                e.favorites = r._count.userId;
                e.totalScore += r._count.userId * 3;
            }
            for (const r of preorderCounts) {
                if (!scoreMap.has(r.userId)) scoreMap.set(r.userId, { views: 0, favorites: 0, preorders: 0, totalScore: 0 });
                const e = scoreMap.get(r.userId);
                e.preorders = r._count.userId;
                e.totalScore += r._count.userId * 5;
            }

            // Sắp xếp theo totalScore, lấy top 6
            return [...scoreMap.entries()]
                .sort((a, b) => b[1].totalScore - a[1].totalScore)
                .slice(0, 6)
                .map(([uid, activity]) => ({ uid, area, activity }));
        })
    );

    // Gom tất cả userIds cần fetch, tránh trùng
    const areaUserIdMap = new Map(); // userId → { area, activity }
    for (const areaResults of activityPerAreaResults) {
        for (const { uid, area, activity } of areaResults) {
            if (!seenUserIds.has(uid) && !areaUserIdMap.has(uid)) {
                areaUserIdMap.set(uid, { area, activity });
                seenUserIds.add(uid);
            }
        }
    }

    if (areaUserIdMap.size === 0) return { data: [], isRandom: false };

    const allCandidateIds = Array.from(areaUserIdMap.keys());

    // ── Bước 6: Song song — fetch users + CF matrices + experience ──
    const [candidateUsers, roommateMatrix, roomFavMatrix, experienceMap] = await Promise.all([
        prisma.user.findMany({
            where: { id: { in: allCandidateIds }, status: 'ACTIVE', role: 'TENANT' },
            include: { lifestyleProfile: true, preference: true },
        }),
        buildRoommateInteractionMatrix().catch(() => new Map()),
        buildRoomFavMatrix().catch(() => new Map()),
        computeExperienceData(allCandidateIds).catch(() => new Map()),
    ]);

    // ── Bước 7: Tính scores và build response ──
    const data = candidateUsers.map((u) => {
        const { area, activity } = areaUserIdMap.get(u.id) || { area: '', activity: { views: 0, favorites: 0, preorders: 0, totalScore: 0 } };
        const lifestyleScore = computeLifestyleScore(me.lifestyleProfile, u.lifestyleProfile, me.preference, u.preference);
        const cfBoost = computeCFBoost(userId, u.id, roommateMatrix, roomFavMatrix);
        const expData = experienceMap.get(u.id) || { experienceBoost: 0, wouldLiveAgainRate: null };
        return {
            user: { id: u.id, fullName: u.fullName, avatarUrl: u.avatarUrl, gender: u.gender },
            lifestyle: u.lifestyleProfile ? {
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
            } : null,
            reasons: [{ type: 'same_area_search', area, activity }],
            matchStatus: matchStatusMap.get(u.id) || null,
            matchScore: Math.min(100, lifestyleScore + cfBoost + expData.experienceBoost),
            areaName: area,
        };
    });

    const groupedByArea = top3Areas
        .map((area) => ({ area, users: data.filter((d) => d.areaName === area) }))
        .filter((g) => g.users.length > 0);

    return { data, groupedByArea, isRandom: false, topAreas: top3Areas };
}

/**
 * Trích xuất tên quận/xã từ địa chỉ đầy đủ (fallback khi district null).
 * VD: "Thôn X, Xã Hòa Lạc, Huyện Thạch Thất, Hà Nội" → "Xã Hòa Lạc"
 */
function extractAreaFromAddress(address) {
    if (!address) return '';
    // Tìm xã/phường/thị trấn/quận/huyện
    const match = address.match(/(xã|phường|thị trấn|quận|huyện|thành phố)\s+[^\s,]+(?:\s+[^\s,]+)?/i);
    return match ? match[0].trim() : '';
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
    getPeopleYouMayKnow,
    // helpers exported for testing
    jaccardSimilarity,
    computeCFBoost,
    computeExperienceData,
    buildRoommateInteractionMatrix,
    buildRoomFavMatrix,
    // vector-based scoring helpers (testing)
    quantize,
    vectorizeLifestyle,
    weightedCosineSimilarity,
    QUANT_MAPS,
    LIFESTYLE_WEIGHTS,
};
