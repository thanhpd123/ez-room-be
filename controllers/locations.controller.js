const prisma = require('../config/prisma');

/**
 * GET /locations
 * Lấy danh sách tất cả địa điểm (public)
 * Query: ?city=Hanoi&district=Cau Giay
 */
async function getAllLocations(req, res) {
    try {
        const { city, district, search } = req.query;

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
            orderBy: [
                { city: 'asc' },
                { district: 'asc' },
            ],
            select: {
                id: true,
                address: true,
                district: true,
                city: true,
                latitude: true,
                longitude: true,
            },
        });

        return res.json({
            success: true,
            data: locations,
            total: locations.length,
        });
    } catch (err) {
        console.error('Get locations error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách địa điểm',
            error: err.message,
        });
    }
}

/**
 * GET /locations/cities
 * Lấy danh sách các thành phố (distinct)
 */
async function getCities(req, res) {
    try {
        const cities = await prisma.location.findMany({
            where: {
                city: { not: null },
            },
            select: {
                city: true,
            },
            distinct: ['city'],
            orderBy: { city: 'asc' },
        });

        return res.json({
            success: true,
            data: cities.map(c => c.city).filter(Boolean),
        });
    } catch (err) {
        console.error('Get cities error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách thành phố',
            error: err.message,
        });
    }
}

/**
 * GET /locations/districts
 * Lấy danh sách quận/huyện theo thành phố
 * Query: ?city=Hanoi
 */
async function getDistricts(req, res) {
    try {
        const { city } = req.query;

        const where = {
            district: { not: null },
        };

        if (city) {
            where.city = { equals: city, mode: 'insensitive' };
        }

        const districts = await prisma.location.findMany({
            where,
            select: {
                district: true,
                city: true,
            },
            distinct: ['district', 'city'],
            orderBy: { district: 'asc' },
        });

        return res.json({
            success: true,
            data: districts.filter(d => d.district),
        });
    } catch (err) {
        console.error('Get districts error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách quận/huyện',
            error: err.message,
        });
    }
}

/**
 * GET /locations/:id
 * Lấy chi tiết một địa điểm
 */
async function getLocationById(req, res) {
    try {
        const { id } = req.params;

        const location = await prisma.location.findUnique({
            where: { id },
            include: {
                rentals: {
                    select: {
                        id: true,
                        title: true,
                        status: true,
                    },
                },
            },
        });

        if (!location) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy địa điểm',
            });
        }

        return res.json({
            success: true,
            data: {
                ...location,
                rentalCount: location.rentals.length,
            },
        });
    } catch (err) {
        console.error('Get location by id error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thông tin địa điểm',
            error: err.message,
        });
    }
}

/**
 * POST /locations (Admin only)
 * Tạo địa điểm mới
 * Body: { address, district?, city?, latitude?, longitude? }
 */
async function createLocation(req, res) {
    try {
        const { address, district, city, latitude, longitude } = req.body;

        // Validate
        if (!address || typeof address !== 'string' || address.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Địa chỉ không được để trống',
            });
        }

        // Validate coordinates if provided
        if (latitude !== undefined && (typeof latitude !== 'number' || latitude < -90 || latitude > 90)) {
            return res.status(400).json({
                success: false,
                message: 'Latitude phải là số từ -90 đến 90',
            });
        }

        if (longitude !== undefined && (typeof longitude !== 'number' || longitude < -180 || longitude > 180)) {
            return res.status(400).json({
                success: false,
                message: 'Longitude phải là số từ -180 đến 180',
            });
        }

        // Create
        const location = await prisma.location.create({
            data: {
                address: address.trim(),
                district: district?.trim() || null,
                city: city?.trim() || null,
                latitude: latitude ?? null,
                longitude: longitude ?? null,
            },
        });

        return res.status(201).json({
            success: true,
            message: 'Đã tạo địa điểm mới',
            data: location,
        });
    } catch (err) {
        console.error('Create location error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tạo địa điểm',
            error: err.message,
        });
    }
}

/**
 * PATCH /locations/:id (Admin only)
 * Cập nhật địa điểm
 * Body: { address?, district?, city?, latitude?, longitude? }
 */
async function updateLocation(req, res) {
    try {
        const { id } = req.params;
        const { address, district, city, latitude, longitude } = req.body;

        // Check exists
        const existing = await prisma.location.findUnique({
            where: { id },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy địa điểm',
            });
        }

        // Build update data
        const updateData = {};

        if (address !== undefined) {
            if (typeof address !== 'string' || address.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Địa chỉ không được để trống',
                });
            }
            updateData.address = address.trim();
        }

        if (district !== undefined) {
            updateData.district = district?.trim() || null;
        }

        if (city !== undefined) {
            updateData.city = city?.trim() || null;
        }

        if (latitude !== undefined) {
            if (latitude !== null && (typeof latitude !== 'number' || latitude < -90 || latitude > 90)) {
                return res.status(400).json({
                    success: false,
                    message: 'Latitude phải là số từ -90 đến 90',
                });
            }
            updateData.latitude = latitude;
        }

        if (longitude !== undefined) {
            if (longitude !== null && (typeof longitude !== 'number' || longitude < -180 || longitude > 180)) {
                return res.status(400).json({
                    success: false,
                    message: 'Longitude phải là số từ -180 đến 180',
                });
            }
            updateData.longitude = longitude;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Không có dữ liệu để cập nhật',
            });
        }

        // Update
        const location = await prisma.location.update({
            where: { id },
            data: updateData,
        });

        return res.json({
            success: true,
            message: 'Đã cập nhật địa điểm',
            data: location,
        });
    } catch (err) {
        console.error('Update location error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật địa điểm',
            error: err.message,
        });
    }
}

/**
 * DELETE /locations/:id (Admin only)
 * Xóa địa điểm
 */
async function deleteLocation(req, res) {
    try {
        const { id } = req.params;

        // Check exists and rentals count
        const existing = await prisma.location.findUnique({
            where: { id },
            include: {
                rentals: {
                    select: { id: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy địa điểm',
            });
        }

        // Prevent delete if location has rentals
        if (existing.rentals.length > 0) {
            return res.status(409).json({
                success: false,
                message: `Không thể xóa địa điểm này vì đang có ${existing.rentals.length} bài đăng liên kết`,
            });
        }

        // Delete
        await prisma.location.delete({
            where: { id },
        });

        return res.json({
            success: true,
            message: 'Đã xóa địa điểm',
        });
    } catch (err) {
        console.error('Delete location error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa địa điểm',
            error: err.message,
        });
    }
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
