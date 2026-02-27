const prisma = require('../config/prisma');
const { validateCreateRental, validateUpdateRentalStatus } = require('../validators/rental.validator');

/**
 * POST /rentals
 * Tạo rental mới (LANDLORD). Status mặc định = pending (chờ duyệt).
 * Body: { title, description?, city, district, address, images?: string[] }
 */
async function createRental(req, res) {
    try {
        const { valid, errors } = validateCreateRental(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const ownerId = req.auth.user.id;
        const { title, description, city, district, address, images } = req.body;

        // 1. Tạo hoặc tìm Location
        let location = await prisma.location.findFirst({
            where: {
                address: address.trim(),
                district: district.trim(),
                city: city.trim(),
            },
        });

        if (!location) {
            location = await prisma.location.create({
                data: {
                    address: address.trim(),
                    district: district.trim(),
                    city: city.trim(),
                },
            });
        }

        // 2. Tạo Rental với status = pending
        const rental = await prisma.rental.create({
            data: {
                owner_id: ownerId,
                locationId: location.id,
                title: title.trim(),
                description: description ? description.trim() : null,
                status: 'PENDING',
                // Tạo images nếu có
                ...(images && images.length > 0 ? {
                    images: {
                        create: images.map((url) => ({ imageUrl: url })),
                    },
                } : {}),
            },
            include: {
                location: true,
                images: true,
            },
        });

        return res.status(201).json({
            success: true,
            message: 'Tạo bài đăng thành công. Đang chờ duyệt.',
            data: {
                id: rental.id,
                title: rental.title,
                description: rental.description,
                status: rental.status,
                createdAt: rental.createdAt,
                location: rental.location ? {
                    id: rental.location.id,
                    address: rental.location.address,
                    district: rental.location.district,
                    city: rental.location.city,
                } : null,
                images: (rental.images || []).map((img) => img.imageUrl),
            },
        });
    } catch (err) {
        console.error('Create rental error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tạo bài đăng',
            error: err.message,
        });
    }
}

/**
 * GET /rentals
 * Lấy danh sách rentals (có phân trang, filter).
 * Query: ?page=1&limit=10&status=AVAILABLE&search=keyword
 */
async function getRentals(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = {};

        // Filter by status
        if (req.query.status) {
            where.status = req.query.status;
        }

        // Filter by owner (nếu là landlord xem của mình)
        if (req.query.owner_id) {
            where.owner_id = req.query.owner_id;
        }

        // Search by title
        if (req.query.search) {
            where.title = { contains: req.query.search, mode: 'insensitive' };
        }

        const [rentals, total] = await Promise.all([
            prisma.rental.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    location: true,
                    images: true,
                    users: {
                        select: {
                            id: true,
                            fullName: true,
                            avatarUrl: true,
                        },
                    },
                },
            }),
            prisma.rental.count({ where }),
        ]);

        return res.json({
            success: true,
            data: rentals.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description,
                status: r.status,
                createdAt: r.createdAt,
                owner: r.users ? {
                    id: r.users.id,
                    fullName: r.users.fullName,
                    avatarUrl: r.users.avatarUrl,
                } : null,
                location: r.location ? {
                    id: r.location.id,
                    address: r.location.address,
                    district: r.location.district,
                    city: r.location.city,
                } : null,
                images: (r.images || []).map((img) => img.imageUrl),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get rentals error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách bài đăng',
            error: err.message,
        });
    }
}

/**
 * GET /rentals/:rentalId
 * Lấy chi tiết một rental
 */
async function getRentalById(req, res) {
    try {
        const { rentalId } = req.params;

        const rental = await prisma.rental.findUnique({
            where: { id: rentalId },
            include: {
                location: true,
                images: true,
                users: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                        email: true,
                        phone: true,
                    },
                },
                rooms: true,
            },
        });

        if (!rental) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài đăng',
            });
        }

        return res.json({
            success: true,
            data: {
                id: rental.id,
                title: rental.title,
                description: rental.description,
                status: rental.status,
                createdAt: rental.createdAt,
                owner: rental.users ? {
                    id: rental.users.id,
                    fullName: rental.users.fullName,
                    avatarUrl: rental.users.avatarUrl,
                    email: rental.users.email,
                    phone: rental.users.phone,
                } : null,
                location: rental.location ? {
                    id: rental.location.id,
                    address: rental.location.address,
                    district: rental.location.district,
                    city: rental.location.city,
                } : null,
                rooms: rental.rooms || [],
                images: (rental.images || []).map((img) => img.imageUrl),
            },
        });
    } catch (err) {
        console.error('Get rental by id error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy chi tiết bài đăng',
            error: err.message,
        });
    }
}

/**
 * GET /rentals/my-rentals
 * Lấy danh sách rentals của user đang đăng nhập (LANDLORD)
 */
