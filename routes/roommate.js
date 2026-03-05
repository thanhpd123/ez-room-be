const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getSuggestions,
    sendRequest,
    getMyMatches,
    updateMatchStatus,
} = require('../controllers/roommate.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * GET /roommate/suggestions – potential roommates (same gender, lifestyle score).
 * Query: ?limit=20
 */
router.get('/suggestions', getSuggestions);

/**
 * GET /roommate/matches – list my sent + received match requests.
 */
router.get('/matches', getMyMatches);

/**
 * POST /roommate/request/:targetId – send a roommate match request (PENDING).
 */
router.post('/request/:targetId', sendRequest);

/**
 * PATCH /roommate/matches/:matchId – accept or reject (target only).
 * Body: { status: 'ACCEPTED' | 'REJECTED' }
 */
router.patch('/matches/:matchId', updateMatchStatus);

module.exports = router;
