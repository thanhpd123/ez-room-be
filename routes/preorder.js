const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getMyPreorders,
    createDepositPayment,
    handlePayOSWebhook,
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
} = require('../controllers/preorder.controller');

const router = express.Router();

/**
 * @openapi
 * /preorders/payos/webhook:
 *   post:
 *     tags: [Preorders]
 *     summary: Webhook PayOS cập nhật trạng thái thanh toán đặt cọc
 *     responses:
 *       200:
 *         description: Đã ghi nhận webhook
 */
router.post('/payos/webhook', handlePayOSWebhook);

/**
 * @openapi
 * /preorders/mine:
 *   get:
 *     tags: [Preorders]
 *     summary: Tenant xem danh sách đặt cọc của chính mình
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách preorder của user
 */
router.get('/mine', verifyJWT, requireRole('TENANT'), getMyPreorders);

/**
 * @openapi
 * /preorders/deposit/pay:
 *   post:
 *     tags: [Preorders]
 *     summary: Tenant tạo link thanh toán PayOS để đặt cọc phòng
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roomId, depositAmount]
 *             properties:
 *               roomId: { type: string }
 *               depositAmount: { type: number, description: Số tiền VND, số nguyên dương }
 *               buyerName: { type: string }
 *               buyerEmail: { type: string }
 *               buyerPhone: { type: string }
 *     responses:
 *       201:
 *         description: Tạo link thành công
 */
router.post('/deposit/pay', verifyJWT, requireRole('TENANT'), createDepositPayment);

/**
 * @openapi
 * /preorders/landlord:
 *   get:
 *     tags: [Preorders]
 *     summary: Landlord xem danh sách yêu cầu thuê
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách preorder requests
 */
router.get('/landlord', verifyJWT, requireRole('LANDLORD'), getLandlordRequests);

/**
 * @openapi
 * /preorders/{preorderId}/confirm:
 *   patch:
 *     tags: [Preorders]
 *     summary: Landlord xác nhận yêu cầu thuê
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: preorderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xác nhận thành công
 */
router.patch('/:preorderId/confirm', verifyJWT, requireRole('LANDLORD'), confirmRequest);

/**
 * @openapi
 * /preorders/{preorderId}/reject:
 *   patch:
 *     tags: [Preorders]
 *     summary: Landlord từ chối yêu cầu thuê
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: preorderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Từ chối thành công
 */
router.patch('/:preorderId/reject', verifyJWT, requireRole('LANDLORD'), rejectRequest);

module.exports = router;
