const prisma = require('../config/prisma');

const VALID_ROLES = ['ADMIN', 'LANDLORD', 'TENANT', 'GUEST', 'MODERATOR'];
const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'];
const WITHDRAW_PRIORITY_AMOUNT_THRESHOLD = 3000000;
const WITHDRAW_PRIORITY_WAITING_HOURS = 12;
const VIP_REFUND_WINDOW_DAYS = Math.max(1, Math.round(toFiniteNumber(process.env.VIP_REFUND_WINDOW_DAYS, 7)));
const VIP_REFUND_MIN_REASON_LENGTH = Math.max(
    8,
    Math.round(toFiniteNumber(process.env.VIP_REFUND_MIN_REASON_LENGTH, 12))
);
const VIP_REFUND_REASON_CODES = new Set([
    'CUSTOMER_REQUEST',
    'DUPLICATE_PAYMENT',
    'SYSTEM_ERROR',
    'FRAUD_SUSPECT',
    'OTHER',
]);

const SETTINGS_KEYS = {
    PREORDER_DEPOSIT: 'preorder.deposit',
    PLATFORM_COMMISSION: 'platform.commission',
};

function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

function getDefaultSystemSettings() {
    return {
        [SETTINGS_KEYS.PREORDER_DEPOSIT]: {
            defaultPercent: toFiniteNumber(process.env.PREORDER_DEFAULT_DEPOSIT_PERCENT, 30),
            minPercent: toFiniteNumber(process.env.PREORDER_MIN_DEPOSIT_PERCENT, 5),
            maxPercent: toFiniteNumber(process.env.PREORDER_MAX_DEPOSIT_PERCENT, 80),
            baseMonths: Math.max(1, Math.round(toFiniteNumber(process.env.PREORDER_DEPOSIT_PERCENT_BASE_MONTHS, 12))),
        },
        [SETTINGS_KEYS.PLATFORM_COMMISSION]: {
            preorderFeeBps: Math.max(0, Math.round(toFiniteNumber(process.env.PLATFORM_PREORDER_FEE_BPS, 0))),
        },
    };
}

function validateDepositSettings(value) {
    if (!value || typeof value !== 'object') {
        throw Object.assign(new Error('preorder.deposit phải là object'), { statusCode: 400 });
    }

    const minPercent = round2(toFiniteNumber(value.minPercent, NaN));
    const maxPercent = round2(toFiniteNumber(value.maxPercent, NaN));
    const defaultPercent = round2(toFiniteNumber(value.defaultPercent, NaN));
    const baseMonths = Math.max(1, Math.round(toFiniteNumber(value.baseMonths, NaN)));

    if (!Number.isFinite(minPercent) || !Number.isFinite(maxPercent) || !Number.isFinite(defaultPercent)) {
        throw Object.assign(new Error('preorder.deposit percent phải là số'), { statusCode: 400 });
    }

    const safeMin = Math.max(0.01, Math.min(minPercent, 99.99));
    const safeMax = Math.max(safeMin, Math.min(maxPercent, 99.99));
    const safeDefault = Math.max(safeMin, Math.min(defaultPercent, safeMax));

    if (!Number.isFinite(baseMonths) || baseMonths < 1) {
        throw Object.assign(new Error('preorder.deposit.baseMonths phải là số nguyên dương'), { statusCode: 400 });
    }

    return {
        minPercent: safeMin,
        maxPercent: safeMax,
        defaultPercent: safeDefault,
        baseMonths,
    };
}

function validateCommissionSettings(value) {
    if (!value || typeof value !== 'object') {
        throw Object.assign(new Error('platform.commission phải là object'), { statusCode: 400 });
    }
    const preorderFeeBps = Math.round(toFiniteNumber(value.preorderFeeBps, NaN));
    if (!Number.isFinite(preorderFeeBps) || preorderFeeBps < 0 || preorderFeeBps > 10000) {
        throw Object.assign(new Error('platform.commission.preorderFeeBps phải nằm trong 0..10000'), {
            statusCode: 400,
        });
    }
    return { preorderFeeBps };
}

function normalizeSettingsPayload(body) {
    const settings = body?.settings && typeof body.settings === 'object' ? body.settings : null;
    if (!settings) {
        throw Object.assign(new Error('Thiếu payload settings'), { statusCode: 400 });
    }
    const keys = Object.keys(settings);
    if (keys.length === 0) {
        throw Object.assign(new Error('settings không có dữ liệu để cập nhật'), { statusCode: 400 });
    }
    return settings;
}

function parseDateInput(raw) {
    if (!raw) return null;
    const date = new Date(String(raw));
    return Number.isNaN(date.getTime()) ? null : date;
}

function resolveDateRange(params) {
    const to = parseDateInput(params?.to) || new Date();
    const from = parseDateInput(params?.from) || new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (from >= to) {
        throw Object.assign(new Error('Tham số from/to không hợp lệ'), { statusCode: 400 });
    }
    return { from, to };
}

function toPositiveInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function getWaitingHours(createdAt) {
    const createdMs = new Date(createdAt).getTime();
    if (!Number.isFinite(createdMs)) return 0;
    const diffMs = Math.max(0, Date.now() - createdMs);
    return Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;
}

function getWithdrawPriority(amount, waitingHours) {
    return amount >= WITHDRAW_PRIORITY_AMOUNT_THRESHOLD || waitingHours > WITHDRAW_PRIORITY_WAITING_HOURS
        ? 'HIGH'
        : 'NORMAL';
}

function isUuid(value) {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.trim()
    );
}

function normalizeVipTargetRole(role) {
    if (!role) return null;
    const value = String(role).trim().toUpperCase();
    if (!['TENANT', 'LANDLORD'].includes(value)) {
        throw Object.assign(new Error('targetRole chỉ hỗ trợ TENANT hoặc LANDLORD'), {
            statusCode: 400,
        });
    }
    return value;
}

function mapVipPackage(item) {
    return {
        id: item.id,
        name: item.name,
        description: item.description || null,
        durationDays: item.duration_days,
        price: Number(item.price || 0),
        targetRole: item.target_role,
        isActive: item.is_active !== false,
        createdAt: item.created_at || null,
    };
}

