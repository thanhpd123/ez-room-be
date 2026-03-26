/**
 * User–room interaction tracking for learning from behavior.
 * Weights: view=1, favorite=5, contact_landlord=10, share=3
 */

const prisma = require('../config/prisma');

const INTERACTION_WEIGHTS = {
    view: 1,
    favorite: 5,
    contact_landlord: 10,
    share: 3,
};

/**
 * Record a single interaction (idempotent per event; we store each event for counts).
 */
async function recordInteraction(userId, roomId, interactionType) {
    const type = (interactionType || 'view').toLowerCase().replace(/\s+/g, '_');
    if (!Object.prototype.hasOwnProperty.call(INTERACTION_WEIGHTS, type)) {
        throw new Error(`Invalid interaction_type: ${interactionType}. Use: view, favorite, contact_landlord, share`);
    }
    await prisma.userRoomInteraction.create({
        data: {
            userId,
            roomId,
            interaction_type: type,
        },
    });
}

/**
 * Get engagement score (0–100) per room from aggregated interactions.
 * engagementScore = views*1 + favorites*5 + contact_landlord*10 + share*3, then normalized to 0–100.
 */
async function getEngagementScoresByRoom(roomIds) {
    if (!roomIds || roomIds.length === 0) return {};

    const rows = await prisma.userRoomInteraction.groupBy({
        by: ['roomId', 'interaction_type'],
        where: { roomId: { in: roomIds } },
        _count: { id: true },
    });

    const scoreByRoom = {};
    for (const r of rows) {
        const roomId = r.roomId;
        if (!scoreByRoom[roomId]) scoreByRoom[roomId] = 0;
        const w = INTERACTION_WEIGHTS[r.interaction_type] ?? 1;
        scoreByRoom[roomId] += (r._count.id || 0) * w;
    }

    const maxRaw = Math.max(1, ...Object.values(scoreByRoom));
    const normalized = {};
    for (const [roomId, raw] of Object.entries(scoreByRoom)) {
        normalized[roomId] = Math.min(100, Math.round((raw / maxRaw) * 100));
    }
    return normalized;
}

/**
 * Get popularity score (0–100) for ranking: same as engagement but scaled across all rooms in result set.
 */
async function getPopularityScoresForRooms(roomIds) {
    return getEngagementScoresByRoom(roomIds);
}

module.exports = {
    recordInteraction,
    getEngagementScoresByRoom,
    getPopularityScoresForRooms,
    INTERACTION_WEIGHTS,
};
