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
            select: { id: true, fullName: true, role: true, status: true },
        });

        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
        }

        if (!ALLOWED_ROLES.includes(existingUser.role)) {
            return res.status(403).json({ success: false, message: 'Không có quyền thay đổi status của người dùng này' });
        }

        const action = newStatus === 'BANNED' ? 'BAN' : newStatus === 'SUSPENDED' ? 'SUSPEND' : 'UNSUSPEND';

        const updatedUser = await prisma.$transaction(async (tx) => {
            const user = await tx.user.update({
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
            await tx.moderator_logs.create({
                data: {
                    moderator_id: moderatorId,
                    target_type: 'USER',
                    target_id: userId,
                    action,
                    previous_status: existingUser.status,
                    new_status: newStatus,
                    note: req.body.note || null,
                },
            });
            return user;
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

        const updatedRental = await prisma.$transaction(async (tx) => {
            const rental = await tx.rental.update({
                where: { id: rentalId },
                data: { status },
                include: { location: true },
            });
            await tx.moderation_queue.updateMany({
                where: {
                    target_type: 'RENTAL',
                    target_id: rentalId,
                    status: 'OPEN',
                },
                data: { status: 'RESOLVED', resolved_at: new Date() },
            });
            await tx.moderator_logs.create({
                data: {
                    moderator_id: req.auth.user.id,
                    target_type: 'RENTAL',
                    target_id: rentalId,
                    action: status === 'AVAILABLE' ? 'APPROVE' : 'REJECT',
                    previous_status: existingRental.status,
                    new_status: status,
                    note: req.body.note || null,
                },
            });
            return rental;
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

        const updated = await prisma.$transaction(async (tx) => {
            const updatedRoom = await tx.rooms.update({
                where: { id: roomId },
                data: { status: newStatus },
                include: {
                    images: true,
                    roomAmenities: { include: { amenity: true } },
                    rentals: { include: { location: true } },
                },
            });
            await tx.moderation_queue.updateMany({
                where: {
                    target_type: 'ROOM',
                    target_id: roomId,
                    status: 'OPEN',
                },
                data: { status: 'RESOLVED', resolved_at: new Date() },
            });
            await tx.moderator_logs.create({
                data: {
                    moderator_id: req.auth.user.id,
                    target_type: 'ROOM',
                    target_id: roomId,
                    action: decision === 'approved' ? 'APPROVE' : 'REJECT',
                    previous_status: room.status,
                    new_status: newStatus,
                    note: note || null,
                },
            });
            return updatedRoom;
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

// ═══════════════════ Moderator Logs ═══════════════════

const VALID_TARGET_TYPES = ['RENTAL', 'ROOM', 'REPORT', 'FEEDBACK', 'USER', 'QUEUE'];
const VALID_LOG_ACTIONS = ['APPROVE', 'REJECT', 'HIDE', 'DISMISS', 'BAN', 'SUSPEND', 'UNSUSPEND', 'CLAIM', 'RELEASE'];

/**
 * GET /moderator/logs
 * Lấy lịch sử moderation (chỉ MODERATOR/ADMIN)
 * Query: ?page=1&limit=20&targetType=RENTAL|ROOM|REPORT|FEEDBACK|USER&action=...&moderatorId=...
 */
async function getModeratorLogs(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;

        const where = {};
        if (req.query.targetType && VALID_TARGET_TYPES.includes(req.query.targetType.toUpperCase())) {
            where.target_type = req.query.targetType.toUpperCase();
        }
        if (req.query.action && VALID_LOG_ACTIONS.includes(req.query.action.toUpperCase())) {
            where.action = req.query.action.toUpperCase();
        }
        if (req.query.moderatorId) {
            where.moderator_id = req.query.moderatorId;
        }

        const [items, total] = await Promise.all([
            prisma.moderator_logs.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: {
                    users: {
                        select: { id: true, fullName: true },
                    },
                },
            }),
            prisma.moderator_logs.count({ where }),
        ]);

        return res.json({
            success: true,
            data: items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Moderator - Get logs error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy lịch sử moderation',
            error: err.message,
        });
    }
}

/**
 * GET /moderator/queue/activity
 * Lịch sử thao tác claim/release queue (ai nhận task, ai trả task).
 * Query: ?page=1&limit=20&action=CLAIM|RELEASE|all&moderatorId=...
 */
async function getQueueActivity(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;

        const where = { target_type: 'QUEUE', action: { in: ['CLAIM', 'RELEASE'] } };
        if (req.query.action && ['CLAIM', 'RELEASE'].includes(req.query.action.toUpperCase())) {
            where.action = req.query.action.toUpperCase();
        }
        if (req.query.moderatorId) {
            where.moderator_id = req.query.moderatorId;
        }

        const [items, total] = await Promise.all([
            prisma.moderator_logs.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
                include: {
                    users: { select: { id: true, fullName: true, email: true } },
                },
            }),
            prisma.moderator_logs.count({ where }),
        ]);

        return res.json({
            success: true,
            data: items,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (err) {
        console.error('Moderator - Get queue activity error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy lịch sử thao tác queue',
            error: err.message,
        });
    }
}

// ═══════════════════ Moderation Queue ═══════════════════

const VALID_QUEUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'EXPIRED'];
const VALID_QUEUE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const VALID_QUEUE_CATEGORIES = [
    'NEW_LISTING',
    'DOCUMENT_REVIEW',
    'REPORTED_CONTENT',
    'FEEDBACK_REVIEW',
    'USER_COMPLAINT',
    'FRAUD_SUSPICION',
    'POLICY_VIOLATION',
];

/**
 * GET /moderator/queue
 * Lấy danh sách moderation queue theo status, priority, category
 * Query: ?status=OPEN&priority=HIGH&category=...&assignedTo=userId&page=1&limit=20
 */
async function getModerationQueue(req, res) {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;

        const where = {};
        if (req.query.status && VALID_QUEUE_STATUSES.includes(req.query.status.toUpperCase())) {
            where.status = req.query.status.toUpperCase();
        }
        if (req.query.priority && VALID_QUEUE_PRIORITIES.includes(req.query.priority.toUpperCase())) {
            where.priority = req.query.priority.toUpperCase();
        }
        if (req.query.category && VALID_QUEUE_CATEGORIES.includes(req.query.category)) {
            where.category = req.query.category;
        }
        if (req.query.assignedTo) {
            where.assigned_to = req.query.assignedTo;
        }

        const [items, total] = await Promise.all([
            prisma.moderation_queue.findMany({
                where,
                orderBy: [
                    { status: 'asc' },
                    { priority: 'desc' },
                    { created_at: 'asc' },
                ],
                skip,
                take: limit,
                include: {
                    users: {
                        select: { id: true, fullName: true },
                    },
                },
            }),
            prisma.moderation_queue.count({ where }),
        ]);

        return res.json({
            success: true,
            data: items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Moderator - Get queue error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy moderation queue',
            error: err.message,
        });
    }
}

/**
 * PATCH /moderator/queue/:id/assign
 * Claim task (assign to self) hoặc assign cho moderator khác (admin).
 * Body: { assignTo?: userId } — nếu rỗng thì assign to self.
 */
async function assignQueueItem(req, res) {
    try {
        const { id } = req.params;
        const assignTo = req.body?.assignTo || req.auth?.user?.id;
        if (!assignTo) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }

        const existing = await prisma.moderation_queue.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy mục queue' });
        }
        if (existing.status !== 'OPEN') {
            return res.status(400).json({
                success: false,
                message: `Mục này đã được giao (status: ${existing.status}), không thể claim`,
            });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const u = await tx.moderation_queue.update({
                where: { id },
                data: {
                    assigned_to: assignTo,
                    assigned_at: new Date(),
                    status: 'IN_PROGRESS',
                    version: { increment: 1 },
                },
                include: {
                    users: { select: { id: true, fullName: true } },
                },
            });
            await tx.moderator_logs.create({
                data: {
                    moderator_id: assignTo,
                    target_type: 'QUEUE',
                    target_id: id,
                    action: 'CLAIM',
                    previous_status: 'OPEN',
                    new_status: 'IN_PROGRESS',
                    metadata: {
                        queue_target_type: existing.target_type,
                        queue_target_id: existing.target_id,
                        queue_category: existing.category,
                    },
                },
            });
            return u;
        });

        return res.json({
            success: true,
            message: 'Đã nhận task thành công',
            data: updated,
        });
    } catch (err) {
        console.error('Moderator - Assign queue error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi gán task',
            error: err.message,
        });
    }
}

