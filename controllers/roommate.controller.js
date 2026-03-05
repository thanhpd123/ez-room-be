const prisma = require('../config/prisma');

const strEq = (a, b) => a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Compute lifestyle + preference compatibility score (0–100). Higher = better match.
 * Same gender is required by caller; here we score lifestyle and preference overlap.
 * Results are sorted by this score descending so higher matching points show first.
 */
function computeLifestyleScore(myLifestyle, candidateLifestyle, myPrefs, candidatePrefs) {
    let score = 0;
    let maxPossible = 0;

    // --- Lifestyle (up to ~55 points) ---
    if (myLifestyle && candidateLifestyle) {
        const lifestylePairs = [
            [myLifestyle.smoking, candidateLifestyle.smoking, 8],
            [myLifestyle.drinking, candidateLifestyle.drinking, 5],
            [myLifestyle.pets_allowed, candidateLifestyle.pets_allowed, 10],
            [myLifestyle.work_from_home, candidateLifestyle.work_from_home, 5],
        ];
        lifestylePairs.forEach(([a, b, pts]) => {
            maxPossible += pts;
            if (a === b) score += pts;
        });
        const strPairs = [
            [myLifestyle.sleep_schedule, candidateLifestyle.sleep_schedule, 8],
            [myLifestyle.cleanliness, candidateLifestyle.cleanliness, 5],
            [myLifestyle.noise_tolerance, candidateLifestyle.noise_tolerance, 5],
            [myLifestyle.guest_frequency, candidateLifestyle.guest_frequency, 4],
            [myLifestyle.cooking_frequency, candidateLifestyle.cooking_frequency, 4],
            [myLifestyle.personalityType, candidateLifestyle.personalityType, 4],
            [myLifestyle.social_level, candidateLifestyle.social_level, 4],
            [myLifestyle.wake_time, candidateLifestyle.wake_time, 3],
            [myLifestyle.bedtime, candidateLifestyle.bedtime, 3],
            [myLifestyle.occupation_type, candidateLifestyle.occupation_type, 3],
            [myLifestyle.temperature_preference, candidateLifestyle.temperature_preference, 2],
            [myLifestyle.quiet_hours_preference, candidateLifestyle.quiet_hours_preference, 2],
        ];
        strPairs.forEach(([a, b, pts]) => {
            maxPossible += pts;
            if (strEq(a, b)) score += pts;
        });
        const myInterests = Array.isArray(myLifestyle.interests) ? myLifestyle.interests : [];
        const candInterests = Array.isArray(candidateLifestyle.interests) ? candidateLifestyle.interests : [];
        const commonInterests = myInterests.filter((i) => candInterests.includes(i)).length;
        const interestPts = Math.min(12, commonInterests * 3);
        maxPossible += 12;
        score += interestPts;
        const myLangs = Array.isArray(myLifestyle.languages) ? myLifestyle.languages : [];
        const candLangs = Array.isArray(candidateLifestyle.languages) ? candidateLifestyle.languages : [];
        const commonLangs = myLangs.filter((l) => candLangs.includes(l)).length;
        const langPts = Math.min(5, commonLangs * 2);
        maxPossible += 5;
        score += langPts;
        if (myLifestyle.preferred_lease_months != null && candidateLifestyle.preferred_lease_months != null) {
            maxPossible += 3;
            if (myLifestyle.preferred_lease_months === candidateLifestyle.preferred_lease_months) score += 3;
        }
    }

    // --- Preference (up to ~45 points) ---
    if (myPrefs && candidatePrefs) {
        const myDistricts = Array.isArray(myPrefs.preferred_districts) ? myPrefs.preferred_districts : [];
        const candDistricts = Array.isArray(candidatePrefs.preferred_districts) ? candidatePrefs.preferred_districts : [];
        const districtOverlap = myDistricts.some((d) => candDistricts.some((c) => String(c).toLowerCase().includes(String(d).toLowerCase()))) ||
            candDistricts.some((d) => myDistricts.some((c) => String(c).toLowerCase().includes(String(d).toLowerCase())));
        maxPossible += 12;
        if (districtOverlap) score += 12;

        maxPossible += 8;
        if (myPrefs.room_type && candidatePrefs.room_type && myPrefs.room_type === candidatePrefs.room_type) score += 8;

        const myAmenities = Array.isArray(myPrefs.preferred_amenities) ? myPrefs.preferred_amenities : [];
        const candAmenities = Array.isArray(candidatePrefs.preferred_amenities) ? candidatePrefs.preferred_amenities : [];
        const commonAmenities = myAmenities.filter((a) => candAmenities.includes(a)).length;
        const amenityPts = Math.min(10, commonAmenities * 2);
        maxPossible += 10;
        score += amenityPts;

        const myMust = Array.isArray(myPrefs.must_have_amenities) ? myPrefs.must_have_amenities : [];
        const candMust = Array.isArray(candidatePrefs.must_have_amenities) ? candidatePrefs.must_have_amenities : [];
        const mustOverlap = myMust.some((m) => candMust.includes(m)) || (myMust.length === 0 && candMust.length === 0);
        maxPossible += 8;
        if (mustOverlap) score += 8;

        if (myPrefs.preferred_lease_months != null && candidatePrefs.preferred_lease_months != null) {
            maxPossible += 5;
            if (myPrefs.preferred_lease_months === candidatePrefs.preferred_lease_months) score += 5;
        }

        if (myPrefs.pet_friendly != null && candidatePrefs.pet_friendly != null) {
            maxPossible += 4;
            if (myPrefs.pet_friendly === candidatePrefs.pet_friendly) score += 4;
        }
    }

    if (maxPossible === 0) return 50;
    return Math.min(100, Math.max(0, Math.round((score / maxPossible) * 100)));
}

