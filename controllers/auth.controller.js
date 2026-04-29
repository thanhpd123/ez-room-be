const authService = require('../services/auth.service');
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { validateChangePassword } = require('../validators/auth.validator');

const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE_NAME || 'ezroom_refresh_token';
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const COOKIE_SAME_SITE = process.env.REFRESH_TOKEN_SAMESITE || 'lax';
const COOKIE_MAX_AGE_MS = Number(process.env.REFRESH_TOKEN_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);

function getCookieOptions() {
    return {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: COOKIE_SAME_SITE,
        path: '/',
        maxAge: COOKIE_MAX_AGE_MS,
    };
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return {};
    return cookieHeader.split(';').reduce((acc, chunk) => {
        const [rawKey, ...rawValueParts] = chunk.trim().split('=');
        if (!rawKey) return acc;
        acc[rawKey] = decodeURIComponent(rawValueParts.join('='));
        return acc;
    }, {});
}

function getRefreshTokenFromRequest(req) {
    if (req.body?.refreshToken) return String(req.body.refreshToken);
    const cookies = parseCookies(req);
    return cookies[REFRESH_TOKEN_COOKIE] || null;
}

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;

    // Chỉ in ra error stack trace nếu là lỗi server (500), nếu là lỗi client (4xx) thì chỉ in warning
    if (statusCode >= 500) {
        console.error('Auth error HTTP 500:', err);
    } else {
        console.warn(`Auth warning HTTP ${statusCode}:`, message, err.errors || '');
    }

    return res.status(statusCode).json({
        success: false,
        message,
        ...(err.errors && { errors: err.errors }),
        ...(err.code && { code: err.code }),
        ...(statusCode === 500 && { error: err.message }),
    });
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
        const result = await authService.login({
            ...req.body,
            meta: {
                userAgent: req.headers['user-agent'] || null,
                ipAddress: req.ip || req.socket?.remoteAddress || null,
            },
        });
        res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, getCookieOptions());
        return res.status(200).json({
            success: true,
            message: 'Đăng nhập thành công',
            token: result.accessToken,
            accessToken: result.accessToken,
            user: result.user,
        });
    } catch (err) {
        return handleError(err, res, 'Đã xảy ra lỗi khi đăng nhập');
    }
}

async function refreshToken(req, res) {
    try {
        const refreshTokenRaw = getRefreshTokenFromRequest(req);
        const result = await authService.refreshSession({
            refreshToken: refreshTokenRaw,
            meta: {
                userAgent: req.headers['user-agent'] || null,
                ipAddress: req.ip || req.socket?.remoteAddress || null,
            },
        });
        res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, getCookieOptions());
        return res.status(200).json({
            success: true,
            message: 'Làm mới phiên đăng nhập thành công',
            token: result.accessToken,
            accessToken: result.accessToken,
            user: result.user,
        });
    } catch (err) {
        return handleError(err, res, 'Không thể làm mới phiên đăng nhập');
    }
}

async function logout(req, res) {
    try {
        const refreshTokenRaw = getRefreshTokenFromRequest(req);
        if (refreshTokenRaw) {
            await authService.logoutCurrentSession({ refreshToken: refreshTokenRaw });
        }
        res.clearCookie(REFRESH_TOKEN_COOKIE, getCookieOptions());
        return res.status(200).json({
            success: true,
            message: 'Đăng xuất thành công',
        });
    } catch (err) {
        return handleError(err, res, 'Không thể đăng xuất');
    }
}

async function logoutAll(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa xác thực' });
        }
        const result = await authService.logoutAllSessions(userId);
        res.clearCookie(REFRESH_TOKEN_COOKIE, getCookieOptions());
        return res.status(200).json({
            success: true,
            message: 'Đã đăng xuất khỏi tất cả thiết bị',
            revokedCount: result.revokedCount,
        });
    } catch (err) {
        return handleError(err, res, 'Không thể đăng xuất tất cả thiết bị');
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
    login,
    refreshToken,
    logout,
    logoutAll,
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
