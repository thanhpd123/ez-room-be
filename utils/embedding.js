/**
 * Text embedding utility — runs locally via Transformers.js.
 * No API keys needed. Model downloads on first use (cached after).
 * On corrupt cache (e.g. Protobuf parsing failed), cache is cleared and load retried once.
 *
 * Default: Xenova/multilingual-e5-base (quantized ONNX, multilingual incl. Vietnamese) — stronger than e5-small.
 * Override: TEXT_EMBEDDING_MODEL, TEXT_EMBEDDING_DIMS (must match model output, e.g. small=384, base=768).
 * After changing model/dimensions, truncate or delete room_text_embeddings and re-run scripts/generate-embeddings.js.
 */

const path = require('path');
const fs = require('fs');

const LOCAL_MODEL = (process.env.TEXT_EMBEDDING_MODEL || 'Xenova/multilingual-e5-base').trim();
const LOCAL_DIMS = Math.max(1, parseInt(process.env.TEXT_EMBEDDING_DIMS || '768', 10) || 768);

let extractor = null;
let loadingPromise = null;

function getEmbeddingCachePath() {
    const parts = LOCAL_MODEL.split('/').filter(Boolean);
    return path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', '.cache', ...parts);
}

function clearEmbeddingCache() {
    const cacheDir = getEmbeddingCachePath();
    try {
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true });
            console.log('[Embedding] Cleared corrupt cache, will re-download on next load.');
        }
    } catch (e) {
        console.warn('[Embedding] Could not clear cache:', e.message);
    }
}

function isCorruptCacheError(err) {
    const msg = (err && err.message) || '';
    return /Protobuf parsing failed|failed to load|parse.*onnx/i.test(msg);
}

async function loadModel() {
    if (extractor) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        const { pipeline } = await import('@huggingface/transformers');
        console.log(`[Embedding] Loading model ${LOCAL_MODEL} (first run may download ~100–500MB depending on model)...`);
        try {
            extractor = await pipeline('feature-extraction', LOCAL_MODEL);
            console.log(`[Embedding] Model loaded (dim=${LOCAL_DIMS})`);
        } catch (err) {
            if (isCorruptCacheError(err)) {
                loadingPromise = null;
                clearEmbeddingCache();
                extractor = await pipeline('feature-extraction', LOCAL_MODEL);
                console.log(`[Embedding] Model loaded after cache clear (dim=${LOCAL_DIMS})`);
            } else {
                throw err;
            }
        }
    })();

    return loadingPromise;
}

/**
 * Always available — no API keys required.
 */
function isEmbeddingAvailable() {
    return true;
}

function getProvider() {
    return 'local';
}

function getEmbeddingDims() {
    return LOCAL_DIMS;
}

/**
 * Generate text embedding. Returns number[] or null.
 */
async function getTextEmbedding(text) {
    const clean = (text || '').trim();
    if (!clean) return null;

    try {
        await loadModel();

        // multilingual-e5 expects "query: ..." or "passage: ..." prefix
        const input = `query: ${clean.slice(0, 5000)}`;
        const output = await extractor(input, { pooling: 'mean', normalize: true });

        const arr = Array.from(output.data);
        if (arr.length !== LOCAL_DIMS) {
            console.warn(
                `[Embedding] Got ${arr.length} dims, expected ${LOCAL_DIMS} — fix TEXT_EMBEDDING_DIMS for ${LOCAL_MODEL}`
            );
        }
        return arr;
    } catch (err) {
        console.error('[Embedding] Error:', err.message);
        return null;
    }
}

/**
 * Generate embedding for a "passage" (room description stored in DB).
 * Uses "passage:" prefix for better retrieval quality.
 */
async function getPassageEmbedding(text) {
    const clean = (text || '').trim();
    if (!clean) return null;

    try {
        await loadModel();
        const input = `passage: ${clean.slice(0, 5000)}`;
        const output = await extractor(input, { pooling: 'mean', normalize: true });
        const arr = Array.from(output.data);
        if (arr.length !== LOCAL_DIMS) {
            console.warn(
                `[Embedding] Got ${arr.length} dims, expected ${LOCAL_DIMS} — fix TEXT_EMBEDDING_DIMS for ${LOCAL_MODEL}`
            );
        }
        return arr;
    } catch (err) {
        console.error('[Embedding] Passage error:', err.message);
        return null;
    }
}

/**
 * Build a rich text blob from room + rental data for embedding.
 */
function buildRoomTextForEmbedding(room) {
    const parts = [];
    const rental = room.rentals || room.rental;

    if (rental?.title) parts.push(rental.title);
    if (rental?.description) parts.push(rental.description);
    if (room.room_name) parts.push(`Phòng: ${room.room_name}`);
    if (room.description) parts.push(room.description);
    if (room.room_type) parts.push(`Loại: ${room.room_type}`);
    if (room.price) parts.push(`Giá: ${Number(room.price).toLocaleString('vi-VN')} VNĐ/tháng`);
    if (room.size_m2) parts.push(`Diện tích: ${room.size_m2} m²`);

    const loc = rental?.location;
    if (loc) {
        const locParts = [loc.address, loc.district, loc.city].filter(Boolean);
        if (locParts.length) parts.push(`Địa chỉ: ${locParts.join(', ')}`);
    }

    const amenities = (room.roomAmenities || []).map((ra) => ra.amenity?.name || ra.name).filter(Boolean);
    if (amenities.length) parts.push(`Tiện nghi: ${amenities.join(', ')}`);

    return parts.join('. ');
}

/**
 * Pre-load the embedding model (call at server startup).
 */
async function preloadEmbedding() {
    try {
        await loadModel();
        return true;
    } catch (err) {
        console.error('[Embedding] Preload failed:', err.message);
        return false;
    }
}

module.exports = {
    getTextEmbedding,
    getPassageEmbedding,
    buildRoomTextForEmbedding,
    isEmbeddingAvailable,
    getEmbeddingDims,
    getProvider,
    preloadEmbedding,
    LOCAL_MODEL,
};
