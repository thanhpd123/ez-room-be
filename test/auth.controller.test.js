const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);

    /* Mock bcryptjs */
    injectMock('bcryptjs', {
        genSalt: async () => 'salt',
        hash: async (pw) => `hashed_${pw}`,
        compare: async (plain, hash) => hash === `hashed_${plain}`,
    });

    /* Mock jsonwebtoken */
    injectMock('jsonwebtoken', {
        sign: (payload) => `token_${payload.userId || payload.email || 'test'}`,
        verify: (tok) => {
            if (tok === 'valid-reset') return { userId: 'user-1', purpose: 'password_reset' };
            if (tok === 'invalid-purpose') return { userId: 'user-1', purpose: 'other' };
            throw new Error('invalid token');
        },
    });

    /* Mock validators */
    injectMock('../validators/auth.validator', {
        validateRegister: (body) => {
            if (!body.email || !body.password || !body.fullName) return { valid: false, errors: ['missing fields'] };
            if (body.password !== body.confirmPassword) return { valid: false, errors: ['password mismatch'] };
            return { valid: true, errors: [] };
        },
        validateRegisterOAuth: (body) => {
            if (!body.email || !body.fullName) return { valid: false, errors: ['missing'] };
            return { valid: true, errors: [] };
        },
        validateLogin: (body) => {
            if (!body.email || !body.password) return { valid: false, errors: ['missing'] };
            return { valid: true, errors: [] };
        },
        validateForgotPassword: (body) => {
            if (!body.email) return { valid: false, errors: ['missing email'] };
            return { valid: true, errors: [] };
        },
        validateResetPassword: (body) => {
            if (!body.token || !body.newPassword) return { valid: false, errors: ['missing'] };
            return { valid: true, errors: [] };
        },
    });

    /* Prevent actual email sending — mock nodemailer lazily */
    injectMock('nodemailer', {
        createTransport: () => ({
            sendMail: async () => ({ messageId: 'test' }),
        }),
    });

    clearModule('../controllers/auth.controller');
    controller = require('../controllers/auth.controller');
}

/* ════════════════════════════════════════════
   register
   ════════════════════════════════════════════ */
