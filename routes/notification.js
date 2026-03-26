const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} = require('../controllers/notification.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notification]
 *     summary: Danh sách thông báo của user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Danh sách thông báo
 */
router.get('/', getMyNotifications);

/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [Notification]
 *     summary: Đếm thông báo chưa đọc
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Số thông báo chưa đọc
 */
router.get('/unread-count', getUnreadCount);

/**
 * @openapi
 * /notifications/read-all:
 *   patch:
 *     tags: [Notification]
 *     summary: Đánh dấu tất cả đã đọc
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thành công
 */
router.patch('/read-all', markAllAsRead);

/**
 * @openapi
 * /notifications/{id}/read:
 *   patch:
 *     tags: [Notification]
 *     summary: Đánh dấu 1 thông báo đã đọc
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Thành công
 */
router.patch('/:id/read', markAsRead);

module.exports = router;
