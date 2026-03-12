const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { createFeedback, getFeedbackByRentalPeriod } = require('../controllers/feedback.controller');

const router = express.Router();

/**
 * @openapi
 * /feedback:
 *   post:
 *     tags: [Feedback]
 *     summary: Tenant tạo đánh giá phòng
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rentalPeriodId, roomId, rating, comment]
 *             properties:
 *               rentalPeriodId: { type: string }
 *               roomId: { type: string }
 *               rating: { type: number }
 *               comment: { type: string }
 *               cleanlinessRating: { type: number }
 *               locationRating: { type: number }
 *               valueRating: { type: number }
 *               landlordRating: { type: number }
 *     responses:
 *       201:
 *         description: Tạo đánh giá thành công
 */
router.post('/', verifyJWT, createFeedback);

/**
 * @openapi
 * /feedback/by-rental-period/{rentalPeriodId}:
 *   get:
 *     tags: [Feedback]
 *     summary: Xem feedback theo rental period
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rentalPeriodId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết feedback
 */
router.get('/by-rental-period/:rentalPeriodId', verifyJWT, getFeedbackByRentalPeriod);

module.exports = router;
