/**
 * Auto-complete rental periods when end date is reached.
 *
 * Kiểm tra các kỳ thuê với end_date <= hôm nay
 * Cập nhật trạng thái thành COMPLETED
 * Cập nhật phòng về trạng thái AVAILABLE
 */
const prisma = require('../config/prisma');

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Chạy mỗi 5 phút

async function completeExpiredRentalPeriods() {
    try {
        // Use end of today so we catch all rentals ending today
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        // Find all ACTIVE rental periods where endDate <= today
        const expiredRentals = await prisma.roomRentalPeriod.findMany({
            where: {
                status: 'ACTIVE',
                endDate: {
                    lte: endOfToday,
                },
            },
            include: {
                room: {
                    include: {
                        rentals: true,
                    },
                },
                tenant: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                    },
                },
            },
        });

        if (expiredRentals.length === 0) return;

        // Process each expired rental
        for (const rentalPeriod of expiredRentals) {
            try {
                await prisma.$transaction(async (tx) => {
                    // Update rental period status to COMPLETED
                    await tx.roomRentalPeriod.update({
                        where: { id: rentalPeriod.id },
                        data: {
                            status: 'COMPLETED',
                            updatedAt: new Date(),
                        },
                    });

                    // Update room status back to AVAILABLE (only if it's still RENTED)
                    const room = await tx.rooms.findUnique({
                        where: { id: rentalPeriod.roomId },
                        include: {
                            rentalPeriods: {
                                where: {
                                    status: 'ACTIVE',
                                },
                            },
                            rentals: true,
                        },
                    });

                    if (room && room.status === 'RENTED') {
                        // Check if there are other ACTIVE rental periods for this room
                        const hasOtherActivePeriods = room.rentalPeriods.length > 0;

                        if (!hasOtherActivePeriods) {
                            await tx.rooms.update({
                                where: { id: rentalPeriod.roomId },
                                data: {
                                    status: 'AVAILABLE',
                                    updated_at: new Date(),
                                },
                            });
                        }
                    }

                    // Create notification for tenant
                    await tx.notification.create({
                        data: {
                            userId: rentalPeriod.userId,
                            type: 'RENTAL_COMPLETED',
                            title: 'Hợp đồng thuê phòng kết thúc',
                            body: `Hợp đồng thuê phòng của bạn đã hết hạn vào ${rentalPeriod.endDate.toLocaleDateString('vi-VN')}. Vui lòng liên hệ chủ trọ để hoàn tất thủ tục.`,
                            status: 'UNREAD',
                        },
                    });

                    // Create notification for landlord
                    const rental = room.rentals;
                    if (rental && rental.owner_id) {
                        await tx.notification.create({
                            data: {
                                userId: rental.owner_id,
                                type: 'ROOM_AVAILABLE',
                                title: 'Phòng sắp trở lại có sẵn',
                                body: `Kỳ thuê của phòng "${room.room_name || 'Phòng trọ'}" kết thúc vào ${rentalPeriod.endDate.toLocaleDateString('vi-VN')}. Phòng này bây giờ có sẵn để cho thuê.`,
                                status: 'UNREAD',
                            },
                        });
                    }
                });

                console.log(`[Cron] Completed rental period: ${rentalPeriod.id} for room: ${rentalPeriod.roomId}`);
            } catch (err) {
                console.error(`[Cron] Error completing rental period ${rentalPeriod.id}:`, err.message);
            }
        }

        console.log(`[Cron] Checked and completed ${expiredRentals.length} expired rental period(s)`);
    } catch (err) {
        console.error('[Cron] Error in completeExpiredRentalPeriods:', err.message);
    }
}

function startCompleteRentalCron() {
    // Run immediately on startup, then repeat periodically.
    completeExpiredRentalPeriods();
    setInterval(completeExpiredRentalPeriods, CHECK_INTERVAL_MS);

    console.log(
        '[Cron] Rental period auto-completion scheduled: every ' +
        (CHECK_INTERVAL_MS / 60000) +
        ' minute(s)'
    );
}

module.exports = { startCompleteRentalCron, completeExpiredRentalPeriods };