function parseVipPackagePayload(body, { partial = false } = {}) {
    const payload = body && typeof body === 'object' ? body : {};
    const parsed = {};

    if (!partial || payload.name !== undefined) {
        const name = String(payload.name || '').trim();
        if (!name) {
            throw Object.assign(new Error('Tên gói VIP là bắt buộc'), { statusCode: 400 });
        }
        if (name.length > 100) {
            throw Object.assign(new Error('Tên gói VIP không được quá 100 ký tự'), { statusCode: 400 });
        }
        parsed.name = name;
    }

    if (!partial || payload.durationDays !== undefined) {
        const durationDays = Number.parseInt(payload.durationDays, 10);
        if (!Number.isFinite(durationDays) || durationDays <= 0 || durationDays > 3650) {
            throw Object.assign(new Error('durationDays phải là số nguyên trong khoảng 1..3650'), {
                statusCode: 400,
            });
        }
        parsed.duration_days = durationDays;
    }

    if (!partial || payload.price !== undefined) {
        const price = Number(payload.price);
        if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(price)) {
            throw Object.assign(new Error('price phải là số nguyên dương'), { statusCode: 400 });
        }
        parsed.price = price;
    }

    if (!partial || payload.targetRole !== undefined) {
        parsed.target_role = normalizeVipTargetRole(payload.targetRole);
    }

    if (payload.description !== undefined) {
        const description = String(payload.description || '').trim();
        parsed.description = description || null;
    }

    if (payload.isActive !== undefined) {
        parsed.is_active = Boolean(payload.isActive);
    }

    return parsed;
}

function mapVipPurchaseOrder(item, packageMap = new Map()) {
    const vipPackage = item.ref_id ? packageMap.get(item.ref_id) || null : null;
    return {
        id: item.id,
        orderCode: item.vnp_txn_ref,
        userId: item.user_id,
        amount: Number(item.amount || 0),
        status: item.status,
        purpose: item.purpose,
        packageId: item.ref_id || null,
        package: vipPackage ? mapVipPackage(vipPackage) : null,
        refund: {
            status: item.vnp_refund_status || 'NOT_REQUESTED',
            amount: item.refund_amount != null ? Number(item.refund_amount) : null,
            reason: item.refund_reason || null,
            requestedAt: item.refund_requested_at || null,
            completedAt: item.refund_completed_at || null,
            requestedBy: item.refund_requested_by || null,
            refundTxnRef: item.vnp_refund_txn_ref || null,
            refundTransactionNo: item.vnp_refund_trans_no || null,
        },
        createdAt: item.created_at || null,
        updatedAt: item.updated_at || null,
        user: item.users_payment_orders_user_idTousers
            ? {
                id: item.users_payment_orders_user_idTousers.id,
                fullName: item.users_payment_orders_user_idTousers.fullName,
                email: item.users_payment_orders_user_idTousers.email,
                phone: item.users_payment_orders_user_idTousers.phone,
                role: item.users_payment_orders_user_idTousers.role,
                isVip: item.users_payment_orders_user_idTousers.isVip,
                vipExpiresAt: item.users_payment_orders_user_idTousers.vip_expires_at,
            }
            : null,
    };
}

/**
 * Lấy danh sách ví (phân trang, filter)
 */
