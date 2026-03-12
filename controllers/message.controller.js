const messageService = require('../services/message.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Message error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getConversations(req, res) {
    try {
        const result = await messageService.getConversations(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải danh sách hội thoại');
    }
}

async function getThread(req, res) {
    try {
        const result = await messageService.getThread(
            req.auth.user.id,
            req.params.userId,
            {
                limit: req.query.limit,
                before: req.query.before,
            }
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải tin nhắn');
    }
}

async function sendMessage(req, res) {
    try {
        const result = await messageService.sendMessage(req.auth.user.id, req.body);
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi gửi tin nhắn');
    }
}

module.exports = {
    getConversations,
    getThread,
    sendMessage,
};
