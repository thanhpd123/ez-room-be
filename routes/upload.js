const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype);
        if (allowed) cb(null, true);
        else cb(new Error('Chỉ chấp nhận ảnh: JPEG, PNG, GIF, WebP'), false);
    },
});

/**
 * POST /upload/image
 * multipart/form-data, field name: "file"
 * Returns: { success: true, url: string } (Cloudinary secure_url)
 */
router.post('/image', requireAuth, upload.single('file'), (req, res) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(503).json({
            success: false,
            message: 'Chưa cấu hình Cloudinary. Thêm CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET vào .env',
        });
    }
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({
            success: false,
            message: 'Không có file ảnh. Gửi với field name "file".',
        });
    }

    const folder = process.env.CLOUDINARY_FOLDER || 'ezroom';

    const uploadStream = cloudinary.uploader.upload_stream(
        {
            folder,
            resource_type: 'image',
        },
        (err, result) => {
            if (err) {
                console.error('Cloudinary upload error:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Tải ảnh lên thất bại',
                    error: err.message,
                });
            }
            res.json({
                success: true,
                url: result.secure_url,
            });
        }
    );

    uploadStream.end(req.file.buffer);
});

module.exports = router;
