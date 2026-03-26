const prisma = require('../config/prisma');
const { publishPendingRoomsWhenRentalAvailable } = require('./sync-rental-rooms-on-approve');

const VALID_RENTAL_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'HIDDEN', 'VIOLATE', 'PENDING', 'SUSPEND'];

/**
 * Lấy danh sách tất cả bài đăng cho Admin/Moderator
 */
async function getAllRentals(params) {
    const { page = 1, limit = 10, status, ownerId, search, city } = params;
    const skip = (page - 1) * limit;
    const where = {};

    if (status && VALID_RENTAL_STATUSES.includes(status.toUpperCase())) {
        where.status = status.toUpperCase();
    }
    if (ownerId) where.owner_id = ownerId;
    if (search) {
        where.OR = [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
        ];
    }
    if (city) {
        where.location = {
            city: { contains: city, mode: 'insensitive' },
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

    const data = rentals.map((r) => ({
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

    return {
        data,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Lấy chi tiết một bài đăng
 */
async function getRentalById(id) {
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
                    images: { select: { id: true, imageUrl: true } },
                    roomAmenities: {
                        include: {
                            amenity: { select: { id: true, name: true } },
                        },
                    },
                    preorders: {
                        select: {
                            id: true,
                            status: true,
                            payment_status: true,
                            createdAt: true,
                            user: {
                                select: { id: true, fullName: true, email: true },
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
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    const rooms = rental.rooms.map((room) => ({
        ...room,
        amenities: room.roomAmenities.map((ra) => ra.amenity),
        roomAmenities: undefined,
    }));

    return {
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
    };
}

/**
 * Thay đổi trạng thái bài đăng
 */
async function updateRentalStatus(id, body, moderatorId) {
    const { status, reason } = body;

    if (!status || !VALID_RENTAL_STATUSES.includes(status.toUpperCase())) {
        throw Object.assign(
            new Error(`Status không hợp lệ. Các status hợp lệ: ${VALID_RENTAL_STATUSES.join(', ')}`),
            { statusCode: 400 }
        );
    }

    const newStatus = status.toUpperCase();

    const existing = await prisma.rental.findUnique({
        where: { id },
        include: {
            users: { select: { id: true, fullName: true, email: true } },
        },
    });

    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    const rental = await prisma.$transaction(async (tx) => {
        const updated = await tx.rental.update({
            where: { id },
            data: { status: newStatus },
            select: { id: true, title: true, status: true },
        });
        if (newStatus === 'AVAILABLE') {
            await publishPendingRoomsWhenRentalAvailable(id, tx);
        }
        return updated;
    });

    console.log(
        `[RENTAL_STATUS] Moderator ${moderatorId} changed rental ${id} status to ${newStatus}. Reason: ${reason || 'N/A'}`
    );

    const statusMessages = {
        AVAILABLE: 'hiển thị',
        UNAVAILABLE: 'tạm ngưng',
        HIDDEN: 'ẩn',
        VIOLATE: 'đánh dấu vi phạm',
        PENDING: 'chờ duyệt',
        SUSPEND: 'tạm khóa',
    };

    return {
        message: `Đã ${statusMessages[newStatus] || newStatus.toLowerCase()} bài đăng "${rental.title}"`,
        data: rental,
    };
}

/**
 * Xóa vĩnh viễn bài đăng (Admin only)
 */
async function deleteRental(id, adminId) {
    const existing = await prisma.rental.findUnique({
        where: { id },
        include: {
            users: { select: { id: true, fullName: true } },
            rooms: {
                include: {
                    preorders: {
                        where: { status: { in: ['PENDING', 'CONFIRMED'] } },
                    },
                },
            },
        },
    });

    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    const activePreorders = existing.rooms.flatMap((r) => r.preorders);
    if (activePreorders.length > 0) {
        throw Object.assign(
            new Error(`Không thể xóa vì có ${activePreorders.length} đơn đặt cọc đang hoạt động`),
            { statusCode: 409 }
        );
    }

    await prisma.rental.delete({ where: { id } });

    console.log(
        `[RENTAL_DELETE] Admin ${adminId} deleted rental ${id} "${existing.title}" owned by ${existing.users.fullName}`
    );

    return { message: `Đã xóa bài đăng "${existing.title}"` };
}

/**
 * Thống kê bài đăng
 */
async function getRentalStats() {
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

    return {
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
    };
}

module.exports = {
    getAllRentals,
    getRentalById,
    updateRentalStatus,
    deleteRental,
    getRentalStats,
};
