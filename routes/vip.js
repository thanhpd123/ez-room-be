const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getVipPackages,
    createVipPurchase,
    verifyVipPurchase,
} = require('../controllers/vip.controller');

const router = express.Router();

/**
 * @openapi
 * /vip/packages:
 *   get:
 *     tags: [VIP]
 *     summary: Danh sách gói VIP đang mở bán
 *     parameters:
 *       - in: query
 *         name: targetRole
 *         schema: { type: string, enum: [TENANT, LANDLORD] }
 *     responses:
 *       200:
 *         description: Danh sách gói VIP
 */
router.get('/packages', getVipPackages);

/**
 * @openapi
 * /vip/purchase:
 *   post:
 *     tags: [VIP]
 *     summary: Tạo link thanh toán mua VIP
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageId]
 *             properties:
 *               packageId: { type: string }
 *     responses:
 *       201:
 *         description: Tạo link mua VIP thành công
 */
router.post('/purchase', verifyJWT, requireRole('TENANT', 'LANDLORD'), createVipPurchase);

/**
 * @openapi
 * /vip/verify:
 *   get:
 *     tags: [VIP]
 *     summary: Xác minh giao dịch VIP từ PayOS return URL
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: orderCode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kết quả xác minh giao dịch VIP
 */
router.get('/verify', verifyJWT, requireRole('TENANT', 'LANDLORD'), verifyVipPurchase);

module.exports = router;