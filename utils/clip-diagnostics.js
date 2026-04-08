/**
 * CLIP + pgvector health checks for "search by image" debugging.
 * See GET /search/clip-diagnostics and scripts/diagnose-clip.js
 */

const { getClipImageEmbedding, preloadCLIP, CLIP_DIMS, CLIP_MODEL, getClipModelLabel } = require('./clip');

/** Minimal valid PNG (1×1 px) — exercises ONNX vision path without a user upload */
const MINI_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

/**
 * Run all checks. Safe to call from API (authenticated) or CLI.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ skipDb?: boolean }} options
 */
async function runClipDiagnostics(prisma, options = {}) {
    const skipDb = !!options.skipDb;
    const interpret = [];

    const onnxClipVision = {
        ok: false,
        error: null,
        dimensions: null,
        l2Norm: null,
        ms: null,
    };

    const t0 = Date.now();
    let emb = null;
    try {
        await preloadCLIP();
        emb = await getClipImageEmbedding(MINI_PNG);
        onnxClipVision.ms = Date.now() - t0;
        if (emb && emb.length) {
            onnxClipVision.ok = true;
            onnxClipVision.dimensions = emb.length;
            const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
            onnxClipVision.l2Norm = Math.round(norm * 10000) / 10000;
            if (Math.abs(norm - 1) > 0.01) {
                interpret.push('Embedding L2 norm should be ~1 after normalize; unexpected if far off.');
            }
            if (emb.length !== CLIP_DIMS) {
                interpret.push(`Expected ${CLIP_DIMS} dimensions (${getClipModelLabel()}), got ${emb.length}.`);
            }
        } else {
            onnxClipVision.error = 'getClipImageEmbedding returned null';
            interpret.push(
                'ONNX CLIP vision failed — check server logs, Node 18+ (Blob), disk space for ~/.cache or node_modules/@huggingface/transformers/.cache'
            );
        }
    } catch (e) {
        onnxClipVision.error = e.message;
        onnxClipVision.ms = Date.now() - t0;
        interpret.push(`CLIP vision error: ${e.message}`);
    }

    const pgvector = { extensionInstalled: null, error: null, skipped: skipDb };
    if (!skipDb) {
        try {
            const rows = await prisma.$queryRawUnsafe(`
                SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS e
            `);
            pgvector.extensionInstalled = !!rows[0]?.e;
            if (!pgvector.extensionInstalled) {
                interpret.push("PostgreSQL extension 'vector' not installed — run: CREATE EXTENSION vector;");
            }
        } catch (e) {
            pgvector.error = e.message;
            interpret.push(`Could not check pgvector: ${e.message}`);
        }
    } else {
        interpret.push('DB/pgvector checks skipped (clip-only diagnostics mode).');
    }

    const clipVectorsTable = { rowCount: null, roomImageCount: null, error: null, skipped: skipDb };
    if (!skipDb) {
        try {
            const [cv, ri] = await Promise.all([
                prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM clip_vectors`),
                prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM room_images`),
            ]);
            clipVectorsTable.rowCount = Number(cv[0]?.c ?? 0);
            clipVectorsTable.roomImageCount = Number(ri[0]?.c ?? 0);
            if (clipVectorsTable.rowCount === 0 && clipVectorsTable.roomImageCount > 0) {
                interpret.push('room_images exist but clip_vectors is empty — run: node scripts/generate-clip-embeddings.js');
            }
            if (clipVectorsTable.roomImageCount === 0) {
                interpret.push('No rows in room_images — add room photos first, then generate CLIP vectors.');
            }
        } catch (e) {
            clipVectorsTable.error = e.message;
            interpret.push(`clip_vectors / room_images count failed: ${e.message}`);
        }
    }

    const vectorQuery = {
        ok: false,
        error: null,
        /** Best cosine similarity (0–1) from DB for the tiny test PNG vs stored vectors */
        topSimilarity: null,
        sampleRoomIds: [],
        skipped: skipDb,
    };

    if (!skipDb && emb && emb.length && clipVectorsTable.rowCount > 0) {
        try {
            const vecStr = `[${emb.join(',')}]`;
            const clipRows = await prisma.$queryRawUnsafe(
                `
                SELECT ri.room_id::text AS room_id,
                       1 - (cv.embedding::vector <=> '${vecStr}'::vector) AS similarity
                FROM clip_vectors cv
                JOIN room_images ri ON ri.id = cv.room_image_id
                ORDER BY cv.embedding::vector <=> '${vecStr}'::vector
                LIMIT 5
            `
            );
            vectorQuery.ok = true;
            if (clipRows.length) {
                vectorQuery.topSimilarity = Math.round(Number(clipRows[0].similarity) * 10000) / 10000;
                vectorQuery.sampleRoomIds = clipRows.map((r) => r.room_id).filter(Boolean);
                if (vectorQuery.topSimilarity < 0.15) {
                    interpret.push(
                        'Top similarity for random 1×1 PNG is expected to be low. For a real room photo matching your DB, expect higher scores (often 0.25–0.6+ for decent matches).'
                    );
                }
            }
        } catch (e) {
            vectorQuery.error = e.message;
            interpret.push(
                `Vector similarity query failed (wrong vector dimension in DB vs 512?, or type mismatch): ${e.message}`
            );
        }
    }

    const effectiveness = {
        metric: 'cosine similarity via pgvector: 1 - (embedding <=> query)',
        scale: '0 = unrelated, 1 = identical direction in CLIP space',
        roughGuide: [
            'Same / very similar scene: often ~0.35–0.7+',
            'Loosely related (e.g. both bedrooms): ~0.2–0.4',
            'Unrelated content: often below 0.2',
            'Scores depend on your image set and query image; tune by inspecting top results.',
        ],
        note: 'CLIP is semantic/visual — not pixel matching. Effectiveness = quality of room photos + coverage in clip_vectors.',
    };

    const healthy = skipDb
        ? onnxClipVision.ok
        : onnxClipVision.ok && pgvector.extensionInstalled && clipVectorsTable.rowCount > 0 && vectorQuery.ok;

    return {
        healthy,
        dbChecksSkipped: skipDb,
        model: `${CLIP_MODEL} (ONNX via @huggingface/transformers)`,
        modelLabel: getClipModelLabel(),
        expectedEmbeddingDimensions: CLIP_DIMS,
        onnxClipVision,
        pgvector,
        clipVectorsTable,
        vectorQuery,
        effectiveness,
        interpret: [...new Set(interpret)],
    };
}

module.exports = {
    runClipDiagnostics,
    MINI_PNG,
};
