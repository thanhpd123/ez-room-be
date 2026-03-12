const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllLocations,
    getCities,
    getDistricts,
    getLocationById,
    createLocation,
    updateLocation,
    deleteLocation,
} = require('../controllers/locations.controller');

const router = express.Router();

/**
 * @openapi
 * /locations:
 *   get:
 *     tags: [Locations]
 *     summary: Lấy danh sách địa điểm
 *     parameters:
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: district
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách địa điểm
 *   post:
 *     tags: [Locations]
 *     summary: Tạo địa điểm mới (ADMIN)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address]
 *             properties:
 *               address: { type: string }
 *               district: { type: string }
 *               city: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       201:
 *         description: Tạo thành công
 */
router.get('/', getAllLocations);
router.post('/', verifyJWT, requireRole('ADMIN'), createLocation);

/**
 * @openapi
 * /locations/cities:
 *   get:
 *     tags: [Locations]
 *     summary: Lấy danh sách thành phố (distinct)
 *     responses:
 *       200:
 *         description: Danh sách cities
 */
router.get('/cities', getCities);

/**
 * @openapi
 * /locations/districts:
 *   get:
 *     tags: [Locations]
 *     summary: Lấy danh sách quận/huyện
 *     parameters:
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách districts
 */
router.get('/districts', getDistricts);

/**
 * @openapi
 * /locations/{id}:
 *   get:
 *     tags: [Locations]
 *     summary: Lấy chi tiết địa điểm
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết location
 *   patch:
 *     tags: [Locations]
 *     summary: Cập nhật địa điểm (ADMIN)
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
 *               address: { type: string }
 *               district: { type: string }
 *               city: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *   delete:
 *     tags: [Locations]
 *     summary: Xóa địa điểm (ADMIN) - không xóa được nếu có rentals
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
router.get('/:id', getLocationById);
router.patch('/:id', verifyJWT, requireRole('ADMIN'), updateLocation);
router.delete('/:id', verifyJWT, requireRole('ADMIN'), deleteLocation);

module.exports = router;