async function getAllWallets(params) {
    const { page = 1, limit = 10, search, minBalance, maxBalance } = params;
    const skip = (page - 1) * limit;
    const where = {};

    if (search) {
        where.user = {
            OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
            ],
        };
    }

    if (minBalance || maxBalance) {
        where.balance = {};
        if (minBalance) where.balance.gte = parseFloat(minBalance);
        if (maxBalance) where.balance.lte = parseFloat(maxBalance);
    }

    const [wallets, total] = await Promise.all([
        prisma.wallet.findMany({
            where,
            skip,
            take: limit,
            orderBy: { created_at: 'desc' },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        avatarUrl: true,
                        role: true,
                        status: true,
                    },
                },
            },
        }),
        prisma.wallet.count({ where }),
    ]);

    return {
        data: wallets.map((w) => ({
            id: w.id,
            userId: w.userId,
            balance: w.balance,
            createdAt: w.created_at,
            user: w.user,
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Lấy lịch sử giao dịch của một ví
 */
async function getWalletTransactions(walletId, params) {
    const { page = 1, limit = 20, type, status } = params;
    const skip = (page - 1) * limit;

    const wallet = await prisma.wallet.findUnique({
        where: { id: walletId },
        include: {
            user: {
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                    role: true,
                },
            },
        },
    });

    if (!wallet) {
        throw Object.assign(new Error('Không tìm thấy ví'), { statusCode: 404 });
    }

    const where = { walletId };
    if (type) where.transaction_type = type.toUpperCase();
    if (status) where.status = status.toUpperCase();

    const [transactions, total] = await Promise.all([
        prisma.walletTransaction.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
        }),
        prisma.walletTransaction.count({ where }),
    ]);

    return {
        data: {
            wallet: {
                id: wallet.id,
                balance: wallet.balance,
                user: wallet.user,
            },
            transactions,
        },
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Thống kê tổng quan ví
 */
async function getWalletStats() {
    const [totalWallets, aggregation, txByType, txByStatus, pendingWithdrawRequests] = await Promise.all([
        prisma.wallet.count(),
        prisma.wallet.aggregate({
            _sum: { balance: true },
            _avg: { balance: true },
            _max: { balance: true },
        }),
        prisma.walletTransaction.groupBy({
            by: ['transaction_type'],
            _count: true,
            _sum: { amount: true },
        }),
        prisma.walletTransaction.groupBy({
            by: ['status'],
            _count: true,
        }),
        prisma.walletTransaction.count({
            where: {
                transaction_type: 'WITHDRAW',
                status: 'PENDING',
            },
        }),
    ]);

    return {
        data: {
            totalWallets,
            totalBalance: aggregation._sum.balance || 0,
            avgBalance: aggregation._avg.balance || 0,
            maxBalance: aggregation._max.balance || 0,
            pendingWithdrawRequests,
            transactionsByType: txByType.map((t) => ({
                type: t.transaction_type,
                count: t._count,
                totalAmount: t._sum.amount,
            })),
            transactionsByStatus: txByStatus.map((s) => ({
                status: s.status,
                count: s._count,
            })),
        },
    };
}

/**
 * Queue pending withdrawals toàn hệ thống (queue-first cho admin duyệt rút tiền)
 */
async function getPendingWithdrawalQueue(params) {
    const page = toPositiveInt(params?.page, 1, 1, 100000);
    const limit = toPositiveInt(params?.limit, 20, 1, 200);
    const skip = (page - 1) * limit;
    const search = typeof params?.search === 'string' ? params.search.trim() : '';
    const sortBy = params?.sortBy === 'amount' ? 'amount' : 'createdAt';
    const order = String(params?.order || '').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const minAmount = Number.isFinite(Number(params?.minAmount)) ? Number(params.minAmount) : null;
    const maxAmount = Number.isFinite(Number(params?.maxAmount)) ? Number(params.maxAmount) : null;
    const createdAfter = parseDateInput(params?.createdAfter);
    const createdBefore = parseDateInput(params?.createdBefore);

    const where = {
        transaction_type: 'WITHDRAW',
        status: 'PENDING',
    };

    if (minAmount !== null || maxAmount !== null) {
        where.amount = {};
        if (minAmount !== null) where.amount.gte = minAmount;
        if (maxAmount !== null) where.amount.lte = maxAmount;
    }

    if (createdAfter || createdBefore) {
        where.createdAt = {};
        if (createdAfter) where.createdAt.gte = createdAfter;
        if (createdBefore) where.createdAt.lte = createdBefore;
    }

    if (search) {
        where.wallet = {
            user: {
                OR: [
                    { fullName: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search } },
                ],
            },
        };
    }

    const overdueAt = new Date(Date.now() - WITHDRAW_PRIORITY_WAITING_HOURS * 60 * 60 * 1000);

    const [transactions, total, aggregate, allWaitingRows, overdueCount] = await Promise.all([
        prisma.walletTransaction.findMany({
            where,
            skip,
            take: limit,
            orderBy: { [sortBy]: order },
            include: {
                wallet: {
                    select: {
                        id: true,
                        balance: true,
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                                phone: true,
                                avatarUrl: true,
                                role: true,
                                status: true,
                            },
                        },
                    },
                },
            },
        }),
        prisma.walletTransaction.count({ where }),
        prisma.walletTransaction.aggregate({
            where,
            _sum: { amount: true },
        }),
        prisma.walletTransaction.findMany({
            where,
            select: { createdAt: true },
        }),
        prisma.walletTransaction.count({
            where: {
                ...where,
                createdAt: { lt: overdueAt },
            },
        }),
    ]);

    const avgWaitingHours = allWaitingRows.length
        ? round2(
            allWaitingRows.reduce((acc, item) => acc + getWaitingHours(item.createdAt), 0) /
            allWaitingRows.length
        )
        : 0;

    const data = transactions.map((tx) => {
        const amount = Number(tx.amount || 0);
        const waitingHours = getWaitingHours(tx.createdAt);
        return {
            id: tx.id,
            walletId: tx.walletId,
            amount: tx.amount,
            status: tx.status,
            transaction_type: tx.transaction_type,
            description: tx.description,
            createdAt: tx.createdAt,
            waitingHours,
            priority: getWithdrawPriority(amount, waitingHours),
            isOverdue: waitingHours > WITHDRAW_PRIORITY_WAITING_HOURS,
            wallet: {
                id: tx.wallet.id,
                balance: tx.wallet.balance,
            },
            user: tx.wallet.user,
        };
    });

    return {
        data,
        summary: {
            pendingCount: total,
            pendingAmount: aggregate._sum.amount || 0,
            avgWaitingHours,
            overdueCount,
            slaHours: WITHDRAW_PRIORITY_WAITING_HOURS,
            priorityAmountThreshold: WITHDRAW_PRIORITY_AMOUNT_THRESHOLD,
        },
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Admin duyệt yêu cầu rút tiền
 */
async function approveWalletWithdrawal(transactionId, adminId) {
    const result = await prisma.$transaction(async (tx) => {
        const withdrawalTx = await tx.walletTransaction.findUnique({
            where: { id: transactionId },
            include: { wallet: true },
        });

        if (!withdrawalTx) {
            throw Object.assign(new Error('Không tìm thấy giao dịch rút tiền'), { statusCode: 404 });
        }

        if (withdrawalTx.transaction_type !== 'WITHDRAW') {
            throw Object.assign(new Error('Giao dịch không phải rút tiền'), { statusCode: 400 });
        }

        if (withdrawalTx.status !== 'PENDING') {
            throw Object.assign(new Error(`Giao dịch đã được xử lý (${withdrawalTx.status})`), { statusCode: 400 });
        }

        const wallet = await tx.wallet.findUnique({ where: { id: withdrawalTx.walletId } });
        if (!wallet) {
            throw Object.assign(new Error('Không tìm thấy ví'), { statusCode: 404 });
        }

        const amount = Number(withdrawalTx.amount || 0);
        const updatedTx = await tx.walletTransaction.updateMany({
            where: {
                id: transactionId,
                status: 'PENDING',
            },
            data: {
                status: 'SUCCESS',
                description: `${withdrawalTx.description || 'Yêu cầu rút tiền'} (Duyệt bởi admin ${adminId})`,
            },
        });

        if (updatedTx.count === 0) {
            throw Object.assign(new Error('Yêu cầu đã được xử lý trước đó'), { statusCode: 409 });
        }

        // Atomic decrement để tránh race condition khi nhiều yêu cầu rút được duyệt đồng thời.
        const walletUpdated = await tx.wallet.updateMany({
            where: {
                id: wallet.id,
                balance: { gte: amount },
            },
            data: { balance: { decrement: amount } },
        });

        if (walletUpdated.count === 0) {
            throw Object.assign(new Error('Số dư ví không đủ để duyệt rút tiền'), { statusCode: 400 });
        }

        const updatedWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });

        await tx.notification.create({
            data: {
                userId: wallet.userId,
                type: 'PAYMENT',
                status: 'UNREAD',
                title: 'Yêu cầu rút tiền đã được duyệt',
                body: `Yêu cầu rút ${amount.toLocaleString('vi-VN')} VND đã được duyệt và trừ khỏi ví.`,
            },
        });

        const latestTx = await tx.walletTransaction.findUnique({ where: { id: transactionId } });
        return { wallet: updatedWallet, transaction: latestTx };
    });

    return {
        message: 'Đã duyệt yêu cầu rút tiền',
        data: result,
    };
}

/**
 * Admin từ chối yêu cầu rút tiền
 */
async function rejectWalletWithdrawal(transactionId, adminId, body) {
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

    const result = await prisma.$transaction(async (tx) => {
        const withdrawalTx = await tx.walletTransaction.findUnique({
            where: { id: transactionId },
            include: { wallet: true },
        });

        if (!withdrawalTx) {
            throw Object.assign(new Error('Không tìm thấy giao dịch rút tiền'), { statusCode: 404 });
        }

        if (withdrawalTx.transaction_type !== 'WITHDRAW') {
            throw Object.assign(new Error('Giao dịch không phải rút tiền'), { statusCode: 400 });
        }

        if (withdrawalTx.status !== 'PENDING') {
            throw Object.assign(new Error(`Giao dịch đã được xử lý (${withdrawalTx.status})`), { statusCode: 400 });
        }

        const updatedTx = await tx.walletTransaction.updateMany({
            where: {
                id: transactionId,
                status: 'PENDING',
            },
            data: {
                status: 'CANCELLED',
                description: `${withdrawalTx.description || 'Yêu cầu rút tiền'} (Từ chối bởi admin ${adminId}${reason ? `: ${reason}` : ''})`,
            },
        });

        if (updatedTx.count === 0) {
            throw Object.assign(new Error('Yêu cầu đã được xử lý trước đó'), { statusCode: 409 });
        }

        await tx.notification.create({
            data: {
                userId: withdrawalTx.wallet.userId,
                type: 'PAYMENT',
                status: 'UNREAD',
                title: 'Yêu cầu rút tiền bị từ chối',
                body: reason
                    ? `Yêu cầu rút tiền của bạn bị từ chối. Lý do: ${reason}`
                    : 'Yêu cầu rút tiền của bạn bị từ chối.',
            },
        });

        return tx.walletTransaction.findUnique({ where: { id: transactionId } });
    });

    return {
        message: 'Đã từ chối yêu cầu rút tiền',
        data: { transaction: result },
    };
}