/**
 * GET /roommate/suggestions – other tenants available to be new roommates (TENANT, not in existing match).
 * If user has gender, same-gender candidates are prioritized by score bonus instead of hard filtering.
 * Always returns eligible tenants sorted by matching score (higher first).
 * Query: ?limit=20
 */
async function getSuggestions(req, res) {
    try {
        const userId = req.auth.user.id;
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

        const me = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                lifestyleProfile: true,
                preference: true,
            },
        });
        if (!me) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const existingMatchUserIds = await prisma.roommateMatch.findMany({
            where: {
                OR: [
                    { requester_id: userId },
                    { target_id: userId },
                ],
                status: { notIn: ['BLOCKED'] },
            },
            select: { requester_id: true, target_id: true },
        });
        const excludeIds = new Set([userId]);
        existingMatchUserIds.forEach((m) => {
            excludeIds.add(m.requester_id);
            excludeIds.add(m.target_id);
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
        const hasUsableGender = !!myGenderNorm && myGenderNorm !== 'không tiết lộ' && myGenderNorm !== 'khong tiet lo';

        // Fetch all other tenants who are available (ACTIVE, TENANT, not already in a match with me)
        const candidates = await prisma.user.findMany({
            where: {
                id: { notIn: Array.from(excludeIds) },
                status: 'ACTIVE',
                role: 'TENANT',
            },
            include: {
                lifestyleProfile: true,
                preference: true,
            },
        });

        const scored = candidates.map((u) => {
            const candidateGenderNorm = genderNorm(u.gender);
            const isSameGender = hasUsableGender && candidateGenderNorm && candidateGenderNorm === myGenderNorm;
            const baseScore = computeLifestyleScore(me.lifestyleProfile, u.lifestyleProfile, me.preference, u.preference);
            // Prefer same-gender results when available, but still show all tenants.
            const genderBoost = isSameGender ? 12 : 0;
            return {
            user: {
                id: u.id,
                fullName: u.fullName,
                avatarUrl: u.avatarUrl,
                gender: u.gender,
            },
            lifestyle: u.lifestyleProfile ? {
                smoking: u.lifestyleProfile.smoking,
                drinking: u.lifestyleProfile.drinking,
                pets_allowed: u.lifestyleProfile.pets_allowed,
                sleep_schedule: u.lifestyleProfile.sleep_schedule,
                work_from_home: u.lifestyleProfile.work_from_home,
                personalityType: u.lifestyleProfile.personalityType,
                social_level: u.lifestyleProfile.social_level,
                interests: u.lifestyleProfile.interests || [],
            } : null,
            preference: u.preference ? {
                preferred_districts: u.preference.preferred_districts || [],
                room_type: u.preference.room_type,
            } : null,
            matchScore: Math.min(100, baseScore + genderBoost),
            isSameGender,
        };
        });

        scored.sort((a, b) => b.matchScore - a.matchScore);
        const data = scored.slice(0, limit);

        return res.json({
            success: true,
            data,
            message: hasUsableGender
                ? undefined
                : 'Bạn chưa cập nhật giới tính, đang gợi ý roommate từ toàn bộ tenant theo điểm phù hợp.',
        });
    } catch (err) {
        console.error('Roommate suggestions error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tải gợi ý roommate',
            error: err.message,
        });
    }
}

/**
 * POST /roommate/request/:targetId – send a roommate match request (PENDING).
 */
