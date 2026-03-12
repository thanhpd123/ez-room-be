const authService = require('../services/auth.service');
const prisma = require('../config/prisma');

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Auth error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(err.errors && { errors: err.errors }),
        ...(err.code && { code: err.code }),
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function createNotification(userId, type, title, body) {
    try {
        await prisma.notification.create({
            data: { userId, type, title, body },
        });
    } catch (err) {
        console.error('createNotification error:', err.message);
    }
}

async function register(req, res) {
    try {
        const result = await authService.register(req.body);
        return res.status(201).json({
            success: true,
            message: 'Đăng ký thành công',
            ...result,
        });
    } catch (err) {
        const message = err && (err.message || String(err));
        const code = err && err.code;
        console.error('[Register] Error:', message);
        if (code) console.error('[Register] Code:', code);
        return handleError(err, res, 'Đã xảy ra lỗi khi đăng ký');
    }
}

async function login(req, res) {
    try {
        const result = await authService.login(req.body);
        return res.status(200).json({
            success: true,
            message: 'Đăng nhập thành công',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Đã xảy ra lỗi khi đăng nhập');
    }
}

async function forgotPassword(req, res) {
    try {
        const result = await authService.forgotPassword(req.body);
        return res.status(200).json({
            success: true,
            message: result.message,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi. Vui lòng thử lại sau.',
        });
    }
}

async function resetPassword(req, res) {
    try {
        const result = await authService.resetPassword(req.body);
        return res.status(200).json({
            success: true,
            message: result.message,
        });
    } catch (err) {
        return handleError(err, res, 'Đã xảy ra lỗi. Vui lòng thử lại.');
    }
}

async function registerOAuth(req, res) {
    try {
        const result = await authService.registerOAuth(req.body);
        return res.status(201).json({
            success: true,
            message: 'Đăng ký hoàn tất. Bạn có thể đăng nhập.',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Đã xảy ra lỗi khi đăng ký');
    }
}

function toCitizenCardResponse(record) {
    if (!record) return null;
    return {
        id: record.id,
        citizenCardNumber: record.citizenCardNumber,
        citizenCardFrontImageUrl: record.frontImageUrl,
        citizenCardBackImageUrl: record.backImageUrl,
        status: record.status,
        reviewNote: record.reviewNote ?? null,
        submittedAt: record.submittedAt,
        reviewedAt: record.reviewedAt ?? null,
        reviewedBy: record.reviewedBy ?? null,
    };
}

async function getCitizenCard(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }

        const record = await prisma.citizenCardVerification.findUnique({
            where: { userId },
        });

        return res.json({
            success: true,
            citizenCard: toCitizenCardResponse(record),
        });
    } catch (err) {
        console.error('Get citizen card error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi tải CCCD' });
    }
}

async function upsertCitizenCard(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }

        const {
            citizenCardNumber,
            citizenCardFrontImageUrl,
            citizenCardBackImageUrl,
        } = req.body || {};

        const number = typeof citizenCardNumber === 'string' ? citizenCardNumber.trim() : '';
        const front = typeof citizenCardFrontImageUrl === 'string' ? citizenCardFrontImageUrl.trim() : '';
        const back = typeof citizenCardBackImageUrl === 'string' ? citizenCardBackImageUrl.trim() : '';

        if (!/^\d{12}$/.test(number)) {
            return res.status(400).json({ success: false, message: 'Số CCCD phải gồm đúng 12 chữ số' });
        }
        if (!front || !back) {
            return res.status(400).json({ success: false, message: 'Vui lòng cung cấp ảnh CCCD mặt trước và mặt sau' });
        }

        const record = await prisma.citizenCardVerification.upsert({
            where: { userId },
            create: {
                userId,
                citizenCardNumber: number,
                frontImageUrl: front,
                backImageUrl: back,
                status: 'PENDING',
                reviewNote: null,
                reviewedBy: null,
                reviewedAt: null,
            },
            update: {
                citizenCardNumber: number,
                frontImageUrl: front,
                backImageUrl: back,
                status: 'PENDING',
                reviewNote: null,
                reviewedBy: null,
                reviewedAt: null,
                submittedAt: new Date(),
            },
        });

        return res.json({
            success: true,
            message: 'Đã gửi CCCD để xác minh. Vui lòng chờ duyệt.',
            citizenCard: toCitizenCardResponse(record),
        });
    } catch (err) {
        console.error('Upsert citizen card error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Lỗi lưu CCCD' });
    }
}

async function registerLandlord(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                role: true,
                fullName: true,
                phone: true,
                gender: true,
            },
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
        }

        if (user.role === 'LANDLORD') {
            return res.status(400).json({ success: false, message: 'Bạn đã là chủ nhà' });
        }

        if (user.role !== 'TENANT') {
            return res.status(403).json({ success: false, message: 'Chỉ tài khoản Tenant mới có thể đăng ký lên Landlord' });
        }

        const lifestyle = await prisma.lifestyleProfile.findUnique({
            where: { userId },
            select: { id: true },
        });
        const preference = await prisma.userPreference.findUnique({
            where: { userId },
            select: { id: true },
        });
        const citizenCard = await prisma.citizenCardVerification.findUnique({
            where: { userId },
            select: { id: true, status: true },
        });

        const checks = {
            profile: !!(user.fullName && String(user.fullName).trim().length >= 2 && user.phone && String(user.phone).trim() && user.gender && String(user.gender).trim()),
            lifestyle: !!lifestyle,
            preference: !!preference,
            citizenCardVerified: citizenCard?.status === 'VERIFIED',
            citizenCardStatus: citizenCard?.status || 'NOT_SUBMITTED',
        };

        if (!checks.profile || !checks.lifestyle || !checks.preference || !checks.citizenCardVerified) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng hoàn tất hồ sơ, sở thích, phong cách sống và CCCD đã được duyệt trước khi đăng ký chủ nhà.',
                checks,
            });
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { role: 'LANDLORD' },
        });

        await createNotification(
            userId,
            'SYSTEM',
            'Đăng ký chủ nhà thành công',
            'Tài khoản của bạn đã được nâng cấp thành Chủ nhà sau khi hoàn tất hồ sơ và thông tin CCCD.'
        );

        return res.json({
            success: true,
            message: 'Đăng ký chủ nhà thành công',
            user: {
                id: updatedUser.id,
                role: updatedUser.role,
            },
        });
    } catch (err) {
        console.error('Register landlord error:', err);
        return res.status(500).json({
            success: false,
            message: 'Đăng ký chủ nhà thất bại',
            error: err.message,
        });
    }
}

async function updateProfile(req, res) {
    try {
        const result = await authService.updateProfile(req.auth.user.id, req.body);
        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

async function getLifestyle(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }
        const result = await authService.getLifestyle(userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải phong cách sống');
    }
}

async function upsertLifestyle(req, res) {
    try {
        const result = await authService.upsertLifestyle(req.auth.user.id, req.body);
        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

async function getPreference(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }
        const result = await authService.getPreference(userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải sở thích');
    }
}

async function upsertPreference(req, res) {
    try {
        const result = await authService.upsertPreference(req.auth.user.id, req.body);
        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

function suggestPassword(req, res) {
    try {
        const result = authService.suggestPassword();
        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    register,
    registerOAuth,
    getCitizenCard,
    upsertCitizenCard,
    registerLandlord,
    login,
    forgotPassword,
    resetPassword,
    updateProfile,
    getLifestyle,
    upsertLifestyle,
    getPreference,
    upsertPreference,
    suggestPassword,
};
