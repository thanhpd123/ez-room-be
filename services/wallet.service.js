const prisma = require('../config/prisma');

const DEFAULT_CURRENCY = 'VND';

function toNumber(v) {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function parsePositiveAmount(raw) {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(amount * 100) / 100;
}

function formatWallet(wallet) {
    return {
        id: wallet.id,
        userId: wallet.userId,
        balance: toNumber(wallet.balance),
        currency: DEFAULT_CURRENCY,
        createdAt: wallet.created_at,
    };
}

function formatTransaction(tx) {
    return {
        id: tx.id,
        walletId: tx.walletId,
        type: tx.transaction_type,
        status: tx.status,
        amount: toNumber(tx.amount),
        description: tx.description || '',
        createdAt: tx.createdAt,
    };
}

async function ensureWallet(userId, txClient = prisma) {
    const existing = await txClient.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return txClient.wallet.create({
        data: {
            userId,
            balance: 0,
        },
    });
}

/**
 * Lấy ví của user
 */
async function getMyWallet(userId) {
    const wallet = await ensureWallet(userId);
    return { data: formatWallet(wallet) };
}

/**
 * Lấy lịch sử giao dịch ví
 */
async function getMyWalletTransactions(userId, params) {
    const { page = 1, limit = 20, type } = params;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const typeFilter =
        typeof type === 'string' ? type.trim().toUpperCase() : '';

    const wallet = await ensureWallet(userId);
    const where = { walletId: wallet.id };
    if (typeFilter) where.transaction_type = typeFilter;

    const [rows, total] = await Promise.all([
        prisma.walletTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
        }),
        prisma.walletTransaction.count({ where }),
    ]);

    return {
        data: rows.map(formatTransaction),
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    };
}

/**
 * Nạp tiền vào ví
 */
async function depositToWallet(userId, body) {
    const amount = parsePositiveAmount(body?.amount);
    const description =
        typeof body?.description === 'string' ? body.description.trim() : '';

    if (!amount) {
        throw Object.assign(new Error('Số tiền nạp không hợp lệ'), { statusCode: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(userId, tx);
        const updatedWallet = await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: amount } },
        });
        const transaction = await tx.walletTransaction.create({
            data: {
                walletId: wallet.id,
                transaction_type: 'DEPOSIT',
                status: 'SUCCESS',
                amount,
                description: description || 'Nạp tiền ví (giả lập)',
            },
        });
        return { updatedWallet, transaction };
    });

    return {
        message: 'Nạp tiền thành công (mô phỏng)',
        data: {
            wallet: formatWallet(result.updatedWallet),
            transaction: formatTransaction(result.transaction),
        },
    };
}

/**
 * Rút tiền từ ví
 */
async function withdrawFromWallet(userId, body) {
    const amount = parsePositiveAmount(body?.amount);
    const description =
        typeof body?.description === 'string' ? body.description.trim() : '';

    if (!amount) {
        throw Object.assign(new Error('Số tiền rút không hợp lệ'), { statusCode: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(userId, tx);
        const currentBalance = toNumber(wallet.balance);
        if (currentBalance < amount) {
            const err = new Error('Số dư không đủ');
            err.statusCode = 400;
            throw err;
        }

        const updatedWallet = await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { decrement: amount } },
        });
        const transaction = await tx.walletTransaction.create({
            data: {
                walletId: wallet.id,
                transaction_type: 'WITHDRAW',
                status: 'SUCCESS',
                amount,
                description: description || 'Rút tiền ví (giả lập)',
            },
        });
        return { updatedWallet, transaction };
    });

    return {
        message: 'Rút tiền thành công (mô phỏng)',
        data: {
            wallet: formatWallet(result.updatedWallet),
            transaction: formatTransaction(result.transaction),
        },
    };
}

module.exports = {
    getMyWallet,
    getMyWalletTransactions,
    depositToWallet,
    withdrawFromWallet,
};
