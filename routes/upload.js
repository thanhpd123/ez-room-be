const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { verifyJWT } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');
const supabase = require('../config/supabase');
const { isSupabaseConfigured } = require('../config/supabase-helpers');

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
 * @openapi
 * /upload/image:
 *   post:
 *     tags: [Upload]
 *     summary: Tải ảnh lên Cloudinary
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: { success: true, url: string }
 *       400:
 *         description: Không có file ảnh
 */
router.post('/image', verifyJWT, upload.single('file'), (req, res) => {
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
            try {
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
            } catch (callbackErr) {
                console.error('Cloudinary callback error:', callbackErr);
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: 'Lỗi xử lý kết quả tải ảnh',
                    });
                }
            }
        }
    );

    uploadStream.end(req.file.buffer);
});

/**
 * @openapi
 * /upload/rental-image:
 *   post:
 *     tags: [Upload]
 *     summary: Tải ảnh rental lên Supabase Storage
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: { success: true, url: string }
 *       400:
 *         description: Không có file ảnh
 */
router.post('/rental-image', verifyJWT, upload.single('file'), async (req, res) => {
    try {
        if (!isSupabaseConfigured() || !supabase) {
            return res.status(503).json({
                success: false,
                message: 'Chưa cấu hình Supabase Storage. Thêm SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY vào .env',
            });
        }
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'Không có file ảnh. Gửi với field name "file".',
            });
        }

        const ext = req.file.originalname.split('.').pop() || 'jpg';
        const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const filePath = `rentals/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('rental-images')
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false,
            });

        if (uploadError) {
            console.error('Supabase Storage upload error:', uploadError);
            return res.status(500).json({
                success: false,
                message: 'Tải ảnh lên Supabase thất bại',
                error: uploadError.message,
            });
        }

        const { data: publicData } = supabase.storage
            .from('rental-images')
            .getPublicUrl(filePath);

        return res.json({
            success: true,
            url: publicData.publicUrl,
        });
    } catch (err) {
        console.error('Upload rental image error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tải ảnh lên',
            error: err.message,
        });
    }
});

module.exports = router;
