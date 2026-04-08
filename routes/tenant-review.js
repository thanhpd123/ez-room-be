const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
  createTenantReview,
  getTenantReviewByRentalPeriod,
  getTenantReviews,
  replyToTenantReview,
  getPendingReviews,
  updateReviewStatus,
  getCompletedRentals,
} = require('../controllers/tenant-review.controller');

const router = express.Router();

/**
 * @openapi
 * /tenant-reviews:
 *   post:
 *     tags: [Tenant Reviews]
 *     summary: Landlord tạo đánh giá tenant
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rentalPeriodId, rating, comment]
 *             properties:
 *               rentalPeriodId: { type: string }
 *               rating: { type: number }
 *               paymentPunctualityRating: { type: number }
 *               propertyCareRating: { type: number }
 *               communicationRating: { type: number }
 *               comment: { type: string }
 *     responses:
 *       201:
 *         description: Tạo đánh giá tenant thành công
 */
router.post('/', verifyJWT, createTenantReview);

/**
 * @openapi
 * /tenant-reviews/by-rental-period/{rentalPeriodId}:
 *   get:
 *     tags: [Tenant Reviews]
 *     summary: Lấy đánh giá tenant cho một lần thuê (của người dùng hiện tại)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rentalPeriodId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết đánh giá tenant
 */
router.get('/by-rental-period/:rentalPeriodId', verifyJWT, getTenantReviewByRentalPeriod);

/**
 * @openapi
 * /tenant-reviews/tenant/{tenantId}:
 *   get:
 *     tags: [Tenant Reviews]
 *     summary: Lấy tất cả đánh giá của một tenant (nội bộ, chỉ cho landlord/admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách đánh giá tenant
 */
router.get('/tenant/:tenantId', verifyJWT, getTenantReviews);

/**
 * @openapi
 * /tenant-reviews/{reviewId}/reply:
 *   post:
 *     tags: [Tenant Reviews]
 *     summary: Landlord phản hồi đánh giá tenant
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
router.post('/:reviewId/reply', verifyJWT, replyToTenantReview);

/**
 * @openapi
 * /tenant-reviews/moderation/pending:
 *   get:
 *     tags: [Tenant Reviews - Moderation]
 *     summary: Lấy danh sách đánh giá tenant chờ duyệt (moderator)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Danh sách đánh giá chờ duyệt
 */
router.get('/moderation/pending', verifyJWT, requireRole('MODERATOR', 'ADMIN'), getPendingReviews);

/**
 * @openapi
 * /tenant-reviews/completed-rentals:
 *   get:
 *     tags: [Tenant Reviews]
 *     summary: Lấy danh sách rental đã hoàn thành của landlord (để đánh giá tenant)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách rental đã hoàn thành
 */
router.get('/completed-rentals', verifyJWT, getCompletedRentals);

/**
 * @openapi
 * /tenant-reviews/{reviewId}/status/{action}:
 *   patch:
 *     tags: [Tenant Reviews - Moderation]
 *     summary: Cập nhật trạng thái đánh giá tenant (moderator)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: action
 *         required: true
 *         schema: { type: string, enum: [approve, reject, hide] }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Cập nhật trạng thái thành công
 */
router.patch('/:reviewId/status/:action', verifyJWT, requireRole('MODERATOR', 'ADMIN'), updateReviewStatus);

module.exports = router;
