const preorderService = require('../services/preorder.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Preorder error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getLandlordRequests(req, res) {
    try {
        const result = await preorderService.getLandlordRequests(req.auth.user.id, {
            status: req.query.status,
            search: req.query.search,
            page: req.query.page,
            limit: req.query.limit,
        });
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tải danh sách yêu cầu');
    }
}

async function getMyPreorders(req, res) {
    try {
        const result = await preorderService.getMyPreorders(req.auth.user.id, {
            status: req.query.status,
            paymentStatus: req.query.paymentStatus,
            page: req.query.page,
            limit: req.query.limit,
        });
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tải danh sách đặt cọc của bạn');
    }
}

async function createDepositPayment(req, res) {
    try {
        const result = await preorderService.createDepositPayment(req.auth.user.id, req.body);
        return res.status(201).json({
            success: true,
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tạo thanh toán đặt cọc');
    }
}

async function handlePayOSWebhook(req, res) {
    try {
        const result = await preorderService.handlePayOSWebhook(req.body);
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        const statusCode = err.statusCode || 400;
        return res.status(statusCode).json({
            success: false,
            message: err.message || 'Webhook không hợp lệ',
        });
    }
}

async function confirmRequest(req, res) {
    try {
        const result = await preorderService.confirmRequest(
            req.params.preorderId,
            req.auth.user.id
        );
        return res.status(200).json({
            success: true,
            message: 'Đã xác nhận yêu cầu',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xác nhận yêu cầu');
    }
}

async function rejectRequest(req, res) {
    try {
        const result = await preorderService.rejectRequest(
            req.params.preorderId,
            req.auth.user.id,
            req.body
        );
        return res.status(200).json({
            success: true,
            message: 'Đã từ chối yêu cầu',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi từ chối yêu cầu');
    }
}

async function resumePayment(req, res) {
    try {
        const result = await preorderService.resumePayment(
            req.auth.user.id,
            req.params.preorderId
        );
        console.log('[resumePayment] checkoutUrl:', result?.data?.payment?.checkoutUrl);
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy lại link thanh toán');
    }
}

async function cancelUnpaidPreorder(req, res) {
    try {
        const result = await preorderService.cancelUnpaidPreorder(
            req.auth.user.id,
            req.params.preorderId,
            req.body
        );
        return res.status(200).json({
            success: true,
            message: 'Đã hủy yêu cầu đặt cọc',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi hủy yêu cầu đặt cọc');
    }
}

async function verifyPreorderPayment(req, res) {
    try {
        const result = await preorderService.verifyPreorderPayment(
            req.auth.user.id,
            req.params.preorderId,
            req.query.orderCode
        );
        return res.status(200).json({
            success: true,
            message: 'Đã xác minh trạng thái thanh toán',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xác minh thanh toán');
    }
}

module.exports = {
    getMyPreorders,
    createDepositPayment,
    resumePayment,
    cancelUnpaidPreorder,
    verifyPreorderPayment,
    handlePayOSWebhook,
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
};
