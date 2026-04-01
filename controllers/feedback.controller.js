const feedbackService = require('../services/feedback.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Feedback error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function createFeedback(req, res) {
    try {
        const result = await feedbackService.createFeedback(req.auth.user.id, req.body);
        return res.status(201).json({
            success: true,
            message: 'Đánh giá của bạn đã được gửi và đang chờ duyệt',
            ...result,
        });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'Bạn đã đánh giá phòng này cho lần thuê này rồi',
            });
        }
        return handleError(err, res, 'Lỗi khi gửi đánh giá');
    }
}

async function getFeedbackByRentalPeriod(req, res) {
    try {
        const result = await feedbackService.getFeedbackByRentalPeriod(
            req.auth.user.id,
            req.params.rentalPeriodId
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy đánh giá');
    }
}

/**
 * Get landlord reviews
 */
async function getLandlordReviews(req, res) {
    try {
        const status = req.query.status || 'APPROVED';
        const page = Math.max(1, parseInt(req.query.page || 1, 10));
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || 10, 10)));
        const sortBy = req.query.sortBy || 'recent';

        const result = await feedbackService.getLandlordReviews(req.auth.user.id, {
            status,
            page,
            limit,
            sortBy,
        });

        return res.json({ success: true, data: result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy đánh giá');
    }
}

/** * Get reviews for a specific room (public endpoint for tenants)
 */
async function getRoomReviews(req, res) {
    try {
        const { roomId } = req.params;
        const { page = 1, limit = 5 } = req.query;

        const result = await feedbackService.getRoomReviews(roomId, {
            page: parseInt(page),
            limit: parseInt(limit),
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách đánh giá');
    }
}

/** * Reply to a review
 */
async function replyToReview(req, res) {
    try {
        const { reviewId } = req.params;
        const { content } = req.body;

        const result = await feedbackService.replyToReview(req.auth.user.id, reviewId, content);
        return res.json(result);
    } catch (err) {
        return handleError(err, res, 'Lỗi khi phản hồi đánh giá');
    }
}

module.exports = {
    createFeedback,
    getFeedbackByRentalPeriod,
    getRoomReviews,
    getLandlordReviews,
    replyToReview,
};
