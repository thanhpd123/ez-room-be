const prisma = require('../config/prisma');
const cache = require('../utils/simple-cache');
const feedbackConfig = require('../config/feedback.config');
const { mapFeToDb, mapDbToFe } = require('../utils/room-type-mapper');
const { sendEmail } = require('../utils/email');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const AMENITIES_CACHE_KEY = 'rooms:amenities';
const FREE_TIER_LANDLORD_MAX_ROOMS = Math.max(
    1,
    Number(process.env.FREE_TIER_LANDLORD_MAX_ROOMS || 5)
);

function isActiveVipLandlord(authUser) {
    if (!authUser) return false;
    return authUser.role === 'LANDLORD' && authUser.isVip === true;
}

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
        description: room.description,
        area: room.size_m2 ? Number(room.size_m2) : 0,
        max_occupants: room.max_people || 1,
        status: room.status,
        thumbnail_url: room.images?.[0]?.imageUrl || null,
        created_at: room.created_at?.toISOString() || new Date().toISOString(),
    };
}

async function notifyFavoritersRoomAvailable(room) {
    const favoriters = await prisma.favoriteRoom.findMany({
        where: { roomId: room.id },
        include: { user: { select: { id: true, email: true, fullName: true } } },
    });
    if (favoriters.length === 0) return;

    const rental = room.rentals;
    const loc = rental?.location;
    const roomTitle = room.room_name || rental?.title || 'Phòng trọ';
    const address = loc ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ') : '';
    const roomUrl = `${FRONTEND_URL.replace(/\/$/, '')}/room/${room.id}`;
    const subject = `EzRoom – Phòng bạn quan tâm đã có sẵn: ${roomTitle}`;
    const text = `Chào bạn,\n\nPhòng "${roomTitle}" (${address}) mà bạn đã lưu vào danh sách yêu thích hiện đã có sẵn để cho thuê.\n\nXem chi tiết: ${roomUrl}\n\n— EzRoom`;
    const html = `<p>Chào bạn,</p><p>Phòng <strong>${roomTitle}</strong> (${address}) mà bạn đã lưu vào danh sách yêu thích hiện đã có sẵn để cho thuê.</p><p><a href="${roomUrl}">Xem chi tiết</a></p><p>— EzRoom</p>`;

    for (const fav of favoriters) {
        const user = fav.user;
        if (user && user.email) {
            await sendEmail(user.email, subject, text, html);
            await prisma.notification.create({
                data: {
                    userId: user.id,
                    type: 'FAVORITE',
                    title: `Phòng "${roomTitle}" đã có sẵn`,
                    body: `Phòng bạn đã lưu tại ${address} hiện đã có sẵn.`,
                    status: 'UNREAD',
                },
            });
        }
    }
}

function mapRentalPeriodStatus(s) {
    const m = { ACTIVE: 'active', COMPLETED: 'completed', CANCELLED: 'cancelled', OVERDUE: 'active' };
    return m[s] || 'active';
}

