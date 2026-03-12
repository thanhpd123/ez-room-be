const favoriteService = require('../services/favorite.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Favorite error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function addFavorite(req, res) {
    try {
        const result = await favoriteService.addFavorite(req.auth.user.id, req.params.roomId);
        return res.json({
            success: true,
            message: 'Đã thêm vào danh sách yêu thích',
            data: result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi thêm yêu thích');
    }
}

async function removeFavorite(req, res) {
    try {
        const result = await favoriteService.removeFavorite(req.auth.user.id, req.params.roomId);
        return res.json({
            success: true,
            message: 'Đã xóa khỏi danh sách yêu thích',
            data: result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa yêu thích');
    }
}

async function getMyFavorites(req, res) {
    try {
        const result = await favoriteService.getMyFavorites(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách yêu thích');
    }
}

async function getFavoriteIds(req, res) {
    try {
        const result = await favoriteService.getFavoriteIds(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách yêu thích');
    }
}

module.exports = {
    addFavorite,
    removeFavorite,
    getMyFavorites,
    getFavoriteIds,
    formatRoomForFavorite: favoriteService.formatRoomForFavorite,
};
