const prisma = require('../config/prisma');

const VALID_RENTAL_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'HIDDEN', 'VIOLATE', 'PENDING', 'SUSPEND'];

/**
 * GET /rentals (Admin/Moderator)
 * Lấy danh sách tất cả bài đăng cho thuê
 * Query: ?page=1&limit=10&status=AVAILABLE&ownerId=xxx&search=keyword
 */
async function getAllRentals(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = {};

        // Filter by status
        if (req.query.status && VALID_RENTAL_STATUSES.includes(req.query.status.toUpperCase())) {
            where.status = req.query.status.toUpperCase();
        }

        // Filter by owner
        if (req.query.ownerId) {
            where.owner_id = req.query.ownerId;
        }

        // Search by title or description
        if (req.query.search) {
            where.OR = [
                { title: { contains: req.query.search, mode: 'insensitive' } },
                { description: { contains: req.query.search, mode: 'insensitive' } },
            ];
        }

        // Filter by city
        if (req.query.city) {
            where.location = {
                city: { contains: req.query.city, mode: 'insensitive' },
            };
        }

        const [rentals, total] = await Promise.all([
            prisma.rental.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    status: true,
                    createdAt: true,
                    owner_id: true,
                    users: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            phone: true,
                        },
                    },
                    location: {
                        select: {
                            id: true,
                            address: true,
                            district: true,
                            city: true,
                        },
                    },
                    rooms: {
                        select: {
                            id: true,
                            room_name: true,
                            price: true,
                            room_type: true,
                        },
                    },
                },
            }),
            prisma.rental.count({ where }),
        ]);

        // Transform data
        const data = rentals.map(r => ({
            id: r.id,
            title: r.title,
            description: r.description,
            status: r.status,
            createdAt: r.createdAt,
            owner: r.users,
            location: r.location,
            roomCount: r.rooms.length,
            rooms: r.rooms,
        }));

        return res.json({
            success: true,
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get all rentals error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách bài đăng',
            error: err.message,
        });
    }
}

/**
 * GET /rentals/:id (Admin/Moderator)
 * Lấy chi tiết một bài đăng
 */
async function getRentalById(req, res) {
    try {
        const { id } = req.params;

        const rental = await prisma.rental.findUnique({
            where: { id },
            include: {
                users: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        avatarUrl: true,
                        status: true,
                    },
                },
                location: true,
                rooms: {
                    include: {
                        images: {
                            select: {
                                id: true,
                                imageUrl: true,
                            },
                        },
                        roomAmenities: {
                            include: {
                                amenity: {
                                    select: {
                                        id: true,
                                        name: true,
                                    },
                                },
                            },
                        },
                        preorders: {
                            select: {
                                id: true,
                                status: true,
                                payment_status: true,
                                createdAt: true,
                                user: {
                                    select: {
                                        id: true,
                                        fullName: true,
                                        email: true,
                                    },
                                },
                            },
                            orderBy: { createdAt: 'desc' },
                            take: 5,
                        },
                    },
                },
            },
        });

        if (!rental) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài đăng',
            });
        }

        // Transform rooms data
        const rooms = rental.rooms.map(room => ({
            ...room,
            amenities: room.roomAmenities.map(ra => ra.amenity),
            roomAmenities: undefined,
        }));

        return res.json({
            success: true,
            data: {
                id: rental.id,
                title: rental.title,
                description: rental.description,
                status: rental.status,
                createdAt: rental.createdAt,
                owner: rental.users,
                location: rental.location,
                rooms,
            },
        });
    } catch (err) {
        console.error('Get rental by id error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thông tin bài đăng',
            error: err.message,
        });
    }
}

/**
 * PATCH /rentals/:id/status (Admin/Moderator)
 * Thay đổi trạng thái bài đăng (ẩn/hiện/lưu trữ)
 * Body: { status: 'HIDDEN' | 'AVAILABLE' | 'ARCHIVED' }
 */
