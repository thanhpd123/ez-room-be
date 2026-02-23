const supabase = require('../config/supabase');

/**
 * Verify Supabase JWT from Authorization: Bearer <access_token>
 * and attach user to req.auth (user object from Supabase Auth).
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
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token',
                error: error.message,
            });
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found',
            });
        }

        req.auth = { user };
        next();
    } catch (err) {
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
