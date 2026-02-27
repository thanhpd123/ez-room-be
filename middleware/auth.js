const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'ez-room-default-secret';

/**
 * Verify Supabase JWT (Google/Facebook OAuth) or Backend JWT (email/password)
 * Attaches user info to req.auth.user
 */
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

    try {
        // 1) Try Supabase JWT (Google/Facebook OAuth) – require matching Prisma user
        const { data: { user: supaUser }, error } = await supabase.auth.getUser(token);
        if (!error && supaUser) {
            const email = (supaUser.email || '').toLowerCase();
            const dbUser = await prisma.user.findUnique({
                where: { email },
            });
            if (!dbUser || dbUser.status !== 'ACTIVE') {
                return res.status(404).json({
                    success: false,
                    code: 'NEED_REGISTER',
                    message: 'Tài khoản chưa đăng ký. Vui lòng đăng ký trước.',
                    email: supaUser.email ?? null,
                    full_name: supaUser.user_metadata?.full_name ?? supaUser.user_metadata?.name ?? null,
                    avatar_url: supaUser.user_metadata?.avatar_url ?? null,
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
                },
            };
            return next();
        }

        // 2) Try backend JWT (email/password login)
        const payload = jwt.verify(token, JWT_SECRET);
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
            },
        };
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Token không hợp lệ',
            });
        }
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token đã hết hạn',
            });
        }
        res.status(500).json({
            success: false,
            message: 'Xác thực token thất bại',
            error: err.message,
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
        // 1) Try Supabase JWT first
        const { data: { user: supaUser }, error } = await supabase.auth.getUser(token);
        if (!error && supaUser) {
            const email = (supaUser.email || '').toLowerCase();
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
                    },
                };
                return next();
            }
        }

        // 2) Try backend JWT
        const payload = jwt.verify(token, JWT_SECRET);
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
                    },
                };
                return next();
            }
        }
        req.auth = null;
        next();
    } catch {
        req.auth = null;
        next();
    }
}

module.exports = { verifyJWT, requireRole, optionalJWT };
