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
 * GET /favorites – List my favorite rooms (full details)
 */
router.get('/', getMyFavorites);

/**
 * GET /favorites/ids – List only favorite room IDs (for sync/check)
 */
router.get('/ids', getFavoriteIds);

/**
 * POST /favorites/:roomId – Add room to favorites
 */
router.post('/:roomId', addFavorite);

/**
 * DELETE /favorites/:roomId – Remove room from favorites
 */
router.delete('/:roomId', removeFavorite);

module.exports = router;
