/**
 * Unit tests for auth.controller.js
 *
 * SECURITY NOTE: All secrets, tokens, and hashes in this file are obviously
 * fake placeholders (e.g. "mock-token", "hashed"). No real credentials are used.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

/* ── mock modules ── */
const mockPrisma = createMockPrisma();

const mockBcrypt = {
    genSalt: async () => 'fake-salt',
    hash: async () => 'hashed',
    compare: async () => true,
};

const mockJwt = {
    sign: () => 'mock-token',
    decode: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    verify: (token) => {
        if (token === 'valid-reset') return { userId: 'user-1', purpose: 'password_reset' };
        if (token === 'wrong-purpose') return { userId: 'user-1', purpose: 'email_verify' };
        throw new Error('invalid token');
    },
};

const mockValidators = {
    validateRegister: () => ({ valid: true, errors: [] }),
    validateRegisterOAuth: () => ({ valid: true, errors: [] }),
    validateLogin: () => ({ valid: true, errors: [] }),
    validateForgotPassword: () => ({ valid: true, errors: [] }),
    validateResetPassword: () => ({ valid: true, errors: [] }),
};

const mockNodemailer = {
    createTransport: () => ({
        sendMail: async () => ({ messageId: 'test' }),
    }),
};

function loadController() {
    clearModule('../controllers/auth.controller');
    clearModule('../services/auth.service');
    injectMock('../config/prisma', mockPrisma);
    injectMock('bcryptjs', mockBcrypt);
    injectMock('jsonwebtoken', mockJwt);
    injectMock('../validators/auth.validator', mockValidators);
    injectMock('nodemailer', mockNodemailer);
    return require('../controllers/auth.controller');
}

/* ── helper data ── */
const fakeUser = {
    id: 'user-1',
    fullName: 'Test User',
    email: 'test@example.com',
    phone: '0900000000',
    role: 'TENANT',
    status: 'ACTIVE',
    avatarUrl: null,
    password_hash: 'hashed',
    gender: 'Nam',
    isVip: false,
    createdAt: new Date(),
};

/* ================================================================
   register
   ================================================================ */
describe('Auth > register', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => null;
        mockPrisma.user.create = async () => fakeUser;
        mockPrisma.notification.create = async () => ({});
        mockValidators.validateRegister = () => ({ valid: true, errors: [] });
    });

    it('should register successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({
            body: { fullName: 'New User', email: 'new@example.com', password: 'Abc12345!', confirmPassword: 'Abc12345!', role: 'TENANT' },
        });
        const res = mockRes();
        await ctrl.register(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
        assert.ok(res._json.user);
    });

    it('should return 400 on validation failure', async () => {
        mockValidators.validateRegister = () => ({ valid: false, errors: ['bad'] });
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.register(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 409 when email already exists', async () => {
        mockPrisma.user.findUnique = async () => fakeUser;
        const ctrl = loadController();
        const req = mockReq({
            body: { fullName: 'Dup', email: 'test@example.com', password: 'Abc12345!', confirmPassword: 'Abc12345!', role: 'TENANT' },
        });
        const res = mockRes();
        await ctrl.register(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => null;
        mockPrisma.user.create = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({
            body: { fullName: 'X', email: 'x@example.com', password: 'Abc12345!', confirmPassword: 'Abc12345!', role: 'TENANT' },
        });
        const res = mockRes();
        await ctrl.register(req, res);
        assert.equal(res._status, 500);
    });

    it('should set role to LANDLORD when requested', async () => {
        let captured = null;
        mockPrisma.user.create = async (args) => { captured = args; return { ...fakeUser, role: 'LANDLORD' }; };
        const ctrl = loadController();
        const req = mockReq({
            body: { fullName: 'LL', email: 'll@example.com', password: 'Abc12345!', confirmPassword: 'Abc12345!', role: 'LANDLORD' },
        });
        const res = mockRes();
        await ctrl.register(req, res);
        assert.equal(res._status, 201);
        assert.equal(captured.data.role, 'LANDLORD');
    });
});

/* ================================================================
   login
   ================================================================ */
