const express = require('express');
const { optionalJWT } = require('../middleware/auth');
const { getPublicRentals, getPublicRentalById, getPublicRoomTypes, getLandlordProfile } = require('../controllers/rental.controller');
const { getPublicSearch } = require('../controllers/search.controller');

const router = express.Router();

/**
 * GET /public/room-types
 * Distinct room types from available rentals. No auth.
 */
router.get('/room-types', getPublicRoomTypes);

/**
 * GET /public/search
 * Room-based recommendation search. Returns rooms sorted by match score.
 * Optional Authorization for user preference scoring.
 */
router.get('/search', optionalJWT, getPublicSearch);

/**
 * GET /public/landlord/:userId
 * Public landlord profile page. No auth.
 */
router.get('/landlord/:userId', getLandlordProfile);

/**
 * GET /public/rentals
 * List rentals for home/browse. No auth.
 * Query: ?page=1&limit=20&district=...&city=...&sort=createdAt_desc|createdAt_asc|title_asc|title_desc
 */
router.get('/rentals', getPublicRentals);

/**
 * GET /public/rentals/:rentalId
 * Chi tiết một rental. No auth.
 */
router.get('/rentals/:rentalId', getPublicRentalById);

module.exports = router;

