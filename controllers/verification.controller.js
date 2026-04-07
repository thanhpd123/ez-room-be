const prisma = require('../config/prisma');

function toVerificationResponse(item) {
    return {
        id: item.id,
        userId: item.userId,
        citizenCardNumber: item.citizenCardNumber,
        citizenCardFrontImageUrl: item.frontImageUrl,
        citizenCardBackImageUrl: item.backImageUrl,
        status: item.status,
        reviewNote: item.reviewNote ?? null,
        submittedAt: item.submittedAt,
        reviewedAt: item.reviewedAt ?? null,
        reviewedBy: item.reviewedBy ?? null,
        user: item.user
            ? {
                id: item.user.id,
                fullName: item.user.fullName,
                email: item.user.email,
                phone: item.user.phone,
                role: item.user.role,
            }
            : null,
    };
}

async function createNotification(userId, title, body) {
    try {
        await prisma.notification.create({
            data: {
                userId,
                type: 'SYSTEM',
                title,
                body,
                status: 'UNREAD',
            },
        });
    } catch (err) {
        console.error('Create verification notification error:', err);
    }
}

/**
 * GET /verifications/citizen-cards
 * Role: ADMIN | MODERATOR
 */
async function getCitizenCardVerifications(req, res) {
    try {
        const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
        const limit = Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 100) : 20;
        const skip = (page - 1) * limit;

        const where = {};
        if (req.query.status) {
            const status = String(req.query.status).toUpperCase();
            if (['PENDING', 'VERIFIED', 'REJECTED'].includes(status)) {
                where.status = status;
            }
        }
        if (req.query.search) {
            const q = String(req.query.search).trim();
            if (q) {
                where.OR = [
                    { citizenCardNumber: { contains: q } },
                    { user: { fullName: { contains: q, mode: 'insensitive' } } },
                    { user: { email: { contains: q, mode: 'insensitive' } } },
                ];
            }
        }

        const [items, total] = await Promise.all([
            prisma.citizenCardVerification.findMany({
                where,
                skip,
                take: limit,
                orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
                include: {
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                            phone: true,
                            role: true,
                        },
                    },
                },
            }),
            prisma.citizenCardVerification.count({ where }),
        ]);

        return res.json({
            success: true,
            data: items.map(toVerificationResponse),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get citizen card verifications error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách xác minh CCCD',
            error: err.message,
        });
    }
}

/**
 * PATCH /verifications/citizen-cards/:verificationId/review
 * Body: { status: 'VERIFIED' | 'REJECTED', reviewNote?: string }
 * Role: ADMIN | MODERATOR
 */
async function reviewCitizenCardVerification(req, res) {
    try {
        const reviewerId = req.auth?.user?.id;
        const { verificationId } = req.params;
        const { status, reviewNote } = req.body || {};
        const normalizedStatus = String(status || '').toUpperCase();

        if (!['VERIFIED', 'REJECTED'].includes(normalizedStatus)) {
            return res.status(400).json({
                success: false,
                message: 'status phải là VERIFIED hoặc REJECTED',
            });
        }

        const existing = await prisma.citizenCardVerification.findUnique({
            where: { id: verificationId },
            include: {
                user: {
                    select: { id: true, fullName: true, role: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy hồ sơ xác minh CCCD',
            });
        }

        const updated = await prisma.citizenCardVerification.update({
            where: { id: verificationId },
            data: {
                status: normalizedStatus,
                reviewNote: reviewNote == null || reviewNote === '' ? null : String(reviewNote).slice(0, 1000),
                reviewedBy: reviewerId,
                reviewedAt: new Date(),
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        role: true,
                    },
                },
            },
        });

        await createNotification(
            existing.user.id,
            normalizedStatus === 'VERIFIED' ? 'CCCD đã được xác minh' : 'CCCD bị từ chối',
            normalizedStatus === 'VERIFIED'
                ? 'Thông tin CCCD của bạn đã được xác minh thành công.'
                : `Thông tin CCCD bị từ chối${reviewNote ? `: ${String(reviewNote)}` : '.'}`
        );

        return res.json({
            success: true,
            message: normalizedStatus === 'VERIFIED' ? 'Đã duyệt CCCD' : 'Đã từ chối CCCD',
            data: toVerificationResponse(updated),
        });
    } catch (err) {
        console.error('Review citizen card verification error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi duyệt hồ sơ CCCD',
            error: err.message,
        });
    }
}

module.exports = {
    getCitizenCardVerifications,
    reviewCitizenCardVerification,
};
