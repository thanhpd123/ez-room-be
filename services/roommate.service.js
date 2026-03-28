const prisma = require('../config/prisma');

const strEq = (a, b) =>
    a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Tokenize a text string into meaningful words for comparison.
 * Splits on commas, spaces, and common delimiters; filters short/stop words.
 */
function tokenize(text) {
    if (!text) return [];
    return String(text)
        .trim()
        .toLowerCase()
        .split(/[,，、;\s]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 1);
}

/**
 * Check how many of a user's deal-breaker keywords are violated
 * by the other user's actual lifestyle habits.
 * Returns number of violations (0 = no conflict).
 */
function countDealBreakerViolations(dealBreakerText, otherLifestyle) {
    if (!dealBreakerText || !otherLifestyle) return 0;
    const db = String(dealBreakerText).trim().toLowerCase();
    if (!db) return 0;

    let violations = 0;

    // Smoking-related deal-breakers
    if (/hút thuốc|thuốc lá|smoking|khói thuốc/.test(db) && otherLifestyle.smoking)
        violations++;

    // Drinking-related deal-breakers
    if (/rượu|bia|uống rượu|drinking|nhậu/.test(db) && otherLifestyle.drinking)
        violations++;

    // Cleanliness-related deal-breakers
    if (/dơ|bẩn|không sạch|ở bẩn|mất vệ sinh/.test(db)) {
        const low = String(otherLifestyle.cleanliness || '').trim().toLowerCase();
        if (low === 'bình thường' || low === 'không quan tâm') violations++;
    }

    // Noise-related deal-breakers
    if (/ồn|ồn ào|tiếng ồn|noise|gây ồn/.test(db)) {
        const low = String(otherLifestyle.noise_tolerance || '').trim().toLowerCase();
        if (low === 'cao') violations++;
    }

    // Pet-related deal-breakers
    if (/thú cưng|chó|mèo|pet|nuôi/.test(db) && otherLifestyle.pets_allowed)
        violations++;

    // Guest-related deal-breakers
    if (/khách|đưa người lạ|dẫn bạn|guest/.test(db)) {
        const low = String(otherLifestyle.guest_frequency || '').trim().toLowerCase();
        if (low === 'thường xuyên') violations++;
    }

    // Late night / sleep related deal-breakers
    if (/thức khuya|về khuya|ngủ muộn|khuya/.test(db)) {
        const low = String(otherLifestyle.sleep_schedule || '').trim().toLowerCase();
        if (low.includes('sau 0h') || low.includes('khuya')) violations++;
    }

    return violations;
}

/**
 * Compute lifestyle + preference compatibility score (0–100)
 *
 * Scoring breakdown (visible UI fields only):
 *   Thói quen       – smoking(10), drinking(8), pets_allowed(10) .............. 28 pts
 *   Sinh hoạt        – sleep_schedule(10), cleanliness(10),
 *                      noise_tolerance(8), guest_frequency(6) ................ 34 pts
 *   Tính cách        – personalityType(6) ..................................... 6 pts
 *   ★ Sở thích       – interests overlap .................................... 15 pts
 *   ★ Điều không chấp nhận – deal_breakers similarity + cross-check ........ 15 pts
 *   Khu vực + loại phòng ................................................... 20 pts
 *   Gender boost (outside this function) .................................... +12
 */
