const prisma = require('../config/prisma');

// Các role hợp lệ trong hệ thống
const VALID_ROLES = ['ADMIN', 'LANDLORD', 'TENANT', 'GUEST', 'MODERATOR'];

// ==================== WALLETS (READ-ONLY) ====================

/**
 * GET /admin/wallets
 * Lấy danh sách ví (phân trang, filter)
 * Query: ?page=1&limit=10&search=keyword&minBalance=0&maxBalance=999999
 */
async function getAllWallets(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = {};

        // Filter by user search (name/email)
        if (req.query.search) {
            where.user = {
                OR: [
                    { fullName: { contains: req.query.search, mode: 'insensitive' } },
                    { email: { contains: req.query.search, mode: 'insensitive' } },
                ],
            };
        }

        // Filter by balance range
        if (req.query.minBalance || req.query.maxBalance) {
            where.balance = {};
            if (req.query.minBalance) where.balance.gte = parseFloat(req.query.minBalance);
            if (req.query.maxBalance) where.balance.lte = parseFloat(req.query.maxBalance);
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

        return res.json({
            success: true,
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
        });
    } catch (err) {
        console.error('Get all wallets error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách ví',
            error: err.message,
        });
    }
}

/**
 * GET /admin/wallets/:walletId/transactions
 * Lấy lịch sử giao dịch của một ví (READ-ONLY)
 * Query: ?page=1&limit=20&type=DEPOSIT&status=SUCCESS
 */
async function getWalletTransactions(req, res) {
    try {
        const { walletId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // Check wallet exists
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
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy ví',
            });
        }

        const where = { walletId };

        if (req.query.type) {
            where.transaction_type = req.query.type.toUpperCase();
        }
        if (req.query.status) {
            where.status = req.query.status.toUpperCase();
        }

        const [transactions, total] = await Promise.all([
            prisma.walletTransaction.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.walletTransaction.count({ where }),
        ]);

        return res.json({
            success: true,
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
        });
    } catch (err) {
        console.error('Get wallet transactions error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy giao dịch ví',
            error: err.message,
        });
    }
}

/**
 * GET /admin/wallets/stats
 * Thống kê tổng quan ví
 */
async function getWalletStats(req, res) {
    try {
        const [totalWallets, aggregation, txByType, txByStatus] = await Promise.all([
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
        ]);

        return res.json({
            success: true,
            data: {
                totalWallets,
                totalBalance: aggregation._sum.balance || 0,
                avgBalance: aggregation._avg.balance || 0,
                maxBalance: aggregation._max.balance || 0,
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
        });
    } catch (err) {
        console.error('Get wallet stats error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thống kê ví',
            error: err.message,
        });
    }
}

/**
 * GET /admin/users
 * Lấy danh sách tất cả users (có phân trang)
 * Query: ?page=1&limit=10&role=TENANT&search=keyword
 */
async function getAllUsers(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Filters
        const where = {};

        if (req.query.role && VALID_ROLES.includes(req.query.role.toUpperCase())) {
            where.role = req.query.role.toUpperCase();
        }

        if (req.query.status) {
            where.status = req.query.status.toUpperCase();
        }

        if (req.query.search) {
            where.OR = [
                { fullName: { contains: req.query.search, mode: 'insensitive' } },
                { email: { contains: req.query.search, mode: 'insensitive' } },
                { phone: { contains: req.query.search } },
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

        return res.json({
            success: true,
            data: users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get all users error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách người dùng',
            error: err.message,
        });
    }
}

/**
 * GET /admin/users/:userId
 * Lấy thông tin chi tiết một user
 */
async function getUserById(req, res) {
    try {
        const { userId } = req.params;

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
                // isVip: true, // Field not in Prisma schema yet
                createdAt: true,
                updated_at: true,
                // Wallet info (read-only)
                wallet: {
                    select: {
                        id: true,
                        balance: true,
                        created_at: true,
                    },
                },
                // Landlord-specific: rentals summary
                rentals: {
                    select: {
                        id: true,
                        title: true,
                        status: true,
                        createdAt: true,
                        rooms: {
                            select: { id: true },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 20,
                },
                // Lifestyle profile
                lifestyleProfile: {
                    select: {
                        id: true,
                        // occupation_type: true, // Field not recognized by current Prisma client
                        personalityType: true,
                        created_at: true,
                    },
                },
                // User preferences
                preference: {
                    select: {
                        id: true,
                        budget_min: true,
                        budget_max: true,
                        preferredLocation: true,
                        // room_type: true,
                        preferred_gender: true,
                        created_at: true,
                    },
                },
                // Favorites count
                favoriteRooms: {
                    select: { roomId: true },
                },
                // Preorders
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
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng',
            });
        }

        // Build a rich response
        const response = {
            ...user,
            stats: {
                totalRentals: user.rentals.length,
                totalFavorites: user.favoriteRooms.length,
                totalPreorders: user.preorders.length,
            },
        };
        // Clean up arrays from top level for cleanliness
        delete response.favoriteRooms;

        return res.json({
            success: true,
            data: response,
        });
    } catch (err) {
        console.error('Get user by id error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thông tin người dùng',
            error: err.message,
        });
    }
}