/**
 * Batch duyệt nhiều yêu cầu rút tiền.
 */
async function approveWalletWithdrawalsBatch(payload, adminId) {
    const ids = Array.isArray(payload?.transactionIds) ? payload.transactionIds : [];
    const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()))];

    if (uniqueIds.length === 0) {
        throw Object.assign(new Error('transactionIds phải là mảng không rỗng'), { statusCode: 400 });
    }

    const approved = [];
    const failed = [];

    for (const txId of uniqueIds) {
        try {
            const result = await approveWalletWithdrawal(txId, adminId);
            approved.push({
                transactionId: txId,
                walletId: result?.data?.transaction?.walletId || null,
                amount: result?.data?.transaction?.amount || null,
            });
        } catch (err) {
            failed.push({
                transactionId: txId,
                message: err?.message || 'Xử lý thất bại',
            });
        }
    }

    return {
        message: `Duyệt hàng loạt hoàn tất: ${approved.length} thành công, ${failed.length} thất bại`,
        data: {
            approved,
            failed,
            summary: {
                requested: uniqueIds.length,
                approved: approved.length,
                failed: failed.length,
            },
        },
    };
}

/**
 * Batch từ chối nhiều yêu cầu rút tiền.
 */
async function rejectWalletWithdrawalsBatch(payload, adminId) {
    const ids = Array.isArray(payload?.transactionIds) ? payload.transactionIds : [];
    const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()))];
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';

    if (uniqueIds.length === 0) {
        throw Object.assign(new Error('transactionIds phải là mảng không rỗng'), { statusCode: 400 });
    }

    const rejected = [];
    const failed = [];

    for (const txId of uniqueIds) {
        try {
            const result = await rejectWalletWithdrawal(txId, adminId, { reason });
            rejected.push({
                transactionId: txId,
                walletId: result?.data?.transaction?.walletId || null,
                amount: result?.data?.transaction?.amount || null,
            });
        } catch (err) {
            failed.push({
                transactionId: txId,
                message: err?.message || 'Xử lý thất bại',
            });
        }
    }

    return {
        message: `Từ chối hàng loạt hoàn tất: ${rejected.length} thành công, ${failed.length} thất bại`,
        data: {
            rejected,
            failed,
            summary: {
                requested: uniqueIds.length,
                rejected: rejected.length,
                failed: failed.length,
            },
        },
    };
}

/**
 * Lấy danh sách users (phân trang, filter)
 */
async function getAllUsers(params) {
    const { page = 1, limit = 10, role, status, search } = params;
    const skip = (page - 1) * limit;
    const where = {};

    if (role && VALID_ROLES.includes(role.toUpperCase())) {
        where.role = role.toUpperCase();
    }
    if (status) where.status = status.toUpperCase();
    if (search) {
        where.OR = [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
        ];
    }

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                avatarUrl: true,
                role: true,
                status: true,
                createdAt: true,
            },
        }),
        prisma.user.count({ where }),
    ]);

    return {
        data: users,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Lấy thông tin chi tiết một user
 */
async function getUserById(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            role: true,
            status: true,
            createdAt: true,
            updated_at: true,
            wallet: {
                select: {
                    id: true,
                    balance: true,
                    created_at: true,
                },
            },
            rentals: {
                select: {
                    id: true,
                    title: true,
                    status: true,
                    createdAt: true,
                    rooms: { select: { id: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
            },
            lifestyleProfile: {
                select: {
                    id: true,
                    personalityType: true,
                    created_at: true,
                },
            },
            preference: {
                select: {
                    id: true,
                    budget_min: true,
                    budget_max: true,
                    preferredLocation: true,
                    preferred_gender: true,
                    created_at: true,
                },
            },
            favoriteRooms: { select: { roomId: true } },
            preorders: {
                select: {
                    id: true,
                    status: true,
                    payment_status: true,
                    deposit_amount: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
            },
        },
    });

    if (!user) {
        throw Object.assign(new Error('Không tìm thấy người dùng'), { statusCode: 404 });
    }

    const response = {
        ...user,
        stats: {
            totalRentals: user.rentals.length,
            totalFavorites: user.favoriteRooms.length,
            totalPreorders: user.preorders.length,
        },
    };
    delete response.favoriteRooms;

    return { data: response };
}

/**
 * Thay đổi role của user
 */
async function updateUserRole(userId, newRole, adminId) {
    if (!newRole || !VALID_ROLES.includes(newRole.toUpperCase())) {
        throw Object.assign(new Error(`Role không hợp lệ. Các role hợp lệ: ${VALID_ROLES.join(', ')}`), {
            statusCode: 400,
        });
    }

    const role = newRole.toUpperCase();

    if (userId === adminId) {
        throw Object.assign(new Error('Bạn không thể thay đổi role của chính mình'), { statusCode: 403 });
    }

    const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, email: true, role: true },
    });

    if (!existingUser) {
        throw Object.assign(new Error('Không tìm thấy người dùng'), { statusCode: 404 });
    }

    if (existingUser.role === 'ADMIN') {
        throw Object.assign(new Error('Không thể thay đổi role của Admin khác'), { statusCode: 403 });
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { role, updated_at: new Date() },
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
        },
    });

    return {
        message: `Đã cập nhật role của "${updatedUser.fullName}" thành ${role}`,
        data: updatedUser,
    };
}

/**
 * Thay đổi status của user
 */
async function updateUserStatus(userId, newStatus, adminId) {
    if (!newStatus || !VALID_STATUSES.includes(newStatus.toUpperCase())) {
        throw Object.assign(new Error(`Status không hợp lệ. Các status hợp lệ: ${VALID_STATUSES.join(', ')}`), {
            statusCode: 400,
        });
    }

    const status = newStatus.toUpperCase();

    if (userId === adminId) {
        throw Object.assign(new Error('Bạn không thể thay đổi status của chính mình'), { statusCode: 403 });
    }

    const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, role: true },
    });

    if (!existingUser) {
        throw Object.assign(new Error('Không tìm thấy người dùng'), { statusCode: 404 });
    }

    if (existingUser.role === 'ADMIN') {
        throw Object.assign(new Error('Không thể thay đổi status của Admin khác'), { statusCode: 403 });
    }

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { status, updated_at: new Date() },
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
        },
    });

    return {
        message: `Đã cập nhật status của "${updatedUser.fullName}" thành ${status}`,
        data: updatedUser,
    };
}

