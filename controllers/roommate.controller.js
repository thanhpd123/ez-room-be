const roommateService = require('../services/roommate.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Roommate error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getSuggestions(req, res) {
    try {
        const result = await roommateService.getSuggestions(
            req.auth.user.id,
            { limit: req.query.limit }
        );
        return res.json({
            success: true,
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải gợi ý roommate');
    }
}

async function sendRequest(req, res) {
    try {
        const result = await roommateService.sendRequest(
            req.auth.user.id,
            req.params.targetId
        );
        return res.status(201).json({
            success: true,
            message: 'Đã gửi lời mời kết bạn ở ghép',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi gửi lời mời');
    }
}

async function getMyMatches(req, res) {
    try {
        const result = await roommateService.getMyMatches(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải danh sách match');
    }
}

async function updateMatchStatus(req, res) {
    try {
        const result = await roommateService.updateMatchStatus(
            req.auth.user.id,
            req.params.matchId,
            req.body
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi cập nhật');
    }
}

async function getProfile(req, res) {
    try {
        const result = await roommateService.getPublicProfile(req.params.userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải hồ sơ');
    }
}

module.exports = {
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
    getProfile,
};