async function updateRentalStatus(req, res) {
    try {
        const { id } = req.params;
        const { status, reason } = req.body;
        const moderatorId = req.auth.user.id;

        // Validate status
        if (!status || !VALID_RENTAL_STATUSES.includes(status.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Status không hợp lệ. Các status hợp lệ: ${VALID_RENTAL_STATUSES.join(', ')}`,
            });
        }

        const newStatus = status.toUpperCase();

        // Check rental exists
        const existing = await prisma.rental.findUnique({
            where: { id },
            include: {
                users: {
                    select: { id: true, fullName: true, email: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài đăng',
            });
        }

        // Update status
        const rental = await prisma.rental.update({
            where: { id },
            data: { status: newStatus },
            select: {
                id: true,
                title: true,
                status: true,
            },
        });

        // Log action (có thể thêm bảng audit_log sau)
        console.log(`[RENTAL_STATUS] Moderator ${moderatorId} changed rental ${id} status to ${newStatus}. Reason: ${reason || 'N/A'}`);

        // TODO: Gửi notification cho chủ trọ nếu bị ẩn/khóa/vi phạm
        if (['HIDDEN', 'VIOLATE', 'SUSPEND'].includes(newStatus)) {
            // await notifyOwner(existing.users.id, `Bài đăng "${existing.title}" đã bị thay đổi trạng thái. Lý do: ${reason || 'Vi phạm quy định'}`);
        }

        const statusMessages = {
            AVAILABLE: 'hiển thị',
            UNAVAILABLE: 'tạm ngưng',
            HIDDEN: 'ẩn',
            VIOLATE: 'đánh dấu vi phạm',
            PENDING: 'chờ duyệt',
            SUSPEND: 'tạm khóa',
        };

        return res.json({
            success: true,
            message: `Đã ${statusMessages[newStatus] || newStatus.toLowerCase()} bài đăng "${rental.title}"`,
            data: rental,
        });
    } catch (err) {
        console.error('Update rental status error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật trạng thái bài đăng',
            error: err.message,
        });
    }
}

/**
 * DELETE /rentals/:id (Admin only)
 * Xóa vĩnh viễn bài đăng
 */
async function deleteRental(req, res) {
    try {
        const { id } = req.params;
        const adminId = req.auth.user.id;

        // Check rental exists
        const existing = await prisma.rental.findUnique({
            where: { id },
            include: {
                users: {
                    select: { id: true, fullName: true },
                },
                rooms: {
                    include: {
                        preorders: {
                            where: {
                                status: { in: ['PENDING', 'CONFIRMED'] },
                            },
                        },
                    },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài đăng',
            });
        }

        // Check if any room has active preorders
        const activePreorders = existing.rooms.flatMap(r => r.preorders);
        if (activePreorders.length > 0) {
            return res.status(409).json({
                success: false,
                message: `Không thể xóa vì có ${activePreorders.length} đơn đặt cọc đang hoạt động`,
            });
        }

        // Delete rental (cascade will delete rooms, images, etc.)
        await prisma.rental.delete({
            where: { id },
        });

        console.log(`[RENTAL_DELETE] Admin ${adminId} deleted rental ${id} "${existing.title}" owned by ${existing.users.fullName}`);

        return res.json({
            success: true,
            message: `Đã xóa bài đăng "${existing.title}"`,
        });
    } catch (err) {
        console.error('Delete rental error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa bài đăng',
            error: err.message,
        });
    }
}

/**
 * GET /rentals/stats (Admin/Moderator)
 * Thống kê bài đăng
 */
async function getRentalStats(req, res) {
    try {
        const [
            total,
            available,
            unavailable,
            hidden,
            violate,
            pending,
            suspend,
            thisMonth,
        ] = await Promise.all([
            prisma.rental.count(),
            prisma.rental.count({ where: { status: 'AVAILABLE' } }),
            prisma.rental.count({ where: { status: 'UNAVAILABLE' } }),
            prisma.rental.count({ where: { status: 'HIDDEN' } }),
            prisma.rental.count({ where: { status: 'VIOLATE' } }),
            prisma.rental.count({ where: { status: 'PENDING' } }),
            prisma.rental.count({ where: { status: 'SUSPEND' } }),
            prisma.rental.count({
                where: {
                    createdAt: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                    },
                },
            }),
        ]);

        // Top cities
        const topCities = await prisma.rental.groupBy({
            by: ['locationId'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 5,
        });

        return res.json({
            success: true,
            data: {
                total,
                byStatus: {
                    available,
                    unavailable,
                    hidden,
                    violate,
                    pending,
                    suspend,
                },
                thisMonth,
            },
        });
    } catch (err) {
        console.error('Get rental stats error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thống kê',
            error: err.message,
        });
    }
}

module.exports = {
    getAllRentals,
    getRentalById,
    updateRentalStatus,
    deleteRental,
    getRentalStats,
};
