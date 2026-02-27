const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { validateRegister, validateRegisterOAuth, validateLogin, validateForgotPassword, validateResetPassword } = require('../validators/auth.validator');

const JWT_SECRET = process.env.JWT_SECRET || 'ez-room-default-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const RESET_TOKEN_EXPIRY = '1h';
const EMAIL_VERIFY_EXPIRY = '24h';

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

        // 4. Create user in DB (table: public.users in PostgreSQL)
        const newUser = await prisma.user.create({
            data: {
                fullName: fullName.trim(),
                email: normalizedEmail,
                password_hash,
                phone: phone ? String(phone).trim() : null,
                role,
                status: 'ACTIVE',
            },
        });

        console.log('[Register] Created user id=', newUser.id, 'email=', newUser.email);

        // 5. Send verification email + welcome email, store in notifications
        const verificationToken = jwt.sign(
            { userId: newUser.id, purpose: 'email_verify' },
            JWT_SECRET,
            { expiresIn: EMAIL_VERIFY_EXPIRY }
        );
        const verifyLink = `${FRONTEND_URL.replace(/\/$/, '')}/verify-email?token=${verificationToken}`;

        const verificationSubject = 'EzRoom - Xác thực email của bạn';
        const verificationText = `Chào ${newUser.fullName},\n\nVui lòng xác thực email bằng cách truy cập link sau (có hiệu lực 24 giờ):\n\n${verifyLink}\n\nNếu bạn không đăng ký tài khoản EzRoom, hãy bỏ qua email này.`;
        const verificationHtml = `<p>Chào <strong>${newUser.fullName}</strong>,</p><p>Vui lòng xác thực email bằng cách <a href="${verifyLink}">nhấn vào đây</a> (link có hiệu lực 24 giờ).</p><p>Nếu bạn không đăng ký tài khoản EzRoom, hãy bỏ qua email này.</p>`;
        const verificationSent = await sendEmail(newUser.email, verificationSubject, verificationText, verificationHtml);
        await createNotification(
            newUser.id,
            'SYSTEM',
            'Email xác thực đã gửi',
            verificationSent ? `Đã gửi email xác thực đến ${newUser.email}. Vui lòng kiểm tra hộp thư.` : `Gửi email xác thực đến ${newUser.email} thất bại (kiểm tra cấu hình SMTP).`
        );

        const welcomeSubject = 'Chào mừng bạn đến với EzRoom';
        const welcomeText = `Chào ${newUser.fullName},\n\nChúc mừng bạn đã đăng ký tài khoản EzRoom thành công. Chúng tôi hy vọng bạn sẽ tìm được chỗ ở phù hợp.\n\nTrân trọng,\nĐội ngũ EzRoom`;
        const welcomeHtml = `<p>Chào <strong>${newUser.fullName}</strong>,</p><p>Chúc mừng bạn đã đăng ký tài khoản EzRoom thành công. Chúng tôi hy vọng bạn sẽ tìm được chỗ ở phù hợp.</p><p>Trân trọng,<br/>Đội ngũ EzRoom</p>`;
        const welcomeSent = await sendEmail(newUser.email, welcomeSubject, welcomeText, welcomeHtml);
        await createNotification(
            newUser.id,
            'SYSTEM',
            'Chào mừng bạn đến với EzRoom',
            welcomeSent ? `Email chào mừng đã gửi đến ${newUser.email}.` : `Gửi email chào mừng đến ${newUser.email} thất bại.`
        );

        // 6. Return user info (exclude password_hash)
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
                isVip: user.isVip === true,
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

function safeDateToISOString(d) {
    if (d == null) return null;
    try {
        const date = d instanceof Date ? d : new Date(d);
        return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    } catch {
        return null;
    }
}

