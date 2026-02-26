const ALLOWED_ROLES = ['TENANT', 'LANDLORD'];

/**
 * Validate register input
 * Fields: fullName, email, phone (optional), password, confirmPassword, role (optional: TENANT | LANDLORD)
 */
function validateRegister(body) {
    const errors = [];
    const { fullName, email, phone, password, confirmPassword, role } = body || {};

    // fullName: required, 2–100 chars
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
        errors.push('Họ và tên phải có ít nhất 2 ký tự');
    } else if (fullName.trim().length > 100) {
        errors.push('Họ và tên không được quá 100 ký tự');
    }

    // email: required, valid format
    if (!email || typeof email !== 'string') {
        errors.push('Email là bắt buộc');
    } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            errors.push('Email không hợp lệ');
        }
    }

    // phone: optional, 10–20 digits
    const phoneStr = phone !== undefined && phone !== null ? String(phone).trim() : '';
    if (phoneStr !== '') {
        const phoneRegex = /^[0-9]{10,20}$/;
        if (!phoneRegex.test(phoneStr)) {
            errors.push('Số điện thoại phải từ 10 đến 20 chữ số');
        }
    }

    // password: required, min 6 chars
    if (!password || typeof password !== 'string' || password.length < 6) {
        errors.push('Mật khẩu phải có ít nhất 6 ký tự');
    }

    // confirmPassword: must match password
    if (password !== confirmPassword) {
        errors.push('Xác nhận mật khẩu không khớp');
    }

    // role: optional, must be TENANT or LANDLORD
    if (role !== undefined && role !== null && role !== '') {
        if (!ALLOWED_ROLES.includes(String(role).toUpperCase())) {
            errors.push('Vai trò phải là Người thuê (TENANT) hoặc Chủ nhà (LANDLORD)');
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate register-oauth (complete signup after Google/Facebook)
 * Fields: email, fullName, role (TENANT | LANDLORD), phone (optional)
 */
function validateRegisterOAuth(body) {
    const errors = [];
    const { email, fullName, role, phone } = body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
        errors.push('Email là bắt buộc');
    } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) errors.push('Email không hợp lệ');
    }
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
        errors.push('Họ và tên phải có ít nhất 2 ký tự');
    } else if (fullName.trim().length > 100) {
        errors.push('Họ và tên không được quá 100 ký tự');
    }
    if (!role || !ALLOWED_ROLES.includes(String(role).toUpperCase())) {
        errors.push('Vai trò phải là Người thuê (TENANT) hoặc Chủ nhà (LANDLORD)');
    }
    if (phone !== undefined && phone !== null && phone !== '') {
        const phoneRegex = /^[0-9]{10,20}$/;
        if (!phoneRegex.test(String(phone).trim())) errors.push('Số điện thoại phải từ 10 đến 20 chữ số');
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Validate login input
 * Fields: email, password
 */
function validateLogin(body) {
    const errors = [];
    const { email, password } = body || {};

    if (!email || typeof email !== 'string' || !email.trim()) {
        errors.push('Email là bắt buộc');
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
        errors.push('Mật khẩu là bắt buộc');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate forgot-password input. Field: email
 */
function validateForgotPassword(body) {
    const errors = [];
    const { email } = body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
        errors.push('Email là bắt buộc');
    } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            errors.push('Email không hợp lệ');
        }
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Validate reset-password input. Fields: token, newPassword, confirmPassword
 */
function validateResetPassword(body) {
    const errors = [];
    const { token, newPassword, confirmPassword } = body || {};
    if (!token || typeof token !== 'string' || !token.trim()) {
        errors.push('Link đặt lại mật khẩu không hợp lệ');
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        errors.push('Mật khẩu mới phải có ít nhất 6 ký tự');
    }
    if (newPassword !== confirmPassword) {
        errors.push('Xác nhận mật khẩu không khớp');
    }
    return { valid: errors.length === 0, errors };
}

module.exports = { validateRegister, validateRegisterOAuth, validateLogin, validateForgotPassword, validateResetPassword };
