const moderatorService = require('../services/moderator.service');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Moderator error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(err.errors && { errors: err.errors }),
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getAllUsers(req, res) {
    try {
        const result = await moderatorService.getAllUsers({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 10,
            role: req.query.role,
            status: req.query.status,
            search: req.query.search,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách người dùng');
    }
}

async function getUserById(req, res) {
    try {
        const result = await moderatorService.getUserById(req.params.userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thông tin người dùng');
    }
}

async function updateUserStatus(req, res) {
    try {
        const result = await moderatorService.updateUserStatus(
            req.params.userId,
            req.body.status,
            req.auth.user.id,
            req.body.note
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật status người dùng');
    }
}

async function getRentalsForModeration(req, res) {
    try {
        const result = await moderatorService.getRentalsForModeration({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50,
            status: req.query.status,
            search: req.query.search,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách bài đăng cho duyệt');
    }
}

async function updateRentalStatus(req, res) {
    try {
        const result = await moderatorService.updateRentalStatus(
            req.params.rentalId,
            req.body,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật trạng thái bài đăng');
    }
}

async function getRentalStats(req, res) {
    try {
        const result = await moderatorService.getRentalStats();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thống kê bài đăng');
    }
}

async function getRooms(req, res) {
    try {
        const result = await moderatorService.getRooms({
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

async function moderateRoom(req, res) {
    try {
        const result = await moderatorService.moderateRoom(req.params.roomId, req.body, req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi duyệt phòng');
    }
}

async function getModeratorLogs(req, res) {
    try {
        const result = await moderatorService.getModeratorLogs({
            page: req.query.page,
            limit: req.query.limit,
            targetType: req.query.targetType,
            action: req.query.action,
            moderatorId: req.query.moderatorId,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy lịch sử moderation');
    }
}

async function getQueueActivity(req, res) {
    try {
        const result = await moderatorService.getQueueActivity({
            page: req.query.page,
            limit: req.query.limit,
            action: req.query.action,
            moderatorId: req.query.moderatorId,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy lịch sử thao tác queue');
    }
}

async function getModeratorList(req, res) {
    try {
        const result = await moderatorService.getModeratorList();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách moderator');
    }
}

async function getModerationQueue(req, res) {
    try {
        const result = await moderatorService.getModerationQueue({
            page: req.query.page,
            limit: req.query.limit,
            status: req.query.status,
            priority: req.query.priority,
            category: req.query.category,
            assignedTo: req.query.assignedTo,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy moderation queue');
    }
}

async function assignQueueItem(req, res) {
    try {
        const assignTo = req.body?.assignTo || req.auth?.user?.id;
        const result = await moderatorService.assignQueueItem(req.params.id, assignTo);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi gán task');
    }
}

async function releaseQueueItem(req, res) {
    try {
        const result = await moderatorService.releaseQueueItem(req.params.id, req.auth?.user?.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi release task');
    }
}

async function getReports(req, res) {
    try {
        const result = await moderatorService.getReports({
            status: req.query.status,
            page: req.query.page,
            limit: req.query.limit,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách báo cáo');
    }
}

async function handleReport(req, res) {
    try {
        const result = await moderatorService.handleReport(req.params.id, req.body, req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xử lý báo cáo');
    }
}

async function getReviewsForModeration(req, res) {
    try {
        const result = await moderatorService.getReviewsForModeration({
            page: req.query.page,
            limit: req.query.limit,
            target_type: req.query.target_type,
            status: req.query.status,
            roomId: req.query.roomId,
            tenantId: req.query.tenantId,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách reviews');
    }
}

async function getReviewDetail(req, res) {
    try {
        const result = await moderatorService.getReviewDetail(req.params.reviewId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy chi tiết feedback');
    }
}

async function updateReviewStatus(req, res) {
    try {
        const result = await moderatorService.updateReviewStatus(
            req.params.reviewId,
            req.body,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật review');
    }
}

async function deleteReview(req, res) {
    try {
        const result = await moderatorService.deleteReview(req.params.reviewId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa review');
    }
}

async function getQueueStatusForTarget(req, res) {
    try {
        const { targetType, targetId } = req.query;
        if (!targetType || !targetId) {
            return res.status(400).json({ success: false, message: 'targetType và targetId là bắt buộc' });
        }
        const result = await moderatorService.getQueueStatusForTarget(targetType, targetId);
        return res.json({ success: true, data: result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi kiểm tra trạng thái queue');
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
    getQueueStatusForTarget,
    getModeratorList,
};
