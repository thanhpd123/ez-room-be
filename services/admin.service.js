const prisma = require('../config/prisma');

const VALID_ROLES = ['ADMIN', 'LANDLORD', 'TENANT', 'GUEST', 'MODERATOR'];
const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'];

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

module.exports = {
    getAllWallets,
    getWalletTransactions,
    getWalletStats,
    approveWalletWithdrawal,
    rejectWalletWithdrawal,
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    getDashboardStats,
};
