const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    createRoom,
    getRooms,
    getRoomById,
    updateRoom,
    deleteRoom,
    getAmenities,
} = require('../controllers/room.controller');

const router = express.Router();

/**
 * GET /rooms/amenities
 * Lấy danh sách amenities (public)
 * ⚠️ Route này phải đặt TRƯỚC /:roomId để tránh conflict
 */
router.get('/amenities', getAmenities);

/**
 * GET /rooms
 * Lấy danh sách rooms (public)
 * Query: ?rentalId=xxx&roomType=single&minPrice=1000000&maxPrice=5000000&page=1&limit=10
 */
router.get('/', getRooms);

/**
 * GET /rooms/:roomId
 * Lấy chi tiết room (public)
 */
router.get('/:roomId', getRoomById);

// ===== Các routes sau yêu cầu đăng nhập với role LANDLORD =====

/**
 * POST /rooms
 * Tạo room mới (LANDLORD only)
 * Body: { rental_id, title, price, area?, max_occupants?, thumbnail_url?, roomType?, images?, amenityIds? }
 */
router.post('/', verifyJWT, requireRole('LANDLORD'), createRoom);

/**
 * PUT /rooms/:roomId
 * Cập nhật room (LANDLORD - owner của rental)
 */
router.put('/:roomId', verifyJWT, requireRole('LANDLORD'), updateRoom);

/**
 * DELETE /rooms/:roomId
 * Xóa room (LANDLORD - owner của rental)
 */
router.delete('/:roomId', verifyJWT, requireRole('LANDLORD'), deleteRoom);

module.exports = router;