async function createRoom(userId, body, authUser = null) {
    const rentalId = body.rentalId || body.rental_id;
    const roomName = body.roomName || body.title;
    const description = body.description;
    const roomType = body.roomType;
    const price = body.price;
    const sizeM2 = body.sizeM2 || body.area;
    const maxPeople = body.maxPeople || body.max_occupants;
    const images = body.images || (body.thumbnail_url ? [body.thumbnail_url] : []);
    const amenityIds = body.amenityIds;

    if (!rentalId) {
        throw Object.assign(new Error('Thiếu rental_id'), { statusCode: 400 });
    }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
        throw Object.assign(new Error('Giá phòng không hợp lệ'), { statusCode: 400 });
    }

    const rental = await prisma.rental.findUnique({
        where: { id: rentalId },
        select: { id: true, owner_id: true },
    });

    if (!rental) {
        throw Object.assign(new Error('Không tìm thấy bất động sản'), { statusCode: 404 });
    }

    if (rental.owner_id !== userId) {
        throw Object.assign(new Error('Bạn không có quyền thêm phòng cho bất động sản này'), { statusCode: 403 });
    }

    const vipLandlord = isActiveVipLandlord(authUser);
    if (!vipLandlord) {
        const ownedRoomsCount = await prisma.rooms.count({
            where: {
                rentals: {
                    owner_id: userId,
                },
            },
        });

        if (ownedRoomsCount >= FREE_TIER_LANDLORD_MAX_ROOMS) {
            const err = new Error(
                `Tài khoản thường chỉ có thể đăng tối đa ${FREE_TIER_LANDLORD_MAX_ROOMS} phòng. Vui lòng nâng cấp VIP để mở rộng quota.`
            );
            err.statusCode = 403;
            err.code = 'FREE_TIER_ROOM_LIMIT_REACHED';
            err.upgradePath = '/vip-plans';
            throw err;
        }
    }

    const room = await prisma.$transaction(async (tx) => {
        const created = await tx.rooms.create({
            data: {
                rental_id: rentalId,
                room_name: roomName ? roomName.trim() : null,
                description: description ? description.trim() : null,
                room_type: mapFeToDb(roomType),
                price: parseFloat(price),
                size_m2: sizeM2 ? parseFloat(sizeM2) : null,
                max_people: maxPeople ? parseInt(maxPeople) : 1,
                ...(images && images.length > 0
                    ? { images: { create: images.map((url) => ({ imageUrl: url })) } }
                    : {}),
                ...(amenityIds && amenityIds.length > 0
                    ? { roomAmenities: { create: amenityIds.map((amenityId) => ({ amenityId })) } }
                    : {}),
            },
            include: {
                images: true,
                roomAmenities: { include: { amenity: true } },
            },
        });
        await tx.moderation_queue.create({
            data: {
                target_type: 'ROOM',
                target_id: created.id,
                priority: vipLandlord ? 'HIGH' : 'NORMAL',
                category: 'NEW_LISTING',
                source: 'SYSTEM',
            },
        });
        return created;
    });

    return { message: 'Tạo phòng thành công', data: formatRoomResponse(room) };
}

async function getRooms(params) {
    const {
        rentalId,
        rental_id,
        roomType,
        minPrice,
        maxPrice,
        status,
        includeAllStatuses,
        page = 1,
        limit = 20,
    } = params;
    const pageNum = Math.max(1, parseInt(page));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * pageSize;

    const where = {};
    const filterRentalId = rentalId || rental_id;
    if (filterRentalId) where.rental_id = filterRentalId;
    if (roomType) where.room_type = mapFeToDb(roomType);
    const includeAll = String(includeAllStatuses || '').toLowerCase() === 'true';
    if (status) {
        const normalized = String(status).toUpperCase();
        if (['PENDING', 'AVAILABLE', 'RENTED', 'MAINTENANCE'].includes(normalized)) {
            where.status = normalized;
        }
    } else if (!includeAll) {
        where.status = { in: ['AVAILABLE', 'RENTED'] };
    }
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

async function getRoomById(roomId) {
    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
            images: true,
            roomAmenities: { include: { amenity: true } },
            rentals: {
                include: {
                    location: true,
                    users: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            phone: true,
                            avatarUrl: true,
                        },
                    },
                },
            },
        },
    });

    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    // Increment overall search_count (async, don't await)
    prisma.rooms.update({
        where: { id: roomId },
        data: { search_count: { increment: 1 } },
    }).catch(err => console.error('Error incrementing search_count:', err));

    return {
        data: {
            ...formatRoomResponse(room),
            rental: room.rentals
                ? {
                    id: room.rentals.id,
                    title: room.rentals.title,
                    description: room.rentals.description,
                    status: room.rentals.status,
                    location: room.rentals.location
                        ? {
                            address: room.rentals.location.address,
                            district: room.rentals.location.district,
                            city: room.rentals.location.city,
                        }
                        : null,
                    owner: room.rentals.users
                        ? {
                            id: room.rentals.users.id,
                            fullName: room.rentals.users.fullName,
                            email: room.rentals.users.email,
                            phone: room.rentals.users.phone,
                            avatarUrl: room.rentals.users.avatarUrl,
                        }
                        : null,
                }
                : null,
        },
    };
}

