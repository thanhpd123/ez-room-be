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

async function getPendingPaymentOrders(req, res) {
    try {
        const result = await adminService.getPendingPaymentOrders({
            page: parseInt(req.query.page, 10) || 1,
            limit: parseInt(req.query.limit, 10) || 20,
            purpose: req.query.purpose,
            search: req.query.search,
            sortBy: req.query.sortBy,
            order: req.query.order,
            createdAfter: req.query.createdAfter,
            createdBefore: req.query.createdBefore,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách đơn pending');
    }
}

async function cancelPendingPaymentOrder(req, res) {
    try {
        const result = await adminService.cancelPendingPaymentOrder(
            {
                source: req.params.source,
                itemId: req.params.itemId,
                reason: req.body?.reason,
            },
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi hủy đơn pending');
    }
}

async function runPreorderReconciliationNow(req, res) {
    try {
        const result = await adminService.runPreorderReconciliationNow({
            batchSize: parseInt(req.body?.batchSize, 10) || parseInt(req.query.batchSize, 10) || undefined,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi chạy reconcile thủ công');
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

async function getVipPackages(req, res) {
    try {
        const result = await adminService.getVipPackages({
            page: parseInt(req.query.page, 10) || 1,
            limit: parseInt(req.query.limit, 10) || 10,
            targetRole: req.query.targetRole,
            status: req.query.status,
            search: req.query.search,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách gói VIP');
    }
}

async function getVipPackageById(req, res) {
    try {
        const result = await adminService.getVipPackageById(req.params.packageId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy chi tiết gói VIP');
    }
}

async function createVipPackage(req, res) {
    try {
        const result = await adminService.createVipPackage(req.body, req.auth.user.id);
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tạo gói VIP');
    }
}

async function updateVipPackage(req, res) {
    try {
        const result = await adminService.updateVipPackage(
            req.params.packageId,
            req.body,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật gói VIP');
    }
}

async function getVipPurchases(req, res) {
    try {
        const result = await adminService.getVipPurchases({
            page: parseInt(req.query.page, 10) || 1,
            limit: parseInt(req.query.limit, 10) || 20,
            status: req.query.status,
            refundStatus: req.query.refundStatus,
            userId: req.query.userId,
            packageId: req.query.packageId,
            search: req.query.search,
            createdFrom: req.query.createdFrom,
            createdTo: req.query.createdTo,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy lịch sử mua VIP');
    }
}

async function refundVipPurchase(req, res) {
    try {
        const result = await adminService.refundVipPurchase(
            req.params.orderId,
            req.body,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi hoàn tiền giao dịch VIP');
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
    getPendingPaymentOrders,
    cancelPendingPaymentOrder,
    runPreorderReconciliationNow,
    getModeratorKpis,
    getVipPackages,
    getVipPackageById,
    createVipPackage,
    updateVipPackage,
    getVipPurchases,
    refundVipPurchase,
};
