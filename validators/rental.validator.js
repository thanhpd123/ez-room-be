const VALID_RENTAL_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'HIDDEN', 'VIOLATE', 'PENDING', 'SUSPEND'];

/**
 * Validate create rental input
 * Fields: title (required), description, city (required), district (required), address (required)
 */
function validateCreateRental(body) {
    const errors = [];
    const { title, description, city, district, address } = body || {};

    // title: required, 2–200 chars
    if (!title || typeof title !== 'string' || title.trim().length < 2) {
        errors.push('Tiêu đề phải có ít nhất 2 ký tự');
    } else if (title.trim().length > 200) {
        errors.push('Tiêu đề không được quá 200 ký tự');
    }

    // description: optional, max 5000 chars
    if (description && typeof description === 'string' && description.trim().length > 5000) {
        errors.push('Mô tả không được quá 5000 ký tự');
    }

    // city: required
    if (!city || typeof city !== 'string' || city.trim().length < 1) {
        errors.push('Thành phố là bắt buộc');
    } else if (city.trim().length > 100) {
        errors.push('Thành phố không được quá 100 ký tự');
    }

    // district: required
    if (!district || typeof district !== 'string' || district.trim().length < 1) {
        errors.push('Quận/huyện là bắt buộc');
    } else if (district.trim().length > 100) {
        errors.push('Quận/huyện không được quá 100 ký tự');
    }

    // address: required
    if (!address || typeof address !== 'string' || address.trim().length < 1) {
        errors.push('Địa chỉ là bắt buộc');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate update rental status input
 * Fields: status (required, must be valid enum)
 */
function validateUpdateRentalStatus(body) {
    const errors = [];
    const { status } = body || {};

    if (!status || !VALID_RENTAL_STATUSES.includes(status)) {
        errors.push(`Status không hợp lệ. Các status hợp lệ: ${VALID_RENTAL_STATUSES.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
}

module.exports = {
    validateCreateRental,
    validateUpdateRentalStatus,
    VALID_RENTAL_STATUSES,
};
