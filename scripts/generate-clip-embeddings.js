/**
 * Pre-generate CLIP embeddings for all room images.
 * Uses the built-in Transformers.js CLIP model — no Python service needed.
 *
 * Usage: node scripts/generate-clip-embeddings.js
 *
 * First run downloads the CLIP model (~350MB), subsequent runs use cached model.
 */

require('dotenv').config();
const prisma = require('../config/prisma');
const axios = require('axios');
const { getClipImageEmbedding, preloadCLIP, CLIP_DIMS } = require('../utils/clip');

async function main() {
    // Pre-load the model once
    console.log('Loading CLIP model...');
    const ok = await preloadCLIP();
    if (!ok) {
        console.error('Failed to load CLIP model');
        process.exit(1);
    }
    console.log(`CLIP model ready (dim=${CLIP_DIMS})`);

    // Ensure pgvector extension
    try {
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
        console.log('pgvector extension ready');
    } catch (e) {
        console.warn('Could not create vector extension (may already exist):', e.message);
    }

    // Fetch all room images
    const images = await prisma.roomImage.findMany({
        select: { id: true, imageUrl: true, roomId: true },
    });
    console.log(`Found ${images.length} room images`);

    // Check which already have CLIP vectors
    const existing = await prisma.clipVector.findMany({
        select: { room_image_id: true },
    });
    const existingSet = new Set(existing.map((e) => e.room_image_id));
    const toProcess = images.filter((img) => !existingSet.has(img.id));
    console.log(`${existingSet.size} already embedded, ${toProcess.length} to process\n`);

    if (toProcess.length === 0) {
        console.log('All images already have CLIP embeddings. Done!');
        await prisma.$disconnect();
        return;
    }

    let success = 0;
    let failed = 0;

    for (let i = 0; i < toProcess.length; i++) {
        const img = toProcess[i];
        const pct = `[${i + 1}/${toProcess.length}]`;

        try {
            // Download the image
            const imgResponse = await axios.get(img.imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
            });
            const buffer = Buffer.from(imgResponse.data);

            // Generate CLIP embedding
            const embedding = await getClipImageEmbedding(buffer);
            if (!embedding || embedding.length === 0) {
                console.warn(`${pct} No embedding returned for image ${img.id}`);
                failed++;
                continue;
            }

            // Insert into clip_vectors using raw SQL (pgvector)
            const vecStr = `[${embedding.join(',')}]`;
            await prisma.$executeRawUnsafe(`
                INSERT INTO clip_vectors (id, room_image_id, model, embedding, created_at)
                VALUES (gen_random_uuid(), $1::uuid, 'CLIP', $2::vector, NOW())
                ON CONFLICT DO NOTHING
            `, img.id, vecStr);

            success++;
            console.log(`${pct} OK: image ${img.id} (room ${img.roomId}) | dim=${embedding.length}`);
        } catch (e) {
            failed++;
            console.error(`${pct} FAIL: image ${img.id} | ${e.message}`);
        }
    }

    console.log(`\nDone! Success: ${success}, Failed: ${failed}, Skipped: ${existingSet.size}`);
    await prisma.$disconnect();
}

main().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
});
