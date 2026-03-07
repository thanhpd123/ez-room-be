const prisma = require('../config/prisma');
const { validateUpdateRentalStatus } = require('../validators/rental.validator');
const { mapFeToDb, mapDbToFe } = require('../utils/room-type-mapper');

// ═══════════════════ Constants ═══════════════════

const ALLOWED_ROLES = ['LANDLORD', 'TENANT'];
const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'];

const REPORT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DISMISSED'];
const REPORT_STATUSES_HANDLE = ['APPROVED', 'REJECTED', 'DISMISSED'];

// ═══════════════════ Helpers ═══════════════════

function formatRoomResponse(room) {
    return {
        id: room.id,
        rentalId: room.rental_id,
        roomName: room.room_name,
        description: room.description,
        roomType: mapDbToFe(room.room_type, 'single'),
        price: Number(room.price),
        sizeM2: room.size_m2 ? Number(room.size_m2) : null,
        maxPeople: room.max_people,
        status: room.status,
        createdAt: room.created_at,
        images: (room.images || []).map((img) => img.imageUrl),
        amenities: (room.roomAmenities || []).map((ra) => ({
            id: ra.amenity?.id,
            name: ra.amenity?.name,
        })),
        room_post_id: room.id,
        rental_id: room.rental_id,
        title: room.room_name || '',
        area: room.size_m2 ? Number(room.size_m2) : 0,
        max_occupants: room.max_people || 1,
        thumbnail_url: room.images?.[0]?.imageUrl || null,
        created_at: room.created_at?.toISOString() || new Date().toISOString(),
    };
}

// ═══════════════════ Quản lý Users ═══════════════════

/**
 * GET /moderator/users
 * Lấy danh sách users chỉ với role LANDLORD và TENANT (có phân trang)
 * Query: ?page=1&limit=10&role=TENANT&status=ACTIVE&search=keyword
 */
async function getAllUsers(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const where = {};

        if (req.query.role) {
            const role = req.query.role.toUpperCase();
            if (!ALLOWED_ROLES.includes(role)) {
                return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ' });
            }
            where.role = role;
        } else {
            where.role = { in: ALLOWED_ROLES };
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
        console.error('Moderator - Get all users error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách người dùng',
            error: err.message,
        });
    }
}

/**
 * GET /moderator/users/:userId
 * Lấy thông tin chi tiết một user (chỉ LANDLORD / TENANT)
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
                favoriteRooms: {
                    select: { roomId: true },
                },
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
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
        }

        if (!ALLOWED_ROLES.includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Không có quyền xem thông tin người dùng này' });
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

        return res.json({ success: true, data: response });
    } catch (err) {
        console.error('Moderator - Get user by id error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thông tin người dùng',
            error: err.message,
        });
    }
}

/**
 * PATCH /moderator/users/:userId/status
 * Thay đổi status của một user (chỉ LANDLORD / TENANT)
 * Body: { status: 'BANNED' }
 */
async function updateUserStatus(req, res) {
    try {
        const { userId } = req.params;
        const { status } = req.body;
        const moderatorId = req.auth.user.id;

        if (!status || !VALID_STATUSES.includes(status.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: `Status không hợp lệ. Các status hợp lệ: ${VALID_STATUSES.join(', ')}`,
            });
        }

        const newStatus = status.toUpperCase();

        if (userId === moderatorId) {
            return res.status(403).json({ success: false, message: 'Bạn không thể thay đổi status của chính mình' });
        }

        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, fullName: true, role: true },
        });

        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
        }

        if (!ALLOWED_ROLES.includes(existingUser.role)) {
            return res.status(403).json({ success: false, message: 'Không có quyền thay đổi status của người dùng này' });
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { status: newStatus, updated_at: new Date() },
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
        console.error('Moderator - Update user status error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật status người dùng',
            error: err.message,
        });
    }
}

// ═══════════════════ Duyệt Rental (Bài đăng) ═══════════════════

/**
 * GET /moderator/rentals/moderation
 * Lấy danh sách rentals để moderator duyệt
 * Query: ?page=1&limit=50&status=PENDING&search=keyword
 */
async function getRentalsForModeration(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const where = {};

        if (req.query.status) {
            where.status = req.query.status;
        }

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
                    rental_documents: true,
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
                documents: (r.rental_documents || []).map((doc) => ({
                    id: doc.id,
                    documentType: doc.document_type,
                    imageUrl: doc.image_url,
                    status: doc.status,
                    note: doc.note,
                })),
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
        console.error('Moderator - Get rentals for moderation error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách bài đăng cho duyệt',
            error: err.message,
        });
    }
}

