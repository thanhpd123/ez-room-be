const prisma = require('../config/prisma');
const { mapDbToFe } = require('../utils/room-type-mapper');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const placeholderImage = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800';

function formatRoomForFavorite(room) {
    const rental = room.rentals;
    const loc = rental?.location;
    const roomImgs = (room.images || []).map((img) => img.imageUrl);
    const rentalImgs = (rental?.images || []).map((img) => img.imageUrl);
    const imgs = roomImgs.length > 0 ? roomImgs : rentalImgs;
    const amenityNames = (room.roomAmenities || []).map((ra) => ra.amenity?.name).filter(Boolean);
    const address = loc ? [loc.address, loc.district, loc.city].filter(Boolean).join(', ') : '';

    return {
        id: room.id,
        rentalId: rental?.id,
        roomName: room.room_name,
        title: rental?.title || room.room_name || 'Phòng trọ',
        price: Number(room.price),
        area: room.size_m2 != null ? Number(room.size_m2) : null,
        roomType: room.room_type ? mapDbToFe(room.room_type, 'single') : null,
        address,
        images: imgs.length > 0 ? imgs : [placeholderImage],
        amenities: amenityNames,
        location: loc ? { district: loc.district, city: loc.city } : null,
        status: room.status,
        available: room.status === 'AVAILABLE',
    };
}

/**
 * POST /favorites/:roomId – Add room to favorites (TENANT/auth required)
 */
async function addFavorite(req, res) {
    try {
        const userId = req.auth.user.id;
        const { roomId } = req.params;

        const room = await prisma.rooms.findUnique({
            where: { id: roomId },
            include: { rentals: { include: { location: true } } },
        });
        if (!room) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
        }

        await prisma.favoriteRoom.upsert({
            where: {
                userId_roomId: { userId, roomId },
            },
            create: { userId, roomId },
            update: {},
        });

        return res.json({
            success: true,
            message: 'Đã thêm vào danh sách yêu thích',
            data: { roomId },
        });
    } catch (err) {
        console.error('Add favorite error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi thêm yêu thích',
            error: err.message,
        });
    }
}

/**
 * DELETE /favorites/:roomId – Remove room from favorites
 */
async function removeFavorite(req, res) {
    try {
        const userId = req.auth.user.id;
        const { roomId } = req.params;

        await prisma.favoriteRoom.deleteMany({
            where: { userId, roomId },
        });

        return res.json({
            success: true,
            message: 'Đã xóa khỏi danh sách yêu thích',
            data: { roomId },
        });
    } catch (err) {
        console.error('Remove favorite error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa yêu thích',
            error: err.message,
        });
    }
}

/**
 * GET /favorites – List current user's favorite rooms with full details
 */
async function getMyFavorites(req, res) {
    try {
        const userId = req.auth.user.id;

        const favorites = await prisma.favoriteRoom.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                room: {
                    include: {
                        images: true,
                        roomAmenities: { include: { amenity: true } },
                        rentals: {
                            include: {
                                location: true,
                                images: true,
                            },
                        },
                    },
                },
            },
        });

        const data = favorites
            .map((f) => f.room)
            .filter(Boolean)
            .map((room) => formatRoomForFavorite(room));

        return res.json({
            success: true,
            data,
        });
    } catch (err) {
        console.error('Get favorites error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách yêu thích',
            error: err.message,
        });
    }
}

/**
 * GET /favorites/ids – Get only favorite room IDs (for quick isFavorite check)
 */
async function getFavoriteIds(req, res) {
    try {
        const userId = req.auth.user.id;
        const rows = await prisma.favoriteRoom.findMany({
            where: { userId },
            select: { roomId: true },
        });
        const ids = rows.map((r) => r.roomId);
        return res.json({ success: true, data: ids });
    } catch (err) {
        console.error('Get favorite ids error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách yêu thích',
            error: err.message,
        });
    }
}

module.exports = {
    addFavorite,
    removeFavorite,
    getMyFavorites,
    getFavoriteIds,
    formatRoomForFavorite,
};
