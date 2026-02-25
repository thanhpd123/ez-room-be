const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { validateRegister, validateLogin } = require('../validators/auth.validator');

const JWT_SECRET = process.env.JWT_SECRET || 'ez-room-default-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * POST /auth/register
 * Body: { fullName, email, phone?, password, confirmPassword }
 */
async function register(req, res) {
    try {
        // 1. Validate input
        const { valid, errors } = validateRegister(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const { fullName, email, phone, password } = req.body;
        const normalizedEmail = email.trim().toLowerCase();

        // 2. Check if email already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'Email đã được sử dụng',
            });
        }

        // 3. Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // 4. Create user in DB
        const newUser = await prisma.user.create({
            data: {
                fullName: fullName.trim(),
                email: normalizedEmail,
                password_hash,
                phone: phone ? phone.trim() : null,
                role: 'TENANT',
                status: 'ACTIVE',
            },
        });

        // 5. Return user info (exclude password_hash)
        return res.status(201).json({
            success: true,
            message: 'Đăng ký thành công',
            user: {
                id: newUser.id,
                fullName: newUser.fullName,
                email: newUser.email,
                phone: newUser.phone,
                role: newUser.role,
                status: newUser.status,
                avatarUrl: newUser.avatarUrl,
                createdAt: newUser.createdAt,
            },
        });
    } catch (err) {
        console.error('Register error:', err);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi khi đăng ký',
            error: err.message,
        });
    }
}

/**
 * POST /auth/login
 * Body: { email, password }
 */
async function login(req, res) {
    try {
        // 1. Validate input
        const { valid, errors } = validateLogin(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const { email, password } = req.body;
        const normalizedEmail = email.trim().toLowerCase();

        // 2. Find user by email
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Email hoặc mật khẩu không đúng',
            });
        }

        // 3. Compare password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Email hoặc mật khẩu không đúng',
            });
        }

        // 4. Check user status
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                message: 'Tài khoản đã bị khóa hoặc tạm ngưng',
            });
        }

        // 5. Generate JWT token
        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                role: user.role,
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        // 6. Return token + user info
        return res.status(200).json({
            success: true,
            message: 'Đăng nhập thành công',
            token,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: user.status,
                avatarUrl: user.avatarUrl,
                createdAt: user.createdAt,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi khi đăng nhập',
            error: err.message,
        });
    }
}

module.exports = { register, login };
