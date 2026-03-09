const prisma = require('../config/prisma');

/**
 * GET /preorders/landlord
 * Get list of rental requests for landlord
 * Query: ?status=PENDING&search=keyword&page=1&limit=20
 */
async function getLandlordRequests(req, res) {
    try {
        const landlordId = req.auth.user.id;
        const { status, search, page = 1, limit = 20 } = req.query;

        // Build where clause - get preorders from landlord's rooms
        const whereClause = {
            room: {
                rentals: {
                    owner_id: landlordId,
                },
            },
        };

        // Add status filter if provided
        if (status && status !== 'ALL' && status !== 'all') {
            whereClause.status = status;
        }

        // Add search filter if provided
        if (search) {
            whereClause.OR = [
                { user: { fullName: { contains: search, mode: 'insensitive' } } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
                { room: { room_name: { contains: search, mode: 'insensitive' } } },
                { room: { rentals: { title: { contains: search, mode: 'insensitive' } } } },
            ];
        }

        // Fetch results
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
                            select: {
                                id: true,
                                title: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip: Math.max(0, (parseInt(page) - 1) * parseInt(limit)),
            take: parseInt(limit),
        });

        return res.status(200).json({
            success: true,
            data: preorders.map(p => ({
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
                rental: p.room.rentals ? {
                    id: p.room.rentals.id,
                    title: p.room.rentals.title,
                } : null,
            })),
        });
    } catch (err) {
        console.error('Get landlord requests error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tải danh sách yêu cầu',
            error: err.message,
        });
    }
}

/**
 * PATCH /preorders/:preorderId/confirm
 * Landlord confirms a rental request
 */
async function confirmRequest(req, res) {
    try {
        const { preorderId } = req.params;
        const landlordId = req.auth.user.id;

        const preorder = await prisma.preorder.findUnique({
            where: { id: preorderId },
            include: {
                room: {
                    include: {
                        rentals: true,
                    },
                },
            },
        });

        if (!preorder) {
            return res.status(404).json({
                success: false,
                message: 'Yêu cầu không tồn tại',
            });
        }

        if (preorder.room.rentals.owner_id !== landlordId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền xác nhận yêu cầu này',
            });
        }

        if (preorder.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Chỉ có thể xác nhận yêu cầu đang chờ`,
            });
        }

        const updated = await prisma.preorder.update({
            where: { id: preorderId },
            data: { status: 'CONFIRMED' },
        });

        return res.status(200).json({
            success: true,
            message: 'Đã xác nhận yêu cầu',
            data: updated,
        });
    } catch (err) {
        console.error('Confirm request error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xác nhận yêu cầu',
            error: err.message,
        });
    }
}

/**
 * PATCH /preorders/:preorderId/reject
 * Landlord rejects a rental request
 */
async function rejectRequest(req, res) {
    try {
        const { preorderId } = req.params;
        const { reason } = req.body;
        const landlordId = req.auth.user.id;

        const preorder = await prisma.preorder.findUnique({
            where: { id: preorderId },
            include: {
                room: {
                    include: {
                        rentals: true,
                    },
                },
            },
        });

        if (!preorder) {
            return res.status(404).json({
                success: false,
                message: 'Yêu cầu không tồn tại',
            });
        }

        if (preorder.room.rentals.owner_id !== landlordId) {
            return res.status(403).json({
                success: false,
                message: 'Bạn không có quyền từ chối yêu cầu này',
            });
        }

        if (preorder.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Chỉ có thể từ chối yêu cầu đang chờ`,
            });
        }

        const updated = await prisma.preorder.update({
            where: { id: preorderId },
            data: {
                status: 'CANCELLED',
                cancel_reason: reason || null,
            },
        });

        return res.status(200).json({
            success: true,
            message: 'Đã từ chối yêu cầu',
            data: updated,
        });
    } catch (err) {
        console.error('Reject request error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi từ chối yêu cầu',
            error: err.message,
        });
    }
}

module.exports = {
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
};
