/**
 * CLIP embedding utility — runs directly in Node.js via Transformers.js.
 * No Python, no separate service needed.
 * On corrupt cache (e.g. Protobuf parsing failed), cache is cleared and load retried once.
 *
 * Model: Xenova/clip-vit-base-patch32 (ONNX, ~350MB, downloaded on first use)
 * Output: 512-dim normalized embedding vector
 */

const path = require('path');
const fs = require('fs');

const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
const CLIP_DIMS = 512;

let processor = null;
let model = null;
let textModel = null;
let textProcessor = null;
let loadingPromise = null;
let textLoadingPromise = null;

function getClipCachePath() {
    return path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', '.cache', 'Xenova', 'clip-vit-base-patch32');
}

function clearClipCache() {
    const cacheDir = getClipCachePath();
    try {
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true });
            console.log('[CLIP] Cleared corrupt cache, will re-download on next load.');
        }
    } catch (e) {
        console.warn('[CLIP] Could not clear cache:', e.message);
    }
}

function isCorruptCacheError(err) {
    const msg = (err && err.message) || '';
    return /Protobuf parsing failed|failed to load|parse.*onnx/i.test(msg);
}

async function loadCLIP() {
    if (model && processor) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        const { AutoProcessor, CLIPVisionModelWithProjection, RawImage } = await import('@huggingface/transformers');
        console.log('[CLIP] Loading vision model (first run downloads ~350MB)...');
        try {
            processor = await AutoProcessor.from_pretrained(CLIP_MODEL);
            model = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL);
            console.log('[CLIP] Vision model loaded successfully');
        } catch (err) {
            if (isCorruptCacheError(err)) {
                loadingPromise = null;
                clearClipCache();
                processor = await AutoProcessor.from_pretrained(CLIP_MODEL);
                model = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL);
                console.log('[CLIP] Vision model loaded after cache clear');
            } else {
                throw err;
            }
        }
    })();

    return loadingPromise;
}

async function loadCLIPText() {
    if (textModel && textProcessor) return;
    if (textLoadingPromise) return textLoadingPromise;

    textLoadingPromise = (async () => {
        const { AutoTokenizer, CLIPTextModelWithProjection } = await import('@huggingface/transformers');
        console.log('[CLIP] Loading text model...');
        try {
            textProcessor = await AutoTokenizer.from_pretrained(CLIP_MODEL);
            textModel = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL);
            console.log('[CLIP] Text model loaded successfully');
        } catch (err) {
            if (isCorruptCacheError(err)) {
                textLoadingPromise = null;
                clearClipCache();
                textProcessor = await AutoTokenizer.from_pretrained(CLIP_MODEL);
                textModel = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL);
                console.log('[CLIP] Text model loaded after cache clear');
            } else {
                throw err;
            }
        }
    })();

    return textLoadingPromise;
}

/**
 * Generate a CLIP image embedding from a Buffer.
 * @param {Buffer} imageBuffer - Raw image bytes (JPEG, PNG, etc.)
 * @returns {Promise<number[]|null>} 512-dim normalized embedding vector, or null on failure
 */
async function getClipImageEmbedding(imageBuffer) {
    try {
        await loadCLIP();

        const { RawImage } = await import('@huggingface/transformers');
        const BlobCtor = globalThis.Blob || require('buffer').Blob;
        const image = await RawImage.fromBlob(new BlobCtor([imageBuffer]));
        const inputs = await processor(image);
        const output = await model(inputs);

        // output.image_embeds is a Tensor of shape [1, 512]
        const embedding = Array.from(output.image_embeds.data);

        // L2 normalize
        const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
        if (norm > 0) {
            for (let i = 0; i < embedding.length; i++) {
                embedding[i] /= norm;
            }
        }

        return embedding;
    } catch (err) {
        console.error('[CLIP] Embedding error:', err.message);
        return null;
    }
}

/**
 * Generate CLIP text embedding for text→image search.
 * Same 512-dim space as image embeddings; compare with clip_vectors for "search by visual description".
 * @param {string} text - e.g. "phòng có cửa sổ lớn"
 * @returns {Promise<number[]|null>} 512-dim normalized vector or null
 */
async function getClipTextEmbedding(text) {
    const clean = (text || '').trim();
    if (!clean) return null;
    try {
        await loadCLIPText();
        const inputs = textProcessor(clean.slice(0, 500), { padding: true, truncation: true });
        const output = await textModel(inputs);
        const embedding = Array.from(output.text_embeds.data);
        const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
        if (norm > 0) {
            for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;
        }
        return embedding;
    } catch (err) {
        console.error('[CLIP] Text embedding error:', err.message);
        return null;
    }
}

/**
 * Check if CLIP is available (always true since it's built-in).
 */
function isClipAvailable() {
    return true;
}

/**
 * Pre-load the CLIP model (call at server startup for faster first request).
 */
async function preloadCLIP() {
    try {
        await loadCLIP();
        return true;
    } catch (err) {
        console.error('[CLIP] Preload failed:', err.message);
        return false;
    }
}

module.exports = {
    getClipImageEmbedding,
    getClipTextEmbedding,
    isClipAvailable,
    preloadCLIP,
    CLIP_DIMS,
};
