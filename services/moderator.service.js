const prisma = require('../config/prisma');
const supabase = require('../config/supabase');
const { validateUpdateRentalStatus } = require('../validators/rental.validator');
const { mapFeToDb, mapDbToFe } = require('../utils/room-type-mapper');
const { publishPendingRoomsWhenRentalAvailable } = require('./sync-rental-rooms-on-approve');

// ═══════════════════ Constants ═══════════════════

const ALLOWED_ROLES = ['LANDLORD', 'TENANT'];
const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'];
const REPORT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DISMISSED'];
const REPORT_STATUSES_HANDLE = ['APPROVED', 'REJECTED', 'DISMISSED'];

// ═══════════════════ Queue ownership check ═══════════════════

async function checkQueueOwnership(tx, targetType, targetId, moderatorId) {
    const queueItem = await tx.moderation_queue.findFirst({
        where: {
            target_type: targetType,
            target_id: targetId,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: { users: { select: { fullName: true } } },
    });
    if (!queueItem) return; // no queue entry -> allow (legacy items)
    if (queueItem.status === 'OPEN') {
        throw Object.assign(
            new Error('Ban can nhan task tu Moderation Queue truoc khi xu ly'),
            { statusCode: 403 }
        );
    }
    if (queueItem.assigned_to !== moderatorId) {
        const name = queueItem.users?.fullName || 'moderator khac';
        throw Object.assign(
            new Error('Task nay dang duoc ' + name + ' xu ly'),
            { statusCode: 403 }
        );
    }
}

async function getQueueStatusForTarget(targetType, targetId) {
    const item = await prisma.moderation_queue.findFirst({
        where: {
            target_type: targetType,
            target_id: targetId,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: { users: { select: { id: true, fullName: true } } },
    });
    if (!item) return { hasQueue: false };
    return {
        hasQueue: true,
        queueId: item.id,
        status: item.status,
        assignedTo: item.users?.id || null,
        assignedToName: item.users?.fullName || null,
    };
}
const VALID_TARGET_TYPES = ['RENTAL', 'ROOM', 'REPORT', 'FEEDBACK', 'USER', 'QUEUE'];
const VALID_LOG_ACTIONS = ['APPROVE', 'REJECT', 'HIDE', 'DISMISS', 'BAN', 'SUSPEND', 'UNSUSPEND', 'CLAIM', 'RELEASE'];
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

async function getAllUsers(params) {
    const { page = 1, limit = 10, role, status, search } = params;
    const skip = (page - 1) * limit;

    const where = {};

    if (role) {
        const roleUpper = role.toUpperCase();
        if (!ALLOWED_ROLES.includes(roleUpper)) {
            throw Object.assign(new Error('Vai trò không hợp lệ'), { statusCode: 400 });
        }
        where.role = roleUpper;
    } else {
        where.role = { in: ALLOWED_ROLES };
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
                _count: {
                    select: { user_warnings_user_warnings_user_idTousers: true }
                }
            },
        }),
        prisma.user.count({ where }),
    ]);

    return {
        data: users.map(u => ({
            id: u.id,
            fullName: u.fullName,
            email: u.email,
            phone: u.phone,
            avatarUrl: u.avatarUrl,
            role: u.role,
            status: u.status,
            createdAt: u.createdAt,
            warningCount: u._count?.user_warnings_user_warnings_user_idTousers || 0
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

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
                select: { id: true, balance: true, created_at: true },
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
                select: { id: true, personalityType: true, created_at: true },
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

    if (!user) throw Object.assign(new Error('Không tìm thấy người dùng'), { statusCode: 404 });
    if (!ALLOWED_ROLES.includes(user.role)) {
        throw Object.assign(new Error('Không có quyền xem thông tin người dùng này'), { statusCode: 403 });
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

async function updateUserStatus(userId, status, moderatorId, note) {
    if (!status || !VALID_STATUSES.includes(status.toUpperCase())) {
        throw Object.assign(
            new Error(`Status không hợp lệ. Các status hợp lệ: ${VALID_STATUSES.join(', ')}`),
            { statusCode: 400 }
        );
    }

    const newStatus = status.toUpperCase();
    if (userId === moderatorId) {
        throw Object.assign(new Error('Bạn không thể thay đổi status của chính mình'), { statusCode: 403 });
    }

    const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, role: true, status: true },
    });

    if (!existingUser) throw Object.assign(new Error('Không tìm thấy người dùng'), { statusCode: 404 });
    if (!ALLOWED_ROLES.includes(existingUser.role)) {
        throw Object.assign(new Error('Không có quyền thay đổi status của người dùng này'), { statusCode: 403 });
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
                note: note || null,
            },
        });
        return user;
    });

    return {
        message: `Đã cập nhật status của "${updatedUser.fullName}" thành ${newStatus}`,
        data: updatedUser,
    };
}

