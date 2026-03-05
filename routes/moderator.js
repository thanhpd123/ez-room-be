const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { getAllUsers, getUserById, updateUserStatus } = require('../controllers/admin.controller');

const router = express.Router();

// Tất cả routes yêu cầu: đăng nhập + role MODERATOR hoặc ADMIN
router.use(verifyJWT);
router.use(requireRole('MODERATOR', 'ADMIN'));

/**
 * GET /moderator/users
 * Lấy danh sách users (phân trang, filter)
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

module.exports = router;
