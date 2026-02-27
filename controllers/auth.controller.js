const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { validateRegister, validateRegisterOAuth, validateLogin, validateForgotPassword, validateResetPassword } = require('../validators/auth.validator');

const JWT_SECRET = process.env.JWT_SECRET || 'ez-room-default-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const RESET_TOKEN_EXPIRY = '1h';
const EMAIL_VERIFY_EXPIRY = '24h';
const OTP_EXPIRY_MINUTES = 5;

function getTransporter() {
    const hasMail = !!(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS);
    if (!hasMail) return null;
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT) || 587,
        secure: process.env.MAIL_SECURE === 'true',
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
}

async function sendEmail(to, subject, text, html) {
    const transporter = getTransporter();
    if (!transporter) return false;
    try {
        await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.MAIL_USER,
            to,
            subject,
            text,
            html: html || text,
        });
        return true;
    } catch (err) {
        console.error('Send email error:', err);
        return false;
    }
}

/**
 * Generate a 6-digit OTP code
 */
function generateOTP() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Save OTP code to database. Invalidates previous unused codes of same email+type.
 */
async function saveOTPCode(email, code, type) {
    // Mark previous unused codes as used
    await prisma.verificationCode.updateMany({
        where: { email: email.toLowerCase(), type, used: false },
        data: { used: true },
    });
    // Create new code
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    return prisma.verificationCode.create({
        data: { email: email.toLowerCase(), code, type, expiresAt },
    });
}

/**
 * Verify OTP code from database
 */
async function verifyOTPCode(email, code, type) {
    const record = await prisma.verificationCode.findFirst({
        where: {
            email: email.toLowerCase(),
            type,
            used: false,
            expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
    });
    if (!record || record.code !== code) return false;
    // Mark as used
    await prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
    });
    return true;
}

/**
 * Send OTP code via email
 */
