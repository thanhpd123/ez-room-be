/**
 * Map query amenity params (UUID or display name) to real amenity UUIDs for Prisma filters.
 */
const prisma = require('../config/prisma');

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string[]} rawIds
 * @returns {Promise<string[]>}
 */
async function resolveAmenityIds(rawIds) {
    if (!rawIds || !rawIds.length) return [];
    const asUuid = [];
    const asName = [];
    for (const id of rawIds) {
        const s = String(id).trim();
        if (!s) continue;
        if (UUID_RE.test(s)) asUuid.push(s);
        else asName.push(s);
    }
    if (asName.length === 0) return asUuid;

    const rows = await prisma.amenities.findMany({
        where: {
            OR: asName.map((n) => ({ name: { equals: n, mode: 'insensitive' } })),
        },
        select: { id: true },
    });
    return [...new Set([...asUuid, ...rows.map((r) => r.id)])];
}

module.exports = { resolveAmenityIds };
