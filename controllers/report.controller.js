const prisma = require('../config/prisma');

// report_target_type_enum values (schema)
const REPORT_TARGET_TYPES = ['USER', 'ROOM', 'BOOKING', 'REVIEW'];

// report_status_enum values (schema)
const REPORT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DISMISSED'];
const REPORT_STATUSES_HANDLE = ['APPROVED', 'REJECTED', 'DISMISSED'];

/**
 * POST /reports
 * Tạo báo cáo vi phạm mới (user đã đăng nhập)
 * Body: { targetType, targetId, reason, description }
 */
async function createReport(req, res) {
    try {
        const reporterId = req.auth.user.id;
        const { targetType, targetId, reason, description } = req.body;

        // Validate required fields
        if (!targetType || !targetId || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu thông tin bắt buộc: targetType, targetId, reason',
            });
        }

        // Validate targetType (report_target_type_enum)
        if (!REPORT_TARGET_TYPES.includes(targetType)) {
            return res.status(400).json({
                success: false,
                message: `targetType không hợp lệ. Chỉ chấp nhận: ${REPORT_TARGET_TYPES.join(', ')}`,
            });
        }

        // Prevent self-report (for USER type)
        if (targetType === 'USER' && targetId === reporterId) {
            return res.status(400).json({
                success: false,
                message: 'Bạn không thể tự báo cáo chính mình',
            });
        }

        // Create report (unique constraint will catch duplicates)
        const report = await prisma.report.create({
            data: {
                reporterId,
                targetType,
                targetId,
                reason,
                description: description || null,
            },
        });

        return res.status(201).json({
            success: true,
            message: 'Gửi báo cáo thành công. Cảm ơn bạn!',
            data: report,
        });
    } catch (err) {
        // Handle unique constraint violation (duplicate report)
        if (err.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'Bạn đã báo cáo nội dung này rồi',
            });
        }
        console.error('[createReport] Error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tạo báo cáo',
            error: err.message,
        });
    }
}

/**
 * GET /reports
 * Lấy danh sách báo cáo (moderator/admin)
 * Query: ?status=PENDING&page=1&limit=20
 */
async function getReports(req, res) {
    try {
        const { status, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const skip = (pageNum - 1) * limitNum;

        const where = {};
        if (status && REPORT_STATUSES.includes(status)) {
            where.status = status;
        }

        const [reports, total] = await Promise.all([
            prisma.report.findMany({
                where,
                orderBy: [
                    { status: 'asc' }, // PENDING first
                    { createdAt: 'desc' },
                ],
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
                    moderator: {
                        select: {
                            id: true,
                            fullName: true,
                        },
                    },
                },
            }),
            prisma.report.count({ where }),
        ]);

        // Resolve target user info for each report
        const targetUserIds = [...new Set(reports.filter(r => r.targetType === 'USER').map(r => r.targetId))];
        const targetUsers = targetUserIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: targetUserIds } },
                select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true },
            })
            : [];
        const targetUserMap = Object.fromEntries(targetUsers.map(u => [u.id, u]));

        // Attach targetUser to each report
        const reportsWithTarget = reports.map(r => ({
            ...r,
            targetUser: r.targetType === 'USER' ? (targetUserMap[r.targetId] || null) : null,
        }));

        return res.json({
            success: true,
            data: reportsWithTarget,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    } catch (err) {
        console.error('[getReports] Error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách báo cáo',
            error: err.message,
        });
    }
}

/**
 * PATCH /reports/:id
 * Xử lý báo cáo (moderator/admin)
 * Body: { status, moderatorNote }
 */
async function handleReport(req, res) {
    try {
        const { id } = req.params;
        const moderatorId = req.auth.user.id;
        const { status, moderatorNote } = req.body;

        // Validate status (report_status_enum - chỉ cho phép cập nhật sang APPROVED/REJECTED/DISMISSED)
        if (!status || !REPORT_STATUSES_HANDLE.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `status không hợp lệ. Chỉ chấp nhận: ${REPORT_STATUSES_HANDLE.join(', ')}`,
            });
        }

        // Check report exists and is still PENDING
        const existing = await prisma.report.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy báo cáo',
            });
        }
        if (existing.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: 'Báo cáo này đã được xử lý trước đó',
            });
        }

        const updated = await prisma.report.update({
            where: { id },
            data: {
                status,
                reviewedBy: moderatorId,
                moderatorNote: moderatorNote || null,
                reviewedAt: new Date(),
            },
            include: {
                reporter: {
                    select: { id: true, fullName: true },
                },
                moderator: {
                    select: { id: true, fullName: true },
                },
            },
        });

        return res.json({
            success: true,
            message: 'Đã xử lý báo cáo thành công',
            data: updated,
        });
    } catch (err) {
        console.error('[handleReport] Error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xử lý báo cáo',
            error: err.message,
        });
    }
}

module.exports = { createReport, getReports, handleReport };
