const prisma = require('../config/prisma');
const feedbackConfig = require('../config/feedback.config');

/**
 * POST /feedback
 * Tenant tạo feedback đánh giá phòng (target_type=ROOM)
 * Body: { rentalPeriodId, roomId, rating, comment, cleanlinessRating?, locationRating?, valueRating?, landlordRating? }
 * - Validate: thuê >= 1 phút, chưa có feedback (hoặc REJECTED được sửa), status ACTIVE
 * - Tạo feedback status=PENDING
 * - Gửi notification cho moderator (nếu có)
 */
async function createFeedback(req, res) {
    try {
        const userId = req.auth.user.id;
        const {
            rentalPeriodId,
            roomId,
            rating,
            comment,
            cleanlinessRating,
            locationRating,
            valueRating,
            landlordRating,
        } = req.body;

        if (!rentalPeriodId || !roomId) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu rentalPeriodId hoặc roomId',
            });
        }

        const ratingNum = rating != null ? parseInt(rating, 10) : null;
        if (ratingNum == null || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({
                success: false,
                message: 'Đánh giá tổng thể phải từ 1 đến 5 sao',
            });
        }

        const commentStr = typeof comment === 'string' ? comment.trim() : '';
        if (commentStr.length < 20) {
            return res.status(400).json({
                success: false,
                message: 'Nhận xét cần tối thiểu 20 ký tự',
            });
        }

        // Validate optional detail ratings 1-5
        const optRatings = [cleanlinessRating, locationRating, valueRating, landlordRating];
        for (const r of optRatings) {
            if (r != null) {
                const n = parseInt(r, 10);
                if (isNaN(n) || n < 1 || n > 5) {
                    return res.status(400).json({
                        success: false,
                        message: 'Các đánh giá chi tiết phải từ 1 đến 5',
                    });
                }
            }
        }

        const rentalPeriod = await prisma.roomRentalPeriod.findUnique({
            where: { id: rentalPeriodId },
            include: { feedback: true },
        });

        if (!rentalPeriod) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy thông tin thuê phòng',
            });
        }

        if (rentalPeriod.userId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền đánh giá lần thuê này',
            });
        }

        if (rentalPeriod.status === 'CANCELLED') {
            return res.status(400).json({
                success: false,
                message: 'Không thể đánh giá cho hợp đồng đã hủy',
            });
        }

        const diffMs = Date.now() - new Date(rentalPeriod.startDate).getTime();
        if (diffMs < feedbackConfig.MIN_RENTAL_DURATION_MS) {
            return res.status(400).json({
                success: false,
                message: 'Bạn cần thuê tối thiểu 1 phút trước khi đánh giá',
            });
        }

        const existingFeedback = rentalPeriod.feedback?.find((f) => f.user_id === userId);
        if (existingFeedback && existingFeedback.status !== 'REJECTED') {
            return res.status(400).json({
                success: false,
                message: 'Bạn đã đánh giá phòng này cho lần thuê này rồi',
            });
        }

        let feedback;
        if (existingFeedback && existingFeedback.status === 'REJECTED') {
            // Cập nhật feedback bị từ chối, reset status về PENDING + thêm vào ModerationQueue
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

        // Notify moderators (optional - create notification for each moderator)
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
                        body: `Có đánh giá mới cho phòng cần kiểm duyệt.`,
                        status: 'UNREAD',
                    })),
                });
            }
        } catch (notifErr) {
            console.warn('Could not notify moderators:', notifErr.message);
        }

        return res.status(201).json({
            success: true,
            message: 'Đánh giá của bạn đã được gửi và đang chờ duyệt',
            data: {
                id: feedback.id,
                status: feedback.status,
                rating: feedback.rating,
            },
        });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'Bạn đã đánh giá phòng này cho lần thuê này rồi',
            });
        }
        console.error('Create feedback error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi gửi đánh giá',
            error: err.message,
        });
    }
}

/**
 * GET /feedback/by-rental-period/:rentalPeriodId
 * Tenant xem feedback của mình theo rental period
 */
async function getFeedbackByRentalPeriod(req, res) {
    try {
        const userId = req.auth.user.id;
        const { rentalPeriodId } = req.params;

        const period = await prisma.roomRentalPeriod.findUnique({
            where: { id: rentalPeriodId },
            include: { feedback: { where: { user_id: userId } } },
        });

        if (!period) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        }

        if (period.userId !== userId) {
            return res.status(403).json({ success: false, message: 'Không có quyền' });
        }

        const fb = period.feedback[0] || null;
        if (!fb) {
            return res.json({ success: true, data: null });
        }

        return res.json({
            success: true,
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
        });
    } catch (err) {
        console.error('Get feedback error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy đánh giá',
            error: err.message,
        });
    }
}

module.exports = {
    createFeedback,
    getFeedbackByRentalPeriod,
};
