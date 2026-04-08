const prisma = require('../config/prisma');
const { mapDbToFe } = require('../utils/room-type-mapper');
const { recordInteraction } = require('./interaction.service');

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

    try {
        await recordInteraction(userId, roomId, 'favorite');
    } catch (_) {
        // non-blocking
    }
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

/**
 * Landlord xem danh sách người wishlist theo thứ tự ưu tiên:
 * - Preorder PENDING trước người chỉ favorite
 * - Trong preorder: đã thanh toán cọc (PAID) trước chưa thanh toán
 * - Tiếp theo: số tiền cọc cao hơn trước
 * - Rồi: preorder tạo sớm hơn, cuối cùng: favorite sớm hơn
 */
async function getRoomWishersForLandlord(landlordId, roomId) {
    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        select: {
            id: true,
            room_name: true,
            status: true,
            rentals: {
                select: {
                    owner_id: true,
                },
            },
        },
    });

    if (!room) {
        throw Object.assign(new Error('Không tìm thấy phòng'), { statusCode: 404 });
    }
    if (room.rentals?.owner_id !== landlordId) {
        throw Object.assign(new Error('Bạn không có quyền xem wishlist của phòng này'), {
            statusCode: 403,
        });
    }

    const rows = await prisma.favoriteRoom.findMany({
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
            room: {
                select: {
                    preorders: {
                        where: {
                            roomId,
                            status: 'PENDING',
                            payment_status: { in: ['UNPAID', 'PAID'] },
                        },
                        select: {
                            id: true,
                            userId: true,
                            status: true,
                            payment_status: true,
                            createdAt: true,
                            deposit_amount: true,
                        },
                    },
                },
            },
        },
    });

    const data = rows
        .map((row) => {
            const preorder = (row.room?.preorders || []).find((p) => p.userId === row.userId) || null;
            return {
                userId: row.userId,
                roomId: row.roomId,
                favoritedAt: row.createdAt,
                user: row.user,
                hasPriorityPreorder: Boolean(preorder),
                preorder: preorder
                    ? {
                        id: preorder.id,
                        status: preorder.status,
                        paymentStatus: preorder.payment_status,
                        createdAt: preorder.createdAt,
                        depositAmount: Number(preorder.deposit_amount || 0),
                    }
                    : null,
            };
        })
        .sort((a, b) => {
            const prA = a.preorder;
            const prB = b.preorder;
            const pendingA = Boolean(prA && prA.status === 'PENDING');
            const pendingB = Boolean(prB && prB.status === 'PENDING');
            if (pendingA !== pendingB) {
                return pendingA ? -1 : 1;
            }
            if (pendingA && pendingB) {
                const paidA = prA.paymentStatus === 'PAID' ? 1 : 0;
                const paidB = prB.paymentStatus === 'PAID' ? 1 : 0;
                if (paidA !== paidB) {
                    return paidB - paidA;
                }
                const depA = prA.depositAmount || 0;
                const depB = prB.depositAmount || 0;
                if (depA !== depB) {
                    return depB - depA;
                }
                const aPo = prA.createdAt ? new Date(prA.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
                const bPo = prB.createdAt ? new Date(prB.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
                if (aPo !== bPo) return aPo - bPo;
            }
            const aFav = a.favoritedAt ? new Date(a.favoritedAt).getTime() : Number.MAX_SAFE_INTEGER;
            const bFav = b.favoritedAt ? new Date(b.favoritedAt).getTime() : Number.MAX_SAFE_INTEGER;
            return aFav - bFav;
        });

    return {
        room: {
            id: room.id,
            roomName: room.room_name,
            status: room.status,
        },
        data,
    };
}

module.exports = {
    addFavorite,
    removeFavorite,
    getMyFavorites,
    getFavoriteIds,
    getRoomWishersForLandlord,
    formatRoomForFavorite,
};
