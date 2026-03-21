const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
    getProfile,
} = require('../controllers/roommate.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * @openapi
 * /roommate/suggestions:
 *   get:
 *     tags: [Roommate]
 *     summary: Gợi ý bạn ở ghép (cùng giới, lifestyle)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Danh sách gợi ý
 */
router.get('/suggestions', getSuggestions);

/**
 * @openapi
 * /roommate/matches:
 *   get:
 *     tags: [Roommate]
 *     summary: Danh sách match đã gửi và nhận
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách matches
 */
router.get('/matches', getMyMatches);

/**
 * @openapi
 * /roommate/request/{targetId}:
 *   post:
 *     tags: [Roommate]
 *     summary: Gửi yêu cầu kết bạn ở ghép (PENDING)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: targetId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Gửi yêu cầu thành công
 */
router.post('/request/:targetId', sendRequest);

/**
 * @openapi
 * /roommate/matches/{matchId}:
 *   patch:
 *     tags: [Roommate]
 *     summary: Chấp nhận hoặc từ chối match (target)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: matchId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ACCEPTED, REJECTED] }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/matches/:matchId', updateMatchStatus);

/**
 * @openapi
 * /roommate/profile/{userId}:
 *   get:
 *     tags: [Roommate]
 *     summary: Xem hồ sơ công khai của một user (lifestyle + preference)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Hồ sơ công khai
 */
router.get('/profile/:userId', getProfile);

module.exports = router;
