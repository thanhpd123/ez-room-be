const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllAmenities,
    getAmenityById,
    createAmenity,
    updateAmenity,
    deleteAmenity,
} = require('../controllers/amenities.controller');

const router = express.Router();

// ============ PUBLIC ROUTES ============
// Ai cũng xem được danh sách tiện ích

/**
 * GET /amenities
 * Lấy danh sách tất cả tiện ích
 */
router.get('/', getAllAmenities);

/**
 * GET /amenities/:id
 * Lấy chi tiết một tiện ích
 */
router.get('/:id', getAmenityById);

// ============ ADMIN ONLY ROUTES ============
// Chỉ Admin được thêm/sửa/xóa

/**
 * POST /amenities
 * Tạo tiện ích mới
 * Body: { name: string }
 */
router.post('/', verifyJWT, requireRole('ADMIN'), createAmenity);

/**
 * PATCH /amenities/:id
 * Cập nhật tiện ích
 * Body: { name: string }
 */
router.patch('/:id', verifyJWT, requireRole('ADMIN'), updateAmenity);

/**
 * DELETE /amenities/:id
 * Xóa tiện ích
 */
router.delete('/:id', verifyJWT, requireRole('ADMIN'), deleteAmenity);

module.exports = router;
