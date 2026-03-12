const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    createRoom,
    getRooms,
    getRoomById,
    updateRoom,
    deleteRoom,
    getAmenities,
    moderateRoom,
    getRoomTenants,
    searchTenants,
    createRentalContract,
    getMyBookings,
} = require('../controllers/room.controller');

const router = express.Router();

/**
 * @openapi
 * /rooms/amenities:
 *   get:
 *     tags: [Rooms]
 *     summary: Lấy danh sách amenities
 *     responses:
 *       200:
 *         description: Danh sách amenities
 */
router.get('/amenities', getAmenities);

/**
 * @openapi
 * /rooms/my-bookings:
 *   get:
 *     tags: [Rooms]
 *     summary: Tenant lấy lịch sử thuê phòng
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách đặt phòng (RoomRentalPeriod)
 */
router.get('/my-bookings', verifyJWT, requireRole('TENANT', 'LANDLORD', 'GUEST'), getMyBookings);

/**
 * @openapi
 * /rooms/search-tenants:
 *   get:
 *     tags: [Rooms]
 *     summary: Landlord tìm tenant theo email/phone
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách tenant phù hợp
 */
router.get('/search-tenants', verifyJWT, requireRole('LANDLORD'), searchTenants);

/**
 * @openapi
 * /rooms:
 *   get:
 *     tags: [Rooms]
 *     summary: Lấy danh sách phòng trọ
 *     parameters:
 *       - in: query
 *         name: rentalId
 *         schema: { type: string }
 *       - in: query
 *         name: roomType
 *         schema: { type: string }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Danh sách phòng
 */
router.get('/', getRooms);

/**
 * @openapi
 * /rooms/{roomId}/tenants:
 *   get:
 *     tags: [Rooms]
 *     summary: Lấy danh sách người thuê phòng (LANDLORD)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách tenant
 */
router.get('/:roomId/tenants', verifyJWT, requireRole('LANDLORD'), getRoomTenants);

/**
 * @openapi
 * /rooms/{roomId}/contracts:
 *   post:
 *     tags: [Rooms]
 *     summary: Landlord tạo hợp đồng thuê phòng
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId, startDate, endDate, actualPrice]
 *             properties:
 *               tenantId: { type: string }
 *               startDate: { type: string, format: date }
 *               endDate: { type: string, format: date }
 *               actualPrice: { type: number }
 *               deposit: { type: number }
 *     responses:
 *       201:
 *         description: Tạo hợp đồng thành công
 */
router.post('/:roomId/contracts', verifyJWT, requireRole('LANDLORD'), createRentalContract);

/**
 * @openapi
 * /rooms/{roomId}:
 *   get:
 *     tags: [Rooms]
 *     summary: Lấy chi tiết phòng trọ
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết phòng
 *       404:
 *         description: Không tìm thấy phòng
 */
router.get('/:roomId', getRoomById);

/**
 * @openapi
 * /rooms:
 *   post:
 *     tags: [Rooms]
 *     summary: Tạo room mới (LANDLORD)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rental_id, title, price]
 *             properties:
 *               rental_id: { type: string }
 *               title: { type: string }
 *               price: { type: number }
 *               area: { type: number }
 *               max_occupants: { type: integer }
 *               thumbnail_url: { type: string }
 *               roomType: { type: string }
 *               images: { type: array, items: { type: string } }
 *               amenityIds: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Tạo room thành công
 */
router.post('/', verifyJWT, requireRole('LANDLORD'), createRoom);

/**
 * @openapi
 * /rooms/{roomId}/moderate:
 *   put:
 *     tags: [Rooms]
 *     summary: Moderator duyệt/từ chối room
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               decision: { type: string, enum: [approved, rejected] }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Duyệt room thành công
 */
router.put('/:roomId/moderate', verifyJWT, requireRole('MODERATOR', 'ADMIN'), moderateRoom);

/**
 * @openapi
 * /rooms/{roomId}:
 *   put:
 *     tags: [Rooms]
 *     summary: Landlord cập nhật room
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               price: { type: number }
 *               area: { type: number }
 *               max_occupants: { type: integer }
 *               thumbnail_url: { type: string }
 *               roomType: { type: string }
 *               images: { type: array, items: { type: string } }
 *               amenityIds: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *   delete:
 *     tags: [Rooms]
 *     summary: Landlord xóa room
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.put('/:roomId', verifyJWT, requireRole('LANDLORD'), updateRoom);
router.delete('/:roomId', verifyJWT, requireRole('LANDLORD'), deleteRoom);

module.exports = router;

