const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getMyWallet,
    getMyWalletTransactions,
    depositToWallet,
    withdrawFromWallet,
} = require('../controllers/wallet.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * GET /wallet
 * Get current user's wallet balance.
 */
router.get('/', getMyWallet);

/**
 * GET /wallet/transactions
 * Get current user's wallet transactions.
 */
router.get('/transactions', getMyWalletTransactions);

/**
 * POST /wallet/deposit
 * Simulate deposit (no real payment gateway).
 */
router.post('/deposit', depositToWallet);

/**
 * POST /wallet/withdraw
 * Simulate withdraw (no real payout provider).
 */
router.post('/withdraw', withdrawFromWallet);

module.exports = router;
