const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'ez-room-default-secret';

/**
 * Normalize user for /auth/me response: { id, email, full_name, avatar_url, created_at }
 */
function normalizeSupabaseUser(user) {
    return {
        id: user.id,
        email: user.email ?? null,
        full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        created_at: user.created_at ?? null,
    };
}

/**
 * Verify Supabase JWT or backend JWT from Authorization: Bearer <token>
 * Attaches normalized user to req.auth.user for /auth/me.
 */
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Missing or invalid Authorization header. Use: Bearer <access_token>',
        });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Missing token',
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
                message: 'Invalid token payload',
            });
        }
        const dbUser = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!dbUser || dbUser.status !== 'ACTIVE') {
            return res.status(401).json({
                success: false,
                message: 'User not found or inactive',
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
            },
        };
        next();
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token',
            });
        }
        res.status(500).json({
            success: false,
            message: 'Auth verification failed',
            error: err.message,
        });
    }
}

/**
 * Optional auth: attach user if token present, do not 401 if missing.
 */
async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.auth = null;
        return next();
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
        req.auth = null;
        return next();
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        req.auth = error || !user ? null : { user };
        next();
    } catch {
        req.auth = null;
        next();
    }
}

module.exports = { requireAuth, optionalAuth };