/**
 * PATCH /admin/users/:userId/role
 * Thay đổi role của một user
 * Body: { role: 'LANDLORD' }
 */
async function updateUserRole(req, res) {
    try {
        const { userId } = req.params;
        const { role } = req.body;
        const adminId = req.auth.user.id;

        // Validate role
        if (!role || !VALID_ROLES.includes(role.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Role không hợp lệ. Các role hợp lệ: ${VALID_ROLES.join(', ')}`,
            });
        }

        const newRole = role.toUpperCase();

        // Không cho phép tự thay đổi role của chính mình
        if (userId === adminId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không thể thay đổi role của chính mình',
            });
        }

        // Kiểm tra user tồn tại
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, fullName: true, email: true, role: true },
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng',
            });
        }

        // Không cho phép thay đổi role của ADMIN khác (bảo vệ admin)
        if (existingUser.role === 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Không thể thay đổi role của Admin khác',
            });
        }

        // Update role
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                role: newRole,
                updated_at: new Date(),
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                status: true,
            },
        });

        return res.json({
            success: true,
            message: `Đã cập nhật role của "${updatedUser.fullName}" thành ${newRole}`,
            data: updatedUser,
        });
    } catch (err) {
        console.error('Update user role error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật role người dùng',
            error: err.message,
        });
    }
}

/**
 * PATCH /admin/users/:userId/status
 * Thay đổi status của một user (ACTIVE, INACTIVE, SUSPENDED, BANNED)
 * Body: { status: 'SUSPENDED' }
 */
async function updateUserStatus(req, res) {
    try {
        const { userId } = req.params;
        const { status } = req.body;
        const adminId = req.auth.user.id;

        const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'];

        if (!status || !VALID_STATUSES.includes(status.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Status không hợp lệ. Các status hợp lệ: ${VALID_STATUSES.join(', ')}`,
            });
        }

        const newStatus = status.toUpperCase();

        // Không cho phép tự thay đổi status của chính mình
        if (userId === adminId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không thể thay đổi status của chính mình',
            });
        }

        // Kiểm tra user tồn tại
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, fullName: true, role: true },
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng',
            });
        }

        // Không cho phép ban ADMIN khác
        if (existingUser.role === 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Không thể thay đổi status của Admin khác',
            });
        }

        // Update status
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                status: newStatus,
                updated_at: new Date(),
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                status: true,
            },
        });

        return res.json({
            success: true,
            message: `Đã cập nhật status của "${updatedUser.fullName}" thành ${newStatus}`,
            data: updatedUser,
        });
    } catch (err) {
        console.error('Update user status error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật status người dùng',
            error: err.message,
        });
    }
}

/**
 * GET /admin/stats
 * Thống kê tổng quan cho admin dashboard
 */
async function getDashboardStats(req, res) {
    try {
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

        return res.json({
            success: true,
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
                rentals: {
                    total: totalRentals,
                },
                rooms: {
                    total: totalRooms,
                },
                wallets: {
                    total: totalWallets,
                    totalBalance: walletAggr._sum.balance || 0,
                },
                feedback: {
                    total: totalFeedback,
                },
                preorders: {
                    total: totalPreorders,
                },
            },
        });
    } catch (err) {
        console.error('Get dashboard stats error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thống kê',
            error: err.message,
        });
    }
}

module.exports = {
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    getDashboardStats,
    getAllWallets,
    getWalletTransactions,
    getWalletStats,
};
