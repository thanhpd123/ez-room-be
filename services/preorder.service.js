const prisma = require('../config/prisma');

/**
 * Lấy danh sách yêu cầu thuê cho landlord
 */
async function getLandlordRequests(landlordId, params) {
    const { status, search, page = 1, limit = 20 } = params;

    const whereClause = {
        room: {
            rentals: {
                owner_id: landlordId,
            },
        },
    };

    if (status && status !== 'ALL' && status !== 'all') {
        whereClause.status = status;
    }

    if (search) {
        whereClause.OR = [
            { user: { fullName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { room: { room_name: { contains: search, mode: 'insensitive' } } },
            { room: { rentals: { title: { contains: search, mode: 'insensitive' } } } },
        ];
    }

    const preorders = await prisma.preorder.findMany({
        where: whereClause,
        select: {
            id: true,
            userId: true,
            roomId: true,
            status: true,
            createdAt: true,
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
                    id: true,
                    room_name: true,
                    price: true,
                    rentals: {
                        select: { id: true, title: true },
                    },
                },
            },
        },
        orderBy: { createdAt: 'desc' },
        skip: Math.max(0, (parseInt(page) - 1) * parseInt(limit)),
        take: parseInt(limit),
    });

    return {
        data: preorders.map((p) => ({
            id: p.id,
            userId: p.userId,
            roomId: p.roomId,
            status: p.status,
            createdAt: p.createdAt,
            user: p.user,
            room: {
                id: p.room.id,
                room_name: p.room.room_name,
                price: p.room.price,
            },
            rental: p.room.rentals
                ? { id: p.room.rentals.id, title: p.room.rentals.title }
                : null,
        })),
    };
}

/**
 * Landlord xác nhận yêu cầu thuê
 */
async function confirmRequest(preorderId, landlordId) {
    const preorder = await prisma.preorder.findUnique({
        where: { id: preorderId },
        include: {
            room: { include: { rentals: true } },
        },
    });

    if (!preorder) {
        throw Object.assign(new Error('Yêu cầu không tồn tại'), { statusCode: 404 });
    }

    if (preorder.room.rentals.owner_id !== landlordId) {
        throw Object.assign(new Error('Bạn không có quyền xác nhận yêu cầu này'), {
            statusCode: 403,
        });
    }

    if (preorder.status !== 'PENDING') {
        throw Object.assign(new Error('Chỉ có thể xác nhận yêu cầu đang chờ'), { statusCode: 400 });
    }

    const updated = await prisma.preorder.update({
        where: { id: preorderId },
        data: { status: 'CONFIRMED' },
    });

    return { data: updated };
}

/**
 * Landlord từ chối yêu cầu thuê
 */
async function rejectRequest(preorderId, landlordId, body) {
    const { reason } = body;

    const preorder = await prisma.preorder.findUnique({
        where: { id: preorderId },
        include: {
            room: { include: { rentals: true } },
        },
    });

    if (!preorder) {
        throw Object.assign(new Error('Yêu cầu không tồn tại'), { statusCode: 404 });
    }

    if (preorder.room.rentals.owner_id !== landlordId) {
        throw Object.assign(new Error('Bạn không có quyền từ chối yêu cầu này'), {
            statusCode: 403,
        });
    }

    if (preorder.status !== 'PENDING') {
        throw Object.assign(new Error('Chỉ có thể từ chối yêu cầu đang chờ'), { statusCode: 400 });
    }

    const updated = await prisma.preorder.update({
        where: { id: preorderId },
        data: {
            status: 'CANCELLED',
            cancel_reason: reason || null,
        },
    });

    return { data: updated };
}

module.exports = {
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
};