/**
 * Thống kê tổng quan dashboard
 */
async function getDashboardStats() {
    const [
        totalUsers,
        totalAdmins,
        totalLandlords,
        totalTenants,
        totalModerators,
        activeUsers,
        bannedUsers,
        totalRentals,
        totalRooms,
        totalWallets,
        walletAggr,
        totalFeedback,
        totalPreorders,
    ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: 'ADMIN' } }),
        prisma.user.count({ where: { role: 'LANDLORD' } }),
        prisma.user.count({ where: { role: 'TENANT' } }),
        prisma.user.count({ where: { role: 'MODERATOR' } }),
        prisma.user.count({ where: { status: 'ACTIVE' } }),
        prisma.user.count({ where: { status: 'BANNED' } }),
        prisma.rental.count(),
        prisma.rooms.count(),
        prisma.wallet.count(),
        prisma.wallet.aggregate({ _sum: { balance: true } }),
        prisma.feedback.count(),
        prisma.preorder.count(),
    ]);

    return {
        data: {
            users: {
                total: totalUsers,
                byRole: {
                    admins: totalAdmins,
                    landlords: totalLandlords,
                    tenants: totalTenants,
                    moderators: totalModerators,
                },
                byStatus: {
                    active: activeUsers,
                    banned: bannedUsers,
                },
            },
            rentals: { total: totalRentals },
            rooms: { total: totalRooms },
            wallets: {
                total: totalWallets,
                totalBalance: walletAggr._sum.balance || 0,
            },
            feedback: { total: totalFeedback },
            preorders: { total: totalPreorders },
        },
    };
}

async function getSystemSettings() {
    const defaults = getDefaultSystemSettings();
    const keys = Object.values(SETTINGS_KEYS);
    const rows = await prisma.systemSetting.findMany({
        where: { key: { in: keys } },
        select: { key: true, value_json: true, updated_at: true, updated_by: true },
    });

    const dbMap = new Map(rows.map((r) => [r.key, r]));
    const settings = {};
    const meta = {};

    for (const key of keys) {
        const row = dbMap.get(key);
        settings[key] = row?.value_json ?? defaults[key];
        meta[key] = {
            source: row ? 'db' : 'default',
            updatedAt: row?.updated_at || null,
            updatedBy: row?.updated_by || null,
        };
    }

    return { data: { settings, meta } };
}

async function updateSystemSettings(body, adminId) {
    const settings = normalizeSettingsPayload(body);
    const allowedKeys = new Set(Object.values(SETTINGS_KEYS));

    for (const key of Object.keys(settings)) {
        if (!allowedKeys.has(key)) {
            throw Object.assign(new Error(`Key settings không được hỗ trợ: ${key}`), { statusCode: 400 });
        }
    }

    const updates = [];
    for (const [key, value] of Object.entries(settings)) {
        if (key === SETTINGS_KEYS.PREORDER_DEPOSIT) {
            updates.push({ key, value: validateDepositSettings(value) });
        } else if (key === SETTINGS_KEYS.PLATFORM_COMMISSION) {
            updates.push({ key, value: validateCommissionSettings(value) });
        }
    }

    await prisma.$transaction(async (tx) => {
        for (const update of updates) {
            const existing = await tx.systemSetting.findUnique({
                where: { key: update.key },
                select: { id: true, value_json: true },
            });

            await tx.systemSetting.upsert({
                where: { key: update.key },
                create: {
                    key: update.key,
                    value_json: update.value,
                    updated_by: adminId,
                },
                update: {
                    value_json: update.value,
                    updated_by: adminId,
                    updated_at: new Date(),
                },
            });

            await tx.systemSettingAudit.create({
                data: {
                    key: update.key,
                    old_value_json: existing?.value_json ?? null,
                    new_value_json: update.value,
                    updated_by: adminId,
                },
            });
        }
    });

    return {
        message: 'Đã cập nhật system settings',
        ...(await getSystemSettings()),
    };
}

async function getFinanceSummary(params) {
    const { from, to } = resolveDateRange(params);
    const rangeFilter = { gte: from, lt: to };

    const [
        preorderDepositSuccess,
        walletTopupSuccess,
        vipPurchaseSuccess,
        refundCompleted,
        platformFees,
        pendingOrders,
    ] = await Promise.all([
        prisma.payment_orders.aggregate({
            where: {
                purpose: 'PREORDER_DEPOSIT',
                status: 'SUCCESS',
                created_at: rangeFilter,
            },
            _sum: { amount: true },
            _count: true,
        }),
        prisma.payment_orders.aggregate({
            where: {
                purpose: 'WALLET_TOPUP',
                status: 'SUCCESS',
                created_at: rangeFilter,
            },
            _sum: { amount: true },
            _count: true,
        }),
        prisma.payment_orders.aggregate({
            where: {
                purpose: 'VIP_PURCHASE',
                status: 'SUCCESS',
                created_at: rangeFilter,
            },
            _sum: { amount: true },
            _count: true,
        }),
        prisma.payment_orders.aggregate({
            where: {
                refund_completed_at: rangeFilter,
                refund_amount: { not: null },
            },
            _sum: { refund_amount: true },
            _count: true,
        }),
        prisma.platformLedgerEntry.aggregate({
            where: {
                entry_type: 'PREORDER_FEE',
                created_at: rangeFilter,
            },
            _sum: { amount: true },
            _count: true,
        }),
        prisma.payment_orders.count({
            where: {
                status: 'PENDING',
                created_at: rangeFilter,
            },
        }),
    ]);

    return {
        data: {
            range: {
                from: from.toISOString(),
                to: to.toISOString(),
            },
            kpis: {
                preorderDeposits: {
                    successCount: preorderDepositSuccess._count,
                    successAmount: preorderDepositSuccess._sum.amount || 0,
                },
                walletTopups: {
                    successCount: walletTopupSuccess._count,
                    successAmount: walletTopupSuccess._sum.amount || 0,
                },
                vipPurchases: {
                    successCount: vipPurchaseSuccess._count,
                    successAmount: vipPurchaseSuccess._sum.amount || 0,
                },
                refunds: {
                    completedCount: refundCompleted._count,
                    completedAmount: refundCompleted._sum.refund_amount || 0,
                },
                platformFees: {
                    entries: platformFees._count,
                    amount: platformFees._sum.amount || 0,
                },
                pendingPaymentOrders: pendingOrders,
            },
        },
    };
}

