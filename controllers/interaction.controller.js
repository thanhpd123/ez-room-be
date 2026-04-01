const { recordInteraction } = require('../services/interaction.service');

/**
 * POST /interactions
 * Body: { roomId, interactionType } where interactionType is one of: view, favorite, contact_landlord, share
 */
async function createInteraction(req, res) {
    try {
        const userId = req.auth?.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Cần đăng nhập' });
        }
        const { roomId, interactionType } = req.body || {};
        if (!roomId) {
            return res.status(400).json({ success: false, message: 'Thiếu roomId' });
        }
        await recordInteraction(userId, roomId, interactionType || 'view');
        return res.json({ success: true, message: 'Đã ghi nhận' });
    } catch (err) {
        console.error('Interaction error:', err);
        return res.status(400).json({
            success: false,
            message: err.message || 'Lỗi ghi nhận tương tác',
        });
    }
}

module.exports = { createInteraction };
