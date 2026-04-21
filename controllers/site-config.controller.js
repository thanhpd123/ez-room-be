const adminService = require('../services/admin.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Site config error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getPublicSiteConfig(req, res) {
    try {
        const result = await adminService.getPublicSiteConfig();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Loi khi lay cau hinh website');
    }
}

module.exports = {
    getPublicSiteConfig,
};
