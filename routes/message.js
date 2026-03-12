const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getConversations,
    getThread,
    sendMessage,
} = require('../controllers/message.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * @openapi
 * /messages/conversations:
 *   get:
 *     tags: [Messages]
 *     summary: Danh sách hội thoại (last message, unread count)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách conversations
 */
router.get('/conversations', getConversations);

/**
 * @openapi
 * /messages/with/{userId}:
 *   get:
 *     tags: [Messages]
 *     summary: Tin nhắn với user (phân trang)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: before
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Danh sách tin nhắn
 */
router.get('/with/:userId', getThread);

/**
 * @openapi
 * /messages:
 *   post:
 *     tags: [Messages]
 *     summary: Gửi tin nhắn
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiverId, content]
 *             properties:
 *               receiverId: { type: string }
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Gửi thành công
 */
router.post('/', sendMessage);

module.exports = router;
