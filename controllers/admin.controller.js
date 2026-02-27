const prisma = require('../config/prisma');

// Các role hợp lệ trong hệ thống
const VALID_ROLES = ['ADMIN', 'LANDLORD', 'TENANT', 'GUEST', 'MODERATOR'];

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
                createdAt: true,
                updated_at: true,
            },
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy người dùng',
            });
        }

        return res.json({
            success: true,
            data: user,
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
        ] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { role: 'ADMIN' } }),
            prisma.user.count({ where: { role: 'LANDLORD' } }),
            prisma.user.count({ where: { role: 'TENANT' } }),
            prisma.user.count({ where: { role: 'MODERATOR' } }),
            prisma.user.count({ where: { status: 'ACTIVE' } }),
            prisma.user.count({ where: { status: 'BANNED' } }),
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
};
