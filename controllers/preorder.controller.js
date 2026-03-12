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

module.exports = {
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
};
