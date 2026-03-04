const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllRentals,
    getRentalById,
    updateRentalStatus,
    deleteRental,
    getRentalStats,
} = require('../controllers/rentals.controller');

const router = express.Router();

// Tất cả routes yêu cầu đăng nhập
router.use(verifyJWT);

// ============ ADMIN + MODERATOR ROUTES ============

/**
 * GET /rentals/stats
 * Thống kê bài đăng
 */
router.get('/stats', requireRole('ADMIN', 'MODERATOR'), getRentalStats);

/**
 * GET /rentals
 * Lấy danh sách bài đăng (có filter)
 * Query: ?page=1&limit=10&status=AVAILABLE&ownerId=xxx&search=keyword&city=Hanoi
 */
router.get('/', requireRole('ADMIN', 'MODERATOR'), getAllRentals);

/**
 * GET /rentals/:id
 * Lấy chi tiết bài đăng
 */
router.get('/:id', requireRole('ADMIN', 'MODERATOR'), getRentalById);

/**
 * PATCH /rentals/:id/status
 * Thay đổi trạng thái (ẩn/hiện/lưu trữ)
 * Body: { status: 'HIDDEN' | 'AVAILABLE' | 'ARCHIVED', reason?: string }
 */
router.patch('/:id/status', requireRole('ADMIN', 'MODERATOR'), updateRentalStatus);

// ============ ADMIN ONLY ROUTES ============

/**
 * DELETE /rentals/:id
 * Xóa vĩnh viễn bài đăng (không thể xóa nếu có đơn cọc đang hoạt động)
 */
router.delete('/:id', requireRole('ADMIN'), deleteRental);

module.exports = router;
