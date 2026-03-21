const prisma = require('../config/prisma');

const strEq = (a, b) =>
    a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Compute lifestyle + preference compatibility score (0–100)
 */
function computeLifestyleScore(myLifestyle, candidateLifestyle, myPrefs, candidatePrefs) {
    let score = 0;
    let maxPossible = 0;

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
        const candInterests = Array.isArray(candidateLifestyle.interests)
            ? candidateLifestyle.interests
            : [];
        const commonInterests = myInterests.filter((i) => candInterests.includes(i)).length;
        const interestPts = Math.min(12, commonInterests * 3);
        maxPossible += 12;
        score += interestPts;
        const myLangs = Array.isArray(myLifestyle.languages) ? myLifestyle.languages : [];
        const candLangs = Array.isArray(candidateLifestyle.languages)
            ? candidateLifestyle.languages
            : [];
        const commonLangs = myLangs.filter((l) => candLangs.includes(l)).length;
        const langPts = Math.min(5, commonLangs * 2);
        maxPossible += 5;
        score += langPts;
        if (
            myLifestyle.preferred_lease_months != null &&
            candidateLifestyle.preferred_lease_months != null
        ) {
            maxPossible += 3;
            if (myLifestyle.preferred_lease_months === candidateLifestyle.preferred_lease_months)
                score += 3;
        }
    }

    if (myPrefs && candidatePrefs) {
        const myDistricts = Array.isArray(myPrefs.preferred_districts)
            ? myPrefs.preferred_districts
            : [];
        const candDistricts = Array.isArray(candidatePrefs.preferred_districts)
            ? candidatePrefs.preferred_districts
            : [];
        const districtOverlap =
            myDistricts.some((d) =>
                candDistricts.some((c) =>
                    String(c).toLowerCase().includes(String(d).toLowerCase())
                )
            ) ||
            candDistricts.some((d) =>
                myDistricts.some((c) =>
                    String(c).toLowerCase().includes(String(d).toLowerCase())
                )
            );
        maxPossible += 12;
        if (districtOverlap) score += 12;

        maxPossible += 8;
        if (
            myPrefs.room_type &&
            candidatePrefs.room_type &&
            myPrefs.room_type === candidatePrefs.room_type
        )
            score += 8;

        const myAmenities = Array.isArray(myPrefs.preferred_amenities)
            ? myPrefs.preferred_amenities
            : [];
        const candAmenities = Array.isArray(candidatePrefs.preferred_amenities)
            ? candidatePrefs.preferred_amenities
            : [];
        const commonAmenities = myAmenities.filter((a) => candAmenities.includes(a)).length;
        const amenityPts = Math.min(10, commonAmenities * 2);
        maxPossible += 10;
        score += amenityPts;

        const myMust = Array.isArray(myPrefs.must_have_amenities)
            ? myPrefs.must_have_amenities
            : [];
        const candMust = Array.isArray(candidatePrefs.must_have_amenities)
            ? candidatePrefs.must_have_amenities
            : [];
        const mustOverlap =
            myMust.some((m) => candMust.includes(m)) ||
            (myMust.length === 0 && candMust.length === 0);
        maxPossible += 8;
        if (mustOverlap) score += 8;

        if (
            myPrefs.preferred_lease_months != null &&
            candidatePrefs.preferred_lease_months != null
        ) {
            maxPossible += 5;
            if (myPrefs.preferred_lease_months === candidatePrefs.preferred_lease_months)
                score += 5;
        }

        if (myPrefs.pet_friendly != null && candidatePrefs.pet_friendly != null) {
            maxPossible += 4;
            if (myPrefs.pet_friendly === candidatePrefs.pet_friendly) score += 4;
        }
    }

    if (maxPossible === 0) return 0;
    return Math.min(100, Math.max(0, Math.round((score / maxPossible) * 100)));
}

/**
 * Lấy gợi ý roommate
 */