function computeLifestyleScore(myLifestyle, candidateLifestyle, myPrefs, candidatePrefs) {
    let score = 0;
    let maxPossible = 0;

    // ── Core Lifestyle Matching ──
    if (myLifestyle && candidateLifestyle) {
        // Boolean habit matching
        const boolPairs = [
            [myLifestyle.smoking, candidateLifestyle.smoking, 10],
            [myLifestyle.drinking, candidateLifestyle.drinking, 8],
            [myLifestyle.pets_allowed, candidateLifestyle.pets_allowed, 10],
        ];
        boolPairs.forEach(([a, b, pts]) => {
            maxPossible += pts;
            if (a === b) score += pts;
        });

        // String-match daily-life factors
        const strPairs = [
            [myLifestyle.sleep_schedule, candidateLifestyle.sleep_schedule, 10],
            [myLifestyle.cleanliness, candidateLifestyle.cleanliness, 10],
            [myLifestyle.noise_tolerance, candidateLifestyle.noise_tolerance, 8],
            [myLifestyle.guest_frequency, candidateLifestyle.guest_frequency, 6],
            [myLifestyle.personalityType, candidateLifestyle.personalityType, 6],
        ];
        strPairs.forEach(([a, b, pts]) => {
            maxPossible += pts;
            if (strEq(a, b)) score += pts;
        });

        // ── ★ Interests overlap (15 pts) ──
        const myInterests = Array.isArray(myLifestyle.interests) ? myLifestyle.interests : [];
        const candInterests = Array.isArray(candidateLifestyle.interests) ? candidateLifestyle.interests : [];
        if (myInterests.length > 0 || candInterests.length > 0) {
            maxPossible += 15;
            if (myInterests.length > 0 && candInterests.length > 0) {
                // Word-level overlap across all interest items
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
            // else: one side empty → 0 points but counted in maxPossible
        }

        // ── ★ Deal-breakers (15 pts total) ──
        const myDB = String(myLifestyle.deal_breakers || '').trim();
        const candDB = String(candidateLifestyle.deal_breakers || '').trim();
        const hasAnyDB = myDB.length > 0 || candDB.length > 0;

        if (hasAnyDB) {
            // Part A (7 pts): Similarity – both users share the same deal-breakers = aligned values
            maxPossible += 7;
            if (myDB && candDB) {
                const myWords = tokenize(myDB);
                const candWords = tokenize(candDB);
                const mySet = new Set(myWords);
                const overlapCount = candWords.filter((w) => mySet.has(w)).length;
                const unionSize = new Set([...myWords, ...candWords]).size;
                if (unionSize > 0) {
                    score += Math.round(7 * (overlapCount / unionSize));
                }
            }

            // Part B (8 pts): Cross-check – penalize if candidate violates my deal-breakers or vice versa
            maxPossible += 8;
            const myViolations = countDealBreakerViolations(myDB, candidateLifestyle);
            const candViolations = countDealBreakerViolations(candDB, myLifestyle);
            const totalViolations = myViolations + candViolations;
            // Each violation costs 3 pts, max penalty = 8
            score += Math.max(0, 8 - totalViolations * 3);
        }
    }

    // ── Room Preference Matching (20 pts) ──
    if (myPrefs && candidatePrefs) {
        const myDistricts = Array.isArray(myPrefs.preferred_districts)
            ? myPrefs.preferred_districts
            : [];
        const candDistricts = Array.isArray(candidatePrefs.preferred_districts)
            ? candidatePrefs.preferred_districts
            : [];
        if (myDistricts.length > 0 && candDistricts.length > 0) {
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
        }

        if (myPrefs.room_type && candidatePrefs.room_type) {
            maxPossible += 8;
            if (myPrefs.room_type === candidatePrefs.room_type) score += 8;
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

    // Look up ROOMMATE_INVITE notifications to find roomId for each match
    // Notifications are sent to the target user with roomId embedded in body
    const allUserIds = [...new Set([userId, ...otherIds])];
    const inviteNotifs = allUserIds.length > 0
        ? await prisma.notification.findMany({
              where: {
                  userId: { in: allUserIds },
                  type: 'ROOMMATE_INVITE',
              },
              orderBy: { createdAt: 'desc' },
              select: { userId: true, body: true, createdAt: true },
          })
        : [];

    // Build a map: targetUserId -> roomId (from the latest invite notification)
    const roomIdByUser = new Map();
    for (const n of inviteNotifs) {
        if (!roomIdByUser.has(n.userId) && n.body) {
            const match = n.body.match(/\|\|ROOM_ID:([a-f0-9-]+)\|\|/i);
            if (match) {
                roomIdByUser.set(n.userId, match[1]);
            }
        }
    }

    const list = matches.map((m) => {
        const isRequester = m.requester_id === userId;
        const otherId = isRequester ? m.target_id : m.requester_id;
        const other = userMap.get(otherId) || null;
        // roomId: check if the current user received an invite, or if the other user received one
        const roomId = roomIdByUser.get(userId) || roomIdByUser.get(otherId) || null;
        return {
            id: m.id,
            status: m.status,
            createdAt: m.created_at,
            isRequester,
            roomId,
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

/**
 * Lấy danh sách phòng đang thuê (ACTIVE) của user
 */
async function getMyActiveRooms(userId) {
    const periods = await prisma.roomRentalPeriod.findMany({
        where: { userId, status: 'ACTIVE' },
        include: {
            room: {
                include: {
                    images: { take: 1 },
                    rentals: {
                        include: {
                            location: true,
                            images: { take: 1 },
                        },
                    },
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
            const address = loc
                ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ')
                : '';
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

/**
 * Mời roommate đã chấp nhận kết bạn vào phòng đang thuê
 * → Tạo notification + gửi email cho target user
 */
async function inviteRoommate(inviterId, targetUserId, roomId) {
    if (inviterId === targetUserId) {
        throw Object.assign(new Error('Không thể mời chính mình'), { statusCode: 400 });
    }

    // 1. Kiểm tra hai người đã ACCEPTED match
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

    // 2. Kiểm tra inviter đang thuê phòng này (ACTIVE)
    const rentalPeriod = await prisma.roomRentalPeriod.findFirst({
        where: { userId: inviterId, roomId, status: 'ACTIVE' },
    });
    if (!rentalPeriod) {
        throw Object.assign(
            new Error('Bạn không có hợp đồng thuê phòng này đang hoạt động'),
            { statusCode: 400 }
        );
    }

    // 3. Lấy thông tin phòng
    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
            images: { take: 1 },
            rentals: {
                include: {
                    location: true,
                    images: { take: 1 },
                },
            },
        },
    });
    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    // 4. Lấy thông tin cả 2 user
    const [inviter, targetUser] = await Promise.all([
        prisma.user.findUnique({ where: { id: inviterId }, select: { id: true, fullName: true } }),
        prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, fullName: true, email: true, status: true } }),
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

    // 5. Tạo notification trên hệ thống (roomId embedded in body for FE parsing)
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

    // 6. Gửi email
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

    return {
        message: `Đã gửi lời mời ở ghép đến ${targetUser.fullName}`,
    };
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
};
