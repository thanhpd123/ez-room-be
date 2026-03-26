const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const {
    validateRegister,
    validateRegisterOAuth,
    validateLogin,
    validateRefreshToken,
    validateForgotPassword,
    validateResetPassword,
} = require('../validators/auth.validator');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('Missing required environment variable: JWT_SECRET');
}
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const RESET_TOKEN_EXPIRY = '1h';
const EMAIL_VERIFY_EXPIRY = '24h';

function hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function decodeExpToDate(token) {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object' || !decoded.exp) {
        throw Object.assign(new Error('Không thể xác định hạn token'), { statusCode: 500 });
    }
    return new Date(Number(decoded.exp) * 1000);
}

function signAccessToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            userId: user.id,
            email: user.email,
            role: user.role,
            type: 'access',
        },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
    );
}

async function issueRefreshToken(user, meta = {}) {
    const refreshTokenId = crypto.randomUUID();
    const refreshToken = jwt.sign(
        {
            sub: user.id,
            tokenId: refreshTokenId,
            type: 'refresh',
        },
        JWT_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
    );

    await prisma.refreshToken.create({
        data: {
            id: refreshTokenId,
            userId: user.id,
            tokenHash: hashToken(refreshToken),
            isRevoked: false,
            expiresAt: decodeExpToDate(refreshToken),
            userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 500) : null,
            ipAddress: meta.ipAddress ? String(meta.ipAddress).slice(0, 45) : null,
        },
    });

    return refreshToken;
}

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
        room_type: prefs.room_type ?? null,
        preferred_amenities: Array.isArray(prefs.preferred_amenities) ? prefs.preferred_amenities : [],
        must_have_amenities: Array.isArray(prefs.must_have_amenities) ? prefs.must_have_amenities : [],
        preferred_lease_months: prefs.preferred_lease_months != null ? Number(prefs.preferred_lease_months) : null,
        move_in_date_min: safeDateToISOString(prefs.move_in_date_min),
        move_in_date_max: safeDateToISOString(prefs.move_in_date_max),
        max_distance_km: prefs.max_distance_km != null ? Number(prefs.max_distance_km) : null,
        transport_nearby: prefs.transport_nearby ?? null,
        pet_friendly: prefs.pet_friendly ?? null,
        preferred_roommate_age_min:
            prefs.preferred_roommate_age_min != null ? Number(prefs.preferred_roommate_age_min) : null,
        preferred_roommate_age_max:
            prefs.preferred_roommate_age_max != null ? Number(prefs.preferred_roommate_age_max) : null,
        lifestyle_match_weight:
            prefs.lifestyle_match_weight != null ? Number(prefs.lifestyle_match_weight) : null,
        safety_priority: prefs.safety_priority != null ? Number(prefs.safety_priority) : null,
    };
}

/**
 * Đăng ký tài khoản
 */
async function register(body) {
    const { valid, errors } = validateRegister(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const { fullName, email, phone, password, role: roleInput } = body;
    const normalizedEmail = email.trim().toLowerCase();
    const role =
        roleInput && String(roleInput).toUpperCase() === 'LANDLORD' ? 'LANDLORD' : 'TENANT';

    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });

    if (existingUser) {
        throw Object.assign(new Error('Email đã được sử dụng'), { statusCode: 409 });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

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

    const verificationToken = jwt.sign(
        { userId: newUser.id, purpose: 'email_verify' },
        JWT_SECRET,
        { expiresIn: EMAIL_VERIFY_EXPIRY }
    );
    const verifyLink = `${FRONTEND_URL.replace(/\/$/, '')}/verify-email?token=${verificationToken}`;

    const verificationSubject = 'EzRoom - Xác thực email của bạn';
    const verificationText = `Chào ${newUser.fullName},\n\nVui lòng xác thực email bằng cách truy cập link sau (có hiệu lực 24 giờ):\n\n${verifyLink}\n\nNếu bạn không đăng ký tài khoản EzRoom, hãy bỏ qua email này.`;
    const verificationHtml = `<p>Chào <strong>${newUser.fullName}</strong>,</p><p>Vui lòng xác thực email bằng cách <a href="${verifyLink}">nhấn vào đây</a> (link có hiệu lực 24 giờ).</p><p>Nếu bạn không đăng ký tài khoản EzRoom, hãy bỏ qua email này.</p>`;
    const verificationSent = await sendEmail(
        newUser.email,
        verificationSubject,
        verificationText,
        verificationHtml
    );
    await createNotification(
        newUser.id,
        'SYSTEM',
        'Email xác thực đã gửi',
        verificationSent
            ? `Đã gửi email xác thực đến ${newUser.email}. Vui lòng kiểm tra hộp thư.`
            : `Gửi email xác thực đến ${newUser.email} thất bại (kiểm tra cấu hình SMTP).`
    );

    const welcomeSubject = 'Chào mừng bạn đến với EzRoom';
    const welcomeText = `Chào ${newUser.fullName},\n\nChúc mừng bạn đã đăng ký tài khoản EzRoom thành công. Chúng tôi hy vọng bạn sẽ tìm được chỗ ở phù hợp.\n\nTrân trọng,\nĐội ngũ EzRoom`;
    const welcomeHtml = `<p>Chào <strong>${newUser.fullName}</strong>,</p><p>Chúc mừng bạn đã đăng ký tài khoản EzRoom thành công. Chúng tôi hy vọng bạn sẽ tìm được chỗ ở phù hợp.</p><p>Trân trọng,<br/>Đội ngũ EzRoom</p>`;
    const welcomeSent = await sendEmail(newUser.email, welcomeSubject, welcomeText, welcomeHtml);
    await createNotification(
        newUser.id,
        'SYSTEM',
        'Chào mừng bạn đến với EzRoom',
        welcomeSent
            ? `Email chào mừng đã gửi đến ${newUser.email}.`
            : `Gửi email chào mừng đến ${newUser.email} thất bại.`
    );

    return {
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
    };
}

