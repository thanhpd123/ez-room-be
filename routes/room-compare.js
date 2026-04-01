/**
 * Room Comparison Routes
 * GET /api/rooms/compare - Compare two rooms
 */

const express = require('express');
const { postCompareRooms } = require('../controllers/room-compare.controller');
const { optionalJWT } = require('../middleware/auth'); // Optional JWT for personalization

const router = express.Router();

/**
 * POST /api/rooms/compare
 * Compare two rooms
 * Body: { room1_id, room2_id }
 * Auth: Optional JWT (for personalization)
 */
router.post('/compare', optionalJWT, postCompareRooms);

module.exports = router;