async function getSuggestions(userId, params) {
    const limit = Math.min(50, Math.max(1, parseInt(params.limit) || 20));

    const me = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            lifestyleProfile: true,
            preference: true,
        },
    });
    if (!me) {
        throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const existingMatchUserIds = await prisma.roommateMatch.findMany({
        where: {
            OR: [{ requester_id: userId }, { target_id: userId }],
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
    const hasUsableGender =
        !!myGenderNorm &&
        myGenderNorm !== 'không tiết lộ' &&
        myGenderNorm !== 'khong tiet lo';

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
        const isSameGender =
            hasUsableGender &&
            candidateGenderNorm &&
            candidateGenderNorm === myGenderNorm;
        const baseScore = computeLifestyleScore(
            me.lifestyleProfile,
            u.lifestyleProfile,
            me.preference,
            u.preference
        );
        const genderBoost = isSameGender ? 12 : 0;
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
                      interests: u.lifestyleProfile.interests || [],
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
            matchScore: Math.min(100, baseScore + genderBoost),
            isSameGender,
        };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);
    const data = scored.slice(0, limit);

    return {
        data,
        message: hasUsableGender
            ? undefined
            : 'Bạn chưa cập nhật giới tính, đang gợi ý roommate từ toàn bộ tenant theo điểm phù hợp.',
    };
}

/**
 * Gửi lời mời roommate
 */
async function sendRequest(requesterId, targetId) {
    if (requesterId === targetId) {
        throw Object.assign(new Error('Không thể gửi lời mời cho chính mình'), {
            statusCode: 400,
        });
    }

    const target = await prisma.user.findUnique({
        where: { id: targetId },
    });
    if (!target || target.status !== 'ACTIVE' || target.role !== 'TENANT') {
        throw Object.assign(
            new Error('Người dùng không tồn tại hoặc không phải tenant'),
            { statusCode: 404 }
        );
    }

    const existing = await prisma.roommateMatch.findUnique({
        where: {
            requester_id_target_id: { requester_id: requesterId, target_id: targetId },
        },
    });
    if (existing) {
        if (existing.status === 'PENDING') {
            throw Object.assign(new Error('Bạn đã gửi lời mời trước đó'), { statusCode: 400 });
        }
        if (existing.status === 'ACCEPTED') {
            throw Object.assign(new Error('Hai bạn đã là match'), { statusCode: 400 });
        }
        if (existing.status === 'REJECTED' || existing.status === 'BLOCKED') {
            throw Object.assign(new Error('Không thể gửi lời mời'), { statusCode: 400 });
        }
    }

    const reverse = await prisma.roommateMatch.findUnique({
        where: {
            requester_id_target_id: { requester_id: targetId, target_id: requesterId },
        },
    });
    if (reverse && reverse.status === 'PENDING') {
        throw Object.assign(
            new Error(
                'Người này đã gửi lời mời cho bạn. Hãy xem trong "Lời mời nhận được" và chấp nhận.'
            ),
            { statusCode: 400 }
        );
    }

    const match = await prisma.roommateMatch.create({
        data: {
            requester_id: requesterId,
            target_id: targetId,
            status: 'PENDING',
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

/**
 * Lấy danh sách match
 */
async function getMyMatches(userId) {
    const matches = await prisma.roommateMatch.findMany({
        where: {
            OR: [{ requester_id: userId }, { target_id: userId }],
        },
        orderBy: { created_at: 'desc' },
    });

    const otherIds = [
        ...new Set(
            matches.map((m) => (m.requester_id === userId ? m.target_id : m.requester_id))
        ),
    ];
    const users =
        otherIds.length > 0
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

    return { data: list };
}

/**
 * Cập nhật trạng thái match
 */
async function updateMatchStatus(userId, matchId, body) {
    const { status } = body;

    if (!status || !['ACCEPTED', 'REJECTED'].includes(status)) {
        throw Object.assign(
            new Error('status phải là ACCEPTED hoặc REJECTED'),
            { statusCode: 400 }
        );
    }

    const match = await prisma.roommateMatch.findUnique({
        where: { id: matchId },
    });
    if (!match) {
        throw Object.assign(new Error('Không tìm thấy lời mời'), { statusCode: 404 });
    }
    if (match.target_id !== userId) {
        throw Object.assign(
            new Error('Chỉ người nhận mới có thể chấp nhận/từ chối'),
            { statusCode: 403 }
        );
    }
    if (match.status !== 'PENDING') {
        throw Object.assign(new Error('Lời mời đã được xử lý'), { statusCode: 400 });
    }

    const updated = await prisma.roommateMatch.update({
        where: { id: matchId },
        data: { status },
    });

    return {
        message: status === 'ACCEPTED' ? 'Đã chấp nhận lời mời' : 'Đã từ chối lời mời',
        data: { id: updated.id, status: updated.status },
    };
}

/**
 * Lấy public profile của một user (dùng cho roommate view)
 */
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

    if (!user) {
        throw Object.assign(new Error('Không tìm thấy người dùng'), { statusCode: 404 });
    }

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

module.exports = {
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
    getPublicProfile,
};
