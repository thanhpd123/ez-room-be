const prisma = require('../config/prisma');
const { mapDbToFe } = require('../utils/room-type-mapper');

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
 * Thêm phòng vào danh sách yêu thích
 */
async function addFavorite(userId, roomId) {
    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { rentals: { include: { location: true } } },
    });
    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }

    await prisma.favoriteRoom.upsert({
        where: {
            userId_roomId: { userId, roomId },
        },
        create: { userId, roomId },
        update: {},
    });

    return { roomId };
}

/**
 * Xóa phòng khỏi danh sách yêu thích
 */
async function removeFavorite(userId, roomId) {
    await prisma.favoriteRoom.deleteMany({
        where: { userId, roomId },
    });
    return { roomId };
}

/**
 * Lấy danh sách phòng yêu thích
 */
async function getMyFavorites(userId) {
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

    return { data };
}

/**
 * Lấy danh sách ID phòng yêu thích
 */
async function getFavoriteIds(userId) {
    const rows = await prisma.favoriteRoom.findMany({
        where: { userId },
        select: { roomId: true },
    });
    return { data: rows.map((r) => r.roomId) };
}

module.exports = {
    addFavorite,
    removeFavorite,
    getMyFavorites,
    getFavoriteIds,
    formatRoomForFavorite,
};
