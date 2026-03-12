const prisma = require('../config/prisma');

const REPORT_TARGET_TYPES = ['USER', 'ROOM', 'BOOKING', 'REVIEW'];
const REPORT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DISMISSED'];
const REPORT_STATUSES_HANDLE = ['APPROVED', 'REJECTED', 'DISMISSED'];

/**
 * Tạo báo cáo vi phạm mới
 */
async function createReport(reporterId, body) {
    const { targetType, targetId, reason, description } = body;

    if (!targetType || !targetId || !reason) {
        throw Object.assign(new Error('Thiếu thông tin bắt buộc: targetType, targetId, reason'), {
            statusCode: 400,
        });
    }

    if (!REPORT_TARGET_TYPES.includes(targetType)) {
        throw Object.assign(new Error(`targetType không hợp lệ. Chỉ chấp nhận: ${REPORT_TARGET_TYPES.join(', ')}`), {
            statusCode: 400,
        });
    }

    if (targetType === 'USER' && targetId === reporterId) {
        throw Object.assign(new Error('Bạn không thể tự báo cáo chính mình'), { statusCode: 400 });
    }

    const report = await prisma.$transaction(async (tx) => {
        const created = await tx.report.create({
            data: {
                reporterId,
                targetType,
                targetId,
                reason,
                description: description || null,
            },
        });
        await tx.moderation_queue.create({
            data: {
                target_type: 'REPORT',
                target_id: created.id,
                priority: 'NORMAL',
                category: 'REPORTED_CONTENT',
                source: 'USER_REPORT',
            },
        });
        return created;
    });

    return { data: report };
}

/**
 * Lấy danh sách báo cáo
 */
async function getReports(params) {
    const { status, page = 1, limit = 20 } = params;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (status && REPORT_STATUSES.includes(status)) {
        where.status = status;
    }

    const [reports, total] = await Promise.all([
        prisma.report.findMany({
            where,
            orderBy: [
                { status: 'asc' },
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

    const targetUserIds = [...new Set(reports.filter((r) => r.targetType === 'USER').map((r) => r.targetId))];
    const targetUsers =
        targetUserIds.length > 0
            ? await prisma.user.findMany({
                  where: { id: { in: targetUserIds } },
                  select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true },
              })
            : [];
    const targetUserMap = Object.fromEntries(targetUsers.map((u) => [u.id, u]));

    const reportsWithTarget = reports.map((r) => ({
        ...r,
        targetUser: r.targetType === 'USER' ? (targetUserMap[r.targetId] || null) : null,
    }));

    return {
        data: reportsWithTarget,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    };
}

/**
 * Xử lý báo cáo (duyệt / từ chối / bỏ qua)
 */
async function handleReport(id, moderatorId, body) {
    const { status, moderatorNote } = body;

    if (!status || !REPORT_STATUSES_HANDLE.includes(status)) {
        throw Object.assign(
            new Error(`status không hợp lệ. Chỉ chấp nhận: ${REPORT_STATUSES_HANDLE.join(', ')}`),
            { statusCode: 400 }
        );
    }

    const existing = await prisma.report.findUnique({ where: { id } });
    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy báo cáo'), { statusCode: 404 });
    }
    if (existing.status !== 'PENDING') {
        throw Object.assign(new Error('Báo cáo này đã được xử lý trước đó'), { statusCode: 400 });
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

    return { message: 'Đã xử lý báo cáo thành công', data: updated };
}

module.exports = {
    createReport,
    getReports,
    handleReport,
};
