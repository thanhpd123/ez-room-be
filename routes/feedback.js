const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { createFeedback, getFeedbackByRentalPeriod, getRoomReviews, getLandlordReviews, replyToReview } = require('../controllers/feedback.controller');

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

/**
 * @openapi
 * /feedback/landlord/reviews:
 *   get:
 *     tags: [Feedback]
 *     summary: Lấy danh sách đánh giá của landlord cho rentals/rooms của họ
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, APPROVED, REJECTED, HIDDEN], default: APPROVED }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [recent, rating], default: recent }
 *     responses:
 *       200:
 *         description: Danh sách đánh giá
 */
router.get('/landlord/reviews', verifyJWT, getLandlordReviews);

/**
 * @openapi
 * /feedback/room/{roomId}:
 *   get:
 *     tags: [Feedback]
 *     summary: Lấy danh sách đánh giá của một phòng (công khai)
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5 }
 *     responses:
 *       200:
 *         description: Danh sách đánh giá của phòng
 */
router.get('/room/:roomId', getRoomReviews);

/**
 * @openapi
 * /feedback/{reviewId}/reply:
 *   post:
 *     tags: [Feedback]
 *     summary: Landlord phản hồi đánh giá
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       200:
 *         description: Phản hồi thành công
 */
router.post('/:reviewId/reply', verifyJWT, replyToReview);

module.exports = router;
