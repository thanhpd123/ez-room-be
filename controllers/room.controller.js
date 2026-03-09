const prisma = require('../config/prisma');
const cache = require('../utils/simple-cache');
const { mapFeToDb, mapDbToFe } = require('../utils/room-type-mapper');
const { sendEmail } = require('../utils/email');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';

/**
 * Format room response - trả về cả 2 format (standard + FE room-post)
 */
function formatRoomResponse(room) {
    return {
        // Standard format
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
        // FE room-post format (alias)
        room_post_id: room.id,
        rental_id: room.rental_id,
        title: room.room_name || '',
        description: room.description,
        area: room.size_m2 ? Number(room.size_m2) : 0,
        max_occupants: room.max_people || 1,
        status: room.status,
        thumbnail_url: room.images?.[0]?.imageUrl || null,
        images: (room.images || []).map((img) => img.imageUrl),
        amenities: (room.roomAmenities || []).map((ra) => ({
            id: ra.amenity?.id,
            name: ra.amenity?.name,
        })),
        created_at: room.created_at?.toISOString() || new Date().toISOString(),
    };
}

/**
 * POST /rooms
 * Tạo room mới (LANDLORD - chỉ owner của rental mới được tạo)
 * Body: { rental_id, title, description?, price, area?, max_occupants?, status?, roomType?, images?, amenityIds? }
 */
async function createRoom(req, res) {
    try {
        const userId = req.auth.user.id;

        // Support cả 2 format
        const rentalId = req.body.rentalId || req.body.rental_id;
        const roomName = req.body.roomName || req.body.title;
        const description = req.body.description;
        const roomType = req.body.roomType;
        const price = req.body.price;
        const sizeM2 = req.body.sizeM2 || req.body.area;
        const maxPeople = req.body.maxPeople || req.body.max_occupants;
        const status = req.body.status;
        const images = req.body.images || (req.body.thumbnail_url ? [req.body.thumbnail_url] : []);
        const amenityIds = req.body.amenityIds;

        // Validate
        if (!rentalId) {
            return res.status(400).json({ success: false, message: 'Thiếu rental_id' });
        }
        if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
            return res.status(400).json({ success: false, message: 'Giá phòng không hợp lệ' });
        }

        // Kiểm tra rental tồn tại và thuộc về user này
        const rental = await prisma.rental.findUnique({
            where: { id: rentalId },
            select: { id: true, owner_id: true },
        });

        if (!rental) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bất động sản' });
        }

        if (rental.owner_id !== userId) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền thêm phòng cho bất động sản này' });
        }

        // Tạo room
        // Bỏ qua status từ frontend - sử dụng default PENDING từ database
        const room = await prisma.rooms.create({
            data: {
                rental_id: rentalId,
                room_name: roomName ? roomName.trim() : null,
                description: description ? description.trim() : null,
                room_type: mapFeToDb(roomType),
                price: parseFloat(price),
                size_m2: sizeM2 ? parseFloat(sizeM2) : null,
                max_people: maxPeople ? parseInt(maxPeople) : 1,
                // status: sử dụng default từ schema (PENDING)
                ...(images && images.length > 0 ? {
                    images: {
                        create: images.map((url) => ({ imageUrl: url })),
                    },
                } : {}),
                ...(amenityIds && amenityIds.length > 0 ? {
                    roomAmenities: {
                        create: amenityIds.map((amenityId) => ({ amenityId })),
                    },
                } : {}),
            },
            include: {
                images: true,
                roomAmenities: { include: { amenity: true } },
            },
        });

        return res.status(201).json({
            success: true,
            message: 'Tạo phòng thành công',
            data: formatRoomResponse(room),
        });
    } catch (err) {
        console.error('Create room error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tạo phòng',
            error: err.message,
        });
    }
}

/**
 * GET /rooms
 * Lấy danh sách rooms (public)
 * Query: ?rentalId=xxx&rental_id=xxx&roomType=single&minPrice=&maxPrice=&page=1&limit=20
 */
async function getRooms(req, res) {
    try {
        const { rentalId, rental_id, roomType, minPrice, maxPrice, page = '1', limit = '20' } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * pageSize;

        const where = {};
        // Support both rentalId and rental_id
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
        console.error('Get rooms error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách phòng', error: err.message });
    }
}

/**
 * GET /rooms/:roomId
 * Lấy chi tiết một room (public)
 */
