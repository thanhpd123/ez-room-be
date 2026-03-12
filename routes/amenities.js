const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllAmenities,
    getAmenityById,
    createAmenity,
    updateAmenity,
    deleteAmenity,
} = require('../controllers/amenities.controller');

const router = express.Router();

/**
 * @openapi
 * /amenities:
 *   get:
 *     tags: [Amenities]
 *     summary: Lấy danh sách tất cả tiện ích
 *     responses:
 *       200:
 *         description: Danh sách amenities
 *   post:
 *     tags: [Amenities]
 *     summary: Tạo tiện ích mới (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Tạo thành công
 */
router.get('/', getAllAmenities);
router.post('/', verifyJWT, requireRole('ADMIN'), createAmenity);

/**
 * @openapi
 * /amenities/{id}:
 *   get:
 *     tags: [Amenities]
 *     summary: Lấy chi tiết tiện ích
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết amenity
 *   patch:
 *     tags: [Amenities]
 *     summary: Cập nhật tiện ích (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *   delete:
 *     tags: [Amenities]
 *     summary: Xóa tiện ích (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.get('/:id', getAmenityById);
router.patch('/:id', verifyJWT, requireRole('ADMIN'), updateAmenity);
router.delete('/:id', verifyJWT, requireRole('ADMIN'), deleteAmenity);

module.exports = router;