describe('auth.controller — register', () => {
    beforeEach(() => setup());

    it('should register a new user', async () => {
        mockPrisma.user.findUnique = async () => null;
        mockPrisma.user.create = async (args) => ({
            id: 'u-new', fullName: args.data.fullName, email: args.data.email,
            phone: null, role: args.data.role, status: 'ACTIVE', avatarUrl: null, createdAt: '2026-01-01',
        });
        mockPrisma.notification.create = async () => ({});
        const req = mockReq({ body: { fullName: 'Test', email: 'test@x.com', password: '123456', confirmPassword: '123456' } });
        const res = mockRes();
        await controller.register(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
    });

    it('should return 400 on validation error', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.register(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 409 on duplicate email', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'existing' });
        const req = mockReq({ body: { fullName: 'T', email: 'dup@x.com', password: '123456', confirmPassword: '123456' } });
        const res = mockRes();
        await controller.register(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => null;
        mockPrisma.user.create = async () => { throw new Error('DB'); };
        const req = mockReq({ body: { fullName: 'T', email: 'a@x.com', password: '123456', confirmPassword: '123456' } });
        const res = mockRes();
        await controller.register(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   login
   ════════════════════════════════════════════ */
describe('auth.controller — login', () => {
    beforeEach(() => setup());

    it('should login successfully', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', fullName: 'A', email: 'a@x.com', password_hash: 'hashed_pass123',
            phone: null, role: 'TENANT', status: 'ACTIVE', avatarUrl: null, createdAt: '2026-01-01', isVip: false, gender: null,
        });
        const req = mockReq({ body: { email: 'a@x.com', password: 'pass123' } });
        const res = mockRes();
        await controller.login(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.token);
    });

    it('should reject wrong email', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ body: { email: 'wrong@x.com', password: '123' } });
        const res = mockRes();
        await controller.login(req, res);
        assert.equal(res._status, 401);
    });

    it('should reject wrong password', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', email: 'a@x.com', password_hash: 'hashed_correct', status: 'ACTIVE',
        });
        const req = mockReq({ body: { email: 'a@x.com', password: 'wrong' } });
        const res = mockRes();
        await controller.login(req, res);
        assert.equal(res._status, 401);
    });

    it('should reject inactive account', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', email: 'a@x.com', password_hash: 'hashed_pass', status: 'BANNED',
        });
        const req = mockReq({ body: { email: 'a@x.com', password: 'pass' } });
        const res = mockRes();
        await controller.login(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 400 on missing fields', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.login(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ body: { email: 'a@x.com', password: 'p' } });
        const res = mockRes();
        await controller.login(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   forgotPassword
   ════════════════════════════════════════════ */
describe('auth.controller — forgotPassword', () => {
    beforeEach(() => setup());

    it('should always return success (user exists)', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-1', email: 'a@x.com' });
        const req = mockReq({ body: { email: 'a@x.com' } });
        const res = mockRes();
        await controller.forgotPassword(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return success even when user does not exist', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ body: { email: 'none@x.com' } });
        const res = mockRes();
        await controller.forgotPassword(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return 400 on missing email', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.forgotPassword(req, res);
        assert.equal(res._status, 400);
    });
});

/* ════════════════════════════════════════════
   resetPassword
   ════════════════════════════════════════════ */
describe('auth.controller — resetPassword', () => {
    beforeEach(() => setup());

    it('should reset password with valid token', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-1', status: 'ACTIVE' });
        mockPrisma.user.update = async () => ({});
        const req = mockReq({ body: { token: 'valid-reset', newPassword: 'new123', confirmPassword: 'new123' } });
        const res = mockRes();
        await controller.resetPassword(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should reject invalid token', async () => {
        const req = mockReq({ body: { token: 'bad-token', newPassword: 'new123' } });
        const res = mockRes();
        await controller.resetPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject token with wrong purpose', async () => {
        const req = mockReq({ body: { token: 'invalid-purpose', newPassword: 'new123' } });
        const res = mockRes();
        await controller.resetPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject if user not found/inactive', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-1', status: 'BANNED' });
        const req = mockReq({ body: { token: 'valid-reset', newPassword: 'new123' } });
        const res = mockRes();
        await controller.resetPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 400 on missing fields', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.resetPassword(req, res);
        assert.equal(res._status, 400);
    });
});

/* ════════════════════════════════════════════
   registerOAuth
   ════════════════════════════════════════════ */
describe('auth.controller — registerOAuth', () => {
    beforeEach(() => setup());

    it('should register OAuth user', async () => {
        mockPrisma.user.findUnique = async () => null;
        mockPrisma.user.create = async (args) => ({
            id: 'u-new', fullName: args.data.fullName, email: args.data.email,
            phone: null, role: 'TENANT', status: 'ACTIVE', avatarUrl: null, createdAt: '2026-01-01',
        });
        const req = mockReq({ body: { fullName: 'T', email: 'g@x.com', role: 'TENANT' } });
        const res = mockRes();
        await controller.registerOAuth(req, res);
        assert.equal(res._status, 201);
    });

    it('should reject duplicate email', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'existing' });
        const req = mockReq({ body: { fullName: 'T', email: 'dup@x.com', role: 'TENANT' } });
        const res = mockRes();
        await controller.registerOAuth(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 400 on missing fields', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.registerOAuth(req, res);
        assert.equal(res._status, 400);
    });
});

/* ════════════════════════════════════════════
   updateProfile
   ════════════════════════════════════════════ */
