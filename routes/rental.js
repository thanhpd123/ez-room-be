const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    createRental,
    getRentals,
    getRentalById,
    getMyRentals,
    getRentalsForModeration,
    updateRentalStatus,
    getRentalStats,
} = require('../controllers/rental.controller');

const router = express.Router();

/**
 * GET /rentals/stats
 * Admin/Moderator dashboard rental stats. Must be before /:rentalId
 */
router.get('/stats', requireRole('MODERATOR', 'ADMIN'), getRentalStats);

/**
 * GET /rentals/my-rentals
 * Landlord xem danh sách rentals của mình
 * ⚠️ Route này phải đặt TRƯỚC /:rentalId để tránh conflict
 */
router.get('/my-rentals', verifyJWT, getMyRentals);

/**
 * GET /rentals
 * Lấy danh sách rentals (có filter, phân trang) - PUBLIC
 * Query: ?page=1&limit=10&status=AVAILABLE&search=keyword
 */
router.get('/', getRentals);

/**
 * GET /rentals/moderation
 * Moderator/Admin lấy danh sách rentals để duyệt
 * Query: ?status=PENDING&search=keyword&page=1&limit=50
 */
router.get('/moderation', requireRole('MODERATOR', 'ADMIN'), getRentalsForModeration);

/**
 * GET /rentals/:rentalId
 * Lấy chi tiết một rental - PUBLIC
 */
router.get('/:rentalId', getRentalById);

/**
 * POST /rentals
 * Landlord tạo rental mới (status mặc định = HIDDEN)
 */
router.post('/', verifyJWT, requireRole('LANDLORD'), createRental);

/**
 * PATCH /rentals/:rentalId/status
 * Moderator/Admin duyệt rental (đổi status)
 * Body: { status: 'AVAILABLE' }
 */
router.patch('/:rentalId/status', verifyJWT, requireRole('MODERATOR', 'ADMIN'), updateRentalStatus);

module.exports = router;
