const express = require('express');
const multer = require('multer');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    uploadDocument,
    getDocumentUrl,
    verifyDocument,
    getDocumentLogs,
} = require('../controllers/document.controller');

const router = express.Router();

// Multer config - memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        // Only images and PDFs
        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, WebP, PDF allowed.'));
        }
    }
});

/**
 * POST /documents/upload
 * Landlord upload documents
 * Protected: LANDLORD only
 */
router.post('/upload', verifyJWT, requireRole('LANDLORD'), upload.single('file'), uploadDocument);

/**
 * GET /documents/:docId/url
 * Get signed URL for viewing document
 * Protected: Owner or ADMIN/MODERATOR
 */
router.get('/:docId/url', verifyJWT, getDocumentUrl);

/**
 * PATCH /documents/:docId/verify
 * Verify document (approve/reject)
 * Protected: ADMIN/MODERATOR only
 * Body: { approved: boolean, rejectionReason?: string }
 */
router.patch('/:docId/verify', verifyJWT, requireRole('ADMIN', 'MODERATOR'), verifyDocument);

/**
 * GET /documents/:docId/logs
 * View audit logs for document access
 * Protected: ADMIN/MODERATOR only
 */
router.get('/:docId/logs', verifyJWT, requireRole('ADMIN', 'MODERATOR'), getDocumentLogs);

module.exports = router;
