const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getMyPreorders,
    createDepositPayment,
    resumePayment,
    cancelUnpaidPreorder,
    verifyPreorderPayment,
    handlePayOSWebhook,
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
} = require('../controllers/preorder.controller');

const router = express.Router();
const verifyPaymentRateBuckets = new Map();

function verifyPaymentRateLimit(req, res, next) {
    const windowMs = 60 * 1000;
    const maxRequests = Math.max(5, Number(process.env.PREORDER_VERIFY_RATE_LIMIT_MAX || 8));
    const userId = req?.auth?.user?.id || 'anonymous';
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `${userId}:${ip}`;
    const now = Date.now();
    const bucket = verifyPaymentRateBuckets.get(key) || { count: 0, windowStart: now };

    if (now - bucket.windowStart >= windowMs) {
        bucket.count = 0;
        bucket.windowStart = now;
    }

    bucket.count += 1;
    verifyPaymentRateBuckets.set(key, bucket);

    if (bucket.count > maxRequests) {
        return res.status(429).json({
            success: false,
            message: `Bạn thao tác quá nhanh. Vui lòng thử lại sau khoảng 1 phút.`,
        });
    }

    // Lightweight cleanup to avoid unbounded growth in long-running process.
    if (verifyPaymentRateBuckets.size > 5000) {
        for (const [bucketKey, value] of verifyPaymentRateBuckets.entries()) {
            if (now - value.windowStart > windowMs * 2) {
                verifyPaymentRateBuckets.delete(bucketKey);
            }
        }
    }

    return next();
}

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
 * /preorders/{preorderId}/resume-payment:
 *   get:
 *     tags: [Preorders]
 *     summary: Tenant lấy lại link thanh toán cho preorder chưa thanh toán
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: preorderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trả về checkout URL
 */
router.get('/:preorderId/resume-payment', verifyJWT, requireRole('TENANT'), resumePayment);
router.patch('/:preorderId/cancel', verifyJWT, requireRole('TENANT'), cancelUnpaidPreorder);
router.get(
    '/:preorderId/verify-payment',
    verifyJWT,
    requireRole('TENANT'),
    verifyPaymentRateLimit,
    verifyPreorderPayment
);

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
 *             required: [roomId]
 *             properties:
 *               roomId: { type: string }
 *               depositMonths: { type: number, description: Số tháng cọc (ví dụ 0.5, 1, 2), hệ thống quy đổi sang phần trăm }
 *               depositPercent: { type: number, description: Phần trăm tiền cọc theo giá phòng, phải < 100% }
 *               depositAmount: { type: number, description: Legacy field (tùy chọn), hệ thống sẽ quy đổi sang phần trăm rồi chuẩn hóa lại }
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
 * /preorders/verify-payment:
 *   get:
 *     tags: [Preorders]
 *     summary: Tenant xác minh trạng thái thanh toán preorder từ return URL PayOS
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: orderCode
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: preorderId
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kết quả xác minh
 */
router.get('/verify-payment', verifyJWT, requireRole('TENANT'), verifyPreorderPayment);

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
