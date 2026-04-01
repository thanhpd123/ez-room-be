const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllUsers,
    getUserById,
    updateUserStatus,
    getRentalsForModeration,
    updateRentalStatus,
    getRentalStats,
    getRooms,
    moderateRoom,
    getModeratorLogs,
    getModerationQueue,
    getQueueActivity,
    assignQueueItem,
    releaseQueueItem,
    getReports,
    handleReport,
    getReviewsForModeration,
    getReviewDetail,
    updateReviewStatus,
    deleteReview,
    getQueueStatusForTarget,
    getModeratorList,
    getRejectionInfo,
} = require('../controllers/moderator.controller');

const router = express.Router();

// Tất cả routes yêu cầu: đăng nhập + role MODERATOR hoặc ADMIN
router.use(verifyJWT);
router.use(requireRole('MODERATOR', 'ADMIN'));

/**
 * @openapi
 * /moderator/moderators:
 *   get:
 *     tags: [Moderator]
 *     summary: Danh sách moderator (cho filter dropdown)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách moderators
 */
router.get('/moderators', getModeratorList);

/**
 * @openapi
 * /moderator/logs:
 *   get:
 *     tags: [Moderator]
 *     summary: Log kiểm duyệt
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách logs
 */
router.get('/logs', getModeratorLogs);

/**
 * @openapi
 * /moderator/queue:
 *   get:
 *     tags: [Moderator]
 *     summary: Hàng đợi kiểm duyệt
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách queue
 */
router.get('/queue', getModerationQueue);

/**
 * @openapi
 * /moderator/queue/activity:
 *   get:
 *     tags: [Moderator]
 *     summary: Hoạt động queue
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Activity data
 */
router.get('/queue/activity', getQueueActivity);

/**
 * @openapi
 * /moderator/queue/check:
 *   get:
 *     tags: [Moderator]
 *     summary: Kiểm tra trạng thái queue của một target
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: targetType
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: targetId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trạng thái queue
 */
router.get('/queue/check', getQueueStatusForTarget);

/**
 * @openapi
 * /moderator/queue/{id}/assign:
 *   patch:
 *     tags: [Moderator]
 *     summary: Gán item cho moderator
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Gán thành công
 */
router.patch('/queue/:id/assign', assignQueueItem);

/**
 * @openapi
 * /moderator/queue/{id}/release:
 *   patch:
 *     tags: [Moderator]
 *     summary: Trả item về queue
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trả thành công
 */
router.patch('/queue/:id/release', releaseQueueItem);

// ═══════════════════ Quản lý Users ═══════════════════

/**
 * @openapi
 * /moderator/users:
 *   get:
 *     tags: [Moderator]
 *     summary: Danh sách users (LANDLORD, TENANT)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách users
 */
router.get('/users', getAllUsers);

/**
 * @openapi
 * /moderator/users/{userId}:
 *   get:
 *     tags: [Moderator]
 *     summary: Chi tiết user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết user
 *   patch:
 *     tags: [Moderator]
 *     summary: Thay đổi status user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [ACTIVE, BANNED, SUSPENDED] }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.get('/users/:userId', getUserById);
router.patch('/users/:userId/status', updateUserStatus);

// ═══════════════════ Duyệt Rental (Bài đăng) ═══════════════════

/**
 * @openapi
 * /moderator/rentals/stats:
 *   get:
 *     tags: [Moderator]
 *     summary: Thống kê bài đăng
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Rental stats
 */
router.get('/rentals/stats', getRentalStats);

/**
 * @openapi
 * /moderator/rentals/moderation:
 *   get:
 *     tags: [Moderator]
 *     summary: Danh sách rentals cần duyệt
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Danh sách rentals
 */
router.get('/rentals/moderation', getRentalsForModeration);

/**
 * @openapi
 * /moderator/rentals/{rentalId}/status:
 *   patch:
 *     tags: [Moderator]
 *     summary: Duyệt/từ chối rental
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [AVAILABLE, HIDDEN] }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/rentals/:rentalId/status', updateRentalStatus);

// ═══════════════════ Duyệt Room Post (Phòng) ═══════════════════

/**
 * @openapi
 * /moderator/rooms:
 *   get:
 *     tags: [Moderator]
 *     summary: Danh sách phòng cần duyệt
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: rentalId
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Danh sách rooms
 */
router.get('/rooms', getRooms);

/**
 * @openapi
 * /moderator/rooms/{roomId}/moderate:
 *   put:
 *     tags: [Moderator]
 *     summary: Duyệt/từ chối phòng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               decision: { type: string, enum: [approved, rejected] }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Duyệt thành công
 */
router.put('/rooms/:roomId/moderate', moderateRoom);

// ═══════════════════ Xử lý Báo cáo (Reports) ═══════════════════

/**
 * @openapi
 * /moderator/reports:
 *   get:
 *     tags: [Moderator]
 *     summary: Danh sách báo cáo vi phạm
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
 */
router.get('/reports', getReports);

/**
 * @openapi
 * /moderator/reports/{id}:
 *   patch:
 *     tags: [Moderator]
 *     summary: Xử lý báo cáo
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
 *               status: { type: string, enum: [APPROVED, REJECTED, DISMISSED] }
 *               moderatorNote: { type: string }
 *     responses:
 *       200:
 *         description: Xử lý thành công
 */
router.patch('/reports/:id', handleReport);

// ═══════════════════ Kiểm duyệt Reviews ═══════════════════

/**
 * @openapi
 * /moderator/reviews:
 *   get:
 *     tags: [Moderator]
 *     summary: Danh sách reviews cần duyệt
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: roomId
 *         schema: { type: string }
 *       - in: query
 *         name: tenantId
 *         schema: { type: string }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách reviews
 */
router.get('/reviews', getReviewsForModeration);

/**
 * @openapi
 * /moderator/reviews/{reviewId}:
 *   get:
 *     tags: [Moderator]
 *     summary: Chi tiết review
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết review
 *   patch:
 *     tags: [Moderator]
 *     summary: Duyệt/từ chối review
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
 *             properties:
 *               status: { type: string, enum: [APPROVED, REJECTED] }
 *               moderatorNote: { type: string }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *   delete:
 *     tags: [Moderator]
 *     summary: Xóa review vi phạm
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.get('/reviews/:reviewId', getReviewDetail);
router.patch('/reviews/:reviewId', updateReviewStatus);
router.delete('/reviews/:reviewId', deleteReview);

// ═══════════════════ Rejection Info (Audit Trail) ═══════════════════

/**
 * @openapi
 * /moderator/rejection-info:
 *   get:
 *     tags: [Moderator]
 *     summary: Lấy thông tin từ chối gần nhất của một target
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: targetType
 *         required: true
 *         schema: { type: string, enum: [RENTAL, ROOM] }
 *       - in: query
 *         name: targetId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Thông tin từ chối
 */
router.get('/rejection-info', getRejectionInfo);

module.exports = router;
