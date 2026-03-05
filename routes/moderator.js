const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { getAllUsers } = require('../controllers/admin.controller');

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

module.exports = router;
