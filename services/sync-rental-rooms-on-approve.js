const prisma = require('../config/prisma');

/**
 * When a rental is set to AVAILABLE (approved / published), promote rooms that are
 * still PENDING so they appear in search. Does not change MAINTENANCE (rejected),
 * RENTED, or rooms already AVAILABLE.
 *
 * @param {string} rentalId
 * @param {import('@prisma/client').Prisma.TransactionClient | null} [tx] - pass `tx` inside `$transaction`
 * @returns {Promise<{ count: number }>}
 */
async function publishPendingRoomsWhenRentalAvailable(rentalId, tx = null) {
    const db = tx ?? prisma;
    return db.rooms.updateMany({
        where: {
            rental_id: rentalId,
            status: 'PENDING',
        },
        data: { status: 'AVAILABLE' },
    });
}

module.exports = {
    publishPendingRoomsWhenRentalAvailable,
};
