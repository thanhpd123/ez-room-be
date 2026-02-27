/**
 * auth.controller.test.js — Unit test cho Auth Controller
 *
 * Modules được test:
 * - controllers/auth.controller.js :
 *   register, login, verifyEmail, verifyLogin, resendCode,
 *   forgotPassword, resetPassword, registerOAuth,
 *   updateProfile, getLifestyle, upsertLifestyle,
 *   getPreference, upsertPreference, suggestPassword
 *
 * Chiến lược:
 * - Mock prisma (tất cả DB calls)
 * - Mock nodemailer (không gửi email thật)
 * - Mock bcrypt (không hash thật, tốn thời gian)
 * - Test logic xử lý request/response
 *
 * Sử dụng: node --test test/auth.controller.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes } = require('./helpers');

// ═══════════════════════════════════════════════════════════
// Mock dependencies TRƯỚC khi require controller
// ═══════════════════════════════════════════════════════════

// --- Mock prisma ---
let mockUsers = {};       // email -> user object
let mockVerifCodes = {};  // email -> code record
let mockNotifs = [];
let mockLifestyles = {};  // userId -> profile
let mockPrefs = {};       // userId -> preference

const fakePrisma = {
    user: {
        findUnique: async ({ where }) => {
            if (where.email) return mockUsers[where.email] || null;
            if (where.id) return Object.values(mockUsers).find((u) => u.id === where.id) || null;
            return null;
        },
        create: async ({ data }) => {
            const user = { id: `user-${Date.now()}`, createdAt: new Date(), avatarUrl: null, ...data };
            mockUsers[data.email] = user;
            return user;
        },
        update: async ({ where, data }) => {
            const user = where.id
                ? Object.values(mockUsers).find((u) => u.id === where.id)
                : mockUsers[where.email];
            if (user) Object.assign(user, data);
            return user;
        },
        count: async () => Object.keys(mockUsers).length,
    },
    verificationCode: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }) => {
            const record = { id: `vc-${Date.now()}`, used: false, createdAt: new Date(), ...data };
            mockVerifCodes[data.email] = record;
            return record;
        },
        findFirst: async ({ where }) => {
            const record = mockVerifCodes[where.email];
            if (!record) return null;
            // Kiểm tra điều kiện
            if (where.type && record.type !== where.type) return null;
            if (where.used === false && record.used === true) return null;
            if (where.expiresAt?.gt && record.expiresAt <= where.expiresAt.gt) return null;
            if (where.createdAt?.gt && record.createdAt <= where.createdAt.gt) return null;
            return record;
        },
        update: async ({ where, data }) => {
            const key = Object.keys(mockVerifCodes).find((k) => mockVerifCodes[k].id === where.id);
            if (key) Object.assign(mockVerifCodes[key], data);
            return mockVerifCodes[key];
        },
    },
    notification: {
        create: async ({ data }) => {
            mockNotifs.push(data);
            return data;
        },
    },
    lifestyleProfile: {
        findUnique: async ({ where }) => mockLifestyles[where.userId] || null,
        upsert: async ({ where, create, update }) => {
            if (mockLifestyles[where.userId]) {
                Object.assign(mockLifestyles[where.userId], update);
                return mockLifestyles[where.userId];
            }
            const profile = { id: `lp-${Date.now()}`, ...create };
            mockLifestyles[where.userId] = profile;
            return profile;
        },
    },
    userPreference: {
        findUnique: async ({ where }) => mockPrefs[where.userId] || null,
        upsert: async ({ where, create, update }) => {
            if (mockPrefs[where.userId]) {
                Object.assign(mockPrefs[where.userId], update);
                return mockPrefs[where.userId];
            }
            const pref = { id: `pref-${Date.now()}`, ...create };
            mockPrefs[where.userId] = pref;
            return pref;
        },
    },
    $connect: async () => {},
    $disconnect: async () => {},
};

// --- Mock bcryptjs ---
const fakeBcrypt = {
    genSalt: async () => 'mock-salt',
    hash: async (password) => `hashed_${password}`,
    compare: async (password, hash) => hash === `hashed_${password}`,
};

// --- Mock nodemailer ---
const fakeNodemailer = {
    createTransport: () => ({
        sendMail: async () => ({ messageId: 'mock-msg-id' }),
    }),
};

// --- Mock jsonwebtoken ---
let mockJwtVerifyResult = null;
let mockJwtVerifyError = null;
const fakeJwt = {
    sign: (payload, secret, opts) => 'mock-jwt-token',
    verify: (token, secret) => {
        if (mockJwtVerifyError) throw mockJwtVerifyError;
        return mockJwtVerifyResult;
    },
};

// --- Inject mocks vào require cache ---
const configPrismaPath = require.resolve('../config/prisma');
const bcryptPath = require.resolve('bcryptjs');
const nodemailerPath = require.resolve('nodemailer');
const jwtPath = require.resolve('jsonwebtoken');

require.cache[configPrismaPath] = { id: configPrismaPath, exports: fakePrisma };
require.cache[bcryptPath] = { id: bcryptPath, exports: fakeBcrypt };
require.cache[nodemailerPath] = { id: nodemailerPath, exports: fakeNodemailer };
require.cache[jwtPath] = { id: jwtPath, exports: fakeJwt };

// Đặt env cho SMTP (để sendOTPEmail thực sự dùng transporter thay vì chỉ console.log)
process.env.MAIL_HOST = 'mock-smtp';
process.env.MAIL_USER = 'mock@test.com';
process.env.MAIL_PASS = 'mock-pass';

// Load controller SAU KHI đã inject mock
const {
    register,
    login,
    verifyEmail,
    verifyLogin,
    resendCode,
    forgotPassword,
    resetPassword,
    registerOAuth,
    updateProfile,
    getLifestyle,
    upsertLifestyle,
    getPreference,
    upsertPreference,
    suggestPassword,
} = require('../controllers/auth.controller');

// ═══════════════════════════════════════════════════════════
// Reset state trước mỗi test
// ═══════════════════════════════════════════════════════════

function resetMocks() {
    mockUsers = {};
    mockVerifCodes = {};
    mockNotifs = [];
    mockLifestyles = {};
    mockPrefs = {};
    mockJwtVerifyResult = null;
    mockJwtVerifyError = null;
}

// ═══════════════════════════════════════════════════════════
// 1. register
// ═══════════════════════════════════════════════════════════

describe('register', () => {
    beforeEach(resetMocks);

    const validBody = {
        fullName: 'Nguyen Van A',
        email: 'newuser@test.com',
        password: 'Test@12345',
        confirmPassword: 'Test@12345',
        phone: '0912345678',
    };

    it('đăng ký thành công — trả 201, needVerification=true', async () => {
        const req = mockReq({ body: validBody });
        const res = mockRes();
        await register(req, res);

        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
        assert.equal(res._json.needVerification, true);
        assert.equal(res._json.email, 'newuser@test.com');
    });

    it('đăng ký — user được tạo với status INACTIVE', async () => {
        const req = mockReq({ body: validBody });
        const res = mockRes();
        await register(req, res);

        const user = mockUsers['newuser@test.com'];
        assert.ok(user, 'User phải được tạo trong DB');
        assert.equal(user.status, 'INACTIVE');
    });

    it('đăng ký — tạo mã OTP lưu vào DB', async () => {
        const req = mockReq({ body: validBody });
        const res = mockRes();
        await register(req, res);

        const code = mockVerifCodes['newuser@test.com'];
        assert.ok(code, 'OTP code phải được lưu');
        assert.equal(code.type, 'REGISTER');
        assert.equal(code.code.length, 6);
    });

    it('validation thất bại (thiếu confirmPassword) — trả 400', async () => {
        const req = mockReq({ body: { ...validBody, confirmPassword: '' } });
        const res = mockRes();
        await register(req, res);

        assert.equal(res._status, 400);
        assert.equal(res._json.success, false);
        assert.ok(res._json.errors.length > 0);
    });

    it('email đã tồn tại — trả 409', async () => {
        // Tạo user sẵn
        mockUsers['exist@test.com'] = { id: 'u1', email: 'exist@test.com', status: 'ACTIVE' };

        const req = mockReq({ body: { ...validBody, email: 'exist@test.com' } });
        const res = mockRes();
        await register(req, res);

        assert.equal(res._status, 409);
        assert.ok(res._json.message.includes('đã được sử dụng'));
    });

    it('email được chuẩn hóa (lowercase + trim) — đúng', async () => {
        const req = mockReq({ body: { ...validBody, email: '  User@Test.COM  ' } });
        const res = mockRes();
        await register(req, res);

        assert.ok(mockUsers['user@test.com'], 'Email phải được lowercase');
    });

    it('role mặc định là TENANT khi không truyền', async () => {
        const req = mockReq({ body: validBody });
        const res = mockRes();
        await register(req, res);

        const user = mockUsers['newuser@test.com'];
        assert.equal(user.role, 'TENANT');
    });

    it('role = LANDLORD khi truyền', async () => {
        const req = mockReq({ body: { ...validBody, role: 'LANDLORD' } });
        const res = mockRes();
        await register(req, res);

        const user = mockUsers['newuser@test.com'];
        assert.equal(user.role, 'LANDLORD');
    });
});

// ═══════════════════════════════════════════════════════════
// 2. login
// ═══════════════════════════════════════════════════════════

describe('login', () => {
    beforeEach(() => {
        resetMocks();
        // Tạo user ACTIVE sẵn
        mockUsers['active@test.com'] = {
            id: 'u-active',
            email: 'active@test.com',
            password_hash: 'hashed_Test@12345',
            status: 'ACTIVE',
            fullName: 'Active User',
        };
    });

    it('đăng nhập thành công — trả OTP needVerification', async () => {
        const req = mockReq({ body: { email: 'active@test.com', password: 'Test@12345' } });
        const res = mockRes();
        await login(req, res);

        assert.equal(res._status, 200);
        assert.equal(res._json.needVerification, true);
        assert.equal(res._json.email, 'active@test.com');
    });

    it('đăng nhập — tạo OTP type LOGIN', async () => {
        const req = mockReq({ body: { email: 'active@test.com', password: 'Test@12345' } });
        const res = mockRes();
        await login(req, res);

        const code = mockVerifCodes['active@test.com'];
        assert.ok(code);
        assert.equal(code.type, 'LOGIN');
    });

    it('email không tồn tại — trả 401', async () => {
        const req = mockReq({ body: { email: 'nobody@test.com', password: '123' } });
        const res = mockRes();
        await login(req, res);

        assert.equal(res._status, 401);
        assert.ok(res._json.message.includes('không đúng'));
    });

    it('mật khẩu sai — trả 401', async () => {
        const req = mockReq({ body: { email: 'active@test.com', password: 'WrongPass1!' } });
        const res = mockRes();
        await login(req, res);

        assert.equal(res._status, 401);
    });

    it('user INACTIVE — gửi OTP loại REGISTER, trả 403', async () => {
        mockUsers['inactive@test.com'] = {
            id: 'u-inactive',
            email: 'inactive@test.com',
            password_hash: 'hashed_Test@12345',
            status: 'INACTIVE',
        };

        const req = mockReq({ body: { email: 'inactive@test.com', password: 'Test@12345' } });
        const res = mockRes();
        await login(req, res);

        assert.equal(res._status, 403);
        assert.equal(res._json.needVerification, true);
        assert.equal(res._json.verificationType, 'REGISTER');
    });

    it('user BANNED — trả 403 bị khóa', async () => {
        mockUsers['banned@test.com'] = {
            id: 'u-banned',
            email: 'banned@test.com',
            password_hash: 'hashed_Test@12345',
            status: 'BANNED',
        };

        const req = mockReq({ body: { email: 'banned@test.com', password: 'Test@12345' } });
        const res = mockRes();
        await login(req, res);

        assert.equal(res._status, 403);
        assert.ok(res._json.message.includes('khóa'));
    });

    it('user SUSPENDED — trả 403', async () => {
        mockUsers['suspended@test.com'] = {
            id: 'u-sus',
            email: 'suspended@test.com',
            password_hash: 'hashed_Test@12345',
            status: 'SUSPENDED',
        };

        const req = mockReq({ body: { email: 'suspended@test.com', password: 'Test@12345' } });
        const res = mockRes();
        await login(req, res);

        assert.equal(res._status, 403);
    });

    it('validation thất bại (thiếu email) — trả 400', async () => {
        const req = mockReq({ body: { password: '123' } });
        const res = mockRes();
        await login(req, res);

        assert.equal(res._status, 400);
        assert.equal(res._json.success, false);
    });
});

// ═══════════════════════════════════════════════════════════
// 3. verifyEmail (xác thực OTP đăng ký)
// ═══════════════════════════════════════════════════════════

describe('verifyEmail', () => {
    beforeEach(() => {
        resetMocks();
        // User INACTIVE chờ xác thực
        mockUsers['pending@test.com'] = {
            id: 'u-pending',
            email: 'pending@test.com',
            fullName: 'Pending User',
            status: 'INACTIVE',
        };
        // OTP hợp lệ
        mockVerifCodes['pending@test.com'] = {
            id: 'vc-1',
            email: 'pending@test.com',
            code: '123456',
            type: 'REGISTER',
            used: false,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 phút nữa
            createdAt: new Date(),
        };
    });

    it('OTP đúng — xác thực thành công, user thành ACTIVE', async () => {
        const req = mockReq({ body: { email: 'pending@test.com', code: '123456' } });
        const res = mockRes();
        await verifyEmail(req, res);

        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(mockUsers['pending@test.com'].status, 'ACTIVE');
    });

    it('OTP sai — trả 400', async () => {
        const req = mockReq({ body: { email: 'pending@test.com', code: '999999' } });
        const res = mockRes();
        await verifyEmail(req, res);

        assert.equal(res._status, 400);
        assert.ok(res._json.message.includes('không đúng'));
    });

    it('thiếu email — trả 400', async () => {
        const req = mockReq({ body: { code: '123456' } });
        const res = mockRes();
        await verifyEmail(req, res);

        assert.equal(res._status, 400);
    });

    it('thiếu code — trả 400', async () => {
        const req = mockReq({ body: { email: 'pending@test.com' } });
        const res = mockRes();
        await verifyEmail(req, res);

        assert.equal(res._status, 400);
    });

    it('OTP đã hết hạn — trả 400', async () => {
        // Set hết hạn
        mockVerifCodes['pending@test.com'].expiresAt = new Date(Date.now() - 1000);
        const req = mockReq({ body: { email: 'pending@test.com', code: '123456' } });
        const res = mockRes();
        await verifyEmail(req, res);

        assert.equal(res._status, 400);
    });

    it('OTP đã used — trả 400', async () => {
        mockVerifCodes['pending@test.com'].used = true;
        const req = mockReq({ body: { email: 'pending@test.com', code: '123456' } });
        const res = mockRes();
        await verifyEmail(req, res);

        assert.equal(res._status, 400);
    });
});

// ═══════════════════════════════════════════════════════════
// 4. verifyLogin (xác thực OTP đăng nhập)
// ═══════════════════════════════════════════════════════════

describe('verifyLogin', () => {
    beforeEach(() => {
        resetMocks();
        mockUsers['active@test.com'] = {
            id: 'u-active',
            email: 'active@test.com',
            fullName: 'Active User',
            phone: '0912345678',
            role: 'TENANT',
            status: 'ACTIVE',
            avatarUrl: null,
            createdAt: new Date(),
        };
        mockVerifCodes['active@test.com'] = {
            id: 'vc-login',
            email: 'active@test.com',
            code: '654321',
            type: 'LOGIN',
            used: false,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            createdAt: new Date(),
        };
    });

    it('OTP đúng — trả JWT token + user info', async () => {
        const req = mockReq({ body: { email: 'active@test.com', code: '654321' } });
        const res = mockRes();
        await verifyLogin(req, res);

        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.token, 'Phải trả về token');
        assert.equal(res._json.user.email, 'active@test.com');
        assert.equal(res._json.user.role, 'TENANT');
    });

    it('OTP sai — trả 400', async () => {
        const req = mockReq({ body: { email: 'active@test.com', code: '000000' } });
        const res = mockRes();
        await verifyLogin(req, res);

        assert.equal(res._status, 400);
    });

    it('user bị khóa — trả 401', async () => {
        mockUsers['active@test.com'].status = 'BANNED';
        // OTP vẫn đúng nhưng user bị khóa
        const req = mockReq({ body: { email: 'active@test.com', code: '654321' } });
        const res = mockRes();
        await verifyLogin(req, res);

        assert.equal(res._status, 401);
    });

    it('thiếu email và code — trả 400', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await verifyLogin(req, res);

        assert.equal(res._status, 400);
    });
});

// ═══════════════════════════════════════════════════════════
// 5. resendCode
// ═══════════════════════════════════════════════════════════

describe('resendCode', () => {
    beforeEach(() => {
        resetMocks();
        mockUsers['user@test.com'] = {
            id: 'u1',
            email: 'user@test.com',
            status: 'ACTIVE',
        };
    });

    it('gửi lại thành công — trả success', async () => {
        const req = mockReq({ body: { email: 'user@test.com', type: 'LOGIN' } });
        const res = mockRes();
        await resendCode(req, res);

        assert.equal(res._json.success, true);
        assert.ok(mockVerifCodes['user@test.com']);
    });

    it('thiếu email — trả 400', async () => {
        const req = mockReq({ body: { type: 'LOGIN' } });
        const res = mockRes();
        await resendCode(req, res);

        assert.equal(res._status, 400);
    });

    it('type không hợp lệ — trả 400', async () => {
        const req = mockReq({ body: { email: 'user@test.com', type: 'INVALID' } });
        const res = mockRes();
        await resendCode(req, res);

        assert.equal(res._status, 400);
    });

    it('email không tồn tại — vẫn trả success (bảo mật)', async () => {
        const req = mockReq({ body: { email: 'unknown@test.com', type: 'LOGIN' } });
        const res = mockRes();
        await resendCode(req, res);

        assert.equal(res._json.success, true);
    });

    it('rate limit (gửi lại trong 60s) — trả 429', async () => {
        // Tạo code gần đây
        mockVerifCodes['user@test.com'] = {
            id: 'vc-recent',
            email: 'user@test.com',
            type: 'LOGIN',
            createdAt: new Date(), // Vừa tạo
        };

        const req = mockReq({ body: { email: 'user@test.com', type: 'LOGIN' } });
        const res = mockRes();
        await resendCode(req, res);

        assert.equal(res._status, 429);
        assert.ok(res._json.message.includes('60'));
    });
});

// ═══════════════════════════════════════════════════════════
// 6. forgotPassword
// ═══════════════════════════════════════════════════════════

describe('forgotPassword', () => {
    beforeEach(resetMocks);

    it('email tồn tại — trả success (gửi email reset)', async () => {
        mockUsers['user@test.com'] = { id: 'u1', email: 'user@test.com', status: 'ACTIVE' };
        const req = mockReq({ body: { email: 'user@test.com' } });
        const res = mockRes();
        await forgotPassword(req, res);

        assert.equal(res._json.success, true);
    });

    it('email không tồn tại — vẫn trả success (bảo mật)', async () => {
        const req = mockReq({ body: { email: 'unknown@test.com' } });
        const res = mockRes();
        await forgotPassword(req, res);

        assert.equal(res._json.success, true);
    });

    it('email rỗng — trả 400', async () => {
        const req = mockReq({ body: { email: '' } });
        const res = mockRes();
        await forgotPassword(req, res);

        assert.equal(res._status, 400);
    });
});

// ═══════════════════════════════════════════════════════════
// 7. resetPassword
// ═══════════════════════════════════════════════════════════

describe('resetPassword', () => {
    beforeEach(() => {
        resetMocks();
        mockUsers['user@test.com'] = {
            id: 'u1',
            email: 'user@test.com',
            status: 'ACTIVE',
            password_hash: 'hashed_OldPass1!',
        };
    });

    it('token + password hợp lệ — đổi mật khẩu thành công', async () => {
        mockJwtVerifyResult = { userId: 'u1', purpose: 'password_reset' };

        const req = mockReq({
            body: {
                token: 'valid-reset-token',
                newPassword: 'NewPass1!',
                confirmPassword: 'NewPass1!',
            },
        });
        const res = mockRes();
        await resetPassword(req, res);

        assert.equal(res._json.success, true);
        assert.ok(res._json.message.includes('thành công'));
    });

    it('token hết hạn — trả 400', async () => {
        const err = new Error('expired');
        err.name = 'TokenExpiredError';
        mockJwtVerifyError = err;

        const req = mockReq({
            body: {
                token: 'expired-token',
                newPassword: 'NewPass1!',
                confirmPassword: 'NewPass1!',
            },
        });
        const res = mockRes();
        await resetPassword(req, res);

        assert.equal(res._status, 400);
        assert.ok(res._json.message.includes('hết hạn') || res._json.message.includes('không hợp lệ'));
    });

    it('token sai purpose — trả 400', async () => {
        mockJwtVerifyResult = { userId: 'u1', purpose: 'other' };

        const req = mockReq({
            body: {
                token: 'wrong-purpose-token',
                newPassword: 'NewPass1!',
                confirmPassword: 'NewPass1!',
            },
        });
        const res = mockRes();
        await resetPassword(req, res);

        assert.equal(res._status, 400);
    });

    it('user bị khóa — trả 400', async () => {
        mockJwtVerifyResult = { userId: 'u1', purpose: 'password_reset' };
        mockUsers['user@test.com'].status = 'BANNED';

        const req = mockReq({
            body: {
                token: 'valid-token',
                newPassword: 'NewPass1!',
                confirmPassword: 'NewPass1!',
            },
        });
        const res = mockRes();
        await resetPassword(req, res);

        assert.equal(res._status, 400);
    });

    it('mật khẩu yếu — trả 400 validation error', async () => {
        const req = mockReq({
            body: { token: 'tok', newPassword: '123', confirmPassword: '123' },
        });
        const res = mockRes();
        await resetPassword(req, res);

        assert.equal(res._status, 400);
        assert.ok(res._json.errors);
    });
});

// ═══════════════════════════════════════════════════════════
// 8. registerOAuth
// ═══════════════════════════════════════════════════════════

describe('registerOAuth', () => {
    beforeEach(resetMocks);

    it('đăng ký OAuth thành công — trả 201', async () => {
        const req = mockReq({
            body: { email: 'google@gmail.com', fullName: 'Google User', role: 'TENANT' },
        });
        const res = mockRes();
        await registerOAuth(req, res);

        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
        assert.equal(res._json.user.email, 'google@gmail.com');
        assert.equal(res._json.user.status, 'ACTIVE'); // OAuth user ACTIVE ngay
    });

    it('email đã tồn tại — trả 409', async () => {
        mockUsers['exist@gmail.com'] = { id: 'u', email: 'exist@gmail.com' };
        const req = mockReq({
            body: { email: 'exist@gmail.com', fullName: 'User', role: 'TENANT' },
        });
        const res = mockRes();
        await registerOAuth(req, res);

        assert.equal(res._status, 409);
    });

    it('thiếu role — trả 400', async () => {
        const req = mockReq({
            body: { email: 'new@gmail.com', fullName: 'User' },
        });
        const res = mockRes();
        await registerOAuth(req, res);

        assert.equal(res._status, 400);
    });
});

// ═══════════════════════════════════════════════════════════
// 9. suggestPassword
// ═══════════════════════════════════════════════════════════

describe('suggestPassword', () => {
    it('trả về password ngẫu nhiên 12 ký tự', () => {
        const req = mockReq();
        const res = mockRes();
        suggestPassword(req, res);

        assert.equal(res._json.success, true);
        const pwd = res._json.suggestedPassword;
        assert.equal(pwd.length, 12);
    });

    it('password có uppercase, lowercase, number, special', () => {
        const req = mockReq();
        const res = mockRes();
        suggestPassword(req, res);

        const pwd = res._json.suggestedPassword;
        assert.ok(/[A-Z]/.test(pwd), 'Phải có chữ in hoa');
        assert.ok(/[a-z]/.test(pwd), 'Phải có chữ thường');
        assert.ok(/[0-9]/.test(pwd), 'Phải có số');
        assert.ok(/[!@#$%&*]/.test(pwd), 'Phải có ký tự đặc biệt');
    });

    it('gọi nhiều lần — cho kết quả khác nhau (ngẫu nhiên)', () => {
        const results = new Set();
        for (let i = 0; i < 5; i++) {
            const req = mockReq();
            const res = mockRes();
            suggestPassword(req, res);
            results.add(res._json.suggestedPassword);
        }
        // Với 5 lần gọi, ít nhất 2 kết quả khác nhau
        assert.ok(results.size >= 2, 'Password phải ngẫu nhiên');
    });
});

// ═══════════════════════════════════════════════════════════
// 10. updateProfile
// ═══════════════════════════════════════════════════════════

describe('updateProfile', () => {
    beforeEach(() => {
        resetMocks();
        mockUsers['me@test.com'] = {
            id: 'u-me',
            email: 'me@test.com',
            fullName: 'Old Name',
            phone: null,
            avatarUrl: null,
            role: 'TENANT',
            createdAt: new Date(),
        };
    });

    it('cập nhật fullName — thành công', async () => {
        const req = mockReq({
            auth: { user: { id: 'u-me' } },
            body: { fullName: 'New Name' },
        });
        const res = mockRes();
        await updateProfile(req, res);

        assert.equal(res._json.success, true);
        assert.equal(res._json.user.fullName, 'New Name');
    });

    it('không gửi gì — trả về user hiện tại', async () => {
        const req = mockReq({
            auth: { user: { id: 'u-me' } },
            body: {},
        });
        const res = mockRes();
        await updateProfile(req, res);

        assert.equal(res._json.success, true);
        assert.equal(res._json.user.fullName, 'Old Name');
    });

    it('cập nhật phone = null — xóa phone', async () => {
        const req = mockReq({
            auth: { user: { id: 'u-me' } },
            body: { phone: null },
        });
        const res = mockRes();
        await updateProfile(req, res);

        assert.equal(res._json.success, true);
    });
});

// ═══════════════════════════════════════════════════════════
// 11. getLifestyle / upsertLifestyle
// ═══════════════════════════════════════════════════════════

describe('getLifestyle', () => {
    beforeEach(resetMocks);

    it('chưa có profile — trả null', async () => {
        const req = mockReq({ auth: { user: { id: 'u1' } } });
        const res = mockRes();
        await getLifestyle(req, res);

        assert.equal(res._json.success, true);
        assert.equal(res._json.profile, null);
    });

    it('có profile — trả đầy đủ', async () => {
        mockLifestyles['u1'] = {
            id: 'lp1',
            smoking: true,
            drinking: false,
            pets_allowed: true,
            sleep_schedule: '22:00-06:00',
            personalityType: 'Hướng nội',
        };
        const req = mockReq({ auth: { user: { id: 'u1' } } });
        const res = mockRes();
        await getLifestyle(req, res);

        assert.equal(res._json.profile.smoking, true);
        assert.equal(res._json.profile.personalityType, 'Hướng nội');
    });
});

describe('upsertLifestyle', () => {
    beforeEach(resetMocks);

    it('tạo mới lifestyle — thành công', async () => {
        const req = mockReq({
            auth: { user: { id: 'u1' } },
            body: { smoking: true, drinking: false, pets_allowed: false },
        });
        const res = mockRes();
        await upsertLifestyle(req, res);

        assert.equal(res._json.success, true);
        assert.equal(res._json.profile.smoking, true);
    });
});

// ═══════════════════════════════════════════════════════════
// 12. getPreference / upsertPreference
// ═══════════════════════════════════════════════════════════

describe('getPreference', () => {
    beforeEach(resetMocks);

    it('chưa có preference — trả null', async () => {
        const req = mockReq({ auth: { user: { id: 'u1' } } });
        const res = mockRes();
        await getPreference(req, res);

        assert.equal(res._json.success, true);
        assert.equal(res._json.preference, null);
    });

    it('có preference — trả đầy đủ', async () => {
        mockPrefs['u1'] = {
            id: 'pref1',
            budget_min: 2000000,
            budget_max: 5000000,
            preferredLocation: 'Quận 1',
            preferred_gender: 'NAM',
        };
        const req = mockReq({ auth: { user: { id: 'u1' } } });
        const res = mockRes();
        await getPreference(req, res);

        assert.equal(res._json.preference.budget_min, 2000000);
        assert.equal(res._json.preference.preferredLocation, 'Quận 1');
    });
});

describe('upsertPreference', () => {
    beforeEach(resetMocks);

    it('tạo mới preference — thành công', async () => {
        const req = mockReq({
            auth: { user: { id: 'u1' } },
            body: { budget_min: 1000000, budget_max: 3000000, preferredLocation: 'Quận 7' },
        });
        const res = mockRes();
        await upsertPreference(req, res);

        assert.equal(res._json.success, true);
        assert.equal(res._json.preference.budget_min, 1000000);
    });
});