async function getFinanceReconciliation(params) {
    const { from, to } = resolveDateRange(params);
    const page = Math.max(1, Number(params?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(params?.limit) || 50));
    const rangeFilter = { gte: from, lt: to };

    const [ordersInRange, paidPreordersInRange] = await Promise.all([
        prisma.payment_orders.findMany({
            where: {
                purpose: 'PREORDER_DEPOSIT',
                created_at: rangeFilter,
            },
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                vnp_txn_ref: true,
                amount: true,
                status: true,
                ref_type: true,
                ref_id: true,
                created_at: true,
                updated_at: true,
            },
        }),
        prisma.preorder.findMany({
            where: {
                payment_status: 'PAID',
                createdAt: rangeFilter,
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                userId: true,
                roomId: true,
                status: true,
                payment_status: true,
                deposit_amount: true,
                createdAt: true,
            },
        }),
    ]);

    const preorderIdsFromOrders = ordersInRange
        .filter((o) => o.ref_type === 'PREORDER' && o.ref_id)
        .map((o) => o.ref_id);
    const uniquePreorderIds = Array.from(new Set(preorderIdsFromOrders));

    const preordersById = new Map();
    if (uniquePreorderIds.length > 0) {
        const preorders = await prisma.preorder.findMany({
            where: { id: { in: uniquePreorderIds } },
            select: {
                id: true,
                status: true,
                payment_status: true,
                deposit_amount: true,
                createdAt: true,
            },
        });
        for (const p of preorders) preordersById.set(p.id, p);
    }

    const successOrdersByPreorderId = new Map();
    for (const order of ordersInRange) {
        if (order.ref_type !== 'PREORDER' || !order.ref_id) continue;
        if (order.status !== 'SUCCESS') continue;
        successOrdersByPreorderId.set(order.ref_id, order);
    }

    const mismatches = [];

    // A) Payment SUCCESS nhưng preorder không PAID (hoặc missing)
    for (const order of ordersInRange) {
        if (order.status !== 'SUCCESS') continue;
        if (order.ref_type !== 'PREORDER' || !order.ref_id) {
            mismatches.push({
                type: 'ORDER_SUCCESS_MISSING_REF',
                order,
                preorder: null,
            });
            continue;
        }
        const preorder = preordersById.get(order.ref_id) || null;
        if (!preorder) {
            mismatches.push({
                type: 'ORDER_SUCCESS_PREORDER_NOT_FOUND',
                order,
                preorder: null,
            });
            continue;
        }
        if (preorder.payment_status !== 'PAID') {
            mismatches.push({
                type: 'ORDER_SUCCESS_PREORDER_NOT_PAID',
                order,
                preorder,
            });
        }
    }

    // B) preorder PAID nhưng không thấy SUCCESS order
    for (const preorder of paidPreordersInRange) {
        const order = successOrdersByPreorderId.get(preorder.id);
        if (!order) {
            mismatches.push({
                type: 'PREORDER_PAID_NO_SUCCESS_ORDER',
                order: null,
                preorder,
            });
        }
    }

    const total = mismatches.length;
    const byType = mismatches.reduce((acc, item) => {
        acc[item.type] = (acc[item.type] || 0) + 1;
        return acc;
    }, {});

    const start = (page - 1) * limit;
    const data = mismatches.slice(start, start + limit);

    return {
        data: {
            range: {
                from: from.toISOString(),
                to: to.toISOString(),
            },
            summary: {
                total,
                byType,
            },
            mismatches: data,
        },
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function getModeratorKpis(params) {
    const { from, to } = resolveDateRange(params);
    const rangeFilter = { gte: from, lt: to };

    const moderators = await prisma.user.findMany({
        where: { role: 'MODERATOR' },
        select: {
            id: true,
            fullName: true,
            email: true,
            status: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
    });

    const moderatorIds = moderators.map((m) => m.id);
    if (moderatorIds.length === 0) {
        return {
            data: {
                range: { from: from.toISOString(), to: to.toISOString() },
                moderators: [],
            },
        };
    }

    const [openAssigned, resolvedAssigned, escalatedAssigned, resolvedTasks] = await Promise.all([
        prisma.moderation_queue.groupBy({
            by: ['assigned_to'],
            where: {
                assigned_to: { in: moderatorIds },
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
            _count: true,
        }),
        prisma.moderation_queue.groupBy({
            by: ['assigned_to'],
            where: {
                assigned_to: { in: moderatorIds },
                status: 'RESOLVED',
                resolved_at: rangeFilter,
            },
            _count: true,
        }),
        prisma.moderation_queue.groupBy({
            by: ['assigned_to'],
            where: {
                assigned_to: { in: moderatorIds },
                status: 'ESCALATED',
                resolved_at: rangeFilter,
            },
            _count: true,
        }),
        prisma.moderation_queue.findMany({
            where: {
                assigned_to: { in: moderatorIds },
                status: 'RESOLVED',
                resolved_at: rangeFilter,
                assigned_at: { not: null },
            },
            select: {
                assigned_to: true,
                assigned_at: true,
                resolved_at: true,
            },
            take: 5000,
        }),
    ]);

    const openMap = new Map(openAssigned.map((r) => [r.assigned_to, r._count]));
    const resolvedMap = new Map(resolvedAssigned.map((r) => [r.assigned_to, r._count]));
    const escalatedMap = new Map(escalatedAssigned.map((r) => [r.assigned_to, r._count]));

    const timeAgg = new Map();
    for (const task of resolvedTasks) {
        const modId = task.assigned_to;
        if (!modId || !task.assigned_at || !task.resolved_at) continue;
        const ms = new Date(task.resolved_at).getTime() - new Date(task.assigned_at).getTime();
        if (!Number.isFinite(ms) || ms < 0) continue;
        const prev = timeAgg.get(modId) || { totalMs: 0, count: 0 };
        prev.totalMs += ms;
        prev.count += 1;
        timeAgg.set(modId, prev);
    }

    return {
        data: {
            range: { from: from.toISOString(), to: to.toISOString() },
            moderators: moderators.map((m) => {
                const t = timeAgg.get(m.id);
                const avgMs = t && t.count > 0 ? t.totalMs / t.count : null;
                return {
                    id: m.id,
                    fullName: m.fullName,
                    email: m.email,
                    status: m.status,
                    queue: {
                        openAssigned: openMap.get(m.id) || 0,
                        resolvedInRange: resolvedMap.get(m.id) || 0,
                        escalatedInRange: escalatedMap.get(m.id) || 0,
                        avgResolutionMs: avgMs,
                    },
                };
            }),
        },
    };
}

async function getVipPackages(params) {
    const page = toPositiveInt(params?.page, 1, 1, 100000);
    const limit = toPositiveInt(params?.limit, 10, 1, 200);
    const skip = (page - 1) * limit;
    const search = typeof params?.search === 'string' ? params.search.trim() : '';
    const targetRole = params?.targetRole ? normalizeVipTargetRole(params.targetRole) : null;
    const status = String(params?.status || '').trim().toUpperCase();

    const where = {};
    if (targetRole) where.target_role = targetRole;
    if (status === 'ACTIVE') where.is_active = true;
    if (status === 'INACTIVE') where.is_active = false;
    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
        ];
    }

    const [rows, total] = await Promise.all([
        prisma.vip_packages.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ created_at: 'desc' }, { duration_days: 'asc' }],
        }),
        prisma.vip_packages.count({ where }),
    ]);

    return {
        data: rows.map(mapVipPackage),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function getVipPackageById(packageId) {
    if (!isUuid(packageId)) {
        throw Object.assign(new Error('packageId không hợp lệ'), { statusCode: 400 });
    }

    const vipPackage = await prisma.vip_packages.findUnique({
        where: { id: packageId },
    });

    if (!vipPackage) {
        throw Object.assign(new Error('Không tìm thấy gói VIP'), { statusCode: 404 });
    }

    const [successOrders, refundedOrders, activeSubscribers] = await Promise.all([
        prisma.payment_orders.aggregate({
            where: {
                purpose: 'VIP_PURCHASE',
                ref_id: packageId,
                status: 'SUCCESS',
            },
            _sum: { amount: true },
            _count: true,
        }),
        prisma.payment_orders.aggregate({
            where: {
                purpose: 'VIP_PURCHASE',
                ref_id: packageId,
                vnp_refund_status: 'SUCCESS',
            },
            _sum: { refund_amount: true },
            _count: true,
        }),
        prisma.user_vip_purchases.count({
            where: {
                package_id: packageId,
                end_date: { gt: new Date() },
            },
        }),
    ]);

    return {
        data: {
            ...mapVipPackage(vipPackage),
            stats: {
                successPurchaseCount: successOrders._count,
                successPurchaseAmount: Number(successOrders._sum.amount || 0),
                refundedCount: refundedOrders._count,
                refundedAmount: Number(refundedOrders._sum.refund_amount || 0),
                activeSubscribers,
            },
        },
    };
}

async function createVipPackage(payload) {
    const data = parseVipPackagePayload(payload, { partial: false });

    const created = await prisma.vip_packages.create({
        data: {
            ...data,
            is_active: data.is_active ?? true,
        },
    });

    return {
        message: 'Đã tạo gói VIP mới',
        data: mapVipPackage(created),
    };
}

async function updateVipPackage(packageId, payload) {
    if (!isUuid(packageId)) {
        throw Object.assign(new Error('packageId không hợp lệ'), { statusCode: 400 });
    }

    const updateData = parseVipPackagePayload(payload, { partial: true });
    if (Object.keys(updateData).length === 0) {
        throw Object.assign(new Error('Không có dữ liệu cập nhật'), { statusCode: 400 });
    }

    const existing = await prisma.vip_packages.findUnique({ where: { id: packageId } });
    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy gói VIP'), { statusCode: 404 });
    }

    const updated = await prisma.vip_packages.update({
        where: { id: packageId },
        data: updateData,
    });

    return {
        message: 'Đã cập nhật gói VIP',
        data: mapVipPackage(updated),
    };
}

