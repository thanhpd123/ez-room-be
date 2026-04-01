const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    getDashboardStats,
    getAllWallets,
    getWalletTransactions,
    getWalletStats,
    getPendingWithdrawalQueue,
    approveWalletWithdrawal,
    rejectWalletWithdrawal,
    approveWalletWithdrawalsBatch,
    rejectWalletWithdrawalsBatch,
    getSystemSettings,
    updateSystemSettings,
    getFinanceSummary,
    getFinanceReconciliation,
    getModeratorKpis,
    getVipPackages,
    getVipPackageById,
    createVipPackage,
    updateVipPackage,
    getVipPurchases,
    refundVipPurchase,
} = require('../controllers/admin.controller');

const router = express.Router();

// Tất cả routes trong file này yêu cầu: đăng nhập + role ADMIN
router.use(verifyJWT);
router.use(requireRole('ADMIN'));

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Thống kê tổng quan dashboard
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thống kê tổng quan
 */
router.get('/stats', getDashboardStats);

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: Lấy system settings (commission, deposit rules, ...)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách settings
 */
router.get('/settings', getSystemSettings);

/**
 * @openapi
 * /admin/settings:
 *   patch:
 *     tags: [Admin]
 *     summary: Cập nhật system settings (có audit)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 type: object
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/settings', updateSystemSettings);

/**
 * @openapi
 * /admin/finance/summary:
 *   get:
 *     tags: [Admin]
 *     summary: Finance KPIs (deposits/topups/fees)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Finance summary
 */
router.get('/finance/summary', getFinanceSummary);

/**
 * @openapi
 * /admin/finance/reconciliation:
 *   get:
 *     tags: [Admin]
 *     summary: Basic mismatch detection (internal DB)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Reconciliation report
 */
router.get('/finance/reconciliation', getFinanceReconciliation);

/**
 * @openapi
 * /admin/moderators/kpis:
 *   get:
 *     tags: [Admin]
 *     summary: Moderator KPIs (queue-based)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: KPI summary
 */
router.get('/moderators/kpis', getModeratorKpis);

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Lấy danh sách users
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [TENANT, LANDLORD, MODERATOR, ADMIN] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ACTIVE, BANNED, SUSPENDED] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách users
 */
router.get('/users', getAllUsers);

/**
 * @openapi
 * /admin/users/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: Chi tiết user (rentals, wallet, preferences)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết user
 */
router.get('/users/:userId', getUserById);

/**
 * @openapi
 * /admin/users/{userId}/role:
 *   patch:
 *     tags: [Admin]
 *     summary: Thay đổi role của user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [LANDLORD, MODERATOR, ADMIN] }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/users/:userId/role', updateUserRole);

/**
 * @openapi
 * /admin/users/{userId}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Thay đổi status user (khóa/mở khóa)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ACTIVE, BANNED, SUSPENDED] }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/users/:userId/status', updateUserStatus);

/**
 * @openapi
 * /admin/wallets/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Thống kê tổng quan ví
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thống kê ví
 */
router.get('/wallets/stats', getWalletStats);

/**
 * @openapi
 * /admin/wallets:
 *   get:
 *     tags: [Admin]
 *     summary: Lấy danh sách ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: minBalance
 *         schema: { type: number }
 *       - in: query
 *         name: maxBalance
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Danh sách ví
 */
router.get('/wallets', getAllWallets);

/**
 * @openapi
 * /admin/wallets/{walletId}/transactions:
 *   get:
 *     tags: [Admin]
 *     summary: Lịch sử giao dịch của ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [DEPOSIT, WITHDRAW, PAYMENT] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, SUCCESS, FAILED] }
 *     responses:
 *       200:
 *         description: Lịch sử giao dịch
 */
router.get('/wallets/:walletId/transactions', getWalletTransactions);

/**
 * @openapi
 * /admin/wallets/withdrawals/pending:
 *   get:
 *     tags: [Admin]
 *     summary: Queue chờ duyệt rút tiền toàn hệ thống
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, amount] }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *       - in: query
 *         name: minAmount
 *         schema: { type: number }
 *       - in: query
 *         name: maxAmount
 *         schema: { type: number }
 *       - in: query
 *         name: createdAfter
 *         schema: { type: string }
 *       - in: query
 *         name: createdBefore
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Queue pending withdrawals
 */
router.get('/wallets/withdrawals/pending', getPendingWithdrawalQueue);

/**
 * @openapi
 * /admin/wallets/withdrawals/{transactionId}/approve:
 *   patch:
 *     tags: [Admin]
 *     summary: Duyệt yêu cầu rút tiền ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Duyệt thành công
 */
router.patch('/wallets/withdrawals/:transactionId/approve', approveWalletWithdrawal);

/**
 * @openapi
 * /admin/wallets/withdrawals/{transactionId}/reject:
 *   patch:
 *     tags: [Admin]
 *     summary: Từ chối yêu cầu rút tiền ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Từ chối thành công
 */
router.patch('/wallets/withdrawals/:transactionId/reject', rejectWalletWithdrawal);

/**
 * @openapi
 * /admin/wallets/withdrawals/batch-approve:
 *   patch:
 *     tags: [Admin]
 *     summary: Duyệt hàng loạt yêu cầu rút tiền
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionIds]
 *             properties:
 *               transactionIds:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Kết quả duyệt hàng loạt
 */
router.patch('/wallets/withdrawals/batch-approve', approveWalletWithdrawalsBatch);

/**
 * @openapi
 * /admin/wallets/withdrawals/batch-reject:
 *   patch:
 *     tags: [Admin]
 *     summary: Từ chối hàng loạt yêu cầu rút tiền
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionIds]
 *             properties:
 *               transactionIds:
 *                 type: array
 *                 items: { type: string }
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Kết quả từ chối hàng loạt
 */
router.patch('/wallets/withdrawals/batch-reject', rejectWalletWithdrawalsBatch);

/**
 * @openapi
 * /admin/vip/packages:
 *   get:
 *     tags: [Admin]
 *     summary: Danh sách gói VIP (bao gồm active/inactive)
 *     security: [{ bearerAuth: [] }]
 */
router.get('/vip/packages', getVipPackages);

/**
 * @openapi
 * /admin/vip/packages/{packageId}:
 *   get:
 *     tags: [Admin]
 *     summary: Chi tiết gói VIP + thống kê cơ bản
 *     security: [{ bearerAuth: [] }]
 */
router.get('/vip/packages/:packageId', getVipPackageById);

/**
 * @openapi
 * /admin/vip/packages:
 *   post:
 *     tags: [Admin]
 *     summary: Tạo gói VIP mới
 *     security: [{ bearerAuth: [] }]
 */
router.post('/vip/packages', createVipPackage);

/**
 * @openapi
 * /admin/vip/packages/{packageId}:
 *   patch:
 *     tags: [Admin]
 *     summary: Cập nhật gói VIP
 *     security: [{ bearerAuth: [] }]
 */
router.patch('/vip/packages/:packageId', updateVipPackage);

/**
 * @openapi
 * /admin/vip/purchases:
 *   get:
 *     tags: [Admin]
 *     summary: Lịch sử mua VIP theo payment orders
 *     security: [{ bearerAuth: [] }]
 */
router.get('/vip/purchases', getVipPurchases);

/**
 * @openapi
 * /admin/vip/purchases/{orderId}/refund:
 *   patch:
 *     tags: [Admin]
 *     summary: Hoàn tiền giao dịch VIP
 *     security: [{ bearerAuth: [] }]
 */
router.patch('/vip/purchases/:orderId/refund', refundVipPurchase);

module.exports = router;