async function getRoomById(req, res) {
    try {
        const { roomId } = req.params;

        const room = await prisma.rooms.findUnique({
            where: { id: roomId },
            include: {
                images: true,
                roomAmenities: { include: { amenity: true } },
                rentals: {
                    include: {
                        location: true,
                        users: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true } },
                    },
                },
            },
        });

        if (!room) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        }

        return res.json({
            success: true,
            data: {
                ...formatRoomResponse(room),
                rental: room.rentals ? {
                    id: room.rentals.id,
                    title: room.rentals.title,
                    description: room.rentals.description,
                    status: room.rentals.status,
                    location: room.rentals.location ? {
                        address: room.rentals.location.address,
                        district: room.rentals.location.district,
                        city: room.rentals.location.city,
                    } : null,
                    owner: room.rentals.users ? {
                        id: room.rentals.users.id,
                        fullName: room.rentals.users.fullName,
                        email: room.rentals.users.email,
                        phone: room.rentals.users.phone,
                        avatarUrl: room.rentals.users.avatarUrl,
                    } : null,
                } : null,
            },
        });
    } catch (err) {
        console.error('Get room by id error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi lấy chi tiết phòng', error: err.message });
    }
}

/**
 * When a room status changes from RENTED to AVAILABLE, email and notify users who favourited it.
 */
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

/**
 * PUT /rooms/:roomId
 * Cập nhật room (LANDLORD - chỉ owner của rental)
 */
async function updateRoom(req, res) {
    try {
        const userId = req.auth.user.id;
        const { roomId } = req.params;

        const existingRoom = await prisma.rooms.findUnique({
            where: { id: roomId },
            include: { rentals: { select: { owner_id: true } } },
        });

        if (!existingRoom) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        }

        if (existingRoom.rentals.owner_id !== userId) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền sửa phòng này' });
        }

        const updateData = {};
        const roomName = req.body.roomName || req.body.title;
        if (roomName !== undefined) updateData.room_name = roomName?.trim() || null;
        if (req.body.roomType !== undefined) updateData.room_type = mapFeToDb(req.body.roomType);
        if (req.body.price !== undefined) updateData.price = parseFloat(req.body.price);
        const sizeM2 = req.body.sizeM2 || req.body.area;
        if (sizeM2 !== undefined) updateData.size_m2 = parseFloat(sizeM2);
        const maxPeople = req.body.maxPeople || req.body.max_occupants;
        if (maxPeople !== undefined) updateData.max_people = parseInt(maxPeople);
        const newStatus = req.body.status;
        const statusUpper = typeof newStatus === 'string' ? newStatus.toUpperCase() : null;
        if (statusUpper && ['PENDING', 'AVAILABLE', 'RENTED', 'MAINTENANCE'].includes(statusUpper)) {
            updateData.status = statusUpper;
        }

        const previousStatus = existingRoom.status;
        const room = await prisma.rooms.update({
            where: { id: roomId },
            data: updateData,
            include: { images: true, roomAmenities: { include: { amenity: true } }, rentals: { include: { location: true } } },
        });

        // When room becomes AVAILABLE from RENTED, notify users who favourited this room
        if (previousStatus === 'RENTED' && room.status === 'AVAILABLE') {
            notifyFavoritersRoomAvailable(room).catch((err) => console.error('Notify favoriters error:', err));
        }

        return res.json({
            success: true,
            message: 'Cập nhật phòng thành công',
            data: formatRoomResponse(room),
        });
    } catch (err) {
        console.error('Update room error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi cập nhật phòng', error: err.message });
    }
}

/**
 * DELETE /rooms/:roomId
 * Xóa room (LANDLORD - chỉ owner của rental)
 */
async function deleteRoom(req, res) {
    try {
        const userId = req.auth.user.id;
        const { roomId } = req.params;

        const existingRoom = await prisma.rooms.findUnique({
            where: { id: roomId },
            include: { rentals: { select: { owner_id: true } } },
        });

        if (!existingRoom) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        }

        if (existingRoom.rentals.owner_id !== userId) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa phòng này' });
        }

        await prisma.rooms.delete({ where: { id: roomId } });

        return res.json({ success: true, message: 'Xóa phòng thành công' });
    } catch (err) {
        console.error('Delete room error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi xóa phòng', error: err.message });
    }
}

const AMENITIES_CACHE_KEY = 'rooms:amenities';

/**
 * GET /rooms/amenities
 * Lấy danh sách amenities (public)
 */
async function getAmenities(req, res) {
    try {
        const cached = cache.get(AMENITIES_CACHE_KEY);
        if (cached) {
            return res.json({ success: true, data: cached });
        }
        const amenities = await prisma.amenities.findMany({ orderBy: { name: 'asc' } });
        const data = amenities.map((a) => ({ id: a.id, name: a.name }));
        cache.set(AMENITIES_CACHE_KEY, data);
        return res.json({
            success: true,
            data,
        });
    } catch (err) {
        console.error('Get amenities error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách tiện ích', error: err.message });
    }
}

/**
 * PUT /rooms/:roomId/moderate
 * Moderator duyệt / từ chối room post
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
        console.error('Moderate room error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi khi duyệt phòng', error: err.message });
    }
}

module.exports = {
    createRoom,
    getRooms,
    getRoomById,
    updateRoom,
    deleteRoom,
    getAmenities,
    moderateRoom,
};
