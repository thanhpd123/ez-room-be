const prisma = require('../config/prisma');
const feedbackConfig = require('../config/feedback.config');

/**
 * Tạo feedback đánh giá phòng
 */
async function createFeedback(userId, body) {
    const {
        rentalPeriodId,
        roomId,
        rating,
        comment,
        cleanlinessRating,
        locationRating,
        valueRating,
        landlordRating,
    } = body;

    if (!rentalPeriodId || !roomId) {
        throw Object.assign(new Error('Thiếu rentalPeriodId hoặc roomId'), { statusCode: 400 });
    }

    const ratingNum = rating != null ? parseInt(rating, 10) : null;
    if (ratingNum == null || ratingNum < 1 || ratingNum > 5) {
        throw Object.assign(new Error('Đánh giá tổng thể phải từ 1 đến 5 sao'), { statusCode: 400 });
    }

    const commentStr = typeof comment === 'string' ? comment.trim() : '';
    if (commentStr.length < 20) {
        throw Object.assign(new Error('Nhận xét cần tối thiểu 20 ký tự'), { statusCode: 400 });
    }

    const optRatings = [cleanlinessRating, locationRating, valueRating, landlordRating];
    for (const r of optRatings) {
        if (r != null) {
            const n = parseInt(r, 10);
            if (isNaN(n) || n < 1 || n > 5) {
                throw Object.assign(new Error('Các đánh giá chi tiết phải từ 1 đến 5'), { statusCode: 400 });
            }
        }
    }

    const rentalPeriod = await prisma.roomRentalPeriod.findUnique({
        where: { id: rentalPeriodId },
        include: { feedback: true },
    });

    if (!rentalPeriod) {
        throw Object.assign(new Error('Không tìm thấy thông tin thuê phòng'), { statusCode: 404 });
    }

    if (rentalPeriod.userId !== userId) {
        throw Object.assign(new Error('Bạn không có quyền đánh giá lần thuê này'), { statusCode: 403 });
    }

    if (rentalPeriod.status === 'CANCELLED') {
        throw Object.assign(new Error('Không thể đánh giá cho hợp đồng đã hủy'), { statusCode: 400 });
    }

    const diffMs = Date.now() - new Date(rentalPeriod.startDate).getTime();
    if (diffMs < feedbackConfig.MIN_RENTAL_DURATION_MS) {
        throw Object.assign(new Error('Bạn cần thuê tối thiểu 1 phút trước khi đánh giá'), { statusCode: 400 });
    }

    const existingFeedback = rentalPeriod.feedback?.find((f) => f.user_id === userId);
    if (existingFeedback && existingFeedback.status !== 'REJECTED') {
        throw Object.assign(new Error('Bạn đã đánh giá phòng này cho lần thuê này rồi'), { statusCode: 400 });
    }

    let feedback;
    if (existingFeedback && existingFeedback.status === 'REJECTED') {
        feedback = await prisma.$transaction(async (tx) => {
            const updated = await tx.feedback.update({
                where: { id: existingFeedback.id },
                data: {
                    rating: ratingNum,
                    comment: commentStr,
                    cleanliness_rating: cleanlinessRating != null ? parseInt(cleanlinessRating, 10) : null,
                    location_rating: locationRating != null ? parseInt(locationRating, 10) : null,
                    value_rating: valueRating != null ? parseInt(valueRating, 10) : null,
                    landlord_rating: landlordRating != null ? parseInt(landlordRating, 10) : null,
                    status: 'PENDING',
                    reviewed_by: null,
                    reviewed_at: null,
                    moderator_note: null,
                    updated_at: new Date(),
                },
            });
            const moderatorService = require('./moderator.service');
            await moderatorService.autoAssignNewTask(tx, {
                target_type: 'FEEDBACK',
                target_id: updated.id,
                priority: 'NORMAL',
                category: 'FEEDBACK_REVIEW',
                source: 'SYSTEM',
            });
            return updated;
        });
    } else {
        feedback = await prisma.$transaction(async (tx) => {
            const created = await tx.feedback.create({
                data: {
                    user_id: userId,
                    target_type: 'ROOM',
                    target_id: roomId,
                    rental_period_id: rentalPeriodId,
                    rating: ratingNum,
                    comment: commentStr,
                    cleanliness_rating: cleanlinessRating != null ? parseInt(cleanlinessRating, 10) : null,
                    location_rating: locationRating != null ? parseInt(locationRating, 10) : null,
                    value_rating: valueRating != null ? parseInt(valueRating, 10) : null,
                    landlord_rating: landlordRating != null ? parseInt(landlordRating, 10) : null,
                    status: 'PENDING',
                },
            });
            const moderatorService = require('./moderator.service');
            await moderatorService.autoAssignNewTask(tx, {
                target_type: 'FEEDBACK',
                target_id: created.id,
                priority: 'NORMAL',
                category: 'FEEDBACK_REVIEW',
                source: 'SYSTEM',
            });
            return created;
        });
    }

    try {
        const moderators = await prisma.user.findMany({
            where: { role: { in: ['MODERATOR', 'ADMIN'] } },
            select: { id: true },
        });
        if (moderators.length > 0) {
            await prisma.notification.createMany({
                data: moderators.map((m) => ({
                    userId: m.id,
                    type: 'ADMIN_ALERT',
                    title: 'Feedback mới cần duyệt',
                    body: 'Có đánh giá mới cho phòng cần kiểm duyệt.',
                    status: 'UNREAD',
                })),
            });
        }
    } catch (notifErr) {
        console.warn('Could not notify moderators:', notifErr.message);
    }

    return {
        data: {
            id: feedback.id,
            status: feedback.status,
            rating: feedback.rating,
        },
    };
}

