const prisma = require('../config/prisma');

/**
 * GET /amenities
 * Lấy danh sách tất cả tiện ích (public - ai cũng xem được)
 */
async function getAllAmenities(req, res) {
    try {
        const amenities = await prisma.amenities.findMany({
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
            },
        });

        return res.json({
            success: true,
            data: amenities,
            total: amenities.length,
        });
    } catch (err) {
        console.error('Get amenities error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy danh sách tiện ích',
            error: err.message,
        });
    }
}

/**
 * GET /amenities/:id
 * Lấy chi tiết một tiện ích
 */
async function getAmenityById(req, res) {
    try {
        const { id } = req.params;

        const amenity = await prisma.amenities.findUnique({
            where: { id },
            include: {
                roomAmenities: {
                    select: {
                        roomId: true,
                    },
                },
            },
        });

        if (!amenity) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy tiện ích',
            });
        }

        return res.json({
            success: true,
            data: {
                ...amenity,
                roomCount: amenity.roomAmenities.length,
            },
        });
    } catch (err) {
        console.error('Get amenity by id error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy thông tin tiện ích',
            error: err.message,
        });
    }
}

/**
 * POST /amenities (Admin only)
 * Tạo tiện ích mới
 * Body: { name: string }
 */
async function createAmenity(req, res) {
    try {
        const { name } = req.body;

        // Validate
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tên tiện ích không được để trống',
            });
        }

        const trimmedName = name.trim();

        if (trimmedName.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Tên tiện ích không được quá 100 ký tự',
            });
        }

        // Check duplicate
        const existing = await prisma.amenities.findUnique({
            where: { name: trimmedName },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                message: `Tiện ích "${trimmedName}" đã tồn tại`,
            });
        }

        // Create
        const amenity = await prisma.amenities.create({
            data: { name: trimmedName },
        });

        return res.status(201).json({
            success: true,
            message: `Đã tạo tiện ích "${amenity.name}"`,
            data: amenity,
        });
    } catch (err) {
        console.error('Create amenity error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tạo tiện ích',
            error: err.message,
        });
    }
}

/**
 * PATCH /amenities/:id (Admin only)
 * Cập nhật tiện ích
 * Body: { name: string }
 */
async function updateAmenity(req, res) {
    try {
        const { id } = req.params;
        const { name } = req.body;

        // Check exists
        const existing = await prisma.amenities.findUnique({
            where: { id },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy tiện ích',
            });
        }

        // Validate name
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tên tiện ích không được để trống',
            });
        }

        const trimmedName = name.trim();

        if (trimmedName.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Tên tiện ích không được quá 100 ký tự',
            });
        }

        // Check duplicate (exclude current)
        const duplicate = await prisma.amenities.findFirst({
            where: {
                name: trimmedName,
                NOT: { id },
            },
        });

        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: `Tiện ích "${trimmedName}" đã tồn tại`,
            });
        }

        // Update
        const amenity = await prisma.amenities.update({
            where: { id },
            data: { name: trimmedName },
        });

        return res.json({
            success: true,
            message: `Đã cập nhật tiện ích thành "${amenity.name}"`,
            data: amenity,
        });
    } catch (err) {
        console.error('Update amenity error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi cập nhật tiện ích',
            error: err.message,
        });
    }
}

/**
 * DELETE /amenities/:id (Admin only)
 * Xóa tiện ích
 */
async function deleteAmenity(req, res) {
    try {
        const { id } = req.params;

        // Check exists
        const existing = await prisma.amenities.findUnique({
            where: { id },
            include: {
                roomAmenities: {
                    select: { roomId: true },
                },
            },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy tiện ích',
            });
        }

        // Warning if amenity is being used
        const roomCount = existing.roomAmenities.length;
        if (roomCount > 0) {
            // Still delete but warn
            console.warn(`Deleting amenity "${existing.name}" which is used by ${roomCount} rooms`);
        }

        // Delete (cascade will remove room_amenities)
        await prisma.amenities.delete({
            where: { id },
        });

        return res.json({
            success: true,
            message: `Đã xóa tiện ích "${existing.name}"${roomCount > 0 ? ` (đã gỡ khỏi ${roomCount} phòng)` : ''}`,
        });
    } catch (err) {
        console.error('Delete amenity error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa tiện ích',
            error: err.message,
        });
    }
}

module.exports = {
    getAllAmenities,
    getAmenityById,
    createAmenity,
    updateAmenity,
    deleteAmenity,
};
