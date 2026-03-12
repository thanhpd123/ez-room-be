const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { getRecommend } = require('../controllers/search.controller');

const router = express.Router();

/**
 * @openapi
 * /search:
 *   get:
 *     tags: [Search]
 *     summary: Search API (placeholder)
 *     responses:
 *       200:
 *         description: Kết quả tìm kiếm
 */
router.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Search API',
        data: [],
    });
});

/**
 * @openapi
 * /search/recommend:
 *   get:
 *     tags: [Search]
 *     summary: Gợi ý phòng cá nhân hóa (theo preference)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách phòng gợi ý
 */
router.get('/recommend', verifyJWT, getRecommend);

module.exports = router;
