const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ez-room-default-secret';

/**
 * Middleware: Verify JWT token from Authorization: Bearer <token>
 * Decodes token and attaches payload to req.user
 */
function verifyJWT(req, res, next) {
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
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { userId, email, role, iat, exp }
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token đã hết hạn',
            });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Token không hợp lệ',
            });
        }
        return res.status(401).json({
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
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Chưa xác thực. Vui lòng đăng nhập',
            });
        }

        const userRole = req.user.role;

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
function optionalJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
    } catch {
        req.user = null;
    }

    next();
}

module.exports = { verifyJWT, requireRole, optionalJWT };