/**
 * Đăng nhập
 */
async function login(body) {
    const { valid, errors } = validateLogin(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const { email, password } = body;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
    });

    if (!user) {
        throw Object.assign(new Error('Email hoặc mật khẩu không đúng'), { statusCode: 401 });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
        throw Object.assign(new Error('Email hoặc mật khẩu không đúng'), { statusCode: 401 });
    }

    if (user.status !== 'ACTIVE') {
        throw Object.assign(new Error('Tài khoản đã bị khóa hoặc tạm ngưng'), { statusCode: 403 });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user, body?.meta || {});

    return {
        token: accessToken,
        accessToken,
        refreshToken,
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
            gender: user.gender ?? null,
        },
    };
}

async function refreshSession(body) {
    const { valid, errors } = validateRefreshToken(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const refreshTokenRaw = String(body.refreshToken);

    let payload;
    try {
        payload = jwt.verify(refreshTokenRaw, JWT_SECRET);
    } catch {
        throw Object.assign(new Error('Refresh token không hợp lệ hoặc đã hết hạn'), {
            statusCode: 401,
            code: 'REFRESH_INVALID',
        });
    }

    if (payload.type !== 'refresh' || !payload.sub || !payload.tokenId) {
        throw Object.assign(new Error('Refresh token không hợp lệ'), {
            statusCode: 401,
            code: 'REFRESH_INVALID',
        });
    }

    const tokenHash = hashToken(refreshTokenRaw);
    const current = await prisma.refreshToken.findUnique({
        where: { id: payload.tokenId },
    });

    if (
        !current ||
        current.userId !== payload.sub ||
        current.isRevoked === true ||
        current.tokenHash !== tokenHash ||
        new Date(current.expiresAt).getTime() <= Date.now()
    ) {
        throw Object.assign(new Error('Phiên đăng nhập không còn hợp lệ'), {
            statusCode: 401,
            code: 'REFRESH_REVOKED',
        });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
        throw Object.assign(new Error('Tài khoản không tồn tại hoặc đã bị khóa'), { statusCode: 401 });
    }

    await prisma.refreshToken.update({
        where: { id: current.id },
        data: {
            isRevoked: true,
            lastUsedAt: new Date(),
        },
    });

    const nextRefreshToken = await issueRefreshToken(user, body?.meta || {});
    const accessToken = signAccessToken(user);

    return {
        token: accessToken,
        accessToken,
        refreshToken: nextRefreshToken,
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
            gender: user.gender ?? null,
        },
    };
}

async function logoutCurrentSession(body) {
    const { valid, errors } = validateRefreshToken(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    let payload;
    try {
        payload = jwt.verify(String(body.refreshToken), JWT_SECRET, { ignoreExpiration: true });
    } catch {
        return { revokedCount: 0 };
    }

    if (!payload?.tokenId || !payload?.sub) {
        return { revokedCount: 0 };
    }

    const tokenHash = hashToken(body.refreshToken);
    const result = await prisma.refreshToken.updateMany({
        where: {
            id: payload.tokenId,
            userId: payload.sub,
            tokenHash,
            isRevoked: false,
        },
        data: {
            isRevoked: true,
            lastUsedAt: new Date(),
        },
    });

    return { revokedCount: result.count };
}

async function logoutAllSessions(userId) {
    const result = await prisma.refreshToken.updateMany({
        where: {
            userId,
            isRevoked: false,
        },
        data: {
            isRevoked: true,
            lastUsedAt: new Date(),
        },
    });

    return { revokedCount: result.count };
}

/**
 * Quên mật khẩu
 */
async function forgotPassword(body) {
    const { valid, errors } = validateForgotPassword(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const email = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
        where: { email },
    });

    const successMessage =
        'Nếu tài khoản tồn tại, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu.';

    if (!user) {
        return { message: successMessage };
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
        console.log('[Forgot password] Reset link for', email, ':', resetLink);
    }

    return { message: successMessage };
}

