/**
 * Auto-release stale queue items.
 *
 * Neu moderator claim task nhung khong xu ly trong STALE_MINUTES phut,
 * task se tu dong duoc tra ve OPEN de moderator khac nhan.
 */
const prisma = require('../config/prisma');
const cron = require('node-cron');

const STALE_MINUTES = 60;

async function releaseStaleQueueItems() {
    try {
        const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

        const staleItems = await prisma.moderation_queue.findMany({
            where: {
                status: 'IN_PROGRESS',
                assigned_at: { lt: cutoff },
            },
        });

        if (staleItems.length === 0) return;

        for (const item of staleItems) {
            await prisma.$transaction(async (tx) => {
                await tx.moderation_queue.update({
                    where: { id: item.id },
                    data: {
                        status: 'OPEN',
                        assigned_to: null,
                        assigned_at: null,
                        version: { increment: 1 },
                    },
                });
                await tx.moderator_logs.create({
                    data: {
                        moderator_id: item.assigned_to,
                        target_type: 'QUEUE',
                        target_id: item.id,
                        action: 'RELEASE',
                        previous_status: 'IN_PROGRESS',
                        new_status: 'OPEN',
                        note: 'Auto-release: task qua ' + STALE_MINUTES + ' phut khong xu ly',
                        metadata: {
                            queue_target_type: item.target_type,
                            queue_target_id: item.target_id,
                            queue_category: item.category,
                            auto: true,
                        },
                    },
                });
            });
        }

        // console.log('[Cron] Auto-released ' + staleItems.length + ' stale queue item(s)');
    } catch (err) {
        console.error('[Cron] Error releasing stale queue items:', err.message);
    }
}

function startStaleCron() {
    let running = false;

    // Chạy vào 00:01 mỗi ngày
    cron.schedule('1 0 * * *', async () => {
        if (running) return;
        running = true;
        try {
            await releaseStaleQueueItems();
        } catch (error) {
            console.error('[Cron] releaseStaleQueueItems failed:', error);
        } finally {
            running = false;
        }
    });

    console.log('[Cron] Stale queue auto-release scheduled: 00:01 AM daily');
}

module.exports = { startStaleCron, releaseStaleQueueItems };
