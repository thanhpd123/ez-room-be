const prisma = require('../config/prisma');
(async () => {
    try {
        // Find a real userId that has sent or received messages
        const msg = await prisma.message.findFirst({
            select: { senderId: true }
        });
        if (!msg) { console.log('No messages in DB'); return; }

        const userId = msg.senderId;
        console.log('Testing getConversations for userId:', userId);

        const rows = await prisma.$queryRawUnsafe(`
            WITH pairs AS (
                SELECT
                    CASE WHEN sender_id = '${userId}'::uuid THEN receiver_id ELSE sender_id END AS peer_id,
                    id, content, created_at, sender_id, status
                FROM messages
                WHERE sender_id = '${userId}'::uuid OR receiver_id = '${userId}'::uuid
            ),
            latest AS (
                SELECT DISTINCT ON (peer_id)
                    peer_id, id, content, created_at,
                    (sender_id = '${userId}'::uuid) AS is_from_me
                FROM pairs
                ORDER BY peer_id, created_at DESC
            ),
            unread AS (
                SELECT sender_id AS peer_id, COUNT(*)::int AS cnt
                FROM messages
                WHERE receiver_id = '${userId}'::uuid AND status::text <> 'READ'
                GROUP BY sender_id
            )
            SELECT l.peer_id::text, l.id::text, l.content, l.created_at, l.is_from_me,
                   COALESCE(u.cnt, 0) AS unread_count
            FROM latest l
            LEFT JOIN unread u ON u.peer_id = l.peer_id
            ORDER BY l.created_at DESC
        `);

        console.log('OK! Conversations found:', rows.length);
        if (rows[0]) console.log('Sample row:', JSON.stringify(rows[0], null, 2));
    } catch (e) {
        console.error('FAILED:', e.message);
    } finally {
        await prisma.$disconnect();
    }
})();
