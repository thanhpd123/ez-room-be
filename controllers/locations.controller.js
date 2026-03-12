const locationsService = require('../services/locations.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Locations error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getAllLocations(req, res) {
    try {
        const result = await locationsService.getAllLocations({
            city: req.query.city,
            district: req.query.district,
            search: req.query.search,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách địa điểm');
    }
}

async function getCities(req, res) {
    try {
        const result = await locationsService.getCities();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách thành phố');
    }
}

async function getDistricts(req, res) {
    try {
        const result = await locationsService.getDistricts({
            city: req.query.city,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách quận/huyện');
    }
}

async function getLocationById(req, res) {
    try {
        const result = await locationsService.getLocationById(req.params.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thông tin địa điểm');
    }
}

async function createLocation(req, res) {
    try {
        const result = await locationsService.createLocation(req.body);
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tạo địa điểm');
    }
}

async function updateLocation(req, res) {
    try {
        const result = await locationsService.updateLocation(req.params.id, req.body);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật địa điểm');
    }
}

async function deleteLocation(req, res) {
    try {
        const result = await locationsService.deleteLocation(req.params.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa địa điểm');
    }
}

module.exports = {
    getAllLocations,
    getCities,
    getDistricts,
    getLocationById,
    createLocation,
    updateLocation,
    deleteLocation,
};
