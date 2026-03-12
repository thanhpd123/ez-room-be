const adminService = require('../services/admin.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Admin error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(err.errors && { errors: err.errors }),
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getAllWallets(req, res) {
    try {
        const result = await adminService.getAllWallets({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 10,
            search: req.query.search,
            minBalance: req.query.minBalance,
            maxBalance: req.query.maxBalance,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách ví');
    }
}

async function getWalletTransactions(req, res) {
    try {
        const result = await adminService.getWalletTransactions(req.params.walletId, {
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 20,
            type: req.query.type,
            status: req.query.status,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy giao dịch ví');
    }
}

async function getWalletStats(req, res) {
    try {
        const result = await adminService.getWalletStats();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thống kê ví');
    }
}

async function getAllUsers(req, res) {
    try {
        const result = await adminService.getAllUsers({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 10,
            role: req.query.role,
            status: req.query.status,
            search: req.query.search,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách người dùng');
    }
}

async function getUserById(req, res) {
    try {
        const result = await adminService.getUserById(req.params.userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thông tin người dùng');
    }
}

async function updateUserRole(req, res) {
    try {
        const result = await adminService.updateUserRole(
            req.params.userId,
            req.body.role,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật role người dùng');
    }
}

async function updateUserStatus(req, res) {
    try {
        const result = await adminService.updateUserStatus(
            req.params.userId,
            req.body.status,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật status người dùng');
    }
}

async function getDashboardStats(req, res) {
    try {
        const result = await adminService.getDashboardStats();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thống kê');
    }
}

module.exports = {
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    getDashboardStats,
    getAllWallets,
    getWalletTransactions,
    getWalletStats,
};
