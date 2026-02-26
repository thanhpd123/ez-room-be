const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    getDashboardStats,
} = require('../controllers/admin.controller');

const router = express.Router();

// Tất cả routes trong file này yêu cầu: đăng nhập + role ADMIN
router.use(verifyJWT);
router.use(requireRole('ADMIN'));

/**
 * GET /admin/stats
 * Thống kê tổng quan cho dashboard
 */
router.get('/stats', getDashboardStats);

/**
 * GET /admin/users
 * Lấy danh sách users (phân trang, filter)
 * Query: ?page=1&limit=10&role=TENANT&status=ACTIVE&search=keyword
 */
router.get('/users', getAllUsers);

/**
 * GET /admin/users/:userId
 * Lấy thông tin chi tiết một user
 */
router.get('/users/:userId', getUserById);

/**
 * PATCH /admin/users/:userId/role
 * Thay đổi role của user
 * Body: { role: 'LANDLORD' }
 */
router.patch('/users/:userId/role', updateUserRole);

/**
 * PATCH /admin/users/:userId/status
 * Thay đổi status của user (khóa/mở khóa)
 * Body: { status: 'BANNED' }
 */
router.patch('/users/:userId/status', updateUserStatus);

module.exports = router;