async function updateRoom(roomId, userId, body) {
    const existingRoom = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { rentals: { select: { owner_id: true } } },
    });

    if (!existingRoom) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    if (existingRoom.rentals.owner_id !== userId) {
        throw Object.assign(new Error('Bạn không có quyền sửa phòng này'), { statusCode: 403 });
    }

    // Khi resubmit: cho phép chỉnh sửa phòng bị từ chối (MAINTENANCE) và gửi lại để duyệt
    const isResubmit = body.resubmit === true && existingRoom.status === 'MAINTENANCE';

    // Khi edit phòng đã duyệt (AVAILABLE): auto chuyển PENDING để moderator duyệt lại
    const isEditApproved = existingRoom.status === 'AVAILABLE';

    // Chặn edit khi đang chờ duyệt (PENDING)
    if (!isResubmit && existingRoom.status === 'PENDING') {
        throw Object.assign(
            new Error('Phòng đang chờ duyệt. Vui lòng đợi moderator xử lý trước khi chỉnh sửa.'),
            { statusCode: 403 }
        );
    }

    const needsModeration = isResubmit || isEditApproved;

    const updateData = {};
    const roomName = body.roomName || body.title;
    if (roomName !== undefined) updateData.room_name = roomName?.trim() || null;
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.roomType !== undefined) updateData.room_type = mapFeToDb(body.roomType);
    if (body.price !== undefined) updateData.price = parseFloat(body.price);
    const sizeM2 = body.sizeM2 || body.area;
    if (sizeM2 !== undefined) updateData.size_m2 = parseFloat(sizeM2);
    const maxPeople = body.maxPeople || body.max_occupants;
    if (maxPeople !== undefined) updateData.max_people = parseInt(maxPeople);

    if (needsModeration) {
        // Resubmit hoặc edit bài đã duyệt: đổi status về PENDING
        updateData.status = 'PENDING';
    } else {
        const newStatus = body.status;
        const statusUpper = typeof newStatus === 'string' ? newStatus.toUpperCase() : null;
        if (statusUpper && ['PENDING', 'AVAILABLE', 'RENTED', 'MAINTENANCE'].includes(statusUpper)) {
            updateData.status = statusUpper;
        }
    }

    const previousStatus = existingRoom.status;

    const room = await prisma.$transaction(async (tx) => {
        const updated = await tx.rooms.update({
            where: { id: roomId },
            data: updateData,
            include: {
                images: true,
                roomAmenities: { include: { amenity: true } },
                rentals: { include: { location: true } },
            },
        });

        // Resubmit hoặc edit bài đã duyệt: tạo mục mới trong moderation queue
        if (needsModeration) {
            await tx.moderation_queue.create({
                data: {
                    target_type: 'ROOM',
                    target_id: roomId,
                    priority: 'NORMAL',
                    category: 'NEW_LISTING',
                    source: 'SYSTEM',
                },
            });
        }

        return updated;
    });

    if (previousStatus === 'RENTED' && room.status === 'AVAILABLE') {
        notifyFavoritersRoomAvailable(room).catch((err) => console.error('Notify favoriters error:', err));
    }

    const message = isResubmit
        ? 'Đã gửi lại phòng để duyệt'
        : needsModeration
            ? 'Đã cập nhật và gửi phòng để duyệt lại'
            : 'Cập nhật phòng thành công';

    return { message, data: formatRoomResponse(room) };
}

async function deleteRoom(roomId, userId) {
    const existingRoom = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { rentals: { select: { owner_id: true } } },
    });

    if (!existingRoom) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    if (existingRoom.rentals.owner_id !== userId) {
        throw Object.assign(new Error('Bạn không có quyền xóa phòng này'), { statusCode: 403 });
    }

    await prisma.rooms.delete({ where: { id: roomId } });

    return { message: 'Xóa phòng thành công' };
}

async function getAmenities() {
    const cached = cache.get(AMENITIES_CACHE_KEY);
    if (cached) return { data: cached };
    const amenities = await prisma.amenities.findMany({ orderBy: { name: 'asc' } });
    const data = amenities.map((a) => ({ id: a.id, name: a.name }));
    cache.set(AMENITIES_CACHE_KEY, data);
    return { data };
}

