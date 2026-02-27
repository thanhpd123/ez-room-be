/**
 * validators.test.js — Unit test cho các validator
 *
 * Modules được test:
 * - validators/auth.validator.js   : validateRegister, validateLogin, validateForgotPassword, validateResetPassword, validateRegisterOAuth, validatePasswordStrength
 * - validators/rental.validator.js : validateCreateRental, validateUpdateRentalStatus
 *
 * Sử dụng: node --test test/validators.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    validateRegister,
    validateRegisterOAuth,
    validateLogin,
    validateForgotPassword,
    validateResetPassword,
    validatePasswordStrength,
} = require('../validators/auth.validator');

const {
    validateCreateRental,
    validateUpdateRentalStatus,
    VALID_RENTAL_STATUSES,
} = require('../validators/rental.validator');

// ═══════════════════════════════════════════════════════════
// 1. validatePasswordStrength
// ═══════════════════════════════════════════════════════════

describe('validatePasswordStrength', () => {
    it('mật khẩu hợp lệ — không có lỗi', () => {
        const errors = validatePasswordStrength('Abcdef1!');
        assert.equal(errors.length, 0);
    });

    it('mật khẩu rỗng — báo lỗi bắt buộc', () => {
        const errors = validatePasswordStrength('');
        assert.ok(errors.length > 0);
        assert.ok(errors.some((e) => e.includes('bắt buộc')));
    });

    it('mật khẩu null — báo lỗi bắt buộc', () => {
        const errors = validatePasswordStrength(null);
        assert.ok(errors.length > 0);
    });

    it('mật khẩu không phải string — báo lỗi bắt buộc', () => {
        const errors = validatePasswordStrength(12345678);
        assert.ok(errors.length > 0);
    });

    it('mật khẩu < 8 ký tự — báo lỗi độ dài', () => {
        const errors = validatePasswordStrength('Ab1!');
        assert.ok(errors.some((e) => e.includes('8 ký tự')));
    });

    it('mật khẩu không có chữ in hoa — báo lỗi', () => {
        const errors = validatePasswordStrength('abcdef1!');
        assert.ok(errors.some((e) => e.includes('in hoa')));
    });

    it('mật khẩu không có chữ số — báo lỗi', () => {
        const errors = validatePasswordStrength('Abcdefg!');
        assert.ok(errors.some((e) => e.includes('chữ số')));
    });

    it('mật khẩu không có ký tự đặc biệt — báo lỗi', () => {
        const errors = validatePasswordStrength('Abcdefg1');
        assert.ok(errors.some((e) => e.includes('đặc biệt')));
    });

    it('mật khẩu yếu nhiều lỗi cùng lúc — trả về đủ lỗi', () => {
        const errors = validatePasswordStrength('abc');
        // Thiếu: độ dài, in hoa, số, đặc biệt
        assert.ok(errors.length >= 3);
    });

    it('mật khẩu mạnh 12 ký tự — hợp lệ', () => {
        const errors = validatePasswordStrength('MyStr0ng!Pwd');
        assert.equal(errors.length, 0);
    });
});

// ═══════════════════════════════════════════════════════════
// 2. validateRegister
// ═══════════════════════════════════════════════════════════

describe('validateRegister', () => {
    // Dữ liệu mẫu hợp lệ
    const validBody = {
        fullName: 'Nguyen Van A',
        email: 'test@email.com',
        password: 'Test@12345',
        confirmPassword: 'Test@12345',
        phone: '0912345678',
        role: 'TENANT',
    };

    it('dữ liệu hợp lệ đầy đủ — pass', () => {
        const { valid, errors } = validateRegister(validBody);
        assert.equal(valid, true);
        assert.equal(errors.length, 0);
    });

    it('dữ liệu hợp lệ không có phone (optional) — pass', () => {
        const { valid } = validateRegister({ ...validBody, phone: undefined });
        assert.equal(valid, true);
    });

    it('dữ liệu hợp lệ không có role (mặc định TENANT) — pass', () => {
        const { valid } = validateRegister({ ...validBody, role: undefined });
        assert.equal(valid, true);
    });

    it('body rỗng — nhiều lỗi', () => {
        const { valid, errors } = validateRegister({});
        assert.equal(valid, false);
        assert.ok(errors.length >= 3); // fullName, email, password, confirmPassword
    });

    it('body null — nhiều lỗi', () => {
        const { valid, errors } = validateRegister(null);
        assert.equal(valid, false);
        assert.ok(errors.length > 0);
    });

    // --- fullName ---
    it('fullName quá ngắn (1 ký tự) — lỗi', () => {
        const { valid, errors } = validateRegister({ ...validBody, fullName: 'A' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('2 ký tự')));
    });

    it('fullName quá dài (>100 ký tự) — lỗi', () => {
        const { valid, errors } = validateRegister({ ...validBody, fullName: 'A'.repeat(101) });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('100')));
    });

    it('fullName rỗng — lỗi', () => {
        const { valid } = validateRegister({ ...validBody, fullName: '' });
        assert.equal(valid, false);
    });

    // --- email ---
    it('email sai định dạng — lỗi', () => {
        const { valid, errors } = validateRegister({ ...validBody, email: 'not-an-email' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Email')));
    });

    it('email rỗng — lỗi', () => {
        const { valid } = validateRegister({ ...validBody, email: '' });
        assert.equal(valid, false);
    });

    // --- phone ---
    it('phone quá ngắn (9 số) — lỗi', () => {
        const { valid, errors } = validateRegister({ ...validBody, phone: '012345678' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('điện thoại')));
    });

    it('phone có chữ — lỗi', () => {
        const { valid } = validateRegister({ ...validBody, phone: '091234abcd' });
        assert.equal(valid, false);
    });

    it('phone hợp lệ 10 số — pass', () => {
        const { valid } = validateRegister({ ...validBody, phone: '0912345678' });
        assert.equal(valid, true);
    });

    // --- password + confirmPassword ---
    it('confirmPassword không khớp — lỗi', () => {
        const { valid, errors } = validateRegister({ ...validBody, confirmPassword: 'Different1!' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('không khớp')));
    });

    it('mật khẩu yếu — lỗi', () => {
        const { valid } = validateRegister({ ...validBody, password: 'weak', confirmPassword: 'weak' });
        assert.equal(valid, false);
    });

    // --- role ---
    it('role không hợp lệ — lỗi', () => {
        const { valid, errors } = validateRegister({ ...validBody, role: 'SUPERADMIN' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Vai trò')));
    });

    it('role = LANDLORD hợp lệ — pass', () => {
        const { valid } = validateRegister({ ...validBody, role: 'LANDLORD' });
        assert.equal(valid, true);
    });
});

// ═══════════════════════════════════════════════════════════
// 3. validateRegisterOAuth
// ═══════════════════════════════════════════════════════════

describe('validateRegisterOAuth', () => {
    const validBody = {
        email: 'user@gmail.com',
        fullName: 'Google User',
        role: 'TENANT',
    };

    it('dữ liệu hợp lệ — pass', () => {
        const { valid } = validateRegisterOAuth(validBody);
        assert.equal(valid, true);
    });

    it('thiếu email — lỗi', () => {
        const { valid } = validateRegisterOAuth({ ...validBody, email: '' });
        assert.equal(valid, false);
    });

    it('thiếu role — lỗi', () => {
        const { valid, errors } = validateRegisterOAuth({ ...validBody, role: undefined });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Vai trò')));
    });

    it('fullName quá ngắn — lỗi', () => {
        const { valid } = validateRegisterOAuth({ ...validBody, fullName: 'A' });
        assert.equal(valid, false);
    });

    it('phone hợp lệ (optional) — pass', () => {
        const { valid } = validateRegisterOAuth({ ...validBody, phone: '0912345678' });
        assert.equal(valid, true);
    });

    it('phone sai — lỗi', () => {
        const { valid } = validateRegisterOAuth({ ...validBody, phone: 'abc' });
        assert.equal(valid, false);
    });

    it('body null — lỗi', () => {
        const { valid } = validateRegisterOAuth(null);
        assert.equal(valid, false);
    });
});

// ═══════════════════════════════════════════════════════════
// 4. validateLogin
// ═══════════════════════════════════════════════════════════

describe('validateLogin', () => {
    it('email + password đầy đủ — pass', () => {
        const { valid } = validateLogin({ email: 'a@b.com', password: '123456' });
        assert.equal(valid, true);
    });

    it('thiếu email — lỗi', () => {
        const { valid, errors } = validateLogin({ password: '123' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Email')));
    });

    it('thiếu password — lỗi', () => {
        const { valid, errors } = validateLogin({ email: 'a@b.com' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Mật khẩu')));
    });

    it('cả 2 đều rỗng — 2 lỗi', () => {
        const { valid, errors } = validateLogin({ email: '', password: '' });
        assert.equal(valid, false);
        assert.equal(errors.length, 2);
    });

    it('body null — lỗi', () => {
        const { valid } = validateLogin(null);
        assert.equal(valid, false);
    });
});

// ═══════════════════════════════════════════════════════════
// 5. validateForgotPassword
// ═══════════════════════════════════════════════════════════

describe('validateForgotPassword', () => {
    it('email hợp lệ — pass', () => {
        const { valid } = validateForgotPassword({ email: 'user@test.com' });
        assert.equal(valid, true);
    });

    it('email rỗng — lỗi', () => {
        const { valid } = validateForgotPassword({ email: '' });
        assert.equal(valid, false);
    });

    it('email sai format — lỗi', () => {
        const { valid } = validateForgotPassword({ email: 'not-email' });
        assert.equal(valid, false);
    });

    it('không có email — lỗi', () => {
        const { valid } = validateForgotPassword({});
        assert.equal(valid, false);
    });
});

// ═══════════════════════════════════════════════════════════
// 6. validateResetPassword
// ═══════════════════════════════════════════════════════════

describe('validateResetPassword', () => {
    it('đầy đủ hợp lệ — pass', () => {
        const { valid } = validateResetPassword({
            token: 'some-valid-token',
            newPassword: 'NewPass1!',
            confirmPassword: 'NewPass1!',
        });
        assert.equal(valid, true);
    });

    it('token rỗng — lỗi', () => {
        const { valid, errors } = validateResetPassword({
            token: '',
            newPassword: 'NewPass1!',
            confirmPassword: 'NewPass1!',
        });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Link') || e.includes('token')));
    });

    it('mật khẩu mới yếu — lỗi', () => {
        const { valid } = validateResetPassword({
            token: 'tok',
            newPassword: '123',
            confirmPassword: '123',
        });
        assert.equal(valid, false);
    });

    it('xác nhận mật khẩu không khớp — lỗi', () => {
        const { valid, errors } = validateResetPassword({
            token: 'tok',
            newPassword: 'Strong1!x',
            confirmPassword: 'Different1!',
        });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('không khớp')));
    });

    it('body rỗng — nhiều lỗi', () => {
        const { valid, errors } = validateResetPassword({});
        assert.equal(valid, false);
        assert.ok(errors.length >= 2);
    });
});

// ═══════════════════════════════════════════════════════════
// 7. validateCreateRental
// ═══════════════════════════════════════════════════════════

describe('validateCreateRental', () => {
    const validBody = {
        title: 'Nhà trọ đẹp',
        city: 'Hà Nội',
        district: 'Cầu Giấy',
        address: '123 Đường ABC',
    };

    it('đầy đủ bắt buộc — pass', () => {
        const { valid } = validateCreateRental(validBody);
        assert.equal(valid, true);
    });

    it('có description (optional) — pass', () => {
        const { valid } = validateCreateRental({ ...validBody, description: 'Mô tả ngắn' });
        assert.equal(valid, true);
    });

    it('title quá ngắn (1 ký tự) — lỗi', () => {
        const { valid, errors } = validateCreateRental({ ...validBody, title: 'A' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Tiêu đề')));
    });

    it('title quá dài (>200 ký tự) — lỗi', () => {
        const { valid } = validateCreateRental({ ...validBody, title: 'X'.repeat(201) });
        assert.equal(valid, false);
    });

    it('thiếu city — lỗi', () => {
        const { valid, errors } = validateCreateRental({ ...validBody, city: '' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Thành phố')));
    });

    it('thiếu district — lỗi', () => {
        const { valid, errors } = validateCreateRental({ ...validBody, district: '' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Quận')));
    });

    it('thiếu address — lỗi', () => {
        const { valid, errors } = validateCreateRental({ ...validBody, address: '' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Địa chỉ')));
    });

    it('description quá dài (>5000) — lỗi', () => {
        const { valid } = validateCreateRental({ ...validBody, description: 'X'.repeat(5001) });
        assert.equal(valid, false);
    });

    it('body rỗng — nhiều lỗi', () => {
        const { valid, errors } = validateCreateRental({});
        assert.equal(valid, false);
        assert.ok(errors.length >= 4); // title, city, district, address
    });

    it('body null — nhiều lỗi', () => {
        const { valid } = validateCreateRental(null);
        assert.equal(valid, false);
    });
});

// ═══════════════════════════════════════════════════════════
// 8. validateUpdateRentalStatus
// ═══════════════════════════════════════════════════════════

describe('validateUpdateRentalStatus', () => {
    // Kiểm tra tất cả status hợp lệ
    for (const status of VALID_RENTAL_STATUSES) {
        it(`status "${status}" — hợp lệ`, () => {
            const { valid } = validateUpdateRentalStatus({ status });
            assert.equal(valid, true);
        });
    }

    it('status rỗng — lỗi', () => {
        const { valid } = validateUpdateRentalStatus({ status: '' });
        assert.equal(valid, false);
    });

    it('status không hợp lệ "DELETED" — lỗi', () => {
        const { valid, errors } = validateUpdateRentalStatus({ status: 'DELETED' });
        assert.equal(valid, false);
        assert.ok(errors.some((e) => e.includes('Status')));
    });

    it('body rỗng — lỗi', () => {
        const { valid } = validateUpdateRentalStatus({});
        assert.equal(valid, false);
    });
});
