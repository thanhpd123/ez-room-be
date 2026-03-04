const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { getRecommend } = require('../controllers/search.controller');

const router = express.Router();

/**
 * GET /search
 * Search API placeholder – extend with your search logic (e.g. semantic search).
 */
router.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Search API',
        data: [],
    });
});

/**
 * GET /search/recommend
 * Personalized room recommendations (auth required). Returns rooms sorted by user preference.
 */
router.get('/recommend', verifyJWT, getRecommend);

module.exports = router;
