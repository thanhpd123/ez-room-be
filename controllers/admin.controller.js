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

async function getPendingWithdrawalQueue(req, res) {
    try {
        const result = await adminService.getPendingWithdrawalQueue({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 20,
            search: req.query.search,
            sortBy: req.query.sortBy,
            order: req.query.order,
            minAmount: req.query.minAmount,
            maxAmount: req.query.maxAmount,
            createdAfter: req.query.createdAfter,
            createdBefore: req.query.createdBefore,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy queue chờ duyệt rút tiền');
    }
}

async function approveWalletWithdrawal(req, res) {
    try {
        const result = await adminService.approveWalletWithdrawal(
            req.params.transactionId,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi duyệt yêu cầu rút tiền');
    }
}

async function rejectWalletWithdrawal(req, res) {
    try {
        const result = await adminService.rejectWalletWithdrawal(
            req.params.transactionId,
            req.auth.user.id,
            req.body
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi từ chối yêu cầu rút tiền');
    }
}

async function approveWalletWithdrawalsBatch(req, res) {
    try {
        const result = await adminService.approveWalletWithdrawalsBatch(req.body, req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi duyệt hàng loạt yêu cầu rút tiền');
    }
}

async function rejectWalletWithdrawalsBatch(req, res) {
    try {
        const result = await adminService.rejectWalletWithdrawalsBatch(req.body, req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi từ chối hàng loạt yêu cầu rút tiền');
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

async function getSystemSettings(req, res) {
    try {
        const result = await adminService.getSystemSettings();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy system settings');
    }
}

async function updateSystemSettings(req, res) {
    try {
        const result = await adminService.updateSystemSettings(req.body, req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật system settings');
    }
}

async function getFinanceSummary(req, res) {
    try {
        const result = await adminService.getFinanceSummary({
            from: req.query.from,
            to: req.query.to,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy finance summary');
    }
}

async function getFinanceReconciliation(req, res) {
    try {
        const result = await adminService.getFinanceReconciliation({
            from: req.query.from,
            to: req.query.to,
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy reconciliation report');
    }
}

async function getModeratorKpis(req, res) {
    try {
        const result = await adminService.getModeratorKpis({
            from: req.query.from,
            to: req.query.to,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy moderator KPIs');
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
    getPendingWithdrawalQueue,
    approveWalletWithdrawal,
    rejectWalletWithdrawal,
    approveWalletWithdrawalsBatch,
    rejectWalletWithdrawalsBatch,
    getSystemSettings,
    updateSystemSettings,
    getFinanceSummary,
    getFinanceReconciliation,
    getModeratorKpis,
};
