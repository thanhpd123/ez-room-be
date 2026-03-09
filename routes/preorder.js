const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
} = require('../controllers/preorder.controller');

const router = express.Router();

/**
 * GET /preorders/landlord
 * Get list of rental requests for landlord
 * Protected: LANDLORD only
 */
router.get('/landlord', verifyJWT, requireRole('LANDLORD'), getLandlordRequests);

/**
 * PATCH /preorders/:preorderId/confirm
 * Landlord confirms a rental request
 * Protected: LANDLORD only
 */
router.patch('/:preorderId/confirm', verifyJWT, requireRole('LANDLORD'), confirmRequest);

/**
 * PATCH /preorders/:preorderId/reject
 * Landlord rejects a rental request
 * Protected: LANDLORD only
 */
router.patch('/:preorderId/reject', verifyJWT, requireRole('LANDLORD'), rejectRequest);

module.exports = router;