function toLifestyleResponse(profile) {
    if (!profile) return null;
    return {
        id: profile.id,
        smoking: profile.smoking,
        drinking: profile.drinking,
        pets_allowed: profile.pets_allowed,
        sleep_schedule: profile.sleep_schedule ?? null,
        personalityType: profile.personalityType ?? null,
        cleanliness: profile.cleanliness ?? null,
        noise_tolerance: profile.noise_tolerance ?? null,
        guest_frequency: profile.guest_frequency ?? null,
        cooking_frequency: profile.cooking_frequency ?? null,
        work_from_home: profile.work_from_home ?? false,
        wake_time: profile.wake_time ?? null,
        bedtime: profile.bedtime ?? null,
        social_level: profile.social_level ?? null,
        occupation_type: profile.occupation_type ?? null,
        interests: Array.isArray(profile.interests) ? profile.interests : [],
        languages: Array.isArray(profile.languages) ? profile.languages : [],
        preferred_lease_months: profile.preferred_lease_months != null ? Number(profile.preferred_lease_months) : null,
        move_in_date: safeDateToISOString(profile.move_in_date),
        temperature_preference: profile.temperature_preference ?? null,
        quiet_hours_preference: profile.quiet_hours_preference ?? null,
    };
}

function toPreferenceResponse(prefs) {
    if (!prefs) return null;
    return {
        id: prefs.id,
        budget_min: prefs.budget_min != null ? Number(prefs.budget_min) : null,
        budget_max: prefs.budget_max != null ? Number(prefs.budget_max) : null,
        preferredLocation: prefs.preferredLocation ?? null,
        preferred_districts: Array.isArray(prefs.preferred_districts) ? prefs.preferred_districts : [],
        preferred_gender: prefs.preferred_gender ?? null,
        room_type: prefs.room_type ?? null,
        preferred_amenities: Array.isArray(prefs.preferred_amenities) ? prefs.preferred_amenities : [],
        must_have_amenities: Array.isArray(prefs.must_have_amenities) ? prefs.must_have_amenities : [],
        preferred_lease_months: prefs.preferred_lease_months != null ? Number(prefs.preferred_lease_months) : null,
        move_in_date_min: safeDateToISOString(prefs.move_in_date_min),
        move_in_date_max: safeDateToISOString(prefs.move_in_date_max),
        max_distance_km: prefs.max_distance_km != null ? Number(prefs.max_distance_km) : null,
        transport_nearby: prefs.transport_nearby ?? null,
        pet_friendly: prefs.pet_friendly ?? null,
        preferred_roommate_age_min: prefs.preferred_roommate_age_min != null ? Number(prefs.preferred_roommate_age_min) : null,
        preferred_roommate_age_max: prefs.preferred_roommate_age_max != null ? Number(prefs.preferred_roommate_age_max) : null,
        lifestyle_match_weight: prefs.lifestyle_match_weight != null ? Number(prefs.lifestyle_match_weight) : null,
        safety_priority: prefs.safety_priority != null ? Number(prefs.safety_priority) : null,
    };
}

/**
 * GET /auth/lifestyle – get current user lifestyle profile
 */
async function getLifestyle(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }
        const profile = await prisma.lifestyleProfile.findUnique({
            where: { userId },
        });
        return res.json({
            success: true,
            profile: toLifestyleResponse(profile),
        });
    } catch (err) {
        console.error('Get lifestyle error:', err);
        return res.status(500).json({
            success: false,
            message: err.message || 'Lỗi tải phong cách sống',
            code: err.code,
        });
    }
}

/**
 * PUT /auth/lifestyle – create or update lifestyle profile
 * Body: all LifestyleProfile fields (smoking, drinking, pets_allowed, sleep_schedule, personalityType,
 * cleanliness, noise_tolerance, guest_frequency, cooking_frequency, work_from_home, wake_time, bedtime,
 * social_level, occupation_type, interests[], languages[], preferred_lease_months, move_in_date,
 * temperature_preference, quiet_hours_preference)
 */