describe('Auth > login', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => fakeUser;
        mockBcrypt.compare = async () => true;
        mockValidators.validateLogin = () => ({ valid: true, errors: [] });
    });

    it('should login successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com', password: 'Abc12345!' } });
        const res = mockRes();
        await ctrl.login(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.token, 'mock-token');
    });

    it('should return 401 for wrong email', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'wrong@example.com', password: 'pass' } });
        const res = mockRes();
        await ctrl.login(req, res);
        assert.equal(res._status, 401);
    });

    it('should return 401 for wrong password', async () => {
        mockBcrypt.compare = async () => false;
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com', password: 'wrong' } });
        const res = mockRes();
        await ctrl.login(req, res);
        assert.equal(res._status, 401);
    });

    it('should return 403 for inactive user', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser, status: 'BANNED' });
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com', password: 'Abc12345!' } });
        const res = mockRes();
        await ctrl.login(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 400 on validation failure', async () => {
        mockValidators.validateLogin = () => ({ valid: false, errors: ['missing'] });
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.login(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com', password: 'pass' } });
        const res = mockRes();
        await ctrl.login(req, res);
        assert.equal(res._status, 500);
    });

    it('should include isVip and gender in response', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser, isVip: true, gender: 'Nữ' });
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com', password: 'Abc12345!' } });
        const res = mockRes();
        await ctrl.login(req, res);
        assert.equal(res._json.user.isVip, true);
        assert.equal(res._json.user.gender, 'Nữ');
    });
});

/* ================================================================
   forgotPassword
   ================================================================ */
describe('Auth > forgotPassword', () => {
    beforeEach(() => {
        mockValidators.validateForgotPassword = () => ({ valid: true, errors: [] });
        mockPrisma.user.findUnique = async () => fakeUser;
    });

    it('should return success when user exists', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com' } });
        const res = mockRes();
        await ctrl.forgotPassword(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return same success when user does not exist (security)', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'nope@example.com' } });
        const res = mockRes();
        await ctrl.forgotPassword(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return 400 on validation failure', async () => {
        mockValidators.validateForgotPassword = () => ({ valid: false, errors: ['missing email'] });
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.forgotPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com' } });
        const res = mockRes();
        await ctrl.forgotPassword(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   resetPassword
   ================================================================ */
describe('Auth > resetPassword', () => {
    beforeEach(() => {
        mockValidators.validateResetPassword = () => ({ valid: true, errors: [] });
        mockPrisma.user.findUnique = async () => fakeUser;
        mockPrisma.user.update = async () => fakeUser;
    });

    it('should reset password with valid token', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { token: 'valid-reset', newPassword: 'NewPass1!', confirmPassword: 'NewPass1!' } });
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should reject invalid token', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { token: 'bad-token', newPassword: 'NewPass1!', confirmPassword: 'NewPass1!' } });
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject token with wrong purpose', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { token: 'wrong-purpose', newPassword: 'NewPass1!', confirmPassword: 'NewPass1!' } });
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject when user is inactive', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser, status: 'BANNED' });
        const ctrl = loadController();
        const req = mockReq({ body: { token: 'valid-reset', newPassword: 'NewPass1!', confirmPassword: 'NewPass1!' } });
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 400 on validation failure', async () => {
        mockValidators.validateResetPassword = () => ({ valid: false, errors: ['missing'] });
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { token: 'valid-reset', newPassword: 'NewPass1!', confirmPassword: 'NewPass1!' } });
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        assert.equal(res._status, 500);
    });

    it('should return 400 when user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ body: { token: 'valid-reset', newPassword: 'NewPass1!', confirmPassword: 'NewPass1!' } });
        const res = mockRes();
        await ctrl.resetPassword(req, res);
        assert.equal(res._status, 400);
    });
});

/* ================================================================
   registerOAuth
   ================================================================ */