async function sendRequest(req, res) {
    try {
        const requesterId = req.auth.user.id;
        const targetId = req.params.targetId;

        if (requesterId === targetId) {
            return res.status(400).json({ success: false, message: 'Không thể gửi lời mời cho chính mình' });
        }

        const target = await prisma.user.findUnique({
            where: { id: targetId },
        });
        if (!target || target.status !== 'ACTIVE' || target.role !== 'TENANT') {
            return res.status(404).json({ success: false, message: 'Người dùng không tồn tại hoặc không phải tenant' });
        }

        const existing = await prisma.roommateMatch.findUnique({
            where: {
                requester_id_target_id: { requester_id: requesterId, target_id: targetId },
            },
        });
        if (existing) {
            if (existing.status === 'PENDING') {
                return res.status(400).json({ success: false, message: 'Bạn đã gửi lời mời trước đó' });
            }
            if (existing.status === 'ACCEPTED') {
                return res.status(400).json({ success: false, message: 'Hai bạn đã là match' });
            }
            if (existing.status === 'REJECTED' || existing.status === 'BLOCKED') {
                return res.status(400).json({ success: false, message: 'Không thể gửi lời mời' });
            }
        }

        const reverse = await prisma.roommateMatch.findUnique({
            where: {
                requester_id_target_id: { requester_id: targetId, target_id: requesterId },
            },
        });
        if (reverse && reverse.status === 'PENDING') {
            return res.status(400).json({
                success: false,
                message: 'Người này đã gửi lời mời cho bạn. Hãy xem trong "Lời mời nhận được" và chấp nhận.',
            });
        }

        const match = await prisma.roommateMatch.create({
            data: {
                requester_id: requesterId,
                target_id: targetId,
                status: 'PENDING',
            },
        });

        return res.status(201).json({
            success: true,
            message: 'Đã gửi lời mời kết bạn ở ghép',
            data: {
                id: match.id,
                requesterId: match.requester_id,
                targetId: match.target_id,
                status: match.status,
                createdAt: match.created_at,
            },
        });
    } catch (err) {
        console.error('Send roommate request error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi gửi lời mời',
            error: err.message,
        });
    }
}

/**
 * GET /roommate/matches – list my matches (sent + received) with user details.
 */
async function getMyMatches(req, res) {
    try {
        const userId = req.auth.user.id;

        const matches = await prisma.roommateMatch.findMany({
            where: {
                OR: [
                    { requester_id: userId },
                    { target_id: userId },
                ],
            },
            orderBy: { created_at: 'desc' },
        });

        const otherIds = [...new Set(matches.map((m) => (m.requester_id === userId ? m.target_id : m.requester_id)))];
        const users = otherIds.length
            ? await prisma.user.findMany({
                  where: { id: { in: otherIds } },
                  select: { id: true, fullName: true, avatarUrl: true, gender: true },
              })
            : [];
        const userMap = new Map(users.map((u) => [u.id, u]));

        const list = matches.map((m) => {
            const isRequester = m.requester_id === userId;
            const otherId = isRequester ? m.target_id : m.requester_id;
            const other = userMap.get(otherId) || null;
            return {
                id: m.id,
                status: m.status,
                createdAt: m.created_at,
                isRequester,
                otherUser: other
                    ? {
                          id: other.id,
                          fullName: other.fullName,
                          avatarUrl: other.avatarUrl,
                          gender: other.gender,
                      }
                    : null,
            };
        });

        return res.json({ success: true, data: list });
    } catch (err) {
        console.error('Get roommate matches error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tải danh sách match',
            error: err.message,
        });
    }
}

/**
 * PATCH /roommate/matches/:matchId – update match status (target: ACCEPTED/REJECTED).
 * Body: { status: 'ACCEPTED' | 'REJECTED' }
 */
async function updateMatchStatus(req, res) {
    try {
        const userId = req.auth.user.id;
        const matchId = req.params.matchId;
        const { status } = req.body;

        if (!status || !['ACCEPTED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ success: false, message: 'status phải là ACCEPTED hoặc REJECTED' });
        }

        const match = await prisma.roommateMatch.findUnique({
            where: { id: matchId },
        });
        if (!match) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lời mời' });
        }
        if (match.target_id !== userId) {
            return res.status(403).json({ success: false, message: 'Chỉ người nhận mới có thể chấp nhận/từ chối' });
        }
        if (match.status !== 'PENDING') {
            return res.status(400).json({ success: false, message: 'Lời mời đã được xử lý' });
        }

        const updated = await prisma.roommateMatch.update({
            where: { id: matchId },
            data: { status },
        });

        return res.json({
            success: true,
            message: status === 'ACCEPTED' ? 'Đã chấp nhận lời mời' : 'Đã từ chối lời mời',
            data: {
                id: updated.id,
                status: updated.status,
            },
        });
    } catch (err) {
        console.error('Update match status error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi cập nhật',
            error: err.message,
        });
    }
}

module.exports = {
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
};
