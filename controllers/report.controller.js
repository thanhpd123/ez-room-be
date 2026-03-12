const reportService = require('../services/report.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('[Report] Error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function createReport(req, res) {
    try {
        const result = await reportService.createReport(req.auth.user.id, req.body);
        return res.status(201).json({
            success: true,
            message: 'Gửi báo cáo thành công. Cảm ơn bạn!',
            ...result,
        });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'Bạn đã báo cáo nội dung này rồi',
            });
        }
        return handleError(err, res, 'Lỗi khi tạo báo cáo');
    }
}

async function getReports(req, res) {
    try {
        const result = await reportService.getReports({
            status: req.query.status,
            page: req.query.page,
            limit: req.query.limit,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách báo cáo');
    }
}

async function handleReport(req, res) {
    try {
        const result = await reportService.handleReport(req.params.id, req.auth.user.id, req.body);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xử lý báo cáo');
    }
}

module.exports = {
    createReport,
    getReports,
    handleReport,
};