async function upsertLifestyle(req, res) {
    try {
        const userId = req.auth.user.id;
        const body = req.body;
        const str = (v, len = 50) => (v === '' || v == null ? null : String(v).slice(0, len));
        const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 50) : []);
        const num = (v) => (v === '' || v == null ? null : Number(v));
        const date = (v) => (v === '' || v == null ? null : new Date(v));
        const create = {
            userId,
            smoking: body.smoking === true,
            drinking: body.drinking === true,
            pets_allowed: body.pets_allowed === true,
            sleep_schedule: str(body.sleep_schedule),
            personalityType: str(body.personalityType),
            cleanliness: str(body.cleanliness),
            noise_tolerance: str(body.noise_tolerance),
            guest_frequency: str(body.guest_frequency),
            cooking_frequency: str(body.cooking_frequency),
            work_from_home: body.work_from_home === true,
            wake_time: str(body.wake_time),
            bedtime: str(body.bedtime),
            social_level: str(body.social_level),
            occupation_type: str(body.occupation_type),
            interests: arr(body.interests),
            languages: arr(body.languages),
            preferred_lease_months: num(body.preferred_lease_months),
            move_in_date: date(body.move_in_date),
            temperature_preference: str(body.temperature_preference, 20),
            quiet_hours_preference: str(body.quiet_hours_preference, 30),
        };
        const update = {};
        Object.keys(create).forEach((k) => {
            if (k === 'userId') return;
            if (body[k] !== undefined) update[k] = create[k];
        });
        const profile = await prisma.lifestyleProfile.upsert({
            where: { userId },
            create,
            update,
        });
        return res.json({ success: true, profile: toLifestyleResponse(profile) });
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
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });
        }
        const prefs = await prisma.userPreference.findUnique({
            where: { userId },
        });
        return res.json({
            success: true,
            preference: toPreferenceResponse(prefs),
        });
    } catch (err) {
        console.error('Get preference error:', err);
        return res.status(500).json({
            success: false,
            message: err.message || 'Lỗi tải sở thích',
            code: err.code,
        });
    }
}

/**
 * PUT /auth/preference – create or update user preference
 * Body: budget_min?, budget_max?, preferredLocation?, preferred_districts[]?, preferred_gender?,
 * room_type?, preferred_amenities[]?, must_have_amenities[]?, preferred_lease_months?,
 * move_in_date_min?, move_in_date_max?, max_distance_km?, transport_nearby?, pet_friendly?,
 * preferred_roommate_age_min?, preferred_roommate_age_max?, lifestyle_match_weight?, safety_priority?
 */
async function upsertPreference(req, res) {
    try {
        const userId = req.auth.user.id;
        const body = req.body;
        const toNumber = (v) => (v === '' || v == null ? null : Number(v));
        const str = (v, len = 255) => (v === '' || v == null ? null : String(v).slice(0, len));
        const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 100) : []);
        const date = (v) => (v === '' || v == null ? null : new Date(v));
        const create = {
            userId,
            budget_min: toNumber(body.budget_min),
            budget_max: toNumber(body.budget_max),
            preferredLocation: str(body.preferredLocation, 255),
            preferred_districts: arr(body.preferred_districts),
            preferred_gender: str(body.preferred_gender, 20),
            room_type: str(body.room_type, 30),
            preferred_amenities: arr(body.preferred_amenities),
            must_have_amenities: arr(body.must_have_amenities),
            preferred_lease_months: toNumber(body.preferred_lease_months),
            move_in_date_min: date(body.move_in_date_min),
            move_in_date_max: date(body.move_in_date_max),
            max_distance_km: toNumber(body.max_distance_km),
            transport_nearby: body.transport_nearby === true ? true : body.transport_nearby === false ? false : null,
            pet_friendly: body.pet_friendly === true ? true : body.pet_friendly === false ? false : null,
            preferred_roommate_age_min: toNumber(body.preferred_roommate_age_min),
            preferred_roommate_age_max: toNumber(body.preferred_roommate_age_max),
            lifestyle_match_weight: toNumber(body.lifestyle_match_weight),
            safety_priority: toNumber(body.safety_priority),
        };
        const update = {};
        Object.keys(create).forEach((k) => {
            if (k === 'userId') return;
            if (body[k] !== undefined) update[k] = create[k];
        });
        const prefs = await prisma.userPreference.upsert({
            where: { userId },
            create,
            update,
        });
        return res.json({ success: true, preference: toPreferenceResponse(prefs) });
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

module.exports = { register, registerOAuth, login, forgotPassword, resetPassword, updateProfile, getLifestyle, upsertLifestyle, getPreference, upsertPreference, suggestPassword };
