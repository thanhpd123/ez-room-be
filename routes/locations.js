const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllLocations,
    getCities,
    getDistricts,
    getLocationById,
    createLocation,
    updateLocation,
    deleteLocation,
} = require('../controllers/locations.controller');

const router = express.Router();

// ============ PUBLIC ROUTES ============
// Ai cũng xem được

/**
 * GET /locations
 * Lấy danh sách địa điểm
 * Query: ?city=Hanoi&district=Cau Giay&search=keyword
 */
router.get('/', getAllLocations);

/**
 * GET /locations/cities
 * Lấy danh sách các thành phố (distinct)
 */
router.get('/cities', getCities);

/**
 * GET /locations/districts
 * Lấy danh sách quận/huyện
 * Query: ?city=Hanoi
 */
router.get('/districts', getDistricts);

/**
 * GET /locations/:id
 * Lấy chi tiết một địa điểm
 */
router.get('/:id', getLocationById);

// ============ ADMIN ONLY ROUTES ============
// Chỉ Admin được thêm/sửa/xóa

/**
 * POST /locations
 * Tạo địa điểm mới
 * Body: { address, district?, city?, latitude?, longitude? }
 */
router.post('/', verifyJWT, requireRole('ADMIN'), createLocation);

/**
 * PATCH /locations/:id
 * Cập nhật địa điểm
 * Body: { address?, district?, city?, latitude?, longitude? }
 */
router.patch('/:id', verifyJWT, requireRole('ADMIN'), updateLocation);

/**
 * DELETE /locations/:id
 * Xóa địa điểm (không thể xóa nếu có rentals liên kết)
 */
router.delete('/:id', verifyJWT, requireRole('ADMIN'), deleteLocation);

module.exports = router;
