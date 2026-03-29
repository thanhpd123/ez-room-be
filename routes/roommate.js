const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
    getProfile,
    getMyActiveRooms,
    inviteRoommate,
    semanticSearch,
    searchByArea,
} = require('../controllers/roommate.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * @openapi
 * /roommate/search:
 *   get:
 *     tags: [Roommate]
 *     summary: Tìm roommate bằng mô tả tính cách (AI, VIP only)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Mô tả tính cách bạn muốn tìm
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Danh sách roommate phù hợp
 *       403:
 *         description: Cần VIP
 */
router.get('/search', semanticSearch);

/**
 * @openapi
 * /roommate/top-searchers-by-area:
 *   get:
 *     tags: [Roommate]
 *     summary: Tìm người dùng đang tìm phòng nhiều nhất ở khu vực (dựa trên hành vi thực tế)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: area
 *         required: true
 *         schema: { type: string }
 *         description: Tên khu vực cần tìm (VD liêm, hòa lạc, quận 1)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Danh sách người đang tìm phòng ở khu vực
 */
router.get('/top-searchers-by-area', searchByArea);


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
 * /roommate/my-active-rooms:
 *   get:
 *     tags: [Roommate]
 *     summary: Danh sách phòng đang thuê (ACTIVE) của user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách phòng đang thuê
 */
router.get('/my-active-rooms', getMyActiveRooms);

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
 * /roommate/invite-room/{targetUserId}:
 *   post:
 *     tags: [Roommate]
 *     summary: Mời roommate đã chấp nhận kết bạn vào phòng đang thuê (gửi email + notification)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: targetUserId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roomId]
 *             properties:
 *               roomId: { type: string }
 *     responses:
 *       200:
 *         description: Gửi lời mời ở ghép thành công
 */
router.post('/invite-room/:targetUserId', inviteRoommate);

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

