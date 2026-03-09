const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { createFeedback, getFeedbackByRentalPeriod } = require('../controllers/feedback.controller');

const router = express.Router();

/**
 * POST /feedback
 * Tenant tạo đánh giá phòng
 * Body: { rentalPeriodId, roomId, rating, comment, cleanlinessRating?, locationRating?, valueRating?, landlordRating? }
 */
router.post('/', verifyJWT, createFeedback);

/**
 * GET /feedback/by-rental-period/:rentalPeriodId
 * Tenant xem feedback của mình
 */
router.get('/by-rental-period/:rentalPeriodId', verifyJWT, getFeedbackByRentalPeriod);

module.exports = router;