/**
 * Đặt lại mật khẩu
 */
async function resetPassword(body) {
    const { valid, errors } = validateResetPassword(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const { token, newPassword } = body;

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        throw Object.assign(
            new Error('Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu gửi lại.'),
            { statusCode: 400 }
        );
    }

    if (payload.purpose !== 'password_reset' || !payload.userId) {
        throw Object.assign(new Error('Link không hợp lệ.'), { statusCode: 400 });
    }

    const user = await prisma.user.findUnique({
        where: { id: payload.userId },
    });

    if (!user || user.status !== 'ACTIVE') {
        throw Object.assign(new Error('Tài khoản không tồn tại hoặc đã bị khóa.'), { statusCode: 400 });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
        where: { id: user.id },
        data: { password_hash },
    });

    return {
        message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.',
    };
}

/**
 * Đăng ký OAuth
 */
async function registerOAuth(body) {
    const { valid, errors } = validateRegisterOAuth(body);
    if (!valid) {
        throw Object.assign(new Error('Dữ liệu không hợp lệ'), { statusCode: 400, errors });
    }

    const { email, fullName, phone, role: roleInput } = body;
    const normalizedEmail = String(email).trim().toLowerCase();
    const role = String(roleInput).toUpperCase() === 'LANDLORD' ? 'LANDLORD' : 'TENANT';

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
        throw Object.assign(new Error('Email đã được sử dụng.'), { statusCode: 409 });
    }

    const randomPassword = crypto.randomBytes(32).toString('hex');
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

    return {
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
    };
}

/**
 * Cập nhật profile
 */
async function updateProfile(userId, body) {
    const { fullName, phone, avatarUrl, gender } = body;
    const updates = {};
    if (fullName !== undefined) updates.fullName = String(fullName).trim().slice(0, 100);
    if (phone !== undefined)
        updates.phone = phone === null || phone === '' ? null : String(phone).trim();
    if (avatarUrl !== undefined)
        updates.avatarUrl = avatarUrl === null || avatarUrl === '' ? null : String(avatarUrl).trim();
    if (gender !== undefined)
        updates.gender = gender === null || gender === '' ? null : String(gender).trim().slice(0, 20);

    if (Object.keys(updates).length === 0) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        return {
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
                avatarUrl: user.avatarUrl,
                gender: user.gender,
                role: user.role,
                createdAt: user.createdAt,
            },
        };
    }

    const user = await prisma.user.update({
        where: { id: userId },
        data: updates,
    });
    return {
        user: {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            gender: user.gender,
            role: user.role,
            createdAt: user.createdAt,
        },
    };
}

/**
 * Lấy lifestyle profile
 */
async function getLifestyle(userId) {
    const profile = await prisma.lifestyleProfile.findUnique({
        where: { userId },
    });
    return { profile: toLifestyleResponse(profile) };
}

/**
 * Tạo/cập nhật lifestyle profile
 */
async function upsertLifestyle(userId, body) {
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
    return { profile: toLifestyleResponse(profile) };
}

/**
 * Lấy user preference
 */
async function getPreference(userId) {
    const prefs = await prisma.userPreference.findUnique({
        where: { userId },
    });
    return { preference: toPreferenceResponse(prefs) };
}

/**
 * Tạo/cập nhật user preference
 */
async function upsertPreference(userId, body) {
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
        room_type: str(body.room_type, 30),
        preferred_amenities: arr(body.preferred_amenities),
        must_have_amenities: arr(body.must_have_amenities),
        preferred_lease_months: toNumber(body.preferred_lease_months),
        move_in_date_min: date(body.move_in_date_min),
        move_in_date_max: date(body.move_in_date_max),
        max_distance_km: toNumber(body.max_distance_km),
        transport_nearby:
            body.transport_nearby === true ? true : body.transport_nearby === false ? false : null,
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
    return { preference: toPreferenceResponse(prefs) };
}

/**
 * Gợi ý mật khẩu
 */
function suggestPassword() {
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
    const password = (
        pick(upper, 1) +
        pick(lower, 1) +
        pick(numbers, 1) +
        pick(special, 1) +
        pick(all, 8)
    )
        .split('')
        .sort(() => Math.random() - 0.5)
        .join('');
    return { suggestedPassword: password };
}

module.exports = {
    register,
    registerOAuth,
    login,
    refreshSession,
    logoutCurrentSession,
    logoutAllSessions,
    forgotPassword,
    resetPassword,
    updateProfile,
    getLifestyle,
    upsertLifestyle,
    getPreference,
    upsertPreference,
    suggestPassword,
};
