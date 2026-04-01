const vipService = require('../services/vip.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('VIP error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getVipPackages(req, res) {
    try {
        const result = await vipService.getVipPackages({
            targetRole: req.query.targetRole,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải gói VIP');
    }
}

async function createVipPurchase(req, res) {
    try {
        const result = await vipService.createVipPurchase(req.auth?.user, req.body);
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tạo thanh toán VIP');
    }
}

async function verifyVipPurchase(req, res) {
    try {
        const result = await vipService.verifyVipPurchase(
            req.auth?.user?.id,
            req.query.orderCode
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi xác minh thanh toán VIP');
    }
}

async function getMyVipStatus(req, res) {
    try {
        const result = await vipService.getMyVipStatus(req.auth?.user?.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải trạng thái VIP');
    }
}

module.exports = {
    getVipPackages,
    createVipPurchase,
    verifyVipPurchase,
    getMyVipStatus,
};