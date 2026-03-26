const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

/**
 * Lazy JWT secret — server can boot without .env; auth routes return errors until JWT_SECRET is set.
 */
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is required. Set it in .env');
    }
    return secret;
}

async function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Thiếu hoặc sai định dạng header Authorization. Định dạng: Bearer <token>',
        });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Không tìm thấy token',
        });
    }

    // 1) Try backend JWT (email/password login) first – signed with our JWT_SECRET
    try {
        const payload = jwt.verify(token, getJwtSecret());
        const userId = payload.userId || payload.sub;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Token payload không hợp lệ',
            });
        }
        const dbUser = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!dbUser || dbUser.status !== 'ACTIVE') {
            return res.status(401).json({
                success: false,
                message: 'Người dùng không tồn tại hoặc đã bị khóa',
            });
        }
        req.auth = {
            user: {
                id: dbUser.id,
                email: dbUser.email,
                full_name: dbUser.fullName,
                avatar_url: dbUser.avatarUrl ?? null,
                created_at: dbUser.createdAt,
                role: dbUser.role,
                phone: dbUser.phone ?? null,
                isVip: dbUser.isVip === true,
                gender: dbUser.gender ?? null,
            },
        };
        return next();
    } catch (err) {
        // Expired backend JWT: return 401 immediately, do not call Supabase (avoids timeout).
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token đã hết hạn. Vui lòng đăng nhập lại.',
            });
        }
        // Other JWT/DB errors: only fall through for invalid signature (might be Supabase token).
        if (err.name !== 'JsonWebTokenError') {
            const isPrismaSchemaError = err.code && String(err.code).startsWith('P') ||
                (err.message && (err.message.includes('Unknown argument') || err.message.includes('does not exist') || err.message.includes('column')));
            return res.status(500).json({
                success: false,
                message: isPrismaSchemaError
                    ? 'Schema hoặc DB chưa đồng bộ. Dừng server, chạy: npx prisma generate && npx prisma db push'
                    : 'Xác thực token thất bại',
                error: err.message,
                code: err.code || undefined,
            });
        }
    }

    // 2) Treat token as Supabase JWT (Google OAuth) – decode locally and map by email.
    try {
        const payload = jwt.decode(token);
        if (!payload || typeof payload !== 'object') {
            return res.status(401).json({
                success: false,
                message: 'Token không hợp lệ',
            });
        }

        const iss = payload.iss;
        const aud = payload.aud;
        // Basic sanity check: looks like a Supabase auth token for this project.
        const expectedIss = process.env.SUPABASE_URL
            ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
            : null;
        if (!expectedIss || iss !== expectedIss || (aud && aud !== 'authenticated')) {
            return res.status(401).json({
                success: false,
                message: 'Token không hợp lệ',
            });
        }

        const email =
            (payload.email ||
                (payload.user_metadata && payload.user_metadata.email) ||
                '').toLowerCase();

        if (!email) {
            return res.status(401).json({
                success: false,
                message: 'Token Supabase không chứa email hợp lệ',
            });
        }

        const dbUser = await prisma.user.findUnique({
            where: { email },
        });

        if (!dbUser || dbUser.status !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                code: 'NEED_REGISTER',
                message: 'Tài khoản chưa đăng ký. Vui lòng đăng ký trước.',
                email,
                full_name:
                    (payload.user_metadata && (payload.user_metadata.full_name || payload.user_metadata.name)) ||
                    null,
                avatar_url: (payload.user_metadata && payload.user_metadata.avatar_url) || null,
            });
        }

        req.auth = {
            user: {
                id: dbUser.id,
                email: dbUser.email,
                full_name: dbUser.fullName,
                avatar_url: dbUser.avatarUrl ?? null,
                created_at: dbUser.createdAt,
                role: dbUser.role,
                phone: dbUser.phone ?? null,
                isVip: dbUser.isVip === true,
                gender: dbUser.gender ?? null,
            },
        };
        return next();
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Xác thực Supabase thất bại',
            error: err.message,
            code: err.code || undefined,
        });
    }
}

/**
 * Middleware Factory: Check if user role is in allowedRoles
 * Usage: requireRole('ADMIN', 'MODERATOR')
 * @param  {...string} allowedRoles - Roles allowed to access the route
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        // Lấy user từ req.auth.user (được set bởi verifyJWT)
        const user = req.auth?.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Chưa xác thực. Vui lòng đăng nhập',
            });
        }

        const userRole = user.role;

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: `Bạn không có quyền truy cập. Yêu cầu role: ${allowedRoles.join(' hoặc ')}`,
            });
        }

        next();
    };
}

/**
 * Optional JWT: attach user if token present, do not 401 if missing.
 * Useful for routes that work for both authenticated and guest users.
 */
async function optionalJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.auth = null;
        return next();
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        req.auth = null;
        return next();
    }

    try {
        // 1) Try backend JWT
        const payload = jwt.verify(token, getJwtSecret());
        const userId = payload.userId || payload.sub;
        if (userId) {
            const dbUser = await prisma.user.findUnique({ where: { id: userId } });
            if (dbUser && dbUser.status === 'ACTIVE') {
                req.auth = {
                    user: {
                        id: dbUser.id,
                        email: dbUser.email,
                        full_name: dbUser.fullName,
                        avatar_url: dbUser.avatarUrl ?? null,
                        created_at: dbUser.createdAt,
                        role: dbUser.role,
                        phone: dbUser.phone ?? null,
                        isVip: dbUser.isVip === true,
                        gender: dbUser.gender ?? null,
                    },
                };
                return next();
            }
        }
        req.auth = null;
        next();
    } catch {
        // 2) Fallback: treat as Supabase JWT (Google OAuth) using local decode only
        const payload = jwt.decode(token);
        if (payload && typeof payload === 'object') {
            const email =
                (payload.email ||
                    (payload.user_metadata && payload.user_metadata.email) ||
                    '').toLowerCase();
            if (email) {
                const dbUser = await prisma.user.findUnique({ where: { email } });
                if (dbUser && dbUser.status === 'ACTIVE') {
                    req.auth = {
                        user: {
                            id: dbUser.id,
                            email: dbUser.email,
                            full_name: dbUser.fullName,
                            avatar_url: dbUser.avatarUrl ?? null,
                            created_at: dbUser.createdAt,
                            role: dbUser.role,
                            phone: dbUser.phone ?? null,
                            isVip: dbUser.isVip === true,
                            gender: dbUser.gender ?? null,
                        },
                    };
                    return next();
                }
            }
        }
        req.auth = null;
        next();
    }
}

module.exports = { verifyJWT, requireRole, optionalJWT };