async function getMyRentals(req, res) {
    try {
        const ownerId = req.auth.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = { owner_id: ownerId };

        if (req.query.status) {
            where.status = req.query.status;
        }

        const [rentals, total] = await Promise.all([
            prisma.rental.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { location: true, images: true },
            }),
            prisma.rental.count({ where }),
        ]);

        return res.json({
            success: true,
            data: rentals.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description,
                status: r.status,
                createdAt: r.createdAt,
                location: r.location ? {
                    id: r.location.id,
                    address: r.location.address,
                    district: r.location.district,
                    city: r.location.city,
                } : null,
                images: (r.images || []).map((img) => img.imageUrl),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get my rentals error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách bài đăng của bạn',
            error: err.message,
        });
    }
}

/**
 * GET /rentals/moderation
 * Moderator/Admin lấy danh sách rentals để duyệt (có filter status, phân trang).
 * Query: ?page=1&limit=50&status=PENDING&search=keyword
 */
async function getRentalsForModeration(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const where = {};

        // Filter by status (mặc định không filter => lấy tất cả)
        if (req.query.status) {
            where.status = req.query.status;
        }

        // Search by title
        if (req.query.search) {
            where.title = { contains: req.query.search, mode: 'insensitive' };
        }

        const [rentals, total] = await Promise.all([
            prisma.rental.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    location: true,
                    images: true,
                    rooms: true,
                    users: {
                        select: {
                            id: true,
                            fullName: true,
                            avatarUrl: true,
                            email: true,
                            phone: true,
                        },
                    },
                },
            }),
            prisma.rental.count({ where }),
        ]);

        return res.json({
            success: true,
            data: rentals.map((r) => ({
                id: r.id,
                title: r.title,
                description: r.description,
                status: r.status,
                createdAt: r.createdAt,
                owner: r.users ? {
                    id: r.users.id,
                    fullName: r.users.fullName,
                    avatarUrl: r.users.avatarUrl,
                    email: r.users.email,
                    phone: r.users.phone,
                } : null,
                location: r.location ? {
                    id: r.location.id,
                    address: r.location.address,
                    district: r.location.district,
                    city: r.location.city,
                } : null,
                images: (r.images || []).map((img) => img.imageUrl),
                roomsCount: r.rooms ? r.rooms.length : 0,
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get rentals for moderation error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách bài đăng cho duyệt',
            error: err.message,
        });
    }
}

/**
 * PATCH /rentals/:rentalId/status
 * Moderator/Admin duyệt rental: đổi status (HIDDEN → AVAILABLE, etc.)
 * Body: { status: 'AVAILABLE' | 'HIDDEN' | ... }
 */
async function updateRentalStatus(req, res) {
    try {
        const { rentalId } = req.params;
        const { valid, errors } = validateUpdateRentalStatus(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const { status } = req.body;

        const existingRental = await prisma.rental.findUnique({
            where: { id: rentalId },
        });

        if (!existingRental) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy bài đăng',
            });
        }

        const updatedRental = await prisma.rental.update({
            where: { id: rentalId },
            data: { status },
            include: { location: true },
        });

        return res.json({
            success: true,
            message: `Đã cập nhật trạng thái bài đăng thành ${status}`,
            data: {
                id: updatedRental.id,
                title: updatedRental.title,
                status: updatedRental.status,
                location: updatedRental.location ? {
                    id: updatedRental.location.id,
                    address: updatedRental.location.address,
                    district: updatedRental.location.district,
                    city: updatedRental.location.city,
                } : null,
            },
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
 * GET /rentals/stats
 * Rental stats for admin dashboard. Requires MODERATOR or ADMIN.
 * Returns: total, byStatus (available, rented, hidden, archived), thisMonth
 */
async function getRentalStats(req, res) {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [
            total,
            available,
            unavailable,
            hidden,
            suspendedOrViolate,
            thisMonth,
        ] = await Promise.all([
            prisma.rental.count(),
            prisma.rental.count({ where: { status: 'AVAILABLE' } }),
            prisma.rental.count({ where: { status: 'UNAVAILABLE' } }),
            prisma.rental.count({ where: { status: 'HIDDEN' } }),
            prisma.rental.count({
                where: {
                    status: { in: ['SUSPEND', 'VIOLATE'] },
                },
            }),
            prisma.rental.count({
                where: { createdAt: { gte: startOfMonth } },
            }),
        ]);

        return res.json({
            success: true,
            data: {
                total,
                byStatus: {
                    available,
                    rented: unavailable,
                    hidden,
                    archived: suspendedOrViolate,
                },
                thisMonth,
            },
        });
    } catch (err) {
        console.error('Get rental stats error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thống kê bài đăng',
            error: err.message,
        });
    }
}

/**
 * GET (public) /public/rentals/:rentalId – Chi tiết một rental. No auth.
 */
async function getPublicRentalById(req, res) {
    try {
        let rentalId = req.params.rentalId ? String(req.params.rentalId).trim() : '';
        if (!rentalId) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu ID nhà trọ',
            });
        }
        // Normalize UUID to lowercase (PostgreSQL may return lowercase; comparison can be case-sensitive)
        rentalId = rentalId.toLowerCase();

        let rental = await prisma.rental.findUnique({
            where: { id: rentalId },
            include: {
                location: true,
                images: true,
                users: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                        email: true,
                        phone: true,
                    },
                },
                rooms: {
                    include: {
                        images: true,
                        roomAmenities: { include: { amenity: true } },
                    },
                },
            },
        });

        // Fallback: raw query in case Prisma UUID handling differs (e.g. driver returns id in different format)
        if (!rental) {
            const rawRows = await prisma.$queryRawUnsafe(
                'SELECT id FROM rentals WHERE id::text = $1 LIMIT 1',
                rentalId
            );
            if (rawRows && rawRows.length > 0) {
                const idFromDb = rawRows[0].id;
                const idStr = typeof idFromDb === 'string' ? idFromDb : String(idFromDb);
                rental = await prisma.rental.findUnique({
                    where: { id: idStr },
                    include: {
                        location: true,
                        images: true,
                        users: {
                            select: {
                                id: true,
                                fullName: true,
                                avatarUrl: true,
                                email: true,
                                phone: true,
                            },
                        },
                        rooms: {
                            include: {
                                images: true,
                                roomAmenities: { include: { amenity: true } },
                            },
                        },
                    },
                });
            }
        }

        if (!rental) {
            console.warn('[getPublicRentalById] 404 – rentalId not found:', rentalId);
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy nhà trọ',
                rentalId,
            });
        }

        const placeholderImage = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';
        const imgs = (rental.images || []).map((img) => img.imageUrl);

        const roomsWithDetails = (rental.rooms || []).map((r) => {
            const roomImgs = (r.images || []).map((img) => img.imageUrl);
            const amenityNames = (r.roomAmenities || []).map((ra) => ra.amenity?.name).filter(Boolean);
            return {
                id: r.id,
                rental_id: r.rental_id,
                room_name: r.room_name,
                room_type: r.room_type,
                price: Number(r.price),
                size_m2: r.size_m2 ? Number(r.size_m2) : null,
                max_people: r.max_people,
                images: roomImgs.length > 0 ? roomImgs : [placeholderImage],
                amenities: amenityNames,
            };
        });

        const allAmenityNames = [...new Set(roomsWithDetails.flatMap((r) => r.amenities || []))];

        return res.json({
            success: true,
            data: {
                id: rental.id,
                title: rental.title || '',
                description: rental.description ?? null,
                status: rental.status != null ? String(rental.status) : 'PENDING',
                createdAt: rental.createdAt,
                owner: rental.users ? {
                    id: rental.users.id,
                    fullName: rental.users.fullName,
                    avatarUrl: rental.users.avatarUrl,
                    email: rental.users.email,
                    phone: rental.users.phone,
                } : null,
                location: rental.location ? {
                    id: rental.location.id,
                    address: rental.location.address,
                    district: rental.location.district,
                    city: rental.location.city,
                } : null,
                rooms: roomsWithDetails,
                amenities: allAmenityNames,
                images: imgs.length > 0 ? imgs : [placeholderImage],
            },
        });
    } catch (err) {
        console.error('Get public rental by id error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy chi tiết',
            error: err.message,
        });
    }
}

