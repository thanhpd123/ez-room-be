const notificationService = require('../services/notification.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Notification error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getMyNotifications(req, res) {
    try {
        const result = await notificationService.getMyNotifications(
            req.auth.user.id,
            { limit: req.query.limit, page: req.query.page }
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải thông báo');
    }
}

async function getUnreadCount(req, res) {
    try {
        const result = await notificationService.getUnreadCount(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi đếm thông báo');
    }
}

async function markAsRead(req, res) {
    try {
        const result = await notificationService.markAsRead(
            req.auth.user.id,
            req.params.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi đánh dấu đã đọc');
    }
}

async function markAllAsRead(req, res) {
    try {
        const result = await notificationService.markAllAsRead(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi đánh dấu đã đọc');
    }
}

module.exports = {
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
};