async function moderateRoom(roomId, body) {
    const { decision, note } = body;

    if (!decision || !['approved', 'rejected'].includes(decision)) {
        throw Object.assign(new Error('decision phải là approved hoặc rejected'), { statusCode: 400 });
    }

    const room = await prisma.rooms.findUnique({ where: { id: roomId } });
    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
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

    return {
        message: decision === 'approved' ? 'Đã duyệt phòng' : 'Đã từ chối phòng',
        data: formatRoomResponse(updated),
    };
}

async function getRoomTenants(roomId, userId) {
    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        select: { rental_id: true, rentals: { select: { owner_id: true } } },
    });

    if (!room) {
        throw Object.assign(new Error('Phòng không tồn tại'), { statusCode: 404 });
    }

    if (room.rentals.owner_id !== userId) {
        throw Object.assign(new Error('Không có quyền xem thông tin này'), { statusCode: 403 });
    }

    const [rentalPeriods, preorders] = await Promise.all([
        prisma.roomRentalPeriod.findMany({
            where: { roomId },
            include: {
                tenant: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        avatarUrl: true,
                    },
                },
            },
            orderBy: { startDate: 'desc' },
        }),
        prisma.preorder.findMany({
            where: { roomId },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        avatarUrl: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        }),
    ]);

    return {
        data: {
            rentals: rentalPeriods.map((rp) => ({
                id: rp.id,
                tenantId: rp.userId,
                tenant: rp.tenant,
                startDate: rp.startDate,
                endDate: rp.endDate,
                actualPrice: Number(rp.actualPrice),
                deposit: rp.deposit ? Number(rp.deposit) : 0,
                status: rp.status,
                type: 'rental',
            })),
            preorders: preorders.map((po) => ({
                id: po.id,
                userId: po.userId,
                user: po.user,
                depositAmount: po.deposit_amount ? Number(po.deposit_amount) : 0,
                paymentStatus: po.payment_status,
                status: po.status,
                refundStatus: po.refund_status,
                createdAt: po.createdAt,
                type: 'preorder',
            })),
        },
    };
}

async function searchTenants(q) {
    const qTrim = (q || '').trim();
    if (!qTrim || qTrim.length < 2) {
        throw Object.assign(
            new Error('Nhập ít nhất 2 ký tự để tìm kiếm (email hoặc số điện thoại)'),
            { statusCode: 400 }
        );
    }

    const qNorm = qTrim.replace(/\s/g, '');
    const users = await prisma.user.findMany({
        where: {
            role: 'TENANT',
            status: 'ACTIVE',
            OR: [
                { email: { contains: qTrim, mode: 'insensitive' } },
                ...(qNorm ? [{ phone: { contains: qNorm } }] : []),
            ],
        },
        select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            gender: true,
        },
        take: 10,
    });

    return {
        data: users.map((u) => ({
            id: u.id,
            fullName: u.fullName,
            email: u.email,
            phone: u.phone || null,
            avatarUrl: u.avatarUrl || null,
            gender: u.gender || null,
        })),
    };
}