async function getVipPurchases(params) {
    const page = toPositiveInt(params?.page, 1, 1, 100000);
    const limit = toPositiveInt(params?.limit, 20, 1, 200);
    const skip = (page - 1) * limit;

    const status = typeof params?.status === 'string' ? params.status.trim().toUpperCase() : '';
    const refundStatus =
        typeof params?.refundStatus === 'string' ? params.refundStatus.trim().toUpperCase() : '';
    const userId = typeof params?.userId === 'string' ? params.userId.trim() : '';
    const packageId = typeof params?.packageId === 'string' ? params.packageId.trim() : '';
    const search = typeof params?.search === 'string' ? params.search.trim() : '';
    const createdFrom = parseDateInput(params?.createdFrom);
    const createdTo = parseDateInput(params?.createdTo);

    if (userId && !isUuid(userId)) {
        throw Object.assign(new Error('userId không hợp lệ'), { statusCode: 400 });
    }
    if (packageId && !isUuid(packageId)) {
        throw Object.assign(new Error('packageId không hợp lệ'), { statusCode: 400 });
    }

    const where = {
        purpose: 'VIP_PURCHASE',
    };

    if (status) where.status = status;
    if (refundStatus) where.vnp_refund_status = refundStatus;
    if (userId) where.user_id = userId;
    if (packageId) where.ref_id = packageId;
    if (createdFrom || createdTo) {
        where.created_at = {};
        if (createdFrom) where.created_at.gte = createdFrom;
        if (createdTo) where.created_at.lte = createdTo;
    }
    if (search) {
        where.OR = [
            {
                users_payment_orders_user_idTousers: {
                    fullName: { contains: search, mode: 'insensitive' },
                },
            },
            {
                users_payment_orders_user_idTousers: {
                    email: { contains: search, mode: 'insensitive' },
                },
            },
            { vnp_txn_ref: { contains: search, mode: 'insensitive' } },
        ];
    }

    const [rows, total, revenueAgg, refundAgg, activeVipUsers] = await Promise.all([
        prisma.payment_orders.findMany({
            where,
            skip,
            take: limit,
            orderBy: { created_at: 'desc' },
            include: {
                users_payment_orders_user_idTousers: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        role: true,
                        isVip: true,
                        vip_expires_at: true,
                    },
                },
            },
        }),
        prisma.payment_orders.count({ where }),
        prisma.payment_orders.aggregate({
            where: {
                ...where,
                status: 'SUCCESS',
            },
            _sum: { amount: true },
        }),
        prisma.payment_orders.aggregate({
            where: {
                ...where,
                vnp_refund_status: 'SUCCESS',
            },
            _count: true,
        }),
        prisma.user.count({
            where: {
                isVip: true,
            },
        }),
    ]);

    const packageIds = Array.from(new Set(rows.map((item) => item.ref_id).filter(Boolean)));
    const packageRows = packageIds.length
        ? await prisma.vip_packages.findMany({ where: { id: { in: packageIds } } })
        : [];
    const packageMap = new Map(packageRows.map((item) => [item.id, item]));

    return {
        data: rows.map((item) => mapVipPurchaseOrder(item, packageMap)),
        summary: {
            revenueSuccessAmount: Number(revenueAgg._sum.amount || 0),
            refundSuccessCount: refundAgg._count,
            activeVipUsers,
        },
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

function generateRefundTxnRef(orderId) {
    const compactOrder = String(orderId || '').replace(/-/g, '').slice(-8).toUpperCase();
    return `VIPRF${Date.now()}${compactOrder}`.slice(0, 50);
}

function normalizeVipRefundReason(payload) {
    const reasonCode = String(payload?.reasonCode || '').trim().toUpperCase();
    if (!VIP_REFUND_REASON_CODES.has(reasonCode)) {
        throw Object.assign(
            new Error(
                `reasonCode không hợp lệ. Hỗ trợ: ${Array.from(VIP_REFUND_REASON_CODES).join(', ')}`
            ),
            { statusCode: 400 }
        );
    }

    const reason = String(payload?.reason || '').trim();
    if (reason.length < VIP_REFUND_MIN_REASON_LENGTH) {
        throw Object.assign(
            new Error(`Lý do hoàn tiền tối thiểu ${VIP_REFUND_MIN_REASON_LENGTH} ký tự`),
            { statusCode: 400 }
        );
    }

    if (reasonCode === 'OTHER' && reason.length < 20) {
        throw Object.assign(new Error('reasonCode OTHER yêu cầu mô tả tối thiểu 20 ký tự'), {
            statusCode: 400,
        });
    }

    const combinedReason = `[${reasonCode}] ${reason}`;
    if (combinedReason.length > 200) {
        throw Object.assign(new Error('Lý do hoàn tiền quá dài (tối đa 200 ký tự)'), {
            statusCode: 400,
        });
    }

    return {
        reasonCode,
        reason,
        combinedReason,
    };
}

function assertVipRefundWithinWindow(orderCreatedAt) {
    const createdAt = orderCreatedAt ? new Date(orderCreatedAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
        throw Object.assign(new Error('Giao dịch thiếu thời điểm tạo để kiểm tra policy hoàn tiền'), {
            statusCode: 400,
        });
    }

    const deadline = new Date(createdAt.getTime() + VIP_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (Date.now() > deadline.getTime()) {
        throw Object.assign(
            new Error(`Đã quá thời hạn hoàn tiền ${VIP_REFUND_WINDOW_DAYS} ngày theo policy`),
            { statusCode: 409 }
        );
    }
}

async function refundVipPurchase(orderId, payload, adminId) {
    if (!isUuid(orderId)) {
        throw Object.assign(new Error('orderId không hợp lệ'), { statusCode: 400 });
    }

    const requestedAmount = payload?.amount != null ? Number(payload.amount) : null;
    const revokeVip = Boolean(payload?.revokeVip);
    const reasonPolicy = normalizeVipRefundReason(payload);

    const result = await prisma.$transaction(async (tx) => {
        const order = await tx.payment_orders.findUnique({
            where: { id: orderId },
            include: {
                users_payment_orders_user_idTousers: {
                    select: {
                        id: true,
                        isVip: true,
                        vip_expires_at: true,
                    },
                },
            },
        });

        if (!order) {
            throw Object.assign(new Error('Không tìm thấy giao dịch VIP'), { statusCode: 404 });
        }

        if (order.purpose !== 'VIP_PURCHASE') {
            throw Object.assign(new Error('Giao dịch không phải VIP_PURCHASE'), { statusCode: 400 });
        }

        if (order.status !== 'SUCCESS') {
            throw Object.assign(new Error('Chỉ hoàn tiền cho giao dịch VIP đã thành công'), {
                statusCode: 400,
            });
        }

        assertVipRefundWithinWindow(order.created_at);

        if (order.vnp_refund_status === 'SUCCESS' || order.refund_completed_at) {
            throw Object.assign(new Error('Giao dịch này đã được hoàn tiền trước đó'), {
                statusCode: 409,
            });
        }

        const totalAmount = Number(order.amount || 0);
        const refundAmount =
            requestedAmount == null || Number.isNaN(requestedAmount) ? totalAmount : requestedAmount;

        if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > totalAmount) {
            throw Object.assign(new Error('Số tiền hoàn không hợp lệ'), { statusCode: 400 });
        }

        const now = new Date();
        const updatedCount = await tx.payment_orders.updateMany({
            where: {
                id: order.id,
                purpose: 'VIP_PURCHASE',
                status: 'SUCCESS',
                OR: [{ vnp_refund_status: null }, { vnp_refund_status: { not: 'SUCCESS' } }],
            },
            data: {
                vnp_refund_status: 'SUCCESS',
                vnp_refund_txn_ref: generateRefundTxnRef(order.id),
                vnp_refund_trans_no: `MANUAL-${Date.now()}`.slice(0, 50),
                refund_amount: refundAmount,
                refund_reason: reasonPolicy.combinedReason,
                refund_requested_at: now,
                refund_completed_at: now,
                refund_requested_by: adminId,
                updated_at: now,
            },
        });

        if (updatedCount.count === 0) {
            throw Object.assign(new Error('Giao dịch đã được xử lý hoàn tiền trước đó'), {
                statusCode: 409,
            });
        }

        if (revokeVip) {
            await tx.user.update({
                where: { id: order.user_id },
                data: {
                    isVip: false,
                    vip_expires_at: null,
                },
            });
        }

        await tx.notification.create({
            data: {
                userId: order.user_id,
                type: 'PAYMENT',
                status: 'UNREAD',
                title: 'Giao dịch VIP đã được hoàn tiền',
                body: `Giao dịch VIP ${order.vnp_txn_ref} đã được hoàn ${refundAmount.toLocaleString('vi-VN')} VND. Lý do: ${reasonPolicy.combinedReason}`,
            },
        });

        const latestOrder = await tx.payment_orders.findUnique({ where: { id: order.id } });
        return {
            order: latestOrder,
            revokeVip,
        };
    });

    return {
        message: 'Hoàn tiền giao dịch VIP thành công',
        data: {
            orderId,
            refundStatus: result.order?.vnp_refund_status || 'SUCCESS',
            refundAmount: result.order?.refund_amount != null ? Number(result.order.refund_amount) : null,
            refundReason: result.order?.refund_reason || null,
            refundCompletedAt: result.order?.refund_completed_at || null,
            revokeVip: result.revokeVip,
        },
    };
}

module.exports = {
    getAllWallets,
    getWalletTransactions,
    getWalletStats,
    getPendingWithdrawalQueue,
    approveWalletWithdrawal,
    rejectWalletWithdrawal,
    approveWalletWithdrawalsBatch,
    rejectWalletWithdrawalsBatch,
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    getDashboardStats,
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
};
