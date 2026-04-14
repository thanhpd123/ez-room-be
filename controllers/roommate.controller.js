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

async function getMyActiveRooms(req, res) {
    try {
        const result = await roommateService.getMyActiveRooms(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải danh sách phòng đang thuê');
    }
}

async function inviteRoommate(req, res) {
    try {
        const result = await roommateService.inviteRoommate(
            req.auth.user.id,
            req.params.targetUserId,
            req.body.roomId
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi gửi lời mời ở ghép');
    }
}

async function semanticSearch(req, res) {
    try {
        const roommateRagService = require('../services/roommate-rag.service');
        const query = String(req.query.q || '').trim();
        if (!query || query.length < 3) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập mô tả ít nhất 3 ký tự' });
        }
        const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
        const result = await roommateRagService.searchByPersonality(req.auth.user.id, query, limit);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tìm kiếm AI');
    }
}

async function searchByArea(req, res) {
    try {
        const area = String(req.query.area || '').trim();
        if (!area) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập khu vực (area)' });
        }
        const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
        const result = await roommateService.getTopSearchersInArea(req.auth.user.id, area, limit);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tìm kiếm theo khu vực');
    }
}

async function createRoommateRating(req, res) {
    try {
        const result = await roommateService.createRoommateRating(req.auth.user.id, req.body);
        return res.status(201).json({ success: true, message: 'Đánh giá đã được ghi nhận', ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tạo đánh giá');
    }
}

async function checkRoommateRating(req, res) {
    try {
        const { targetId, rentalPeriodId } = req.query;
        const result = await roommateService.checkRoommateRating(req.auth.user.id, targetId, rentalPeriodId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi kiểm tra đánh giá');
    }
}

async function getPeopleYouMayKnow(req, res) {
    try {
        const result = await roommateService.getPeopleYouMayKnow(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải gợi ý "Có thể bạn biết"');
    }
}

module.exports = {
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
    getProfile,
    getMyActiveRooms,
    inviteRoommate,
    semanticSearch,
    searchByArea,
    createRoommateRating,
    checkRoommateRating,
    getPeopleYouMayKnow,
};

