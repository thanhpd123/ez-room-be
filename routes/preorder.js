const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
} = require('../controllers/preorder.controller');

const router = express.Router();

/**
 * @openapi
 * /preorders/landlord:
 *   get:
 *     tags: [Preorders]
 *     summary: Landlord xem danh sách yêu cầu thuê
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách preorder requests
 */
router.get('/landlord', verifyJWT, requireRole('LANDLORD'), getLandlordRequests);

/**
 * @openapi
 * /preorders/{preorderId}/confirm:
 *   patch:
 *     tags: [Preorders]
 *     summary: Landlord xác nhận yêu cầu thuê
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: preorderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xác nhận thành công
 */
router.patch('/:preorderId/confirm', verifyJWT, requireRole('LANDLORD'), confirmRequest);

/**
 * @openapi
 * /preorders/{preorderId}/reject:
 *   patch:
 *     tags: [Preorders]
 *     summary: Landlord từ chối yêu cầu thuê
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: preorderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Từ chối thành công
 */
router.patch('/:preorderId/reject', verifyJWT, requireRole('LANDLORD'), rejectRequest);

module.exports = router;