/**
 * PATCH /moderator/rentals/:rentalId/status
 * Duyệt rental: đổi status (HIDDEN → AVAILABLE, etc.)
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
        console.error('Moderator - Update rental status error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật trạng thái bài đăng',
            error: err.message,
        });
    }
}

/**
 * GET /moderator/rentals/stats
 * Thống kê bài đăng cho dashboard
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
        console.error('Moderator - Get rental stats error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thống kê bài đăng',
            error: err.message,
        });
    }
}

// ═══════════════════ Duyệt Room Post (Phòng) ═══════════════════

/**
 * GET /moderator/rooms
 * Lấy danh sách phòng (để kiểm duyệt)
 * Query: ?rentalId=xxx&roomType=single&minPrice=&maxPrice=&page=1&limit=20
 */
async function getRooms(req, res) {
    try {
        const { rentalId, rental_id, roomType, minPrice, maxPrice, page = '1', limit = '20' } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * pageSize;

        const where = {};
        const filterRentalId = rentalId || rental_id;
        if (filterRentalId) where.rental_id = filterRentalId;
        if (roomType) where.room_type = mapFeToDb(roomType);
        if (minPrice || maxPrice) {
            where.price = {};
            if (minPrice) where.price.gte = parseFloat(minPrice);
            if (maxPrice) where.price.lte = parseFloat(maxPrice);
        }

        const [rooms, total] = await Promise.all([
            prisma.rooms.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: { created_at: 'desc' },
                include: {
                    images: true,
                    roomAmenities: { include: { amenity: true } },
                    rentals: { include: { location: true } },
                },
            }),
            prisma.rooms.count({ where }),
        ]);

        return res.json({
            success: true,
            data: rooms.map((room) => ({
                ...formatRoomResponse(room),
                rental: room.rentals ? {
                    id: room.rentals.id,
                    title: room.rentals.title,
                    status: room.rentals.status,
                    location: room.rentals.location ? {
                        address: room.rentals.location.address,
                        district: room.rentals.location.district,
                        city: room.rentals.location.city,
                    } : null,
                } : null,
            })),
            pagination: { page: pageNum, limit: pageSize, total, pages: Math.ceil(total / pageSize) },
        });
    } catch (err) {
        console.error('Moderator - Get rooms error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách phòng', error: err.message });
    }
}

/**
 * PUT /moderator/rooms/:roomId/moderate
 * Duyệt / từ chối room post
 * Body: { decision: 'approved' | 'rejected', note?: string }
 */
async function moderateRoom(req, res) {
    try {
        const { roomId } = req.params;
        const { decision, note } = req.body;

        if (!decision || !['approved', 'rejected'].includes(decision)) {
            return res.status(400).json({ success: false, message: 'decision phải là approved hoặc rejected' });
        }

        const room = await prisma.rooms.findUnique({ where: { id: roomId } });
        if (!room) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        }

        const newStatus = decision === 'approved' ? 'AVAILABLE' : 'MAINTENANCE';

        const updated = await prisma.rooms.update({
            where: { id: roomId },
            data: { status: newStatus },
            include: {
                images: true,
                roomAmenities: { include: { amenity: true } },
                rentals: { include: { location: true } },
            },
        });

        return res.json({
            success: true,
            message: decision === 'approved' ? 'Đã duyệt phòng' : 'Đã từ chối phòng',
            data: formatRoomResponse(updated),
        });
    } catch (err) {
        console.error('Moderator - Moderate room error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi duyệt phòng', error: err.message });
    }
}

// ═══════════════════ Xử lý Báo cáo (Reports) ═══════════════════

/**
 * GET /moderator/reports
 * Lấy danh sách báo cáo vi phạm
 * Query: ?status=PENDING&page=1&limit=20
 */
