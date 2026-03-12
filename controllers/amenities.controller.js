const amenitiesService = require('../services/amenities.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Amenities error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getAllAmenities(req, res) {
    try {
        const result = await amenitiesService.getAllAmenities();
        return res.json({
            success: true,
            data: result.data,
            total: result.total,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách tiện ích');
    }
}

async function getAmenityById(req, res) {
    try {
        const result = await amenitiesService.getAmenityById(req.params.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thông tin tiện ích');
    }
}

async function createAmenity(req, res) {
    try {
        const result = await amenitiesService.createAmenity(req.body.name);
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tạo tiện ích');
    }
}

async function updateAmenity(req, res) {
    try {
        const result = await amenitiesService.updateAmenity(req.params.id, req.body.name);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật tiện ích');
    }
}

async function deleteAmenity(req, res) {
    try {
        const result = await amenitiesService.deleteAmenity(req.params.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa tiện ích');
    }
}

module.exports = {
    getAllAmenities,
    getAmenityById,
    createAmenity,
    updateAmenity,
    deleteAmenity,
};
