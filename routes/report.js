const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { createReport, getReports, handleReport } = require('../controllers/report.controller');

const router = express.Router();

/**
 * @openapi
 * /reports:
 *   get:
 *     tags: [Reports]
 *     summary: Danh sách báo cáo (MODERATOR/ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Danh sách reports
 *   post:
 *     tags: [Reports]
 *     summary: Tạo báo cáo vi phạm (TENANT)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetType, targetId, reason, description]
 *             properties:
 *               targetType: { type: string }
 *               targetId: { type: string }
 *               reason: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Tạo báo cáo thành công
 */
router.post('/', verifyJWT, requireRole('TENANT'), createReport);
router.get('/', verifyJWT, requireRole('MODERATOR', 'ADMIN'), getReports);

/**
 * @openapi
 * /reports/{id}:
 *   patch:
 *     tags: [Reports]
 *     summary: Xử lý báo cáo (MODERATOR/ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string }
 *               moderatorNote: { type: string }
 *     responses:
 *       200:
 *         description: Xử lý thành công
 */
router.patch('/:id', verifyJWT, requireRole('MODERATOR', 'ADMIN'), handleReport);

module.exports = router;
