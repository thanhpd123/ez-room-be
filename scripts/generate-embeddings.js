/**
 * Generate text embeddings for all rooms using local model.
 * No API keys needed — runs entirely on your machine.
 *
 * Usage: node scripts/generate-embeddings.js
 *
 * First run downloads the model (~90MB), subsequent runs use cache.
 */

require('dotenv').config();
const prisma = require('../config/prisma');
const { getPassageEmbedding, buildRoomTextForEmbedding, getEmbeddingDims, preloadEmbedding } = require('../utils/embedding');

async function main() {
    const dims = getEmbeddingDims();

    // Pre-load the model
    console.log('Loading embedding model...');
    const ok = await preloadEmbedding();
    if (!ok) {
        console.error('Failed to load embedding model');
        process.exit(1);
    }
    console.log(`Model ready (dim=${dims})\n`);

    // Ensure pgvector extension
    try {
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
        console.log('pgvector extension enabled.');
    } catch (err) {
        console.warn('Could not create vector extension (may already exist):', err.message);
    }

    // Ensure table exists
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS room_text_embeddings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                room_id UUID UNIQUE NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                model TEXT DEFAULT 'LOCAL',
                embedding vector,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        `);
    } catch {
        // Table likely already exists
    }

    // Fetch rooms
    const allRooms = await prisma.rooms.findMany({
        where: {
            status: 'AVAILABLE',
            rentals: { status: 'AVAILABLE' },
        },
        include: {
            rentals: { include: { location: true } },
            roomAmenities: { include: { amenity: true } },
        },
    });

    // Check existing
    const existingRows = await prisma.$queryRawUnsafe(
        'SELECT room_id FROM room_text_embeddings'
    ).catch(() => []);
    const existingIds = new Set(existingRows.map((r) => r.room_id));

    const needsEmbedding = allRooms.filter((r) => !existingIds.has(r.id));

    console.log(`Total available rooms: ${allRooms.length}`);
    console.log(`Already embedded: ${existingIds.size}`);
    console.log(`To process: ${needsEmbedding.length}\n`);

    if (needsEmbedding.length === 0) {
        console.log('All rooms already have embeddings. Done!');
        return;
    }

    let success = 0;
    let failed = 0;

    for (let i = 0; i < needsEmbedding.length; i++) {
        const room = needsEmbedding[i];
        const text = buildRoomTextForEmbedding(room);
        if (!text) {
            console.warn(`  Room ${room.id}: no text to embed, skipping.`);
            failed++;
            continue;
        }

        try {
            const embedding = await getPassageEmbedding(text);
            if (!embedding) {
                console.warn(`  Room ${room.id}: embedding returned null.`);
                failed++;
                continue;
            }

            const vecStr = `[${embedding.join(',')}]`;
            await prisma.$executeRawUnsafe(`
                INSERT INTO room_text_embeddings (room_id, model, embedding, content)
                VALUES ($1::uuid, 'LOCAL', $2::vector, $3)
                ON CONFLICT (room_id)
                DO UPDATE SET embedding = $2::vector, content = $3, model = 'LOCAL', updated_at = now()
            `, room.id, vecStr, text);

            success++;
            const title = room.rentals?.title || room.room_name || room.id;
            console.log(`  [${i + 1}/${needsEmbedding.length}] ${title} — OK`);
        } catch (err) {
            failed++;
            console.error(`  Room ${room.id}: ERROR — ${err.message}`);
        }
    }

    console.log(`\nDone! Success: ${success}, Failed: ${failed}`);
}

main()
    .catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
