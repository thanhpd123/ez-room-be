const roomService = require('../services/room.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Room error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(err.code && { code: err.code }),
        ...(err.upgradePath && { upgradePath: err.upgradePath }),
        ...(err.errors && { errors: err.errors }),
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function createRoom(req, res) {
    try {
        const result = await roomService.createRoom(req.auth.user.id, req.body, req.auth.user);
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tạo phòng');
    }
}

async function getRooms(req, res) {
    try {
        const result = await roomService.getRooms({
            rentalId: req.query.rentalId,
            rental_id: req.query.rental_id,
            roomType: req.query.roomType,
            minPrice: req.query.minPrice,
            maxPrice: req.query.maxPrice,
            page: req.query.page,
            limit: req.query.limit,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách phòng');
    }
}

async function getRoomById(req, res) {
    try {
        const userId = req.auth?.user?.id || null;
        const result = await roomService.getRoomById(req.params.roomId, userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy chi tiết phòng');
    }
}

async function getRoomByIdForSearchRoomate(req, res) {
    try {
        const userId = req.auth?.user?.id ?? null;
        const result = await roomService.getRoomByIdForSearchRoomate(req.params.roomId, userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy chi tiết phòng (Search Roommate)');
    }
}

async function updateRoom(req, res) {
    try {
        const result = await roomService.updateRoom(
            req.params.roomId,
            req.auth.user.id,
            req.body
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật phòng');
    }
}

async function deleteRoom(req, res) {
    try {
        const result = await roomService.deleteRoom(req.params.roomId, req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa phòng');
    }
}

async function getAmenities(req, res) {
    try {
        const result = await roomService.getAmenities();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách tiện ích');
    }
}

async function moderateRoom(req, res) {
    try {
        const result = await roomService.moderateRoom(req.params.roomId, req.body);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi duyệt phòng');
    }
}

async function getRoomTenants(req, res) {
    try {
        const result = await roomService.getRoomTenants(
            req.params.roomId,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thông tin người thuê');
    }
}

async function searchTenants(req, res) {
    try {
        const result = await roomService.searchTenants(req.query.q);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tìm kiếm người thuê');
    }
}

async function createRentalContract(req, res) {
    try {
        const result = await roomService.createRentalContract(
            req.params.roomId,
            req.auth.user.id,
            req.body
        );
        return res.status(201).json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, err.message);
    }
}

async function getMyBookings(req, res) {
    try {
        const result = await roomService.getMyBookings(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy lịch sử thuê phòng');
    }
}

async function completeRentalPeriod(req, res) {
    try {
        const result = await roomService.completeRentalPeriod(
            req.params.rentalPeriodId,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi kết thúc kỳ thuê');
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
    getRoomTenants,
    searchTenants,
    createRentalContract,
    completeRentalPeriod,
    getMyBookings,
    getRoomByIdForSearchRoomate,
};