/**
 * GET (public) – List rentals for home/browse. No auth.
 * Query: ?page=1&limit=20&district=...&city=...&sort=createdAt_desc|createdAt_asc|title_asc|title_desc
 */
function getPublicRentalsOrderBy(sortParam) {
    const map = {
        createdAt_desc: { createdAt: 'desc' },
        createdAt_asc: { createdAt: 'asc' },
        title_asc: { title: 'asc' },
        title_desc: { title: 'desc' },
    };
    return map[sortParam] || { createdAt: 'desc' };
}

async function getPublicRentals(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 1000);
        const skip = (page - 1) * limit;
        const sort = getPublicRentalsOrderBy(req.query.sort);

        const where = {};
        if (req.query.district && String(req.query.district).trim()) {
            where.location = where.location || {};
            where.location.district = { equals: String(req.query.district).trim(), mode: 'insensitive' };
        }
        if (req.query.city && String(req.query.city).trim()) {
            where.location = where.location || {};
            where.location.city = { equals: String(req.query.city).trim(), mode: 'insensitive' };
        }

        const [rentals, total] = await Promise.all([
            prisma.rental.findMany({
                where,
                skip,
                take: limit,
                orderBy: sort,
                include: {
                    location: true,
                    images: true,
                },
            }),
            prisma.rental.count({ where }),
        ]);

        const placeholderImage = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';

        return res.json({
            success: true,
            data: rentals.map((r) => {
                const imgs = (r.images || []).map((img) => img.imageUrl);
                return {
                    id: r.id,
                    title: r.title,
                    description: r.description,
                    status: r.status,
                    createdAt: r.createdAt,
                    location: r.location ? {
                        id: r.location.id,
                        address: r.location.address,
                        district: r.location.district,
                        city: r.location.city,
                    } : null,
                    images: imgs.length > 0 ? imgs : [placeholderImage],
                };
            }),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get public rentals error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách',
            error: err.message,
        });
    }
}

module.exports = {
    createRental,
    getRentals,
    getRentalById,
    getMyRentals,
    getRentalsForModeration,
    updateRentalStatus,
    getRentalStats,
    getPublicRentals,
    getPublicRentalById,
};