async function sendOTPEmail(email, code, type) {
    const typeLabel = type === 'REGISTER' ? 'xác thực email đăng ký' : 'xác thực đăng nhập';
    const subject = `EzRoom - Mã xác nhận ${type === 'REGISTER' ? 'đăng ký' : 'đăng nhập'}`;
    const text = `Mã xác nhận của bạn để ${typeLabel} là: ${code}\n\nMã có hiệu lực trong ${OTP_EXPIRY_MINUTES} phút. Không chia sẻ mã này với bất kỳ ai.`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="color: #1a1a1a; margin: 0;">EzRoom</h2>
                <p style="color: #666; font-size: 14px; margin-top: 4px;">Mã xác nhận ${type === 'REGISTER' ? 'đăng ký' : 'đăng nhập'}</p>
            </div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; text-align: center;">
                <p style="color: #333; font-size: 14px; margin: 0 0 16px;">Mã xác nhận của bạn là:</p>
                <div style="font-size: 36px; font-weight: bold; color: #1a73e8; letter-spacing: 8px; font-family: monospace;">${code}</div>
                <p style="color: #999; font-size: 12px; margin: 16px 0 0;">Mã có hiệu lực trong ${OTP_EXPIRY_MINUTES} phút</p>
            </div>
            <p style="color: #999; font-size: 12px; text-align: center; margin-top: 24px;">Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email này.</p>
        </div>
    `;
    const sent = await sendEmail(email, subject, text, html);
    if (!sent) {
        // Development fallback: log OTP to console
        console.log(`[OTP] ${type} code for ${email}: ${code}`);
    }
    return sent;
}

async function createNotification(userId, type, title, body) {
    try {
        await prisma.notification.create({
            data: {
                userId,
                type,
                title: title || null,
                body: body || null,
                status: 'UNREAD',
            },
        });
    } catch (err) {
        console.error('Create notification error:', err);
    }
}

/**
 * POST /auth/register
 * Body: { fullName, email, phone?, password, confirmPassword }
 */
async function register(req, res) {
    try {
        console.log('[Register] Request body keys:', Object.keys(req.body || {}));
        // 1. Validate input
        const { valid, errors } = validateRegister(req.body);
        if (!valid) {
            console.log('[Register] Validation failed:', errors);
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const { fullName, email, phone, password, role: roleInput } = req.body;
        const normalizedEmail = email.trim().toLowerCase();
        const role = (roleInput && String(roleInput).toUpperCase() === 'LANDLORD') ? 'LANDLORD' : 'TENANT';

        // 2. Check if email already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (existingUser) {
            console.log('[Register] Email already exists:', normalizedEmail);
            return res.status(409).json({
                success: false,
                message: 'Email đã được sử dụng',
            });
        }

        // 3. Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // 4. Create user in DB with status INACTIVE (chờ xác thực OTP)
        const newUser = await prisma.user.create({
            data: {
                fullName: fullName.trim(),
                email: normalizedEmail,
                password_hash,
                phone: phone ? String(phone).trim() : null,
                role,
                status: 'INACTIVE',
            },
        });

        console.log('[Register] Created user id=', newUser.id, 'email=', newUser.email, '(INACTIVE - pending OTP)');

        // 5. Generate OTP and send to email
        const otpCode = generateOTP();
        await saveOTPCode(normalizedEmail, otpCode, 'REGISTER');
        await sendOTPEmail(normalizedEmail, otpCode, 'REGISTER');

        await createNotification(
            newUser.id,
            'SYSTEM',
            'Mã xác nhận đăng ký đã gửi',
            `Đã gửi mã xác nhận 6 số đến ${newUser.email}. Vui lòng kiểm tra email.`
        );

        // 6. Return — FE sẽ hiển thị form nhập OTP
        return res.status(201).json({
            success: true,
            message: 'Đăng ký thành công. Vui lòng kiểm tra email để nhập mã xác nhận.',
            needVerification: true,
            email: newUser.email,
        });
    } catch (err) {
        const message = err && (err.message || String(err));
        const code = err && err.code;
        console.error('[Register] Error:', message);
        if (code) console.error('[Register] Code:', code);
        if (err && err.meta) console.error('[Register] Meta:', err.meta);
        console.error('[Register] Stack:', err && err.stack);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi khi đăng ký',
            error: message,
            code: code || undefined,
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
        if (user.status === 'INACTIVE') {
            // Tài khoản chưa xác thực email — gửi lại OTP
            const otpCode = generateOTP();
            await saveOTPCode(user.email, otpCode, 'REGISTER');
            await sendOTPEmail(user.email, otpCode, 'REGISTER');
            return res.status(403).json({
                success: false,
                message: 'Tài khoản chưa xác thực email. Mã xác nhận mới đã được gửi đến email của bạn.',
                needVerification: true,
                verificationType: 'REGISTER',
                email: user.email,
            });
        }

        if (user.status === 'SUSPENDED' || user.status === 'BANNED') {
            return res.status(403).json({
                success: false,
                message: 'Tài khoản đã bị khóa hoặc tạm ngưng',
            });
        }

        // 5. Generate OTP for login verification (2-step login)
        const otpCode = generateOTP();
        await saveOTPCode(user.email, otpCode, 'LOGIN');
        await sendOTPEmail(user.email, otpCode, 'LOGIN');

        // 6. Return — FE sẽ hiển thị form nhập OTP
        return res.status(200).json({
            success: true,
            message: 'Mã xác nhận đã được gửi đến email của bạn.',
            needVerification: true,
            email: user.email,
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

/**
 * POST /auth/forgot-password
 * Body: { email }
 * Sends reset link by email if user exists. Always returns same success message for security.
 */
async function forgotPassword(req, res) {
    try {
        const { valid, errors } = validateForgotPassword(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const email = req.body.email.trim().toLowerCase();
        const user = await prisma.user.findUnique({
            where: { email },
        });

        // Always return success to avoid leaking whether email exists
        const successMessage = 'Nếu tài khoản tồn tại, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu.';

        if (!user) {
            return res.status(200).json({ success: true, message: successMessage });
        }

        const resetToken = jwt.sign(
            { userId: user.id, purpose: 'password_reset' },
            JWT_SECRET,
            { expiresIn: RESET_TOKEN_EXPIRY }
        );

        const resetLink = `${FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${resetToken}`;

        const hasMailConfig = !!(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS);
        if (hasMailConfig) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.MAIL_HOST,
                    port: Number(process.env.MAIL_PORT) || 587,
                    secure: process.env.MAIL_SECURE === 'true',
                    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
                });
                await transporter.sendMail({
                    from: process.env.MAIL_FROM || process.env.MAIL_USER,
                    to: user.email,
                    subject: 'EzRoom - Đặt lại mật khẩu',
                    text: `Bạn đã yêu cầu đặt lại mật khẩu. Truy cập link sau trong vòng 1 giờ:\n\n${resetLink}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
                    html: `<p>Bạn đã yêu cầu đặt lại mật khẩu. <a href="${resetLink}">Nhấn vào đây để đặt lại mật khẩu</a> (link có hiệu lực 1 giờ).</p><p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
                });
            } catch (mailErr) {
                console.error('Forgot password email error:', mailErr);
            }
        } else {
            // Development: log link to console so you can test without SMTP
            console.log('[Forgot password] Reset link for', email, ':', resetLink);
        }

        return res.status(200).json({ success: true, message: successMessage });
    } catch (err) {
        console.error('Forgot password error:', err);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi. Vui lòng thử lại sau.',
        });
    }
}

/**
 * POST /auth/reset-password
 * Body: { token, newPassword, confirmPassword }
 */
async function resetPassword(req, res) {
    try {
        const { valid, errors } = validateResetPassword(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const { token, newPassword } = req.body;

        let payload;
        try {
            payload = jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(400).json({
                success: false,
                message: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu gửi lại.',
            });
        }

        if (payload.purpose !== 'password_reset' || !payload.userId) {
            return res.status(400).json({
                success: false,
                message: 'Link không hợp lệ.',
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: payload.userId },
        });

        if (!user || user.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: 'Tài khoản không tồn tại hoặc đã bị khóa.',
            });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(newPassword, salt);

        await prisma.user.update({
            where: { id: user.id },
            data: { password_hash },
        });

        return res.status(200).json({
            success: true,
            message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.',
        });
    } catch (err) {
        console.error('Reset password error:', err);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi. Vui lòng thử lại.',
        });
    }
}

/**
 * POST /auth/register-oauth
 * Body: { email, fullName, phone?, role: 'TENANT' | 'LANDLORD' }
 * Complete registration after Google/Facebook (no account in our DB yet).
 */
async function registerOAuth(req, res) {
    try {
        const { valid, errors } = validateRegisterOAuth(req.body);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ', errors });
        }

        const { email, fullName, phone, role: roleInput } = req.body;
        const normalizedEmail = String(email).trim().toLowerCase();
        const role = String(roleInput).toUpperCase() === 'LANDLORD' ? 'LANDLORD' : 'TENANT';

        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Email đã được sử dụng.' });
        }

        const randomPassword = require('crypto').randomBytes(32).toString('hex');
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(randomPassword, salt);

        const newUser = await prisma.user.create({
            data: {
                fullName: String(fullName).trim(),
                email: normalizedEmail,
                password_hash,
                phone: phone ? String(phone).trim() : null,
                role,
                status: 'ACTIVE',
            },
        });

        return res.status(201).json({
            success: true,
            message: 'Đăng ký hoàn tất. Bạn có thể đăng nhập.',
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
        console.error('Register OAuth error:', err);
        return res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi khi đăng ký',
            error: err.message,
        });
    }
}

/**
 * PATCH /auth/profile – update current user profile (requireAuth)
 * Body: { fullName?, phone?, avatarUrl? }
 */
async function updateProfile(req, res) {
    try {
        const userId = req.auth.user.id;
        const { fullName, phone, avatarUrl } = req.body;
        const updates = {};
        if (fullName !== undefined) updates.fullName = String(fullName).trim().slice(0, 100);
        if (phone !== undefined) updates.phone = phone === null || phone === '' ? null : String(phone).trim();
        if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl === null || avatarUrl === '' ? null : String(avatarUrl).trim();
        if (Object.keys(updates).length === 0) {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    phone: user.phone,
                    avatarUrl: user.avatarUrl,
                    role: user.role,
                    createdAt: user.createdAt,
                },
            });
        }
        const user = await prisma.user.update({
            where: { id: userId },
            data: updates,
        });
        return res.json({
            success: true,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
                avatarUrl: user.avatarUrl,
                role: user.role,
                createdAt: user.createdAt,
            },
        });
    } catch (err) {
        console.error('Update profile error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /auth/lifestyle – get current user lifestyle profile
 */
async function getLifestyle(req, res) {
    try {
        const userId = req.auth.user.id;
        const profile = await prisma.lifestyleProfile.findUnique({
            where: { userId },
        });
        return res.json({
            success: true,
            profile: profile ? {
                id: profile.id,
                smoking: profile.smoking,
                drinking: profile.drinking,
                pets_allowed: profile.pets_allowed,
                sleep_schedule: profile.sleep_schedule,
                personalityType: profile.personalityType,
            } : null,
        });
    } catch (err) {
        console.error('Get lifestyle error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * PUT /auth/lifestyle – create or update lifestyle profile
 * Body: { smoking?, drinking?, pets_allowed?, sleep_schedule?, personalityType? }
 */
async function upsertLifestyle(req, res) {
    try {
        const userId = req.auth.user.id;
        const { smoking, drinking, pets_allowed, sleep_schedule, personalityType } = req.body;
        const profile = await prisma.lifestyleProfile.upsert({
            where: { userId },
            create: {
                userId,
                smoking: !!smoking,
                drinking: !!drinking,
                pets_allowed: !!pets_allowed,
                sleep_schedule: sleep_schedule ? String(sleep_schedule).slice(0, 50) : null,
                personalityType: personalityType ? String(personalityType).slice(0, 50) : null,
            },
            update: {
                ...(smoking !== undefined && { smoking: !!smoking }),
                ...(drinking !== undefined && { drinking: !!drinking }),
                ...(pets_allowed !== undefined && { pets_allowed: !!pets_allowed }),
                ...(sleep_schedule !== undefined && { sleep_schedule: sleep_schedule ? String(sleep_schedule).slice(0, 50) : null }),
                ...(personalityType !== undefined && { personalityType: personalityType ? String(personalityType).slice(0, 50) : null }),
            },
        });
        return res.json({
            success: true,
            profile: {
                id: profile.id,
                smoking: profile.smoking,
                drinking: profile.drinking,
                pets_allowed: profile.pets_allowed,
                sleep_schedule: profile.sleep_schedule,
                personalityType: profile.personalityType,
            },
        });
    } catch (err) {
        console.error('Upsert lifestyle error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /auth/preference – get current user preference
 */
async function getPreference(req, res) {
    try {
        const userId = req.auth.user.id;
        const prefs = await prisma.userPreference.findUnique({
            where: { userId },
        });
        return res.json({
            success: true,
            preference: prefs ? {
                id: prefs.id,
                budget_min: prefs.budget_min != null ? Number(prefs.budget_min) : null,
                budget_max: prefs.budget_max != null ? Number(prefs.budget_max) : null,
                preferredLocation: prefs.preferredLocation,
                preferred_gender: prefs.preferred_gender,
            } : null,
        });
    } catch (err) {
        console.error('Get preference error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * PUT /auth/preference – create or update user preference
 * Body: { budget_min?, budget_max?, preferredLocation?, preferred_gender? }
 */
async function upsertPreference(req, res) {
    try {
        const userId = req.auth.user.id;
        const { budget_min, budget_max, preferredLocation, preferred_gender } = req.body;
        const toNumber = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
        const prefs = await prisma.userPreference.upsert({
            where: { userId },
            create: {
                userId,
                budget_min: toNumber(budget_min),
                budget_max: toNumber(budget_max),
                preferredLocation: preferredLocation ? String(preferredLocation).slice(0, 200) : null,
                preferred_gender: preferred_gender ? String(preferred_gender).slice(0, 20) : null,
            },
            update: {
                ...(budget_min !== undefined && { budget_min: toNumber(budget_min) }),
                ...(budget_max !== undefined && { budget_max: toNumber(budget_max) }),
                ...(preferredLocation !== undefined && { preferredLocation: preferredLocation ? String(preferredLocation).slice(0, 200) : null }),
                ...(preferred_gender !== undefined && { preferred_gender: preferred_gender ? String(preferred_gender).slice(0, 20) : null }),
            },
        });
        return res.json({
            success: true,
            preference: {
                id: prefs.id,
                budget_min: prefs.budget_min != null ? Number(prefs.budget_min) : null,
                budget_max: prefs.budget_max != null ? Number(prefs.budget_max) : null,
                preferredLocation: prefs.preferredLocation,
                preferred_gender: prefs.preferred_gender,
            },
        });
    } catch (err) {
        console.error('Upsert preference error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /auth/suggest-password
 * Returns a random strong password (12 chars: upper, lower, number, special).
 */
function suggestPassword(req, res) {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const numbers = '23456789';
    const special = '!@#$%&*';
    const all = upper + lower + numbers + special;
    const pick = (str, n) => {
        let result = '';
        for (let i = 0; i < n; i++) result += str[Math.floor(Math.random() * str.length)];
        return result;
    };
    const password = (pick(upper, 1) + pick(lower, 1) + pick(numbers, 1) + pick(special, 1) + pick(all, 8))
        .split('')
        .sort(() => Math.random() - 0.5)
        .join('');
    return res.json({ success: true, suggestedPassword: password });
}

/**
 * POST /auth/verify-email
 * Body: { email, code }
 * Verify OTP after registration → activate user.
 */
async function verifyEmail(req, res) {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, message: 'Email và mã xác nhận là bắt buộc' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Verify OTP
        const isValid = await verifyOTPCode(normalizedEmail, code.trim(), 'REGISTER');
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Mã xác nhận không đúng hoặc đã hết hạn. Vui lòng thử lại.',
            });
        }

        // Activate user
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { status: 'ACTIVE' },
        });

        // Send welcome email
        const welcomeSubject = 'Chào mừng bạn đến với EzRoom';
        const welcomeText = `Chào ${user.fullName},\n\nChúc mừng bạn đã xác thực email và đăng ký tài khoản EzRoom thành công.\n\nTrân trọng,\nĐội ngũ EzRoom`;
        const welcomeHtml = `<p>Chào <strong>${user.fullName}</strong>,</p><p>Chúc mừng bạn đã xác thực email và đăng ký tài khoản EzRoom thành công.</p><p>Trân trọng,<br/>Đội ngũ EzRoom</p>`;
        await sendEmail(user.email, welcomeSubject, welcomeText, welcomeHtml);

        await createNotification(
            user.id,
            'SYSTEM',
            'Xác thực email thành công',
            'Tài khoản của bạn đã được kích hoạt. Chào mừng bạn đến với EzRoom!'
        );

        return res.json({
            success: true,
            message: 'Xác thực email thành công. Bạn có thể đăng nhập.',
        });
    } catch (err) {
        console.error('Verify email error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi xác thực email', error: err.message });
    }
}

/**
 * POST /auth/verify-login
 * Body: { email, code }
 * Verify OTP after login → return JWT token.
 */
async function verifyLogin(req, res) {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, message: 'Email và mã xác nhận là bắt buộc' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Verify OTP
        const isValid = await verifyOTPCode(normalizedEmail, code.trim(), 'LOGIN');
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Mã xác nhận không đúng hoặc đã hết hạn. Vui lòng thử lại.',
            });
        }

        // Find user
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || user.status !== 'ACTIVE') {
            return res.status(401).json({ success: false, message: 'Tài khoản không tồn tại hoặc đã bị khóa' });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                role: user.role,
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        return res.json({
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
        console.error('Verify login error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi xác thực đăng nhập', error: err.message });
    }
}

/**
 * POST /auth/resend-code
 * Body: { email, type: 'REGISTER' | 'LOGIN' }
 * Resend OTP code.
 */
async function resendCode(req, res) {
    try {
        const { email, type } = req.body;
        if (!email || !type || !['REGISTER', 'LOGIN'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Email và loại xác nhận là bắt buộc' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check user exists
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            // Don't reveal if email exists
            return res.json({ success: true, message: 'Nếu email tồn tại, mã xác nhận mới đã được gửi.' });
        }

        // Rate limit: check if a code was sent in the last 60 seconds
        const recentCode = await prisma.verificationCode.findFirst({
            where: {
                email: normalizedEmail,
                type,
                createdAt: { gt: new Date(Date.now() - 60 * 1000) },
            },
        });
        if (recentCode) {
            return res.status(429).json({
                success: false,
                message: 'Vui lòng đợi 60 giây trước khi gửi lại mã.',
            });
        }

        const otpCode = generateOTP();
        await saveOTPCode(normalizedEmail, otpCode, type);
        await sendOTPEmail(normalizedEmail, otpCode, type);

        return res.json({
            success: true,
            message: 'Mã xác nhận mới đã được gửi đến email của bạn.',
        });
    } catch (err) {
        console.error('Resend code error:', err);
        return res.status(500).json({ success: false, message: 'Lỗi gửi lại mã', error: err.message });
    }
}

module.exports = { register, registerOAuth, login, forgotPassword, resetPassword, updateProfile, getLifestyle, upsertLifestyle, getPreference, upsertPreference, suggestPassword, verifyEmail, verifyLogin, resendCode };
