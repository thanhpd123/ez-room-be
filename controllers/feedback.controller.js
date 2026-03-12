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

module.exports = {
    createFeedback,
    getFeedbackByRentalPeriod,
};
