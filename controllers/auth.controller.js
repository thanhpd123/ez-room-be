const authService = require('../services/auth.service');
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { validateChangePassword } = require('../validators/auth.validator');

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
        console.error('[forgotPassword]', err?.message || err);
        return handleError(err, res, 'Đã xảy ra lỗi. Vui lòng thử lại sau.');
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

/** Build API response from rental_documents CCCD rows (front + back). */
function toCitizenCardResponseFromDocs(cccdDocs) {
    if (!cccdDocs || cccdDocs.length === 0) return null;
    let citizenCardNumber = '';
    let frontImageUrl = '';
    let backImageUrl = '';
    let status = 'PENDING';
    let reviewNote = null;
    let submittedAt = null;
    let reviewedAt = null;
    let reviewedBy = null;
    const id = cccdDocs[0]?.id ?? null;

    for (const doc of cccdDocs) {
        try {
            const note = doc.note ? JSON.parse(doc.note) : {};
            if (note.side === 'front') {
                frontImageUrl = doc.image_url || '';
                if (note.citizenCardNumber) citizenCardNumber = note.citizenCardNumber;
            } else if (note.side === 'back') {
                backImageUrl = doc.image_url || '';
            }
        } catch {
            if (!frontImageUrl && doc.image_url) frontImageUrl = doc.image_url;
            else if (!backImageUrl && doc.image_url) backImageUrl = doc.image_url;
        }
        if (doc.status === 'VERIFIED') status = 'VERIFIED';
        else if (doc.status === 'REJECTED' && status !== 'VERIFIED') status = 'REJECTED';
        if (doc.note && !citizenCardNumber) {
            try {
                const n = JSON.parse(doc.note);
                if (n.citizenCardNumber) citizenCardNumber = n.citizenCardNumber;
            } catch (_) {}
        }
        if (doc.created_at) submittedAt = doc.created_at;
        reviewNote = doc.note && typeof doc.note === 'string' && !doc.note.startsWith('{') ? doc.note : reviewNote;
    }
    if (!frontImageUrl && cccdDocs[0]) frontImageUrl = cccdDocs[0].image_url || '';
    if (!backImageUrl && cccdDocs[1]) backImageUrl = cccdDocs[1].image_url || '';

    return {
        id,
        citizenCardNumber,
        citizenCardFrontImageUrl: frontImageUrl,
        citizenCardBackImageUrl: backImageUrl,
        status,
        reviewNote,
        submittedAt,
        reviewedAt,
        reviewedBy,
    };
}

async function getCitizenCard(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }

        const rentals = await prisma.rental.findMany({
            where: { owner_id: userId },
            select: { id: true },
        });
        const rentalIds = rentals.map((r) => r.id);
        if (rentalIds.length === 0) {
            return res.json({ success: true, citizenCard: null });
        }

        const cccdDocs = await prisma.rental_documents.findMany({
            where: {
                rental_id: { in: rentalIds },
                document_type: 'CCCD',
            },
            orderBy: { created_at: 'asc' },
        });

        const citizenCard = toCitizenCardResponseFromDocs(cccdDocs);

        return res.json({
            success: true,
            citizenCard,
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
            rentalId,
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

        let rentalIdToUse = rentalId;
        if (!rentalIdToUse) {
            const firstRental = await prisma.rental.findFirst({
                where: { owner_id: userId },
                select: { id: true },
            });
            if (!firstRental) {
                return res.status(400).json({
                    success: false,
                    message: 'Bạn cần tạo ít nhất một bài đăng nhà trọ trước khi gửi CCCD. Hoặc gửi kèm rentalId trong body.',
                });
            }
            rentalIdToUse = firstRental.id;
        } else {
            const rental = await prisma.rental.findFirst({
                where: { id: rentalIdToUse, owner_id: userId },
            });
            if (!rental) {
                return res.status(403).json({ success: false, message: 'Bạn không có quyền gửi CCCD cho bài đăng này' });
            }
        }

        await prisma.rental_documents.deleteMany({
            where: { rental_id: rentalIdToUse, document_type: 'CCCD' },
        });

        await prisma.rental_documents.createMany({
            data: [
                {
                    rental_id: rentalIdToUse,
                    document_type: 'CCCD',
                    image_url: front,
                    status: 'PENDING',
                    note: JSON.stringify({ side: 'front', citizenCardNumber: number }),
                },
                {
                    rental_id: rentalIdToUse,
                    document_type: 'CCCD',
                    image_url: back,
                    status: 'PENDING',
                    note: JSON.stringify({ side: 'back' }),
                },
            ],
        });

        const cccdDocs = await prisma.rental_documents.findMany({
            where: { rental_id: rentalIdToUse, document_type: 'CCCD' },
            orderBy: { created_at: 'asc' },
        });

        return res.json({
            success: true,
            message: 'Đã gửi CCCD để xác minh. Vui lòng chờ duyệt.',
            citizenCard: toCitizenCardResponseFromDocs(cccdDocs),
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

        const userRentals = await prisma.rental.findMany({
            where: { owner_id: userId },
            select: { id: true },
        });
        const rentalIds = userRentals.map((r) => r.id);
        let citizenCardVerified = false;
        let citizenCardStatus = 'NOT_SUBMITTED';
        if (rentalIds.length > 0) {
            const cccdDoc = await prisma.rental_documents.findFirst({
                where: {
                    rental_id: { in: rentalIds },
                    document_type: 'CCCD',
                },
                select: { status: true },
            });
            if (cccdDoc) {
                citizenCardStatus = cccdDoc.status;
                citizenCardVerified = cccdDoc.status === 'VERIFIED';
            }
        }

        const checks = {
            profile: !!(user.fullName && String(user.fullName).trim().length >= 2 && user.phone && String(user.phone).trim() && user.gender && String(user.gender).trim()),
            lifestyle: !!lifestyle,
            preference: !!preference,
            citizenCardVerified,
            citizenCardStatus,
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

async function changePassword(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }

        const { valid, errors } = validateChangePassword(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const { currentPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, password_hash: true },
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
        }

        if (!user.password_hash) {
            return res.status(400).json({
                success: false,
                message: 'Tài khoản đăng nhập bằng Google không thể đổi mật khẩu tại đây.',
            });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(newPassword, salt);

        await prisma.user.update({
            where: { id: userId },
            data: { password_hash },
        });

        return res.json({ success: true, message: 'Đổi mật khẩu thành công' });
    } catch (err) {
        console.error('Change password error:', err);
        return res.status(500).json({
            success: false,
            message: 'Đổi mật khẩu thất bại',
            error: err.message,
        });
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
    changePassword,
    updateProfile,
    getLifestyle,
    upsertLifestyle,
    getPreference,
    upsertPreference,
    suggestPassword,
};