// ═══════════════════ Duyệt Rental ═══════════════════

async function getRentalsForModeration(params) {
    const { page = 1, limit = 50, status, search } = params;
    const skip = (page - 1) * limit;
    const where = {};
    if (status) where.status = status;
    if (search) where.title = { contains: search, mode: 'insensitive' };

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

    // Helper: generate signed URL for a Supabase storage path (1 hour expiry)
    const getSignedUrl = async (path) => {
        if (!path || !supabase) return path;
        // Already a full URL (e.g. Cloudinary or public bucket)
        if (path.startsWith('http')) return path;
        try {
            const { data, error } = await supabase.storage
                .from('rental-documents')
                .createSignedUrl(path, 3600);
            return error ? path : (data?.signedUrl ?? path);
        } catch {
            return path;
        }
    };

    const data = await Promise.all(
        rentals.map(async (r) => {
            const documents = await Promise.all(
                (r.rental_documents || []).map(async (doc) => ({
                    id: doc.id,
                    documentType: doc.document_type,
                    imageUrl: await getSignedUrl(doc.image_url),
                    status: doc.status,
                    note: doc.note,
                }))
            );

            return {
                id: r.id,
                title: r.title,
                description: r.description,
                status: r.status,
                createdAt: r.createdAt,
                owner: r.users
                    ? {
                          id: r.users.id,
                          fullName: r.users.fullName,
                          avatarUrl: r.users.avatarUrl,
                          email: r.users.email,
                          phone: r.users.phone,
                      }
                    : null,
                location: r.location
                    ? {
                          id: r.location.id,
                          address: r.location.address,
                          district: r.location.district,
                          city: r.location.city,
                      }
                    : null,
                images: (r.images || []).map((img) => img.imageUrl),
                documents,
                roomsCount: r.rooms ? r.rooms.length : 0,
            };
        })
    );

    return {
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
}

async function updateRentalStatus(rentalId, body, moderatorId) {
    const { valid, errors } = validateUpdateRentalStatus(body);
    if (!valid) throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });

    const { status } = body;
    const existingRental = await prisma.rental.findUnique({
        where: { id: rentalId },
        include: { users: { select: { id: true, fullName: true } } },
    });
    if (!existingRental) {
        throw Object.assign(new Error('Không tìm thấy bài đăng'), { statusCode: 404 });
    }

    const updatedRental = await prisma.$transaction(async (tx) => {
        await checkQueueOwnership(tx, 'RENTAL', rentalId, moderatorId);
        const rental = await tx.rental.update({
            where: { id: rentalId },
            data: { status },
            include: { location: true },
        });
        const queueItems = await tx.moderation_queue.findMany({
            where: {
                target_type: 'RENTAL',
                target_id: rentalId,
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
        });
        await tx.moderation_queue.updateMany({
            where: {
                target_type: 'RENTAL',
                target_id: rentalId,
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
            data: { status: 'RESOLVED', resolved_at: new Date(), assigned_to: moderatorId },
        });
        await tx.moderator_logs.create({
            data: {
                moderator_id: moderatorId,
                target_type: 'RENTAL',
                target_id: rentalId,
                action: status === 'AVAILABLE' ? 'APPROVE' : 'REJECT',
                previous_status: existingRental.status,
                new_status: status,
                note: body.note || null,
            },
        });
        // Log RESOLVE action for queue activity tracking
        for (const qi of queueItems) {
            await tx.moderator_logs.create({
                data: {
                    moderator_id: moderatorId,
                    target_type: 'QUEUE',
                    target_id: qi.id,
                    action: 'RESOLVE',
                    previous_status: qi.status,
                    new_status: 'RESOLVED',
                    metadata: {
                        queue_target_type: qi.target_type,
                        queue_target_id: qi.target_id,
                        queue_category: qi.category,
                    },
                },
            });
        }
        if (status === 'AVAILABLE') {
            await publishPendingRoomsWhenRentalAvailable(rentalId, tx);
        }
        return rental;
    });

    // === Notification cho landlord ===
    const ownerId = existingRental.owner_id;
    const rentalTitle = existingRental.title || 'Bài đăng';
    const noteValue = body.note || '';
    try {
        if (status === 'AVAILABLE') {
            await prisma.notification.create({
                data: {
                    userId: ownerId,
                    type: 'ADMIN_ALERT',
                    title: 'Bài đăng nhà trọ đã được duyệt',
                    body: `Bài đăng "${rentalTitle}" của bạn đã được duyệt và hiển thị công khai.`,
                    status: 'UNREAD',
                },
            });
        } else {
            await prisma.notification.create({
                data: {
                    userId: ownerId,
                    type: 'ADMIN_ALERT',
                    title: 'Bài đăng nhà trọ bị từ chối',
                    body: `Bài đăng "${rentalTitle}" bị từ chối.${noteValue ? ' Lý do: ' + noteValue : ''} Vui lòng chỉnh sửa và gửi lại.`,
                    status: 'UNREAD',
                },
            });
        }
    } catch (notifErr) {
        console.warn('Could not create rental moderation notification:', notifErr.message);
    }

    return {
        message: `Đã cập nhật trạng thái bài đăng thành ${status}`,
        data: {
            id: updatedRental.id,
            title: updatedRental.title,
            status: updatedRental.status,
            location: updatedRental.location
                ? {
                      id: updatedRental.location.id,
                      address: updatedRental.location.address,
                      district: updatedRental.location.district,
                      city: updatedRental.location.city,
                  }
                : null,
        },
    };
}

async function getRentalStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, available, unavailable, hidden, suspendedOrViolate, thisMonth] = await Promise.all([
        prisma.rental.count(),
        prisma.rental.count({ where: { status: 'AVAILABLE' } }),
        prisma.rental.count({ where: { status: 'UNAVAILABLE' } }),
        prisma.rental.count({ where: { status: 'HIDDEN' } }),
        prisma.rental.count({ where: { status: { in: ['SUSPEND', 'VIOLATE'] } } }),
        prisma.rental.count({ where: { createdAt: { gte: startOfMonth } } }),
    ]);

    return {
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
    };
}