/**
 * PATCH /moderator/queue/:id/release
 * Trả task về queue (chỉ moderator đang xử lý mới release được).
 */
async function releaseQueueItem(req, res) {
    try {
        const { id } = req.params;
        const moderatorId = req.auth?.user?.id;
        if (!moderatorId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }

        const existing = await prisma.moderation_queue.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy mục queue' });
        }
        if (existing.status !== 'IN_PROGRESS') {
            return res.status(400).json({
                success: false,
                message: 'Chỉ có thể release task đang ở trạng thái IN_PROGRESS',
            });
        }
        if (existing.assigned_to !== moderatorId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không phải người đang xử lý task này',
            });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const u = await tx.moderation_queue.update({
                where: { id },
                data: {
                    assigned_to: null,
                    assigned_at: null,
                    status: 'OPEN',
                    version: { increment: 1 },
                },
            });
            await tx.moderator_logs.create({
                data: {
                    moderator_id: moderatorId,
                    target_type: 'QUEUE',
                    target_id: id,
                    action: 'RELEASE',
                    previous_status: 'IN_PROGRESS',
                    new_status: 'OPEN',
                    metadata: {
                        queue_target_type: existing.target_type,
                        queue_target_id: existing.target_id,
                        queue_category: existing.category,
                    },
                },
            });
            return u;
        });

        return res.json({
            success: true,
            message: 'Đã trả task về queue',
            data: updated,
        });
    } catch (err) {
        console.error('Moderator - Release queue error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi release task',
            error: err.message,
        });
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

        const action = status === 'APPROVED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : 'DISMISS';

        const updated = await prisma.$transaction(async (tx) => {
            const reportUpdated = await tx.report.update({
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
            await tx.moderation_queue.updateMany({
                where: {
                    target_type: 'REPORT',
                    target_id: id,
                    status: 'OPEN',
                },
                data: { status: 'RESOLVED', resolved_at: new Date() },
            });
            await tx.moderator_logs.create({
                data: {
                    moderator_id: moderatorId,
                    target_type: 'REPORT',
                    target_id: id,
                    action,
                    previous_status: 'PENDING',
                    new_status: status,
                    note: moderatorNote || null,
                },
            });
            return reportUpdated;
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
 * Query: ?page=1&limit=20&status=PENDING|APPROVED|REJECTED|HIDDEN&roomId=&tenantId=&dateFrom=&dateTo=
 * Mặc định tab Chờ duyệt (PENDING), sắp xếp FIFO (cũ → mới)
 */
async function getReviewsForModeration(req, res) {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const where = {};
        if (req.query.target_type) where.target_type = req.query.target_type;
        if (req.query.status) where.status = req.query.status;
        if (req.query.roomId) where.target_id = req.query.roomId;
        if (req.query.tenantId) where.user_id = req.query.tenantId;
        if (req.query.dateFrom || req.query.dateTo) {
            where.created_at = {};
            if (req.query.dateFrom) where.created_at.gte = new Date(req.query.dateFrom);
            if (req.query.dateTo) where.created_at.lte = new Date(req.query.dateTo + 'T23:59:59.999Z');
        }

        const orderDir = req.query.status === 'PENDING' ? 'asc' : 'desc';
        const [reviews, total] = await Promise.all([
            prisma.feedback.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: orderDir },
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

        const roomIds = [...new Set(reviews.filter((r) => r.target_type === 'ROOM').map((r) => r.target_id))];
        const roomRentalMap = new Map();
        if (roomIds.length > 0) {
            const rooms = await prisma.rooms.findMany({
                where: { id: { in: roomIds } },
                include: {
                    rentals: { include: { location: true } },
                    images: { take: 1, select: { imageUrl: true } },
                },
            });
            for (const room of rooms) {
                const loc = room.rentals?.location;
                const address = loc ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ') : '';
                roomRentalMap.set(room.id, {
                    roomName: room.room_name || room.rentals?.title || 'Phòng',
                    address,
                    imageUrl: room.images?.[0]?.imageUrl || null,
                });
            }
        }

        return res.json({
            success: true,
            data: reviews.map((r) => {
                const roomInfo = r.target_type === 'ROOM' ? roomRentalMap.get(r.target_id) : null;
                return {
                    id: r.id,
                    review_id: r.id,
                    reviewer_id: r.user_id,
                    reviewer_name: r.users?.fullName || null,
                    reviewer_email: r.users?.email || null,
                    reviewer_avatar: r.users?.avatarUrl || null,
                    target_type: r.target_type,
                    target_id: r.target_id,
                    room_name: roomInfo?.roomName || null,
                    room_address: roomInfo?.address || null,
                    room_image_url: roomInfo?.imageUrl || null,
                    rating: r.rating,
                    content: r.comment,
                    status: r.status,
                    reviewed_by: r.reviewed_by,
                    reviewed_at: r.reviewed_at,
                    moderator_note: r.moderator_note,
                    created_at: r.created_at,
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
        console.error('Moderator - Get reviews error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách reviews',
            error: err.message,
        });
    }
}

/**
 * GET /moderator/reviews/:reviewId
 * Chi tiết feedback đầy đủ (tenant, phòng, hợp đồng, nội dung đánh giá)
 */
async function getReviewDetail(req, res) {
    try {
        const { reviewId } = req.params;

        const feedback = await prisma.feedback.findUnique({
            where: { id: reviewId },
            include: {
                users: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        avatarUrl: true,
                    },
                },
                users_feedback_reviewed_byTousers: {
                    select: { id: true, fullName: true },
                },
                room_rental_periods: {
                    include: {
                        room: {
                            include: {
                                rentals: { include: { location: true } },
                                images: { select: { imageUrl: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!feedback) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy feedback' });
        }

        const period = feedback.room_rental_periods;
        const room = period?.room;
        const rental = room?.rentals;
        const loc = rental?.location;
        const address = loc ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ') : '';
        const startDate = period?.startDate;
        const endDate = period?.endDate;
        const daysRented = startDate && endDate
            ? Math.ceil((new Date(endDate) - new Date(startDate)) / (24 * 60 * 60 * 1000))
            : null;

        return res.json({
            success: true,
            data: {
                id: feedback.id,
                status: feedback.status,
                rating: feedback.rating,
                comment: feedback.comment,
                cleanlinessRating: feedback.cleanliness_rating,
                locationRating: feedback.location_rating,
                valueRating: feedback.value_rating,
                landlordRating: feedback.landlord_rating,
                created_at: feedback.created_at,
                reviewed_by: feedback.reviewed_by,
                reviewed_at: feedback.reviewed_at,
                moderator_note: feedback.moderator_note,
                moderator_name: feedback.users_feedback_reviewed_byTousers?.fullName || null,
                tenant: feedback.users
                    ? {
                        id: feedback.users.id,
                        fullName: feedback.users.fullName,
                        email: feedback.users.email,
                        avatarUrl: feedback.users.avatarUrl,
                    }
                    : null,
                room: room
                    ? {
                        id: room.id,
                        roomName: room.room_name || rental?.title || 'Phòng',
                        address,
                        images: (room.images || []).map((i) => i.imageUrl),
                    }
                    : null,
                contract: period
                    ? {
                        startDate,
                        endDate,
                        actualPrice: period.actualPrice ? Number(period.actualPrice) : null,
                        daysRented,
                    }
                    : null,
            },
        });
    } catch (err) {
        console.error('Moderator - Get review detail error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy chi tiết feedback',
            error: err.message,
        });
    }
}

/**
 * PATCH /moderator/reviews/:reviewId
 * Duyệt / từ chối / ẩn review
 * Body: { status: 'APPROVED' | 'REJECTED' | 'HIDDEN', moderatorNote?: string }
 */
async function updateReviewStatus(req, res) {
    try {
        const { reviewId } = req.params;
        const { status, moderatorNote } = req.body;
        const moderatorId = req.auth.user.id;

        const validStatuses = ['APPROVED', 'REJECTED', 'HIDDEN'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'status phải là APPROVED, REJECTED hoặc HIDDEN',
            });
        }

        const existing = await prisma.feedback.findUnique({
            where: { id: reviewId },
            include: {
                users: { select: { id: true } },
                room_rental_periods: {
                    include: {
                        room: {
                            include: {
                                rentals: { select: { owner_id: true, title: true } },
                            },
                        },
                    },
                },
                users_feedback_reviewed_byTousers: { select: { fullName: true } },
            },
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy review' });
        }

        if (status === 'HIDDEN') {
            if (existing.status !== 'APPROVED') {
                return res.status(400).json({
                    success: false,
                    message: 'Chỉ có thể ẩn đánh giá đã được duyệt',
                });
            }
            const note = moderatorNote ? String(moderatorNote).trim() : '';
            if (note.length < 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng nhập lý do ẩn (tối thiểu 10 ký tự)',
                });
            }
        } else if (status === 'REJECTED') {
            const note = moderatorNote ? String(moderatorNote).trim() : '';
            if (note.length < 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Vui lòng nhập lý do từ chối (tối thiểu 10 ký tự)',
                });
            }
        }

        if (existing.status !== 'PENDING' && status !== 'HIDDEN') {
            const moderatorName = existing.users_feedback_reviewed_byTousers?.fullName || 'moderator';
            return res.status(400).json({
                success: false,
                message: `Đánh giá này đã được xử lý bởi ${moderatorName}`,
            });
        }

        const noteValue = moderatorNote ? String(moderatorNote).trim() : null;
        const action = status === 'APPROVED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : 'HIDE';

        const updated = await prisma.$transaction(async (tx) => {
            const feedbackUpdated = await tx.feedback.update({
                where: { id: reviewId },
                data: {
                    status,
                    reviewed_by: moderatorId,
                    reviewed_at: new Date(),
                    moderator_note: noteValue,
                    updated_at: new Date(),
                },
            });
            await tx.moderation_queue.updateMany({
                where: {
                    target_type: 'FEEDBACK',
                    target_id: reviewId,
                    status: 'OPEN',
                },
                data: { status: 'RESOLVED', resolved_at: new Date() },
            });
            await tx.moderator_logs.create({
                data: {
                    moderator_id: moderatorId,
                    target_type: 'FEEDBACK',
                    target_id: reviewId,
                    action,
                    previous_status: existing.status,
                    new_status: status,
                    note: noteValue || null,
                },
            });
            return feedbackUpdated;
        });

        const tenantId = existing.user_id;
        const landlordId = existing.room_rental_periods?.room?.rentals?.owner_id;
        const roomTitle = existing.room_rental_periods?.room?.rentals?.title || 'Phòng';

        try {
            if (status === 'APPROVED') {
                await prisma.notification.create({
                    data: {
                        userId: tenantId,
                        type: 'ADMIN_ALERT',
                        title: 'Đánh giá được duyệt',
                        body: 'Đánh giá của bạn đã được duyệt và công khai.',
                        status: 'UNREAD',
                    },
                });
                if (landlordId) {
                    await prisma.notification.create({
                        data: {
                            userId: landlordId,
                            type: 'ADMIN_ALERT',
                            title: 'Đánh giá mới',
                            body: `Phòng ${roomTitle} có đánh giá mới.`,
                            status: 'UNREAD',
                        },
                    });
                }
            } else if (status === 'REJECTED') {
                await prisma.notification.create({
                    data: {
                        userId: tenantId,
                        type: 'ADMIN_ALERT',
                        title: 'Đánh giá bị từ chối',
                        body: `Đánh giá của bạn bị từ chối. Lý do: ${noteValue || ''}`,
                        status: 'UNREAD',
                    },
                });
            } else if (status === 'HIDDEN') {
                await prisma.notification.create({
                    data: {
                        userId: tenantId,
                        type: 'ADMIN_ALERT',
                        title: 'Đánh giá đã bị ẩn',
                        body: `Đánh giá của bạn đã bị ẩn. Lý do: ${noteValue || ''}`,
                        status: 'UNREAD',
                    },
                });
            }
        } catch (notifErr) {
            console.warn('Could not create notifications:', notifErr.message);
        }

        return res.json({
            success: true,
            message:
                status === 'APPROVED'
                    ? 'Đã duyệt đánh giá'
                    : status === 'REJECTED'
                        ? 'Đã từ chối đánh giá'
                        : 'Đã ẩn đánh giá',
            data: { id: updated.id, status: updated.status },
        });
    } catch (err) {
        console.error('Moderator - Update review status error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật review',
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
    getModeratorLogs,
    getModerationQueue,
    getQueueActivity,
    assignQueueItem,
    releaseQueueItem,
    getReports,
    handleReport,
    getReviewsForModeration,
    getReviewDetail,
    updateReviewStatus,
    deleteReview,
};