describe('auth.controller — updateProfile', () => {
    beforeEach(() => setup());

    it('should update profile fields', async () => {
        mockPrisma.user.update = async () => ({
            id: 'user-1', fullName: 'Updated', email: 'a@x.com', phone: '123',
            avatarUrl: null, gender: 'Nam', role: 'TENANT', createdAt: '2026-01-01',
        });
        const req = mockReq({ body: { fullName: 'Updated', gender: 'Nam' } });
        const res = mockRes();
        await controller.updateProfile(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.user.fullName, 'Updated');
    });

    it('should return current profile when body empty', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', fullName: 'A', email: 'a@x.com', phone: null,
            avatarUrl: null, gender: null, role: 'TENANT', createdAt: '2026-01-01',
        });
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.updateProfile(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.user.fullName, 'A');
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.update = async () => { throw new Error('DB'); };
        const req = mockReq({ body: { fullName: 'X' } });
        const res = mockRes();
        await controller.updateProfile(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getLifestyle / upsertLifestyle
   ════════════════════════════════════════════ */
describe('auth.controller — lifestyle', () => {
    beforeEach(() => setup());

    it('getLifestyle should return profile', async () => {
        mockPrisma.lifestyleProfile.findUnique = async () => ({
            id: 'lp1', smoking: false, drinking: false, pets_allowed: true,
            sleep_schedule: 'early', interests: ['coding'], languages: ['vi'],
        });
        const req = mockReq();
        const res = mockRes();
        await controller.getLifestyle(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.profile);
    });

    it('getLifestyle should return null profile when none', async () => {
        mockPrisma.lifestyleProfile.findUnique = async () => null;
        const req = mockReq();
        const res = mockRes();
        await controller.getLifestyle(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.profile, null);
    });

    it('getLifestyle should return 401 when not logged in', async () => {
        const req = mockReq();
        req.auth = {};
        const res = mockRes();
        await controller.getLifestyle(req, res);
        assert.equal(res._status, 401);
    });

    it('upsertLifestyle should create/update', async () => {
        mockPrisma.lifestyleProfile.upsert = async () => ({
            id: 'lp1', smoking: true, drinking: false, pets_allowed: false,
            interests: [], languages: [],
        });
        const req = mockReq({ body: { smoking: true } });
        const res = mockRes();
        await controller.upsertLifestyle(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.profile);
    });

    it('upsertLifestyle should return 500 on error', async () => {
        mockPrisma.lifestyleProfile.upsert = async () => { throw new Error('DB'); };
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.upsertLifestyle(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getPreference / upsertPreference
   ════════════════════════════════════════════ */
describe('auth.controller — preference', () => {
    beforeEach(() => setup());

    it('getPreference should return prefs', async () => {
        mockPrisma.userPreference.findUnique = async () => ({
            id: 'p1', budget_min: 2000000, budget_max: 5000000,
            preferred_districts: ['Q1'], room_type: 'single',
            preferred_amenities: [], must_have_amenities: [],
        });
        const req = mockReq();
        const res = mockRes();
        await controller.getPreference(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.preference);
    });

    it('getPreference should return 401 if not logged in', async () => {
        const req = mockReq();
        req.auth = {};
        const res = mockRes();
        await controller.getPreference(req, res);
        assert.equal(res._status, 401);
    });

    it('upsertPreference should create/update', async () => {
        mockPrisma.userPreference.upsert = async () => ({
            id: 'p1', budget_min: 1000000, budget_max: 3000000,
            preferred_districts: [], room_type: null,
            preferred_amenities: [], must_have_amenities: [],
        });
        const req = mockReq({ body: { budget_min: 1000000 } });
        const res = mockRes();
        await controller.upsertPreference(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.preference);
    });

    it('upsertPreference should return 500 on error', async () => {
        mockPrisma.userPreference.upsert = async () => { throw new Error('DB'); };
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.upsertPreference(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   suggestPassword
   ════════════════════════════════════════════ */
describe('auth.controller — suggestPassword', () => {
    beforeEach(() => setup());

    it('should return a 12-char password', () => {
        const req = mockReq();
        const res = mockRes();
        controller.suggestPassword(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.suggestedPassword.length, 12);
    });
});
