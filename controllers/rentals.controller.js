const rentalsService = require('../services/rentals.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Rentals error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getAllRentals(req, res) {
    try {
        const result = await rentalsService.getAllRentals({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 10,
            status: req.query.status,
            ownerId: req.query.ownerId,
            search: req.query.search,
            city: req.query.city,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách bài đăng');
    }
}

async function getRentalById(req, res) {
    try {
        const result = await rentalsService.getRentalById(req.params.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thông tin bài đăng');
    }
}

async function updateRentalStatus(req, res) {
    try {
        const result = await rentalsService.updateRentalStatus(
            req.params.id,
            req.body,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật trạng thái bài đăng');
    }
}

async function deleteRental(req, res) {
    try {
        const result = await rentalsService.deleteRental(
            req.params.id,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa bài đăng');
    }
}

async function getRentalStats(req, res) {
    try {
        const result = await rentalsService.getRentalStats();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thống kê');
    }
}

module.exports = {
    getAllRentals,
    getRentalById,
    updateRentalStatus,
    deleteRental,
    getRentalStats,
};