/**
 * Lấy feedback theo rental period
 */
async function getFeedbackByRentalPeriod(userId, rentalPeriodId) {
    const period = await prisma.roomRentalPeriod.findUnique({
        where: { id: rentalPeriodId },
        include: { feedback: { where: { user_id: userId } } },
    });

    if (!period) {
        throw Object.assign(new Error('Không tìm thấy'), { statusCode: 404 });
    }

    if (period.userId !== userId) {
        throw Object.assign(new Error('Không có quyền'), { statusCode: 403 });
    }

    const fb = period.feedback[0] || null;
    if (!fb) {
        return { data: null };
    }

    return {
        data: {
            id: fb.id,
            rating: fb.rating,
            comment: fb.comment,
            cleanlinessRating: fb.cleanliness_rating,
            locationRating: fb.location_rating,
            valueRating: fb.value_rating,
            landlordRating: fb.landlord_rating,
            status: fb.status,
            moderatorNote: fb.moderator_note,
            createdAt: fb.created_at,
        },
    };
}

/**
 * Lấy danh sách reviews của một room (công khai cho tenant)
 */
async function getRoomReviews(roomId, options = {}) {
    const { page = 1, limit = 5 } = options;

    // Kiểm tra room tồn tại
    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        select: { id: true },
    });

    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    // Query reviews cho room này (chỉ APPROVED)
    const whereClause = {
        target_type: 'ROOM',
        target_id: roomId,
        status: 'APPROVED',
    };

    const total = await prisma.feedback.count({ where: whereClause });

    const reviews = await prisma.feedback.findMany({
        where: whereClause,
        include: {
            users: { select: { id: true, fullName: true, avatarUrl: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
    });

    const formatted = reviews.map((fb) => ({
        id: fb.id,
        rating: fb.rating,
        cleanlinessRating: fb.cleanliness_rating,
        locationRating: fb.location_rating,
        valueRating: fb.value_rating,
        landlordRating: fb.landlord_rating,
        comment: fb.comment,
        createdAt: fb.created_at,
        author: {
            id: fb.users?.id,
            name: fb.users?.fullName || 'Ẩn danh',
            avatar: fb.users?.avatarUrl,
        },
        landlordReply: fb.landlord_reply,
        repliedAt: fb.replied_at,
    }));

    return {
        reviews: formatted,
        total,
        page,
        limit,
        hasMore: (page - 1) * limit + limit < total,
    };
}

/**
 * Lấy danh sách reviews của landlord cho rentals/rooms của họ
 */
async function getLandlordReviews(landlordId, options = {}) {
    const { status = 'APPROVED', page = 1, limit = 10, sortBy = 'recent' } = options;

    // Lấy tất cả rentals của landlord
    const rentals = await prisma.rental.findMany({
        where: { owner_id: landlordId },
        select: { id: true, title: true, rooms: { select: { id: true } } },
    });

    if (!rentals.length) {
        return { reviews: [], total: 0, page, limit, hasMore: false };
    }

    const rentalIds = rentals.map((r) => r.id);
    const roomIds = rentals.flatMap((r) => r.rooms.map((rm) => rm.id));

    // Query reviews cho các rooms của landlord này
    const whereClause = {
        AND: [
            {
                OR: [
                    { target_type: 'ROOM', target_id: { in: roomIds } },
                    { target_type: 'RENTAL', target_id: { in: rentalIds } },
                ],
            },
            ...(status ? [{ status }] : []),
        ],
    };

    const total = await prisma.feedback.count({ where: whereClause });

    const orderBy = sortBy === 'rating' ? { rating: 'desc' } : { created_at: 'desc' };

    const reviews = await prisma.feedback.findMany({
        where: whereClause,
        include: {
            users: { select: { id: true, fullName: true, avatarUrl: true } },
            room_rental_periods: {
                include: { room: { select: { id: true, room_name: true } } },
            },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
    });

    const formatted = reviews.map((fb) => ({
        id: fb.id,
        ratingOverall: fb.rating,
        cleanlinessRating: fb.cleanliness_rating,
        locationRating: fb.location_rating,
        valueRating: fb.value_rating,
        landlordRating: fb.landlord_rating,
        comment: fb.comment,
        reviewer: {
            id: fb.users.id,
            fullName: fb.users.fullName,
            avatarUrl: fb.users.avatarUrl,
        },
        room: fb.room_rental_periods?.room || null,
        targetType: fb.target_type,
        status: fb.status,
        createdAt: fb.created_at,
        landlordReply: fb.landlord_reply,
        repliedAt: fb.replied_at,
    }));

    return {
        reviews: formatted,
        total,
        page,
        limit,
        hasMore: (page - 1) * limit + reviews.length < total,
    };
}

/**
 * Landlord reply to a review
 */
async function replyToReview(landlordId, reviewId, content) {
    const review = await prisma.feedback.findUnique({
        where: { id: reviewId },
        include: {
            room_rental_periods: {
                include: { room: { include: { rentals: true } } },
            },
        },
    });

    if (!review) {
        throw Object.assign(new Error('Không tìm thấy đánh giá'), { statusCode: 404 });
    }

    // Check if landlord owns this rental
    const room = review.room_rental_periods?.room;
    if (!room || room.rentals[0]?.owner_id !== landlordId) {
        throw Object.assign(new Error('Bạn không có quyền trả lời đánh giá này'), { statusCode: 403 });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        throw Object.assign(new Error('Nội dung phản hồi không được để trống'), { statusCode: 400 });
    }

    const updated = await prisma.feedback.update({
        where: { id: reviewId },
        data: {
            landlord_reply: content.trim(),
            replied_at: new Date(),
        },
    });

    return {
        success: true,
        message: 'Phản hồi đã được lưu',
        data: {
            id: updated.id,
            landlordReply: updated.landlord_reply,
            repliedAt: updated.replied_at,
        },
    };
}

module.exports = {
    createFeedback,
    getFeedbackByRentalPeriod,
    getRoomReviews,
    getLandlordReviews,
    replyToReview,
};
