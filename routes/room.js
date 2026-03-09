const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    createRoom,
    getRooms,
    getRoomById,
    updateRoom,
    deleteRoom,
    getAmenities,
    moderateRoom,
    getRoomTenants,
    searchTenants,
    createRentalContract,
    getMyBookings,
} = require('../controllers/room.controller');

const router = express.Router();

/**
 * GET /rooms/amenities
 * Lấy danh sách amenities (public)
 * ⚠️ Route này phải đặt TRƯỚC /:roomId để tránh conflict
 */
router.get('/amenities', getAmenities);

/**
 * GET /rooms/my-bookings
 * Tenant lấy lịch sử thuê phòng của mình (RoomRentalPeriod)
 */
router.get('/my-bookings', verifyJWT, requireRole('TENANT', 'LANDLORD', 'GUEST'), getMyBookings);

/**
 * GET /rooms/search-tenants
 * Landlord tìm kiếm tenant theo email/phone
 * Query: ?q=email_or_phone
 */
router.get('/search-tenants', verifyJWT, requireRole('LANDLORD'), searchTenants);

/**
 * GET /rooms
 * Lấy danh sách rooms (public)
 * Query: ?rentalId=xxx&roomType=single&minPrice=1000000&maxPrice=5000000&page=1&limit=10
 */
router.get('/', getRooms);

/**
 * GET /rooms/:roomId/tenants
 * Lấy danh sách người thuê phòng (LANDLORD only)
 */
router.get('/:roomId/tenants', verifyJWT, requireRole('LANDLORD'), getRoomTenants);

/**
 * POST /rooms/:roomId/contracts
 * Landlord tạo hợp đồng thuê phòng
 * Body: { tenantId, startDate, endDate, actualPrice, deposit? }
 */
router.post('/:roomId/contracts', verifyJWT, requireRole('LANDLORD'), createRentalContract);

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
 * PUT /rooms/:roomId/moderate
 * Moderator duyệt / từ chối room (MODERATOR, ADMIN)
 */
router.put('/:roomId/moderate', verifyJWT, requireRole('MODERATOR', 'ADMIN'), moderateRoom);

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

