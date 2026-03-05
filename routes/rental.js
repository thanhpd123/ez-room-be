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
 * GET /rentals/stats

 * Thống kê bài đăng (Admin/Moderator)

 * Admin/Moderator dashboard rental stats. Must be before /:rentalId
 */
router.get('/stats', verifyJWT, requireRole('MODERATOR', 'ADMIN'), getRentalStats);

/**
 * GET /rentals/my-rentals
 * Landlord xem danh sách rentals của mình
 * ⚠️ Route này phải đặt TRƯỚC /:rentalId để tránh conflict
 */
router.get('/my-rentals', verifyJWT, requireRole('LANDLORD'), getMyRentals);

/**
 * GET /rentals
 * Lấy danh sách rentals (có filter, phân trang) - PUBLIC
 * Query: ?page=1&limit=10&status=AVAILABLE&search=keyword
 */
router.get('/', getRentals);

/**
 * GET /rentals/moderation
 * Moderator/Admin lấy danh sách rentals để duyệt
 * Query: ?status=PENDING&search=keyword&page=1&limit=50
 */
router.get('/moderation', verifyJWT, requireRole('MODERATOR', 'ADMIN'), getRentalsForModeration);

/**
 * GET /rentals/:rentalId
 * Lấy chi tiết một rental - PUBLIC
 */
router.get('/:rentalId', getRentalById);

/**
 * POST /rentals
 * Landlord tạo rental mới (status mặc định = HIDDEN)
 */
router.post('/', verifyJWT, requireRole('LANDLORD'), createRental);

/**
 * PATCH /rentals/:rentalId/status
 * Moderator/Admin duyệt rental (đổi status)
 * Body: { status: 'AVAILABLE' }
 */
router.patch('/:rentalId/status', verifyJWT, requireRole('MODERATOR', 'ADMIN'), updateRentalStatus);

/**
 * PUT /rentals/:rentalId
 * Landlord cập nhật rental của mình
 * Body: { title?, description?, address?, district?, city?, images? }
 */
router.put('/:rentalId', verifyJWT, requireRole('LANDLORD'), updateRental);

/**
 * DELETE /rentals/:rentalId
 * Landlord xóa rental của mình (không thể xóa nếu có đơn cọc đang hoạt động)
 * Admin xóa vĩnh viễn bài đăng
 */
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
