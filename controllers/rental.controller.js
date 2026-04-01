const rentalService = require('../services/rental.service');

function handleError(err, res, defaultMessage) {
    const statusCode = parseInt(err.statusCode) || 500;
    const message = err.message || defaultMessage;
    console.error('Rental error:', err);
    return res.status(statusCode).json({
        success: false,
        message,
        ...(err.errors && { errors: err.errors }),
        ...(err.rentalId && { rentalId: err.rentalId }),
        ...(statusCode === 500 && { error: err.message }),
    });
}

async function createRental(req, res) {
    try {
        // Extract files from multer
        const uploadedFiles = req.files || [];
        console.log('CREATE RENTAL - Request received:', {
            totalUploadedFiles: uploadedFiles.length,
            uploadedFiles: uploadedFiles.map(f => ({ 
                fieldname: f.fieldname,
                name: f.originalname, 
                size: f.size, 
                mime: f.mimetype 
            })),
            hasImages: !!req.body.images,
        });

        // Extract file objects
        // ⚠️ Images can be uploaded via MultiImageUpload (Cloudinary) OR as files
        // Documents can be PDFs or images (uploaded via MultiFileSelect for verification)
        // All files in req.files are documents (from MultiFileSelect)
        const documentFiles = uploadedFiles.filter(f => 
            f.mimetype === 'application/pdf' || 
            f.mimetype.startsWith('image/')  // Allow images as documents too
        );

        // Extract JSON image URLs from FormData
        let imageUrls = [];
        if (req.body.images) {
            try {
                const parsed = JSON.parse(req.body.images);
                imageUrls = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                console.warn('Failed to parse images JSON:', e);
            }
        }

        console.log('Extracted from FormData:', {
            documentFiles: documentFiles.length,
            imageUrls: imageUrls.length,
        });

        const result = await rentalService.createRental(req.auth.user.id, req.body, {
            // Files from multipart - only documents, no separate imageFiles
            documentFiles,
            // URLs from FormData (JSON string)
            imageUrls,
        });
        
        return res.status(201).json({
            success: true,
            message: 'Tạo bài đăng thành công. Đang chờ duyệt.',
            ...result,
        });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi tạo bài đăng');
    }
}

async function getRentals(req, res) {
    try {
        const result = await rentalService.getRentals({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 10,
            status: req.query.status,
            owner_id: req.query.owner_id,
            search: req.query.search,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách bài đăng');
    }
}

async function getRentalById(req, res) {
    try {
        const result = await rentalService.getRentalById(req.params.rentalId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy chi tiết bài đăng');
    }
}

async function getMyRentals(req, res) {
    try {
        const result = await rentalService.getMyRentals(req.auth.user.id, {
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 10,
            status: req.query.status,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách bài đăng của bạn');
    }
}

async function getRentalsForModeration(req, res) {
    try {
        const result = await rentalService.getRentalsForModeration({
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50,
            status: req.query.status,
            search: req.query.search,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách bài đăng cho duyệt');
    }
}

async function updateRentalStatus(req, res) {
    try {
        const result = await rentalService.updateRentalStatus(
            req.params.rentalId,
            req.body
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật trạng thái bài đăng');
    }
}

async function getRentalStats(req, res) {
    try {
        const result = await rentalService.getRentalStats();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thống kê bài đăng');
    }
}

async function getPublicRentalById(req, res) {
    try {
        const result = await rentalService.getPublicRentalById(req.params.rentalId);
        return res.json({ success: true, ...result });
    } catch (err) {
        if (err.rentalId) {
            return res.status(parseInt(err.statusCode) || 404).json({
                success: false,
                message: err.message,
                rentalId: err.rentalId,
            });
        }
        return handleError(err, res, 'Lỗi khi lấy chi tiết');
    }
}

async function getPublicRentals(req, res) {
    try {
        const result = await rentalService.getPublicRentals({
            page: req.query.page,
            limit: req.query.limit,
            sort: req.query.sort,
            district: req.query.district,
            city: req.query.city,
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy danh sách');
    }
}

async function getPublicRoomTypes(req, res) {
    try {
        const result = await rentalService.getPublicRoomTypes();
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy loại phòng');
    }
}

async function getLandlordProfile(req, res) {
    try {
        const result = await rentalService.getLandlordProfile(req.params.userId);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy hồ sơ chủ nhà');
    }
}

async function updateRental(req, res) {
    try {
        const result = await rentalService.updateRental(
            req.params.rentalId,
            req.auth.user.id,
            req.body
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi cập nhật bài đăng');
    }
}

async function deleteRental(req, res) {
    try {
        const result = await rentalService.deleteRental(
            req.params.rentalId,
            req.auth.user.id
        );
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi xóa bài đăng');
    }
}

async function getLandlordDashboardStats(req, res) {
    try {
        const result = await rentalService.getLandlordDashboardStats(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy thống kê');
    }
}

async function getLandlordPerformanceMetrics(req, res) {
    try {
        const result = await rentalService.getLandlordPerformanceMetrics(req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy chỉ số hiệu suất');
    }
}

async function getTopSearchedRooms(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const result = await rentalService.getTopSearchedRooms(req.auth.user.id, limit);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy phòng được tìm kiếm nhiều');
    }
}

async function getRentalDocumentsForModeration(req, res) {
    try {
        const { rentalId } = req.params;
        const result = await rentalService.getRentalDocumentsForModeration(rentalId, req.auth.user.id);
        return res.json({ success: true, ...result });
    } catch (err) {
        return handleError(err, res, 'Lỗi khi lấy documents của rental');
    }
}

module.exports = {
    createRental,
    getRentals,
    getRentalById,
    getMyRentals,
    getRentalsForModeration,
    getRentalDocumentsForModeration,
    updateRentalStatus,
    updateRental,
    deleteRental,
    getRentalStats,
    getPublicRentals,
    getPublicRentalById,
    getPublicRoomTypes,
    getLandlordProfile,
    getLandlordDashboardStats,
    getLandlordPerformanceMetrics,
    getTopSearchedRooms,
};
