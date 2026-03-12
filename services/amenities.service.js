const prisma = require('../config/prisma');
const cache = require('../utils/simple-cache');

const CACHE_KEY = 'amenities:all';
const ROOMS_AMENITIES_KEY = 'rooms:amenities';

function invalidateAmenitiesCache() {
    cache.invalidate(CACHE_KEY);
    cache.invalidate(ROOMS_AMENITIES_KEY);
}

/**
 * Lấy danh sách tất cả tiện ích
 */
async function getAllAmenities() {
    const cached = cache.get(CACHE_KEY);
    if (cached) {
        return { data: cached, total: cached.length };
    }

    const amenities = await prisma.amenities.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
    });
    cache.set(CACHE_KEY, amenities);

    return { data: amenities, total: amenities.length };
}

/**
 * Lấy chi tiết một tiện ích
 */
async function getAmenityById(id) {
    const amenity = await prisma.amenities.findUnique({
        where: { id },
        include: {
            roomAmenities: {
                select: { roomId: true },
            },
        },
    });

    if (!amenity) {
        throw Object.assign(new Error('Không tìm thấy tiện ích'), { statusCode: 404 });
    }

    return {
        data: {
            ...amenity,
            roomCount: amenity.roomAmenities.length,
        },
    };
}

/**
 * Tạo tiện ích mới
 */
async function createAmenity(name) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw Object.assign(new Error('Tên tiện ích không được để trống'), { statusCode: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
        throw Object.assign(new Error('Tên tiện ích không được quá 100 ký tự'), { statusCode: 400 });
    }

    const existing = await prisma.amenities.findUnique({
        where: { name: trimmedName },
    });

    if (existing) {
        throw Object.assign(new Error(`Tiện ích "${trimmedName}" đã tồn tại`), { statusCode: 409 });
    }

    const amenity = await prisma.amenities.create({
        data: { name: trimmedName },
    });
    invalidateAmenitiesCache();

    return {
        message: `Đã tạo tiện ích "${amenity.name}"`,
        data: amenity,
    };
}

/**
 * Cập nhật tiện ích
 */
async function updateAmenity(id, name) {
    const existing = await prisma.amenities.findUnique({
        where: { id },
    });

    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy tiện ích'), { statusCode: 404 });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw Object.assign(new Error('Tên tiện ích không được để trống'), { statusCode: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
        throw Object.assign(new Error('Tên tiện ích không được quá 100 ký tự'), { statusCode: 400 });
    }

    const duplicate = await prisma.amenities.findFirst({
        where: {
            name: trimmedName,
            NOT: { id },
        },
    });

    if (duplicate) {
        throw Object.assign(new Error(`Tiện ích "${trimmedName}" đã tồn tại`), { statusCode: 409 });
    }

    const amenity = await prisma.amenities.update({
        where: { id },
        data: { name: trimmedName },
    });
    invalidateAmenitiesCache();

    return {
        message: `Đã cập nhật tiện ích thành "${amenity.name}"`,
        data: amenity,
    };
}

/**
 * Xóa tiện ích
 */
async function deleteAmenity(id) {
    const existing = await prisma.amenities.findUnique({
        where: { id },
        include: {
            roomAmenities: { select: { roomId: true } },
        },
    });

    if (!existing) {
        throw Object.assign(new Error('Không tìm thấy tiện ích'), { statusCode: 404 });
    }

    const roomCount = existing.roomAmenities.length;
    if (roomCount > 0) {
        console.warn(`Deleting amenity "${existing.name}" which is used by ${roomCount} rooms`);
    }

    await prisma.amenities.delete({
        where: { id },
    });
    invalidateAmenitiesCache();

    return {
        message: `Đã xóa tiện ích "${existing.name}"${roomCount > 0 ? ` (đã gỡ khỏi ${roomCount} phòng)` : ''}`,
    };
}

module.exports = {
    getAllAmenities,
    getAmenityById,
    createAmenity,
    updateAmenity,
    deleteAmenity,
};