describe('Auth > registerOAuth', () => {
    beforeEach(() => {
        mockValidators.validateRegisterOAuth = () => ({ valid: true, errors: [] });
        mockPrisma.user.findUnique = async () => null;
        mockPrisma.user.create = async () => fakeUser;
    });

    it('should register OAuth user successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'oauth@example.com', fullName: 'OAuth User', role: 'TENANT' } });
        const res = mockRes();
        await ctrl.registerOAuth(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
    });

    it('should return 409 when email already exists', async () => {
        mockPrisma.user.findUnique = async () => fakeUser;
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'test@example.com', fullName: 'Dup', role: 'TENANT' } });
        const res = mockRes();
        await ctrl.registerOAuth(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 400 on validation failure', async () => {
        mockValidators.validateRegisterOAuth = () => ({ valid: false, errors: ['missing'] });
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.registerOAuth(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.create = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'new@example.com', fullName: 'Err', role: 'TENANT' } });
        const res = mockRes();
        await ctrl.registerOAuth(req, res);
        assert.equal(res._status, 500);
    });

    it('should set role to LANDLORD when requested', async () => {
        let captured = null;
        mockPrisma.user.create = async (args) => { captured = args; return { ...fakeUser, role: 'LANDLORD' }; };
        const ctrl = loadController();
        const req = mockReq({ body: { email: 'x@example.com', fullName: 'X', role: 'LANDLORD' } });
        const res = mockRes();
        await ctrl.registerOAuth(req, res);
        assert.equal(captured.data.role, 'LANDLORD');
    });
});

/* ================================================================
   updateProfile
   ================================================================ */
describe('Auth > updateProfile', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => fakeUser;
        mockPrisma.user.update = async (args) => ({ ...fakeUser, ...args.data });
    });

    it('should update profile fields', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { fullName: 'Updated', gender: 'Nữ' } });
        const res = mockRes();
        await ctrl.updateProfile(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.user.fullName, 'Updated');
    });

    it('should return current user when body is empty', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.updateProfile(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.user.email, 'test@example.com');
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.update = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { fullName: 'Fail' } });
        const res = mockRes();
        await ctrl.updateProfile(req, res);
        assert.equal(res._status, 500);
    });

    it('should trim and limit fullName to 100 chars', async () => {
        let captured = null;
        mockPrisma.user.update = async (args) => { captured = args; return { ...fakeUser, ...args.data }; };
        const ctrl = loadController();
        const longName = 'A'.repeat(200);
        const req = mockReq({ body: { fullName: longName } });
        const res = mockRes();
        await ctrl.updateProfile(req, res);
        assert.equal(captured.data.fullName.length, 100);
    });

    it('should set phone to null for empty string', async () => {
        let captured = null;
        mockPrisma.user.update = async (args) => { captured = args; return { ...fakeUser, ...args.data }; };
        const ctrl = loadController();
        const req = mockReq({ body: { phone: '' } });
        const res = mockRes();
        await ctrl.updateProfile(req, res);
        assert.equal(captured.data.phone, null);
    });
});

/* ================================================================
   getLifestyle / upsertLifestyle
   ================================================================ */
describe('Auth > lifestyle', () => {
    const fakeProfile = {
        id: 'lp-1', userId: 'user-1', smoking: false, drinking: false, pets_allowed: true,
        sleep_schedule: 'early', personalityType: 'introvert', cleanliness: 'high',
        noise_tolerance: 'low', guest_frequency: 'rare', cooking_frequency: 'daily',
        work_from_home: true, wake_time: '06:00', bedtime: '22:00', social_level: 'low',
        occupation_type: 'student', interests: ['reading'], languages: ['vi'],
        preferred_lease_months: 6, move_in_date: new Date('2026-04-01'),
        temperature_preference: 'cool', quiet_hours_preference: '22:00-06:00',
    };

    beforeEach(() => {
        mockPrisma.lifestyleProfile.findUnique = async () => fakeProfile;
        mockPrisma.lifestyleProfile.upsert = async () => fakeProfile;
    });

    it('getLifestyle — should return profile', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getLifestyle(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.profile.smoking, false);
    });

    it('getLifestyle — should return null profile', async () => {
        mockPrisma.lifestyleProfile.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getLifestyle(req, res);
        assert.equal(res._json.profile, null);
    });

    it('getLifestyle — should return 401 when not logged in', async () => {
        const ctrl = loadController();
        const req = mockReq({ auth: { user: {} } });
        const res = mockRes();
        await ctrl.getLifestyle(req, res);
        assert.equal(res._status, 401);
    });

    it('upsertLifestyle — should create/update lifestyle', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { smoking: true, drinking: false, interests: ['gaming'] } });
        const res = mockRes();
        await ctrl.upsertLifestyle(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.profile);
    });

    it('upsertLifestyle — should return 500 on DB error', async () => {
        mockPrisma.lifestyleProfile.upsert = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { smoking: true } });
        const res = mockRes();
        await ctrl.upsertLifestyle(req, res);
        assert.equal(res._status, 500);
    });

    it('upsertLifestyle — should handle arrays and nulls', async () => {
        let captured = null;
        mockPrisma.lifestyleProfile.upsert = async (args) => { captured = args; return fakeProfile; };
        const ctrl = loadController();
        const req = mockReq({
            body: { interests: ['music', 123, 'art'], languages: [], preferred_lease_months: '', move_in_date: null },
        });
        const res = mockRes();
        await ctrl.upsertLifestyle(req, res);
        assert.deepEqual(captured.create.interests, ['music', 'art']);
        assert.deepEqual(captured.create.languages, []);
        assert.equal(captured.create.preferred_lease_months, null);
        assert.equal(captured.create.move_in_date, null);
    });
});

