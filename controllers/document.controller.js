const prisma = require('../config/prisma');
const supabase = require('../config/supabase');

/**
 * POST /documents/upload
 * Landlord upload documents (CCCD, sổ đỏ, GPKD, hợp đồng)
 */
async function uploadDocument(req, res) {
    try {
        const { rentalId, documentType } = req.body;
        const landlordId = req.auth.user.id;
        
        // Verify rental ownership
        const rental = await prisma.rental.findUnique({
            where: { id: rentalId }
        });
        
        if (!rental || rental.owner_id !== landlordId) {
            return res.status(403).json({ error: 'Unauthorized: Not rental owner' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }
        
        // Upload to Supabase private bucket
        const fileName = `${rentalId}/${documentType}/${Date.now()}_${req.file.originalname}`;
        
        const { data, error: uploadError } = await supabase.storage
            .from('rental-documents')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                cacheControl: '0', // No caching
            });
        
        if (uploadError) {
            console.error('Supabase upload error:', uploadError);
            return res.status(500).json({ error: 'File upload failed' });
        }
        
        // Save document record
        const document = await prisma.rental_documents.create({
            data: {
                rental_id: rentalId,
                document_type: documentType,
                image_url: data.path, // Store path, not full URL
                status: 'PENDING', // Waiting for admin verification
            }
        });
        
        // Log access
        await prisma.document_access_log.create({
            data: {
                document_id: document.id,
                user_id: landlordId,
                action: 'UPLOAD',
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
            }
        });
        
        return res.status(201).json({
            success: true,
            message: 'Document uploaded successfully. Waiting for admin verification.',
            data: {
                id: document.id,
                documentType: document.document_type,
                status: document.status,
                uploadedAt: document.created_at,
            }
        });
    } catch (err) {
        console.error('Upload document error:', err);
        return res.status(500).json({
            success: false,
            error: 'Failed to upload document',
            message: err.message
        });
    }
}

/**
 * GET /documents/:docId/url
 * Get signed URL for viewing/downloading document
 * Only rental owner or admin can access
 */
async function getDocumentUrl(req, res) {
    try {
        const { docId } = req.params;
        const userId = req.auth.user.id;
        const userRole = req.auth.user.role;
        
        const document = await prisma.rental_documents.findUnique({
            where: { id: docId },
            include: { rentals: true }
        });
        
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        
        // Check authorization: owner or admin
        const isOwner = document.rentals.owner_id === userId;
        const isAdmin = userRole === 'ADMIN' || userRole === 'MODERATOR';
        
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        
        // Generate signed URL (expires in 1 hour)
        const { data, error: signError } = await supabase.storage
            .from('rental-documents')
            .createSignedUrl(document.image_url, 3600); // 1 hour
        
        if (signError) {
            console.error('Signed URL error:', signError);
            return res.status(500).json({ error: 'Failed to generate URL' });
        }
        
        // Log access
        await prisma.document_access_log.create({
            data: {
                document_id: docId,
                user_id: userId,
                action: 'VIEW',
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
            }
        });
        
        return res.json({
            success: true,
            data: {
                signedUrl: data.signedUrl,
                expiresIn: 3600, // seconds
                documentType: document.document_type,
                status: document.status,
            }
        });
    } catch (err) {
        console.error('Get document URL error:', err);
        return res.status(500).json({
            success: false,
            error: 'Failed to get document URL',
            message: err.message
        });
    }
}

/**
 * PATCH /documents/:docId/verify
 * Admin/Moderator verify document (VERIFIED or REJECTED)
 */
async function verifyDocument(req, res) {
    try {
        const { docId } = req.params;
        const { approved, rejectionReason } = req.body;
        const adminId = req.auth.user.id;
        
        const document = await prisma.rental_documents.findUnique({
            where: { id: docId }
        });
        
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        
        if (document.status !== 'PENDING') {
            return res.status(400).json({ 
                error: `Document already ${document.status.toLowerCase()}` 
            });
        }
        
        // Update document status
        const updated = await prisma.rental_documents.update({
            where: { id: docId },
            data: {
                status: approved ? 'VERIFIED' : 'REJECTED',
                verified_by: adminId,
                verified_at: new Date(),
                rejection_reason: rejectionReason || null,
            }
        });
        
        // Log verification
        await prisma.document_access_log.create({
            data: {
                document_id: docId,
                user_id: adminId,
                action: approved ? 'VERIFY' : 'REJECT',
                reason: rejectionReason || null,
                ip_address: req.ip,
                user_agent: req.get('user-agent'),
            }
        });
        
        return res.json({
            success: true,
            message: approved ? 'Document verified' : 'Document rejected',
            data: {
                id: updated.id,
                status: updated.status,
                verifiedAt: updated.verified_at,
                rejectionReason: updated.rejection_reason,
            }
        });
    } catch (err) {
        console.error('Verify document error:', err);
        return res.status(500).json({
            success: false,
            error: 'Failed to verify document',
            message: err.message
        });
    }
}

/**
 * GET /documents/:docId/logs
 * View audit logs - who accessed this document and when
 * Only admin/moderator can view
 */
async function getDocumentLogs(req, res) {
    try {
        const { docId } = req.params;
        
        const logs = await prisma.document_access_log.findMany({
            where: { document_id: docId },
            include: {
                user: {
                    select: { id: true, fullName: true, email: true, role: true }
                }
            },
            orderBy: { accessed_at: 'desc' },
            take: 100
        });
        
        return res.json({
            success: true,
            data: logs.map(log => ({
                id: log.id,
                action: log.action,
                user: log.user,
                timestamp: log.accessed_at,
                ipAddress: log.ip_address,
                reason: log.reason,
            }))
        });
    } catch (err) {
        console.error('Get document logs error:', err);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch logs',
            message: err.message
        });
    }
}

module.exports = {
    uploadDocument,
    getDocumentUrl,
    verifyDocument,
    getDocumentLogs,
};
