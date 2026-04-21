/**
 * Text embedding utility — runs via Hugging Face Inference API.
 * Replaces Xenova/transformers local model to save RAM and prevent 503 errors.
 */

const axios = require('axios');

// Using the original Hugging Face model instead of Xenova's port
const LOCAL_MODEL = (process.env.TEXT_EMBEDDING_MODEL || 'intfloat/multilingual-e5-base').trim();
const LOCAL_DIMS = Math.max(1, parseInt(process.env.TEXT_EMBEDDING_DIMS || '768', 10) || 768);

/**
 * Generate text embedding via Hugging Face API
 * Output format: [number, number, ...] with length = LOCAL_DIMS
 */
async function getEmbedding(text) {
    const HF_TOKEN = process.env.HUGGING_FACE_TOKEN;
    if (!HF_TOKEN) {
        console.warn(`[Embedding] HUGGING_FACE_TOKEN is not set in .env! Cannot fetch embeddings.`);
        return null;
    }

    const clean = (text || '').trim();
    if (!clean) return null;

    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/pipeline/feature-extraction/${LOCAL_MODEL}`,
            { inputs: clean.slice(0, 5000) },
            {
                headers: {
                    'Authorization': `Bearer ${HF_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000 // 15 seconds timeout to prevent hanging the server
            }
        );

        let data = response.data;

        // Hugging Face feature-extraction returns data differently depending on the model pipeline.
        if (Array.isArray(data) && Array.isArray(data[0])) {
            if (Array.isArray(data[0][0])) {
                // Return shape: [[[vec1], [vec2], ...]] (3D -> token embeddings)
                data = data[0];
            }
            // Mean pool it across sequence
            const seqLen = data.length;
            const dim = data[0].length;
            const pooled = new Array(dim).fill(0);
            for (let i = 0; i < seqLen; i++) {
                for (let j = 0; j < dim; j++) {
                    pooled[j] += data[i][j];
                }
            }
            // divide by sequence length
            for (let j = 0; j < dim; j++) {
                pooled[j] /= seqLen;
            }
            data = pooled;
        } else if (!Array.isArray(data)) {
            console.error('[Embedding] Unexpected HF response format:', typeof data);
            return null; // Return null gracefully
        }

        // L2 Normalize
        const arr = Array.from(data);
        const magnitude = Math.sqrt(arr.reduce((sum, val) => sum + val * val, 0));
        const normalized = magnitude > 0 ? arr.map(val => val / magnitude) : arr;

        if (normalized.length !== LOCAL_DIMS) {
            console.warn(`[Embedding] Got ${normalized.length} dims, expected ${LOCAL_DIMS}.`);
        }

        return normalized;
    } catch (err) {
        console.error('[Embedding] Hugging Face API Error:', err.response ? JSON.stringify(err.response.data) : err.message);
        // Fallback: return null so server logic can gracefully degrade instead of crashing
        return null;
    }
}

function isEmbeddingAvailable() {
    return !!process.env.HUGGING_FACE_TOKEN;
}

function getProvider() {
    return 'huggingface-api';
}

function getEmbeddingDims() {
    return LOCAL_DIMS;
}

async function getTextEmbedding(text) {
    if (!text) return null;
    const input = `query: ${text.trim()}`;
    return await getEmbedding(input);
}

async function getPassageEmbedding(text) {
    if (!text) return null;
    const input = `passage: ${text.trim()}`;
    return await getEmbedding(input);
}

function buildRoomTextForEmbedding(room) {
    const parts = [];
    const rental = room.rentals || room.rental;

    if (rental?.title) parts.push(rental.title);
    if (rental?.description) parts.push(rental.description);
    if (room.room_name) parts.push(`Phòng: ${room.room_name}`);
    if (room.description) parts.push(room.description);
    if (room.room_type) parts.push(`Loại: ${room.room_type}`);
    if (room.price) parts.push(`Giá: ${Number(room.price).toLocaleString('vi-VN')} VNĐ`);

    // location logic
    const locParts = [];
    if (room.location) {
        if (room.location.street) locParts.push(room.location.street);
        if (room.location.ward) locParts.push(room.location.ward);
        if (room.location.district) locParts.push(room.location.district);
        if (room.location.city) locParts.push(room.location.city);
    }
    if (locParts.length > 0) parts.push(`Địa chỉ: ${locParts.join(', ')}`);

    const amenities = (room.roomAmenities || []).map((ra) => ra.amenity?.name || ra.name).filter(Boolean);
    if (amenities.length) parts.push(`Tiện nghi: ${amenities.join(', ')}`);

    return parts.join('. ');
}

async function preloadEmbedding() {
    return true;
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