// ═══════════════════ Duyệt Room Post ═══════════════════

async function getRooms(params) {
    const { rentalId, rental_id, roomType, minPrice, maxPrice, page = 1, limit = 20 } = params;
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

    return {
        data: rooms.map((room) => ({
            ...formatRoomResponse(room),
            rental: room.rentals
                ? {
                      id: room.rentals.id,
                      title: room.rentals.title,
                      status: room.rentals.status,
                      location: room.rentals.location
                          ? {
                                address: room.rentals.location.address,
                                district: room.rentals.location.district,
                                city: room.rentals.location.city,
                            }
                          : null,
                  }
                : null,
        })),
        pagination: { page: pageNum, limit: pageSize, total, pages: Math.ceil(total / pageSize) },
    };
}

async function moderateRoom(roomId, body, moderatorId) {
    const { decision, note } = body;
    if (!decision || !['approved', 'rejected'].includes(decision)) {
        throw Object.assign(new Error('decision phải là approved hoặc rejected'), { statusCode: 400 });
    }

    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { rentals: { select: { owner_id: true, title: true } } },
    });
    if (!room) throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });

    const newStatus = decision === 'approved' ? 'AVAILABLE' : 'MAINTENANCE';

    const updated = await prisma.$transaction(async (tx) => {
        await checkQueueOwnership(tx, 'ROOM', roomId, moderatorId);
        const updatedRoom = await tx.rooms.update({
            where: { id: roomId },
            data: { status: newStatus },
            include: {
                images: true,
                roomAmenities: { include: { amenity: true } },
                rentals: { include: { location: true } },
            },
        });
        const roomQueueItems = await tx.moderation_queue.findMany({
            where: {
                target_type: 'ROOM',
                target_id: roomId,
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
        });
        await tx.moderation_queue.updateMany({
            where: {
                target_type: 'ROOM',
                target_id: roomId,
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
            data: { status: 'RESOLVED', resolved_at: new Date(), assigned_to: moderatorId },
        });
        await tx.moderator_logs.create({
            data: {
                moderator_id: moderatorId,
                target_type: 'ROOM',
                target_id: roomId,
                action: decision === 'approved' ? 'APPROVE' : 'REJECT',
                previous_status: room.status,
                new_status: newStatus,
                note: note || null,
            },
        });
        // Log RESOLVE action for queue activity tracking
        for (const qi of roomQueueItems) {
            await tx.moderator_logs.create({
                data: {
                    moderator_id: moderatorId,
                    target_type: 'QUEUE',
                    target_id: qi.id,
                    action: 'RESOLVE',
                    previous_status: qi.status,
                    new_status: 'RESOLVED',
                    metadata: {
                        queue_target_type: qi.target_type,
                        queue_target_id: qi.target_id,
                        queue_category: qi.category,
                    },
                },
            });
        }
        return updatedRoom;
    });

    // === Notification cho landlord ===
    const ownerId = room.rentals?.owner_id;
    const roomTitle = room.room_name || room.rentals?.title || 'Phòng';
    if (ownerId) {
        try {
            if (decision === 'approved') {
                await prisma.notification.create({
                    data: {
                        userId: ownerId,
                        type: 'ADMIN_ALERT',
                        title: 'Phòng đã được duyệt',
                        body: `Phòng "${roomTitle}" của bạn đã được duyệt và hiển thị công khai.`,
                        status: 'UNREAD',
                    },
                });
            } else {
                await prisma.notification.create({
                    data: {
                        userId: ownerId,
                        type: 'ADMIN_ALERT',
                        title: 'Phòng bị từ chối',
                        body: `Phòng "${roomTitle}" bị từ chối.${note ? ' Lý do: ' + note : ''} Vui lòng chỉnh sửa và gửi lại.`,
                        status: 'UNREAD',
                    },
                });
            }
        } catch (notifErr) {
            console.warn('Could not create room moderation notification:', notifErr.message);
        }
    }

    return {
        message: decision === 'approved' ? 'Đã duyệt phòng' : 'Đã từ chối phòng',
        data: formatRoomResponse(updated),
    };
}

// ═══════════════════ Moderator Logs ═══════════════════

async function getModeratorLogs(params) {
    const { page = 1, limit = 20, targetType, action, moderatorId } = params;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (targetType && VALID_TARGET_TYPES.includes(targetType.toUpperCase())) {
        where.target_type = targetType.toUpperCase();
    }
    if (action && VALID_LOG_ACTIONS.includes(action.toUpperCase())) where.action = action.toUpperCase();
    if (moderatorId) where.moderator_id = moderatorId;

    const [items, total] = await Promise.all([
        prisma.moderator_logs.findMany({
            where,
            orderBy: { created_at: 'desc' },
            skip,
            take: limitNum,
            include: {
                users: { select: { id: true, fullName: true } },
            },
        }),
        prisma.moderator_logs.count({ where }),
    ]);

    return {
        data: items,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    };
}

async function getQueueActivity(params) {
    const { page = 1, limit = 20, action, moderatorId, dateFrom, dateTo } = params;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = { target_type: 'QUEUE', action: { in: ['CLAIM', 'RELEASE', 'RESOLVE'] } };
    if (action && ['CLAIM', 'RELEASE', 'RESOLVE'].includes(action.toUpperCase())) where.action = action.toUpperCase();
    if (moderatorId) where.moderator_id = moderatorId;
    if (dateFrom || dateTo) {
        where.created_at = {};
        if (dateFrom) where.created_at.gte = new Date(dateFrom);
        if (dateTo) {
            const end = new Date(dateTo);
            end.setHours(23, 59, 59, 999);
            where.created_at.lte = end;
        }
    }

    const [items, total] = await Promise.all([
        prisma.moderator_logs.findMany({
            where,
            orderBy: { created_at: 'desc' },
            skip,
            take: limitNum,
            include: {
                users: { select: { id: true, fullName: true, email: true } },
            },
        }),
        prisma.moderator_logs.count({ where }),
    ]);

    return {
        data: items,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    };
}

async function getModeratorList() {
    const moderators = await prisma.user.findMany({
        where: { role: 'MODERATOR' },
        select: { id: true, fullName: true, email: true },
        orderBy: { fullName: 'asc' },
    });
    return { data: moderators };
}

// ═══════════════════ Moderation Queue ═══════════════════

async function getModerationQueue(params) {
    const { page = 1, limit = 20, status, priority, category, assignedTo, sortBy = 'asc' } = params;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (status && VALID_QUEUE_STATUSES.includes(status.toUpperCase())) where.status = status.toUpperCase();
    if (priority && VALID_QUEUE_PRIORITIES.includes(priority.toUpperCase())) where.priority = priority.toUpperCase();
    if (category && VALID_QUEUE_CATEGORIES.includes(category)) where.category = category;
    if (assignedTo) where.assigned_to = assignedTo;
    
    const sortDirection = sortBy === 'desc' ? 'desc' : 'asc';

    const [items, total] = await Promise.all([
        prisma.moderation_queue.findMany({
            where,
            orderBy: [
                { status: 'asc' },
                { priority: 'desc' },
                { created_at: sortDirection },
            ],
            skip,
            take: limitNum,
            include: {
                users: { select: { id: true, fullName: true } },
            },
        }),
        prisma.moderation_queue.count({ where }),
    ]);

    return {
        data: items,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    };
}

async function assignQueueItem(id, assignTo) {
    if (!assignTo) throw Object.assign(new Error('Chưa đăng nhập'), { statusCode: 401 });

    const existing = await prisma.moderation_queue.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error('Không tìm thấy mục queue'), { statusCode: 404 });
    if (existing.status !== 'OPEN') {
        throw Object.assign(new Error(`Mục này đã được giao (status: ${existing.status}), không thể claim`), {
            statusCode: 400,
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

    return { message: 'Đã nhận task thành công', data: updated };
}

async function addToModerationQueue(tx, data) {
    return await tx.moderation_queue.create({ data });
}

async function releaseQueueItem(id, moderatorId) {
    if (!moderatorId) throw Object.assign(new Error('Chưa đăng nhập'), { statusCode: 401 });

    const existing = await prisma.moderation_queue.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error('Không tìm thấy mục queue'), { statusCode: 404 });
    if (existing.status !== 'IN_PROGRESS') {
        throw Object.assign(new Error('Chỉ có thể release task đang ở trạng thái IN_PROGRESS'), { statusCode: 400 });
    }
    if (existing.assigned_to !== moderatorId) {
        throw Object.assign(new Error('Bạn không phải người đang xử lý task này'), { statusCode: 403 });
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

    return { message: 'Đã trả task về queue', data: updated };
}

// ═══════════════════ Reports ═══════════════════

async function getReports(params) {
    const { status, page = 1, limit = 20 } = params;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (status && REPORT_STATUSES.includes(status)) where.status = status;

    const [reports, total] = await Promise.all([
        prisma.report.findMany({
            where,
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
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
                moderator: { select: { id: true, fullName: true } },
            },
        }),
        prisma.report.count({ where }),
    ]);

    const targetUserIds = [...new Set(reports.filter((r) => r.targetType === 'USER').map((r) => r.targetId))];
    const targetUsers =
        targetUserIds.length > 0
            ? await prisma.user.findMany({
                  where: { id: { in: targetUserIds } },
                  select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true },
              })
            : [];
    const targetUserMap = Object.fromEntries(targetUsers.map((u) => [u.id, u]));

    const reportsWithTarget = reports.map((r) => ({
        ...r,
        targetUser: r.targetType === 'USER' ? (targetUserMap[r.targetId] || null) : null,
    }));

    return {
        data: reportsWithTarget,
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    };
}

async function handleReport(id, body, moderatorId) {
    const { status, moderatorNote } = body;
    if (!status || !REPORT_STATUSES_HANDLE.includes(status)) {
        throw Object.assign(
            new Error(`status không hợp lệ. Chỉ chấp nhận: ${REPORT_STATUSES_HANDLE.join(', ')}`),
            { statusCode: 400 }
        );
    }

    const existing = await prisma.report.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error('Không tìm thấy báo cáo'), { statusCode: 404 });
    if (existing.status !== 'PENDING') {
        throw Object.assign(new Error('Báo cáo này đã được xử lý trước đó'), { statusCode: 400 });
    }

    const action = status === 'APPROVED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : 'DISMISS';

    const updated = await prisma.$transaction(async (tx) => {
        await checkQueueOwnership(tx, 'REPORT', id, moderatorId);
        const reportUpdated = await tx.report.update({
            where: { id },
            data: {
                status,
                reviewedBy: moderatorId,
                moderatorNote: moderatorNote || null,
                reviewedAt: new Date(),
            },
            include: {
                reporter: { select: { id: true, fullName: true } },
                moderator: { select: { id: true, fullName: true } },
            },
        });
        const reportQueueItems = await tx.moderation_queue.findMany({
            where: {
                target_type: 'REPORT',
                target_id: id,
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
        });
        await tx.moderation_queue.updateMany({
            where: {
                target_type: 'REPORT',
                target_id: id,
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
            data: { status: 'RESOLVED', resolved_at: new Date(), assigned_to: moderatorId },
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
        // Log RESOLVE action for queue activity tracking
        for (const qi of reportQueueItems) {
            await tx.moderator_logs.create({
                data: {
                    moderator_id: moderatorId,
                    target_type: 'QUEUE',
                    target_id: qi.id,
                    action: 'RESOLVE',
                    previous_status: qi.status,
                    new_status: 'RESOLVED',
                    metadata: {
                        queue_target_type: qi.target_type,
                        queue_target_id: qi.target_id,
                        queue_category: qi.category,
                    },
                },
            });
        }
        return reportUpdated;
    });

    return { message: 'Đã xử lý báo cáo thành công', data: updated };
}

// ═══════════════════ Reviews (Feedback moderation) ═══════════════════

async function getReviewsForModeration(params) {
    const {
        page = 1,
        limit = 20,
        target_type,
        status,
        roomId,
        tenantId,
        dateFrom,
        dateTo,
    } = params;
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (target_type) where.target_type = target_type;
    if (status) where.status = status;
    if (roomId) where.target_id = roomId;
    if (tenantId) where.user_id = tenantId;
    if (dateFrom || dateTo) {
        where.created_at = {};
        if (dateFrom) where.created_at.gte = new Date(dateFrom);
        if (dateTo) where.created_at.lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    const orderDir = status === 'PENDING' ? 'asc' : 'desc';
    const [reviews, total] = await Promise.all([
        prisma.feedback.findMany({
            where,
            skip,
            take: limitNum,
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

    return {
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
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    };
}

async function getReviewDetail(reviewId) {
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
            users_feedback_reviewed_byTousers: { select: { id: true, fullName: true } },
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

    if (!feedback) throw Object.assign(new Error('Không tìm thấy feedback'), { statusCode: 404 });

    const period = feedback.room_rental_periods;
    const room = period?.room;
    const rental = room?.rentals;
    const loc = rental?.location;
    const address = loc ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ') : '';
    const startDate = period?.startDate;
    const endDate = period?.endDate;
    const daysRented =
        startDate && endDate
            ? Math.ceil((new Date(endDate) - new Date(startDate)) / (24 * 60 * 60 * 1000))
            : null;

    return {
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
    };
}

async function updateReviewStatus(reviewId, body, moderatorId) {
    const { status, moderatorNote } = body;
    const validStatuses = ['APPROVED', 'REJECTED', 'HIDDEN'];

    if (!status || !validStatuses.includes(status)) {
        throw Object.assign(new Error('status phải là APPROVED, REJECTED hoặc HIDDEN'), { statusCode: 400 });
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

    if (!existing) throw Object.assign(new Error('Không tìm thấy review'), { statusCode: 404 });

    if (status === 'HIDDEN') {
        if (existing.status !== 'APPROVED') {
            throw Object.assign(new Error('Chỉ có thể ẩn đánh giá đã được duyệt'), { statusCode: 400 });
        }
        const note = moderatorNote ? String(moderatorNote).trim() : '';
        if (note.length < 10) {
            throw Object.assign(new Error('Vui lòng nhập lý do ẩn (tối thiểu 10 ký tự)'), { statusCode: 400 });
        }
    } else if (status === 'REJECTED') {
        const note = moderatorNote ? String(moderatorNote).trim() : '';
        if (note.length < 10) {
            throw Object.assign(new Error('Vui lòng nhập lý do từ chối (tối thiểu 10 ký tự)'), { statusCode: 400 });
        }
    }

    if (existing.status !== 'PENDING' && status !== 'HIDDEN') {
        const moderatorName = existing.users_feedback_reviewed_byTousers?.fullName || 'moderator';
        throw Object.assign(new Error(`Đánh giá này đã được xử lý bởi ${moderatorName}`), { statusCode: 400 });
    }

    const noteValue = moderatorNote ? String(moderatorNote).trim() : null;
    const action = status === 'APPROVED' ? 'APPROVE' : status === 'REJECTED' ? 'REJECT' : 'HIDE';

    const updated = await prisma.$transaction(async (tx) => {
        await checkQueueOwnership(tx, 'FEEDBACK', reviewId, moderatorId);
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
                status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
            data: { status: 'RESOLVED', resolved_at: new Date(), assigned_to: moderatorId },
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

    const message =
        status === 'APPROVED'
            ? 'Đã duyệt đánh giá'
            : status === 'REJECTED'
              ? 'Đã từ chối đánh giá'
              : 'Đã ẩn đánh giá';

    return { message, data: { id: updated.id, status: updated.status } };
}

async function deleteReview(reviewId) {
    const existing = await prisma.feedback.findUnique({ where: { id: reviewId } });
    if (!existing) throw Object.assign(new Error('Không tìm thấy review'), { statusCode: 404 });

    await prisma.feedback.delete({ where: { id: reviewId } });

    return { message: 'Đã xóa review thành công', data: { id: reviewId } };
}

// ═══════════════════ Rejection Info (Audit Trail) ═══════════════════

async function getLatestRejection(targetType, targetId) {
    const log = await prisma.moderator_logs.findFirst({
        where: {
            target_type: targetType,
            target_id: targetId,
            action: 'REJECT',
        },
        orderBy: { created_at: 'desc' },
        include: {
            users: { select: { id: true, fullName: true } },
        },
    });

    if (!log) return { hasRejection: false };

    return {
        hasRejection: true,
        reason: log.note || null,
        moderatorName: log.users?.fullName || null,
        rejectedAt: log.created_at,
        previousStatus: log.previous_status,
        newStatus: log.new_status,
    };
}

async function getKpi(params = {}) {
    const { days = 30 } = params;
    const since = new Date();
    since.setDate(since.getDate() - Number(days));

    // Lấy tất cả logs trong khoảng thời gian
    const logs = await prisma.moderator_logs.findMany({
        where: { created_at: { gte: since } },
        include: { users: { select: { id: true, fullName: true, avatarUrl: true } } },
        orderBy: { created_at: 'asc' },
    });

    // Tổng hợp theo moderator
    const modMap = new Map();
    for (const log of logs) {
        const id = log.moderator_id;
        if (!modMap.has(id)) {
            modMap.set(id, {
                moderatorId: id,
                moderatorName: log.users?.fullName ?? id,
                totalActions: 0,
                approvals: 0,
                rejections: 0,
                reportHandled: 0,
                reviewHandled: 0,
                byDay: {},
            });
        }
        const m = modMap.get(id);
        m.totalActions++;

        const action = (log.action ?? '').toUpperCase();
        if (['APPROVE', 'APPROVE_LISTING', 'APPROVE_ROOM_POST'].includes(action)) m.approvals++;
        if (['REJECT', 'REJECT_LISTING', 'REJECT_ROOM_POST', 'HIDE', 'BAN', 'SUSPEND'].includes(action)) m.rejections++;
        if (log.target_type === 'REPORT') m.reportHandled++;
        if (log.target_type === 'FEEDBACK') m.reviewHandled++;

        // Group by date (YYYY-MM-DD)
        const day = log.created_at.toISOString().slice(0, 10);
        m.byDay[day] = (m.byDay[day] ?? 0) + 1;
    }

    // Tính avg actions/day và approval rate
    const moderators = Array.from(modMap.values()).map((m) => {
        const activeDays = Object.keys(m.byDay).length || 1;
        const avgPerDay = parseFloat((m.totalActions / activeDays).toFixed(1));
        const approvalRate = m.approvals + m.rejections > 0
            ? parseFloat(((m.approvals / (m.approvals + m.rejections)) * 100).toFixed(1))
            : null;
        return { ...m, avgPerDay, approvalRate, byDay: undefined };
    }).sort((a, b) => b.totalActions - a.totalActions);

    // Trend: actions per day (last N days, all moderators combined)
    const trendMap = {};
    for (let i = Number(days) - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const log of logs) {
        const day = log.created_at.toISOString().slice(0, 10);
        if (trendMap[day] !== undefined) trendMap[day]++;
    }
    const trend = Object.entries(trendMap).map(([date, count]) => ({ date, count }));

    // Action breakdown (all moderators)
    const actionBreakdown = {};
    for (const log of logs) {
        const a = log.action ?? 'UNKNOWN';
        actionBreakdown[a] = (actionBreakdown[a] ?? 0) + 1;
    }

    return {
        data: {
            period: { days: Number(days), since: since.toISOString() },
            moderators,
            trend,
            actionBreakdown,
            totals: {
                totalActions: logs.length,
                totalApprovals: moderators.reduce((s, m) => s + m.approvals, 0),
                totalRejections: moderators.reduce((s, m) => s + m.rejections, 0),
                totalReportsHandled: moderators.reduce((s, m) => s + m.reportHandled, 0),
                totalReviewsHandled: moderators.reduce((s, m) => s + m.reviewHandled, 0),
            },
        },
    };
}

async function getOverview() {
    const [
        openQueueCount,
        pendingRentalCount,
        pendingRoomPostCount,
        openReportCount,
        flaggedReviewCount,
        resolvedReportCount,
        approvedRentalCount,
        approvedRoomPostCount,
        approvedReviewCount,
        rejectedReviewCount
    ] = await Promise.all([
        prisma.moderation_queue.count({ where: { status: 'OPEN' } }),
        prisma.rental.count({ where: { status: { in: ['PENDING', 'HIDDEN'] } } }),
        prisma.rooms.count({ where: { status: 'PENDING' } }),
        prisma.report.count({ where: { status: 'PENDING' } }),
        prisma.feedback.count({ where: { status: 'PENDING' } }),
        prisma.report.count({ where: { status: { in: ['APPROVED', 'REJECTED'] } } }),
        prisma.rental.count({ where: { status: { notIn: ['PENDING', 'HIDDEN', 'VIOLATE'] } } }),
        prisma.rooms.count({ where: { status: { notIn: ['PENDING', 'MAINTENANCE'] } } }),
        prisma.feedback.count({ where: { status: 'APPROVED' } }),
        prisma.feedback.count({ where: { status: { in: ['REJECTED', 'HIDDEN'] } } })
    ]);

    return {
        data: {
            openQueueCount,
            pendingRentalCount,
            pendingRoomPostCount,
            openReportCount,
            flaggedReviewCount,
            resolvedReportCount,
            approvedRentalCount,
            approvedRoomPostCount,
            approvedReviewCount,
            rejectedReviewCount
        }
    };
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
    getQueueActivity,
    getModerationQueue,
    assignQueueItem,
    releaseQueueItem,
    getReports,
    handleReport,
    getReviewsForModeration,
    getReviewDetail,
    updateReviewStatus,
    deleteReview,
    getQueueStatusForTarget,
    getModeratorList,
    getLatestRejection,
    getOverview,
    getKpi,
    autoAssignNewTask: addToModerationQueue, // alias for legacy code just in case
    addToModerationQueue,
};
