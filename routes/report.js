const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { createReport, getReports, handleReport } = require('../controllers/report.controller');

const router = express.Router();

/**
 * POST /reports
 * Tạo báo cáo vi phạm (bất kỳ user đã đăng nhập)
 * Body: { targetType, targetId, reason, description }
 */
router.post('/', verifyJWT, requireRole('TENANT'), createReport);

/**
 * GET /reports
 * Lấy danh sách báo cáo (moderator/admin)
 * Query: ?status=PENDING&page=1&limit=20
 */
router.get('/', verifyJWT, requireRole('MODERATOR', 'ADMIN'), getReports);

/**
 * PATCH /reports/:id
 * Xử lý báo cáo (moderator/admin)
 * Body: { status, moderatorNote }
 */
router.patch('/:id', verifyJWT, requireRole('MODERATOR', 'ADMIN'), handleReport);

module.exports = router;
