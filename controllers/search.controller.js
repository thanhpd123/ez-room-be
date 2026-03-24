const searchService = require('../services/search.service');

function hasAdvancedFilters({ amenityIds, minArea, maxArea }) {
    const hasAmenities = Array.isArray(amenityIds) && amenityIds.length > 0;
    const hasMinArea = minArea != null && String(minArea).trim() !== '';
    const hasMaxArea = maxArea != null && String(maxArea).trim() !== '';
    return hasAmenities || hasMinArea || hasMaxArea;
}

function canUseAdvancedFilters(authUser) {
    if (!authUser) return false;
    const privilegedRoles = new Set(['ADMIN', 'MODERATOR']);
    if (privilegedRoles.has(authUser.role)) return true;
    return authUser.isVip === true;
}

function handleError(err, res, defaultMessage) {
    const statusCode = err.statusCode || 500;
    const message = err.message || defaultMessage;
    console.error('Search error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function getPublicSearch(req, res) {
    try {
        const amenitiesParam =
            typeof req.query.amenities === 'string'
                ? req.query.amenities.trim()
                : '';
        const amenityIds = amenitiesParam
            ? amenitiesParam
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];

        if (
            hasAdvancedFilters({
                amenityIds,
                minArea: req.query.minArea,
                maxArea: req.query.maxArea,
            }) &&
            !canUseAdvancedFilters(req.auth?.user)
        ) {
            return res.status(403).json({
                success: false,
                code: 'VIP_REQUIRED_FOR_ADVANCED_FILTERS',
                message: 'Bộ lọc nâng cao yêu cầu tài khoản VIP',
                upgradePath: '/vip-plans',
                featureName: 'advanced_search_filters',
            });
        }

        const result = await searchService.getPublicSearch(
            {
                page: req.query.page,
                limit: req.query.limit,
                q: req.query.q,
                district: req.query.district,
                city: req.query.city,
                address: req.query.address,
                minPrice: req.query.minPrice,
                maxPrice: req.query.maxPrice,
                roomType: req.query.roomType,
                minArea: req.query.minArea,
                maxArea: req.query.maxArea,
                amenityIds,
            },
            req.auth?.user?.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tìm kiếm');
    }
}

async function getRecommend(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Cần đăng nhập để xem gợi ý',
            });
        }
        const result = await searchService.getRecommend(userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi tải gợi ý');
    }
}

module.exports = { getPublicSearch, getRecommend };