/* ================================================================
   getPreference / upsertPreference
   ================================================================ */
describe('Auth > preference', () => {
    const fakePrefs = {
        id: 'up-1', userId: 'user-1', budget_min: 2000000, budget_max: 5000000,
        preferredLocation: 'HCM', preferred_districts: ['Q1', 'Q3'], room_type: 'single',
        preferred_amenities: ['wifi'], must_have_amenities: [], preferred_lease_months: 6,
        move_in_date_min: null, move_in_date_max: null, max_distance_km: 10,
        transport_nearby: true, pet_friendly: null, preferred_roommate_age_min: 20,
        preferred_roommate_age_max: 30, lifestyle_match_weight: 0.7, safety_priority: 5,
    };

    beforeEach(() => {
        mockPrisma.userPreference.findUnique = async () => fakePrefs;
        mockPrisma.userPreference.upsert = async () => fakePrefs;
    });

    it('getPreference — should return preference', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getPreference(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.preference.budget_min, 2000000);
    });

    it('getPreference — should return null when not set', async () => {
        mockPrisma.userPreference.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getPreference(req, res);
        assert.equal(res._json.preference, null);
    });

    it('getPreference — should return 401 when not logged in', async () => {
        const ctrl = loadController();
        const req = mockReq({ auth: { user: {} } });
        const res = mockRes();
        await ctrl.getPreference(req, res);
        assert.equal(res._status, 401);
    });

    it('upsertPreference — should create/update preference', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { budget_min: 3000000, room_type: 'shared' } });
        const res = mockRes();
        await ctrl.upsertPreference(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('upsertPreference — should return 500 on DB error', async () => {
        mockPrisma.userPreference.upsert = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { budget_min: 1000000 } });
        const res = mockRes();
        await ctrl.upsertPreference(req, res);
        assert.equal(res._status, 500);
    });

    it('upsertPreference — should handle boolean fields', async () => {
        let captured = null;
        mockPrisma.userPreference.upsert = async (args) => { captured = args; return fakePrefs; };
        const ctrl = loadController();
        const req = mockReq({ body: { transport_nearby: true, pet_friendly: false } });
        const res = mockRes();
        await ctrl.upsertPreference(req, res);
        assert.equal(captured.create.transport_nearby, true);
        assert.equal(captured.create.pet_friendly, false);
    });

    it('upsertPreference — should filter non-string from arrays', async () => {
        let captured = null;
        mockPrisma.userPreference.upsert = async (args) => { captured = args; return fakePrefs; };
        const ctrl = loadController();
        const req = mockReq({ body: { preferred_districts: ['Q1', 42, 'Q7'], preferred_amenities: 'not-an-array' } });
        const res = mockRes();
        await ctrl.upsertPreference(req, res);
        assert.deepEqual(captured.create.preferred_districts, ['Q1', 'Q7']);
        assert.deepEqual(captured.create.preferred_amenities, []);
    });
});

/* ================================================================
   suggestPassword
   ================================================================ */
describe('Auth > suggestPassword', () => {
    it('should return a 12-character password', () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        ctrl.suggestPassword(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.suggestedPassword.length, 12);
    });

    it('should return different passwords on each call', () => {
        const ctrl = loadController();
        const passwords = new Set();
        for (let i = 0; i < 10; i++) {
            const res = mockRes();
            ctrl.suggestPassword(mockReq(), res);
            passwords.add(res._json.suggestedPassword);
        }
        assert.ok(passwords.size >= 2, 'Expected at least 2 distinct passwords');
    });
});
