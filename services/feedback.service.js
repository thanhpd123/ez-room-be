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
            await tx.moderation_queue.create({
                data: {
                    target_type: 'FEEDBACK',
                    target_id: updated.id,
                    priority: 'NORMAL',
                    category: 'FEEDBACK_REVIEW',
                    source: 'SYSTEM',
                },
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
            await tx.moderation_queue.create({
                data: {
                    target_type: 'FEEDBACK',
                    target_id: created.id,
                    priority: 'NORMAL',
                    category: 'FEEDBACK_REVIEW',
                    source: 'SYSTEM',
                },
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

module.exports = {
    createFeedback,
    getFeedbackByRentalPeriod,
};
