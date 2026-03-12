const express = require('express');
const { optionalJWT } = require('../middleware/auth');
const { getPublicRentals, getPublicRentalById, getPublicRoomTypes, getLandlordProfile } = require('../controllers/rental.controller');
const { getPublicSearch } = require('../controllers/search.controller');

const router = express.Router();

/**
 * @openapi
 * /public/room-types:
 *   get:
 *     tags: [Public]
 *     summary: Danh sách loại phòng (distinct)
 *     responses:
 *       200:
 *         description: Danh sách room types
 */
router.get('/room-types', getPublicRoomTypes);

/**
 * @openapi
 * /public/search:
 *   get:
 *     tags: [Public]
 *     summary: Tìm kiếm gợi ý phòng (optional auth)
 *     security: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Phòng sắp xếp theo match score
 */
router.get('/search', optionalJWT, getPublicSearch);

/**
 * @openapi
 * /public/landlord/{userId}:
 *   get:
 *     tags: [Public]
 *     summary: Trang profile chủ nhà (public)
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Thông tin landlord
 */
router.get('/landlord/:userId', getLandlordProfile);

/**
 * @openapi
 * /public/rentals:
 *   get:
 *     tags: [Public]
 *     summary: Danh sách rentals (home/browse)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: district
 *         schema: { type: string }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [createdAt_desc, createdAt_asc, title_asc, title_desc] }
 *     responses:
 *       200:
 *         description: Danh sách rentals
 */
router.get('/rentals', getPublicRentals);

/**
 * @openapi
 * /public/rentals/{rentalId}:
 *   get:
 *     tags: [Public]
 *     summary: Chi tiết rental (public)
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết rental
 */
router.get('/rentals/:rentalId', getPublicRentalById);

module.exports = router;

