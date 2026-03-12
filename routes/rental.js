const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    createRental,
    getRentals,
    getRentalById,
    getMyRentals,
    getRentalsForModeration,
    updateRentalStatus,
    updateRental,
    deleteRental,
    getRentalStats,
} = require('../controllers/rental.controller');
const { deleteRental: deleteRentalAdmin } = require('../controllers/rentals.controller');

const router = express.Router();

/**
 * @openapi
 * /rentals/stats:
 *   get:
 *     tags: [Rentals]
 *     summary: Thống kê bài đăng (MODERATOR/ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thống kê rentals
 */
router.get('/stats', verifyJWT, requireRole('MODERATOR', 'ADMIN'), getRentalStats);

/**
 * @openapi
 * /rentals/my-rentals:
 *   get:
 *     tags: [Rentals]
 *     summary: Landlord xem danh sách rentals của mình
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách rentals
 */
router.get('/my-rentals', verifyJWT, requireRole('LANDLORD'), getMyRentals);

/**
 * @openapi
 * /rentals:
 *   get:
 *     tags: [Rentals]
 *     summary: Lấy danh sách rentals (PUBLIC)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [AVAILABLE, HIDDEN, PENDING, ARCHIVED] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *   post:
 *     tags: [Rentals]
 *     summary: Landlord tạo rental mới (status=HIDDEN)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               address: { type: string }
 *               district: { type: string }
 *               city: { type: string }
 *               images: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Tạo thành công
 */
router.get('/', getRentals);
router.post('/', verifyJWT, requireRole('LANDLORD'), createRental);

/**
 * @openapi
 * /rentals/moderation:
 *   get:
 *     tags: [Rentals]
 *     summary: Moderator/Admin lấy rentals cần duyệt
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Danh sách rentals cần duyệt
 */
router.get('/moderation', verifyJWT, requireRole('MODERATOR', 'ADMIN'), getRentalsForModeration);

/**
 * @openapi
 * /rentals/{rentalId}:
 *   get:
 *     tags: [Rentals]
 *     summary: Chi tiết rental (PUBLIC)
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết rental
 *   put:
 *     tags: [Rentals]
 *     summary: Landlord cập nhật rental
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               address: { type: string }
 *               district: { type: string }
 *               city: { type: string }
 *               images: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *   patch:
 *     tags: [Rentals]
 *     summary: Moderator/Admin duyệt rental
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [AVAILABLE, HIDDEN] }
 *     responses:
 *       200:
 *         description: Cập nhật status thành công
 *   delete:
 *     tags: [Rentals]
 *     summary: Landlord xóa rental / Admin xóa vĩnh viễn
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.get('/:rentalId', getRentalById);
router.patch('/:rentalId/status', verifyJWT, requireRole('MODERATOR', 'ADMIN'), updateRentalStatus);
router.put('/:rentalId', verifyJWT, requireRole('LANDLORD'), updateRental);
router.delete('/:rentalId', verifyJWT, requireRole('LANDLORD', 'ADMIN'), (req, res, next) => {
    const userRole = req.auth.user.role;
    
    // Admin: xóa vĩnh viễn (dùng rentals.controller)
    if (userRole === 'ADMIN') {
        req.params.id = req.params.rentalId;
        return deleteRentalAdmin(req, res, next);
    }
    
    // Landlord: xóa của chính mình (dùng rental.controller)
    return deleteRental(req, res, next);
});

module.exports = router;
