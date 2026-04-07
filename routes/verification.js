const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getCitizenCardVerifications,
    reviewCitizenCardVerification,
} = require('../controllers/verification.controller');

const router = express.Router();

router.use(verifyJWT);
router.use(requireRole('ADMIN', 'MODERATOR'));

/**
 * GET /verifications/citizen-cards
 * Query: ?page=1&limit=20&status=PENDING&search=keyword
 */
router.get('/citizen-cards', getCitizenCardVerifications);

/**
 * PATCH /verifications/citizen-cards/:verificationId/review
 * Body: { status: 'VERIFIED' | 'REJECTED', reviewNote?: string }
 */
router.patch('/citizen-cards/:verificationId/review', reviewCitizenCardVerification);

module.exports = router;
