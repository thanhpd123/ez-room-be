/**
 * Validate password strength: 8+ chars, at least 1 uppercase, 1 number, 1 special char.
 * Returns array of error messages (empty if valid).
 */
function validatePasswordStrength(password) {
    const errors = [];
    if (!password || typeof password !== 'string') {
        errors.push('Mật khẩu là bắt buộc');
        return errors;
    }
    if (password.length < 8) {
        errors.push('Mật khẩu phải có ít nhất 8 ký tự');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Mật khẩu phải có ít nhất 1 chữ in hoa');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Mật khẩu phải có ít nhất 1 chữ số');
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
        errors.push('Mật khẩu phải có ít nhất 1 ký tự đặc biệt (!@#$%^&*...)');
    }
    return errors;
}

/**
 * Validate register input
 * Fields: fullName, email, phone (optional), password, confirmPassword
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

    // password: required, 8+ chars, 1 uppercase, 1 number, 1 special
    const passwordErrors = validatePasswordStrength(password);
    if (passwordErrors.length > 0) {
        errors.push(...passwordErrors);
    }

    // confirmPassword: must match password
    if (password !== confirmPassword) {
        errors.push('Xác nhận mật khẩu không khớp');
    }

    // role: required, TENANT|LANDLORD
    const normalizedRole = typeof role === 'string' ? role.trim().toUpperCase() : '';
    if (!normalizedRole) {
        errors.push('Vai trò là bắt buộc');
    } else if (!['TENANT', 'LANDLORD'].includes(normalizedRole)) {
        errors.push('Vai trò không hợp lệ');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate register-oauth (complete signup after Google OAuth)
 * Fields: email, fullName, phone (optional)
 */
function validateRegisterOAuth(body) {
    const errors = [];
    const { email, fullName, phone, role } = body || {};
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
    if (phone !== undefined && phone !== null && phone !== '') {
        const phoneRegex = /^[0-9]{10,20}$/;
        if (!phoneRegex.test(String(phone).trim())) errors.push('Số điện thoại phải từ 10 đến 20 chữ số');
    }
    const normalizedRole = typeof role === 'string' ? role.trim().toUpperCase() : '';
    if (!normalizedRole) {
        errors.push('Vai trò là bắt buộc');
    } else if (!['TENANT', 'LANDLORD'].includes(normalizedRole)) {
        errors.push('Vai trò không hợp lệ');
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
    const newPasswordErrors = validatePasswordStrength(newPassword);
    if (newPasswordErrors.length > 0) {
        errors.push(...newPasswordErrors);
    }
    if (newPassword !== confirmPassword) {
        errors.push('Xác nhận mật khẩu không khớp');
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Validate change-password input. Fields: currentPassword, newPassword, confirmNewPassword
 */
function validateChangePassword(body) {
    const errors = [];
    const { currentPassword, newPassword, confirmNewPassword } = body || {};
    if (!currentPassword || typeof currentPassword !== 'string' || !currentPassword.trim()) {
        errors.push('Mật khẩu hiện tại là bắt buộc');
    }
    const newPasswordErrors = validatePasswordStrength(newPassword);
    if (newPasswordErrors.length > 0) {
        errors.push(...newPasswordErrors);
    }
    if (newPassword !== confirmNewPassword) {
        errors.push('Xác nhận mật khẩu mới không khớp');
    }
    if (currentPassword && newPassword && currentPassword === newPassword) {
        errors.push('Mật khẩu mới phải khác mật khẩu hiện tại');
    }
    return { valid: errors.length === 0, errors };
}

/**
 * Validate refresh token payload. Field: refreshToken
 */
function validateRefreshToken(body) {
    const errors = [];
    const { refreshToken } = body || {};

    if (!refreshToken || typeof refreshToken !== 'string' || !refreshToken.trim()) {
        errors.push('Refresh token là bắt buộc');
    }

    return { valid: errors.length === 0, errors };
}

module.exports = {
    validateRegister,
    validateRegisterOAuth,
    validateLogin,
    validateForgotPassword,
    validateResetPassword,
    validateChangePassword,
    validateRefreshToken,
    validatePasswordStrength,
};
