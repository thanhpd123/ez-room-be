const walletService = require('../services/wallet.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Wallet error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getMyWallet(req, res) {
    try {
        const result = await walletService.getMyWallet(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải ví');
    }
}

async function getMyWalletTransactions(req, res) {
    try {
        const result = await walletService.getMyWalletTransactions(
            req.auth.user.id,
            {
                page: req.query.page,
                limit: req.query.limit,
                type: req.query.type,
            }
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải lịch sử giao dịch');
    }
}

async function depositToWallet(req, res) {
    try {
        const result = await walletService.depositToWallet(
            req.auth.user.id,
            req.body
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({
                success: false,
                message: err.message || 'Yêu cầu không hợp lệ',
            });
        }
        return handleError(err, res, 'Lỗi nạp tiền');
    }
}

async function withdrawFromWallet(req, res) {
    try {
        const result = await walletService.withdrawFromWallet(
            req.auth.user.id,
            req.body
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({
                success: false,
                message: err.message || 'Yêu cầu không hợp lệ',
            });
        }
        return handleError(err, res, 'Lỗi rút tiền');
    }
}

module.exports = {
    getMyWallet,
    getMyWalletTransactions,
    depositToWallet,
    withdrawFromWallet,
};