async function createRentalContract(roomId, userId, body) {
    const { tenantId, startDate, endDate, actualPrice, deposit } = body;

    if (!tenantId || !startDate || actualPrice == null) {
        throw Object.assign(new Error('Thiếu thông tin: tenantId, startDate, actualPrice'), { statusCode: 400 });
    }

    const actualPriceNum = parseFloat(actualPrice);
    const depositNum = deposit != null ? parseFloat(deposit) : 0;
    if (isNaN(actualPriceNum) || actualPriceNum <= 0) {
        throw Object.assign(new Error('Giá thuê không hợp lệ'), { statusCode: 400 });
    }

    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
        throw Object.assign(new Error('Ngày bắt đầu không hợp lệ'), { statusCode: 400 });
    }

    let end = null;
    if (endDate) {
        end = new Date(endDate);
        if (isNaN(end.getTime())) {
            throw Object.assign(new Error('Ngày kết thúc không hợp lệ'), { statusCode: 400 });
        }
    }

    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { rentals: { select: { owner_id: true, title: true } } },
    });

    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    if (room.rentals.owner_id !== userId) {
        throw Object.assign(
            new Error('Bạn không có quyền tạo hợp đồng cho phòng này'),
            { statusCode: 403 }
        );
    }

    if (room.status === 'MAINTENANCE' || room.status === 'PENDING') {
        throw Object.assign(new Error('Phòng chưa sẵn sàng để cho thuê'), { statusCode: 400 });
    }

    const activeContractsCount = await prisma.roomRentalPeriod.count({
        where: { roomId, status: 'ACTIVE' },
    });

    if (activeContractsCount >= (room.max_people || 1)) {
        throw Object.assign(new Error(`Phòng đã đạt số người ở tối đa (${room.max_people} người)`), { statusCode: 400 });
    }

    const tenant = await prisma.user.findUnique({
        where: { id: tenantId },
        select: { id: true, status: true, fullName: true },
    });

    if (!tenant) {
        throw Object.assign(new Error('Người dùng không tồn tại'), { statusCode: 404 });
    }

    if (tenant.status === 'SUSPENDED' || tenant.status === 'BANNED') {
        throw Object.assign(new Error('Người dùng không hợp lệ'), { statusCode: 400 });
    }

    const existingActive = await prisma.roomRentalPeriod.findFirst({
        where: {
            roomId,
            userId: tenantId,
            status: 'ACTIVE',
        },
    });

    if (existingActive) {
        throw Object.assign(new Error('Người này đang thuê phòng này rồi'), { statusCode: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
        const period = await tx.roomRentalPeriod.create({
            data: {
                roomId,
                userId: tenantId,
                startDate: start,
                endDate: end,
                actualPrice: actualPriceNum,
                deposit: depositNum,
                status: 'ACTIVE',
            },
            include: {
                tenant: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        const newCount = activeContractsCount + 1;
        if (newCount >= (room.max_people || 1)) {
            await tx.rooms.update({
                where: { id: roomId },
                data: { status: 'RENTED' },
            });
        }

        const roomTitle = room.room_name || room.rentals?.title || 'Phòng trọ';
        await tx.notification.create({
            data: {
                userId: tenantId,
                type: 'ROOM_MATCH',
                title: 'Bạn đã được gán vào phòng',
                body: `Chủ trọ đã tạo hợp đồng thuê phòng "${roomTitle}" cho bạn. Vào Lịch sử thuê phòng để xem chi tiết.`,
                status: 'UNREAD',
            },
        });

        return period;
    });

    return {
        message: 'Tạo hợp đồng thuê thành công',
        data: {
            id: result.id,
            roomId: result.roomId,
            tenant: result.tenant,
            startDate: result.startDate,
            endDate: result.endDate,
            actualPrice: Number(result.actualPrice),
            deposit: result.deposit ? Number(result.deposit) : 0,
            status: result.status,
        },
    };
}

async function getMyBookings(userId) {
    const periods = await prisma.roomRentalPeriod.findMany({
        where: { userId },
        include: {
            room: {
                include: {
                    images: { take: 1 },
                    rentals: {
                        include: {
                            location: true,
                            images: { take: 1 },
                        },
                    },
                },
            },
            feedback: true,
        },
        orderBy: { startDate: 'desc' },
    });

    const now = Date.now();
    const MIN_MS = feedbackConfig.MIN_RENTAL_DURATION_MS;

    const bookings = periods.map((p) => {
        const startMs = new Date(p.startDate).getTime();
        const diffMs = now - startMs;
        const eligibleToReview = diffMs >= MIN_MS;
        const hasFeedback = p.feedback && p.feedback.length > 0;
        const latestFeedback = hasFeedback ? p.feedback[0] : null;
        const feedbackStatus = latestFeedback ? latestFeedback.status : null;

        const canReview =
            p.status === 'ACTIVE' &&
            (!hasFeedback || feedbackStatus === 'REJECTED') &&
            eligibleToReview;
        const canReviewDisabled =
            p.status === 'ACTIVE' &&
            (!hasFeedback || feedbackStatus === 'REJECTED') &&
            !eligibleToReview;

        const room = p.room;
        const rental = room?.rentals;
        const address = rental?.location
            ? [rental.location.address, rental.location.district, rental.location.city].filter(Boolean).join(', ')
            : '';

        return {
            id: p.id,
            rentalPeriodId: p.id,
            roomId: room?.id,
            roomName: room?.room_name || 'Phòng',
            propertyName: rental?.title || 'Bất động sản',
            propertyImage: room?.images?.[0]?.imageUrl || rental?.images?.[0]?.imageUrl || '',
            address,
            landlordName: null,
            startDate: p.startDate,
            endDate: p.endDate,
            status: mapRentalPeriodStatus(p.status),
            hasReview: hasFeedback,
            userRating: latestFeedback?.rating ?? undefined,
            feedbackId: latestFeedback?.id,
            feedbackStatus: feedbackStatus,
            moderatorNote: latestFeedback?.moderator_note ?? undefined,
            canReview,
            canReviewDisabled,
        };
    });

    const rentalIds = [...new Set(periods.map((p) => p.room?.rentals?.id).filter(Boolean))];
    if (rentalIds.length > 0) {
        const rentals = await prisma.rental.findMany({
            where: { id: { in: rentalIds } },
            include: { users: { select: { fullName: true } } },
        });
        const landlordMap = new Map(rentals.map((r) => [r.id, r.users?.fullName || 'Chủ nhà']));
        periods.forEach((p, i) => {
            const rid = p.room?.rentals?.id;
            if (rid) bookings[i].landlordName = landlordMap.get(rid) || 'Chủ nhà';
        });
    }

    // Fetch roommates: other active tenants in the same rooms
    const roomIds = [...new Set(periods.map((p) => p.room?.id).filter(Boolean))];
    if (roomIds.length > 0) {
        const otherPeriods = await prisma.roomRentalPeriod.findMany({
            where: {
                roomId: { in: roomIds },
                status: 'ACTIVE',
                userId: { not: userId },
            },
            include: {
                tenant: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        // Group roommates by roomId
        const roommatesByRoom = new Map();
        for (const op of otherPeriods) {
            const list = roommatesByRoom.get(op.roomId) || [];
            list.push({
                id: op.tenant.id,
                fullName: op.tenant.fullName,
                email: op.tenant.email || null,
                phone: op.tenant.phone || null,
                avatarUrl: op.tenant.avatarUrl || null,
            });
            roommatesByRoom.set(op.roomId, list);
        }
        // Attach to bookings
        bookings.forEach((b, i) => {
            b.roommates = roommatesByRoom.get(b.roomId) || [];
        });
    }

    return { data: bookings };
}

async function getRoomByIdForSearchRoomate(roomId, userId = null) {
    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
            images: true,
            roomAmenities: { include: { amenity: true } },
            rentals: {
                include: {
                    location: true,
                    users: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            phone: true,
                            avatarUrl: true,
                        },
                    },
                },
            },
        },
    });

    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    // Tăng search_count
    prisma.rooms.update({
        where: { id: roomId },
        data: { search_count: { increment: 1 } },
    }).catch(err => console.error('Error incrementing search_count:', err));

    // Ghi nhận tương tác VIEW
    if (userId) {
        prisma.user_room_interactions.create({
            data: {
                user_id: userId,
                room_id: roomId,
                interaction_type: 'VIEW',
            },
        }).catch(err => console.error('Error tracking room view:', err));
    }

    return {
        data: {
            ...formatRoomResponse(room),
            rental: room.rentals
                ? {
                    id: room.rentals.id,
                    title: room.rentals.title,
                    description: room.rentals.description,
                    status: room.rentals.status,
                    location: room.rentals.location
                        ? {
                            address: room.rentals.location.address,
                            district: room.rentals.location.district,
                            city: room.rentals.location.city,
                            ward: room.rentals.location.ward,
                        }
                        : null,
                    owner: room.rentals.users,
                }
                : null,
        },
    };
}

module.exports = {
    createRoom,
    getRooms,
    getRoomById,
    updateRoom,
    deleteRoom,
    getAmenities,
    moderateRoom,
    getRoomTenants,
    searchTenants,
    createRentalContract,
    getMyBookings,
    getRoomByIdForSearchRoomate,
};
