const prisma = require('../config/prisma');

/**
 * Lấy danh sách địa điểm
 */
async function getAllLocations(params) {
    const { city, district, search } = params;
    const where = {};

    if (city) {
        where.city = { contains: city, mode: 'insensitive' };
    }
    if (district) {
        where.district = { contains: district, mode: 'insensitive' };
    }
    if (search) {
        where.OR = [
            { address: { contains: search, mode: 'insensitive' } },
            { district: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
        ];
    }

    const locations = await prisma.location.findMany({
        where,
        orderBy: [{ city: 'asc' }, { district: 'asc' }],
        select: {
            id: true,
            address: true,
            district: true,
            city: true,
            latitude: true,
            longitude: true,
        },
    });

    return { data: locations, total: locations.length };
}

/**
 * Lấy danh sách thành phố
 */
async function getCities() {
    const cities = await prisma.location.findMany({
        where: { city: { not: null } },
        select: { city: true },
        distinct: ['city'],
        orderBy: { city: 'asc' },
    });
    return { data: cities.map((c) => c.city).filter(Boolean) };
}

/**
 * Lấy danh sách quận/huyện theo thành phố
 */
async function getDistricts(params) {
    const { city } = params;
    const where = { district: { not: null } };
    if (city) {
        where.city = { equals: city, mode: 'insensitive' };
    }

    const districts = await prisma.location.findMany({
        where,
        select: { district: true, city: true },
        distinct: ['district', 'city'],
        orderBy: { district: 'asc' },
    });
    return { data: districts.filter((d) => d.district) };
}

/**
 * Lấy chi tiết một địa điểm
 */
async function getLocationById(id) {
    const location = await prisma.location.findUnique({
        where: { id },
        include: {
            rentals: {
                select: { id: true, title: true, status: true },
            },
        },
    });

    if (!location) {
        throw Object.assign(new Error('Không tìm thấy địa điểm'), { statusCode: 404 });
    }

    return {
        data: {
            ...location,
            rentalCount: location.rentals.length,
        },
    };
}

/**
 * Tạo địa điểm mới
 */
async function createLocation(body) {
    const { address, district, city, latitude, longitude } = body;

    if (!address || typeof address !== 'string' || address.trim().length === 0) {
        throw Object.assign(new Error('Địa chỉ không được để trống'), { statusCode: 400 });
    }

    if (
        latitude !== undefined &&
        (typeof latitude !== 'number' || latitude < -90 || latitude > 90)
    ) {
        throw Object.assign(new Error('Latitude phải là số từ -90 đến 90'), { statusCode: 400 });
    }

    if (
        longitude !== undefined &&
        (typeof longitude !== 'number' || longitude < -180 || longitude > 180)
    ) {
        throw Object.assign(new Error('Longitude phải là số từ -180 đến 180'), { statusCode: 400 });
    }

    const location = await prisma.location.create({
        data: {
            address: address.trim(),
            district: district?.trim() || null,
            city: city?.trim() || null,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
        },
    });

    return {
        message: 'Đã tạo địa điểm mới',
        data: location,
    };
}

/**
 * Cập nhật địa điểm
 */
async function updateLocation(id, body) {
    const { address, district, city, latitude, longitude } = body;

    const existing = await prisma.location.findUnique({
        where: { id },
    });

    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy địa điểm'), { statusCode: 404 });
    }

    const updateData = {};

    if (address !== undefined) {
        if (typeof address !== 'string' || address.trim().length === 0) {
            throw Object.assign(new Error('Địa chỉ không được để trống'), { statusCode: 400 });
        }
        updateData.address = address.trim();
    }
    if (district !== undefined) updateData.district = district?.trim() || null;
    if (city !== undefined) updateData.city = city?.trim() || null;
    if (latitude !== undefined) {
        if (
            latitude !== null &&
            (typeof latitude !== 'number' || latitude < -90 || latitude > 90)
        ) {
            throw Object.assign(new Error('Latitude phải là số từ -90 đến 90'), { statusCode: 400 });
        }
        updateData.latitude = latitude;
    }
    if (longitude !== undefined) {
        if (
            longitude !== null &&
            (typeof longitude !== 'number' || longitude < -180 || longitude > 180)
        ) {
            throw Object.assign(new Error('Longitude phải là số từ -180 đến 180'), {
                statusCode: 400,
            });
        }
        updateData.longitude = longitude;
    }

    if (Object.keys(updateData).length === 0) {
        throw Object.assign(new Error('Không có dữ liệu để cập nhật'), { statusCode: 400 });
    }

    const location = await prisma.location.update({
        where: { id },
        data: updateData,
    });

    return {
        message: 'Đã cập nhật địa điểm',
        data: location,
    };
}

/**
 * Xóa địa điểm
 */
async function deleteLocation(id) {
    const existing = await prisma.location.findUnique({
        where: { id },
        include: {
            rentals: { select: { id: true } },
        },
    });

    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy địa điểm'), { statusCode: 404 });
    }

    if (existing.rentals.length > 0) {
        throw Object.assign(
            new Error(`Không thể xóa địa điểm này vì đang có ${existing.rentals.length} bài đăng liên kết`),
            { statusCode: 409 }
        );
    }

    await prisma.location.delete({
        where: { id },
    });

    return { message: 'Đã xóa địa điểm' };
}

module.exports = {
    getAllLocations,
    getCities,
    getDistricts,
    getLocationById,
    createLocation,
    updateLocation,
    deleteLocation,
};
