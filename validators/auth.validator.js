/**
 * Validate register input
 * Fields: fullName, email, phone (optional), password, confirmPassword
 */
function validateRegister(body) {
    const errors = [];
    const { fullName, email, phone, password, confirmPassword } = body || {};

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
    if (phone !== undefined && phone !== null && phone !== '') {
        const phoneRegex = /^[0-9]{10,20}$/;
        if (!phoneRegex.test(phone.trim())) {
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

module.exports = { validateRegister, validateLogin };
