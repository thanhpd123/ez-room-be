const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllUsers,
    getUserById,
    updateUserStatus,
    getRentalsForModeration,
    updateRentalStatus,
    getRentalStats,
    getRooms,
    moderateRoom,
    getReports,
    handleReport,
    getReviewsForModeration,
    getReviewDetail,
    updateReviewStatus,
    deleteReview,
} = require('../controllers/moderator.controller');

const router = express.Router();

// Tất cả routes yêu cầu: đăng nhập + role MODERATOR hoặc ADMIN
router.use(verifyJWT);
router.use(requireRole('MODERATOR', 'ADMIN'));

// ═══════════════════ Quản lý Users ═══════════════════

/**
 * GET /moderator/users
 * Lấy danh sách users (phân trang, filter) - chỉ LANDLORD và TENANT
 * Query: ?page=1&limit=10&role=TENANT&status=ACTIVE&search=keyword
 */
router.get('/users', getAllUsers);

/**
 * GET /moderator/users/:userId
 * Lấy thông tin chi tiết một user
 */
router.get('/users/:userId', getUserById);

/**
 * PATCH /moderator/users/:userId/status
 * Thay đổi status của một user (ACTIVE, BANNED, SUSPENDED)
 * Body: { status: 'BANNED' }
 */
router.patch('/users/:userId/status', updateUserStatus);

// ═══════════════════ Duyệt Rental (Bài đăng) ═══════════════════

/**
 * GET /moderator/rentals/stats
 * Thống kê bài đăng cho dashboard
 */
router.get('/rentals/stats', getRentalStats);

/**
 * GET /moderator/rentals/moderation
 * Lấy danh sách bài đăng cần duyệt
 * Query: ?status=PENDING&search=keyword&page=1&limit=50
 */
router.get('/rentals/moderation', getRentalsForModeration);

/**
 * PATCH /moderator/rentals/:rentalId/status
 * Duyệt / từ chối bài đăng (đổi status)
 * Body: { status: 'AVAILABLE' | 'HIDDEN' }
 */
router.patch('/rentals/:rentalId/status', updateRentalStatus);

// ═══════════════════ Duyệt Room Post (Phòng) ═══════════════════

/**
 * GET /moderator/rooms
 * Lấy danh sách phòng (để moderator kiểm duyệt)
 * Query: ?rentalId=xxx&page=1&limit=20
 */
router.get('/rooms', getRooms);

/**
 * PUT /moderator/rooms/:roomId/moderate
 * Duyệt / từ chối phòng
 * Body: { decision: 'approved' | 'rejected', note?: string }
 */
router.put('/rooms/:roomId/moderate', moderateRoom);

// ═══════════════════ Xử lý Báo cáo (Reports) ═══════════════════

/**
 * GET /moderator/reports
 * Lấy danh sách báo cáo vi phạm
 * Query: ?status=PENDING&page=1&limit=20
 */
router.get('/reports', getReports);

/**
 * PATCH /moderator/reports/:id
 * Xử lý báo cáo (duyệt / từ chối / bỏ qua)
 * Body: { status: 'APPROVED' | 'REJECTED' | 'DISMISSED', moderatorNote?: string }
 */
router.patch('/reports/:id', handleReport);

// ═══════════════════ Kiểm duyệt Reviews ═══════════════════

/**
 * GET /moderator/reviews
 * Lấy danh sách reviews (feedback) để kiểm duyệt
 * Query: ?page=1&limit=20&status=PENDING|APPROVED|REJECTED|HIDDEN&roomId=&tenantId=&dateFrom=&dateTo=
 */
router.get('/reviews', getReviewsForModeration);

/**
 * GET /moderator/reviews/:reviewId
 * Chi tiết feedback đầy đủ
 */
router.get('/reviews/:reviewId', getReviewDetail);

/**
 * PATCH /moderator/reviews/:reviewId
 * Duyệt / từ chối review
 * Body: { status: 'APPROVED' | 'REJECTED', moderatorNote?: string }
 */
router.patch('/reviews/:reviewId', updateReviewStatus);

/**
 * DELETE /moderator/reviews/:reviewId
 * Xóa review vi phạm
 */
router.delete('/reviews/:reviewId', deleteReview);

module.exports = router;