async function getReports(req, res) {
    try {
        const { status, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        const where = {};
        if (status && REPORT_STATUSES.includes(status)) {
            where.status = status;
        }

        const [reports, total] = await Promise.all([
            prisma.report.findMany({
                where,
                orderBy: [
                    { status: 'asc' },
                    { createdAt: 'desc' },
                ],
                skip,
                take: limitNum,
                include: {
                    reporter: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            phone: true,
                            avatarUrl: true,
                        },
                    },
                    moderator: {
                        select: {
                            id: true,
                            fullName: true,
                        },
                    },
                },
            }),
            prisma.report.count({ where }),
        ]);

        const targetUserIds = [...new Set(reports.filter(r => r.targetType === 'USER').map(r => r.targetId))];
        const targetUsers = targetUserIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: targetUserIds } },
                select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true },
            })
            : [];
        const targetUserMap = Object.fromEntries(targetUsers.map(u => [u.id, u]));

        const reportsWithTarget = reports.map(r => ({
            ...r,
            targetUser: r.targetType === 'USER' ? (targetUserMap[r.targetId] || null) : null,
        }));

        return res.json({
            success: true,
            data: reportsWithTarget,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    } catch (err) {
        console.error('Moderator - Get reports error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách báo cáo',
            error: err.message,
        });
    }
}

/**
 * PATCH /moderator/reports/:id
 * Xử lý báo cáo (duyệt / từ chối / bỏ qua)
 * Body: { status: 'APPROVED' | 'REJECTED' | 'DISMISSED', moderatorNote?: string }
 */
async function handleReport(req, res) {
    try {
        const { id } = req.params;
        const moderatorId = req.auth.user.id;
        const { status, moderatorNote } = req.body;

        if (!status || !REPORT_STATUSES_HANDLE.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `status không hợp lệ. Chỉ chấp nhận: ${REPORT_STATUSES_HANDLE.join(', ')}`,
            });
        }

        const existing = await prisma.report.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy báo cáo',
            });
        }
        if (existing.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: 'Báo cáo này đã được xử lý trước đó',
            });
        }

        const updated = await prisma.report.update({
            where: { id },
            data: {
                status,
                reviewedBy: moderatorId,
                moderatorNote: moderatorNote || null,
                reviewedAt: new Date(),
            },
            include: {
                reporter: {
                    select: { id: true, fullName: true },
                },
                moderator: {
                    select: { id: true, fullName: true },
                },
            },
        });

        return res.json({
            success: true,
            message: 'Đã xử lý báo cáo thành công',
            data: updated,
        });
    } catch (err) {
        console.error('Moderator - Handle report error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xử lý báo cáo',
            error: err.message,
        });
    }
}

// ═══════════════════ Kiểm duyệt Reviews ═══════════════════

/**
 * GET /moderator/reviews
 * Lấy danh sách reviews (feedback) để moderator kiểm duyệt
 * Query: ?page=1&limit=20&target_type=ROOM
 */
async function getReviewsForModeration(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const where = {};
        if (req.query.target_type) {
            where.target_type = req.query.target_type;
        }

        const [reviews, total] = await Promise.all([
            prisma.feedback.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: 'desc' },
                include: {
                    users: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            avatarUrl: true,
                        },
                    },
                },
            }),
            prisma.feedback.count({ where }),
        ]);

        const targetIds = [...new Set(reviews.map((r) => r.target_id))];
        const rentalMap = new Map();
        if (targetIds.length > 0) {
            const rentals = await prisma.rental.findMany({
                where: { id: { in: targetIds } },
                select: { id: true, title: true },
            });
            for (const r of rentals) rentalMap.set(r.id, r.title);
        }

        return res.json({
            success: true,
            data: reviews.map((r) => ({
                id: r.id,
                review_id: r.id,
                reviewer_id: r.user_id,
                reviewer_name: r.users?.fullName || null,
                reviewer_email: r.users?.email || null,
                reviewer_avatar: r.users?.avatarUrl || null,
                target_type: r.target_type,
                target_id: r.target_id,
                rental_title: rentalMap.get(r.target_id) || r.target_id,
                rating: r.rating,
                content: r.comment,
                created_at: r.created_at,
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Moderator - Get reviews error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách reviews',
            error: err.message,
        });
    }
}

/**
 * DELETE /moderator/reviews/:reviewId
 * Moderator xóa review (feedback) vi phạm
 */
async function deleteReview(req, res) {
    try {
        const { reviewId } = req.params;

        const existing = await prisma.feedback.findUnique({ where: { id: reviewId } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy review' });
        }

        await prisma.feedback.delete({ where: { id: reviewId } });

        return res.json({
            success: true,
            message: 'Đã xóa review thành công',
            data: { id: reviewId },
        });
    } catch (err) {
        console.error('Moderator - Delete review error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa review',
            error: err.message,
        });
    }
}

module.exports = {
    getAllUsers,
    getUserById,
    updateUserStatus,
    getRentalsForModeration,
    updateRentalStatus,
    getRentalStats,
    getRooms,
    moderateRoom,
    getReports,
    handleReport,
    getReviewsForModeration,
    deleteReview,
};
