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

module.exports = {
    createRental,
    getRentals,
    getRentalById,
    getMyRentals,
    getRentalsForModeration,
    updateRentalStatus,
};
