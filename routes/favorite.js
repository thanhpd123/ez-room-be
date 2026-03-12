const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    addFavorite,
    removeFavorite,
    getMyFavorites,
    getFavoriteIds,
} = require('../controllers/favorite.controller');

const router = express.Router();

// All routes require auth; tenants (and others) can favourite
router.use(verifyJWT);

/**
 * @openapi
 * /favorites:
 *   get:
 *     tags: [Favorites]
 *     summary: Danh sách phòng yêu thích (chi tiết đầy đủ)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách phòng yêu thích
 */
router.get('/', getMyFavorites);

/**
 * @openapi
 * /favorites/ids:
 *   get:
 *     tags: [Favorites]
 *     summary: Danh sách ID phòng yêu thích (để sync/check)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Mảng room IDs
 */
router.get('/ids', getFavoriteIds);

/**
 * @openapi
 * /favorites/{roomId}:
 *   post:
 *     tags: [Favorites]
 *     summary: Thêm phòng vào yêu thích
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Đã thêm vào yêu thích
 *   delete:
 *     tags: [Favorites]
 *     summary: Xóa phòng khỏi yêu thích
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Đã xóa khỏi yêu thích
 */
router.post('/:roomId', addFavorite);
router.delete('/:roomId', removeFavorite);

module.exports = router;
