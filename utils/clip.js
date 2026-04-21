const axios = require('axios');
const FormData = require('form-data');

const CLIP_MODEL = (process.env.CLIP_MODEL || 'openai/clip-vit-base-patch16').trim();
const CLIP_DIMS = 512;

async function getClipImageEmbedding(imageBuffer) {
    try {
        const baseUrl = process.env.CLIP_SERVICE_URL || process.env.HF_SPACE_URL;
        if (!baseUrl) throw new Error('CLIP_SERVICE_URL is not defined in .env');

        const form = new FormData();
        form.append('file', imageBuffer, { filename: 'image.png', contentType: 'image/png' });

        const response = await axios.post(`${baseUrl}/embed-image`, form, {
            headers: {
                ...form.getHeaders()
            }
        });

        return response.data.embedding;
    } catch (err) {
        console.error('[CLIP API] Image Error:', err.message);
        return null;
    }
}

async function getClipTextEmbedding(text) {
    const clean = (text || '').trim();

    if (!clean) return null;

    try {
        const baseUrl = process.env.CLIP_SERVICE_URL || process.env.HF_SPACE_URL;
        if (!baseUrl) throw new Error('CLIP_SERVICE_URL is not defined in .env');

        const form = new FormData();
        form.append('text', clean);

        const response = await axios.post(`${baseUrl}/embed-text`, form, {
            headers: {
                ...form.getHeaders()
            }
        });

        return response.data.embedding;
    } catch (err) {
        console.error('[CLIP API] Text Error:', err.message);
        return null;
    }
}

function isClipAvailable() {
    return !!(process.env.CLIP_SERVICE_URL || process.env.HF_SPACE_URL);
}

async function preloadCLIP() {
    return true;
}

function getClipModelLabel() {
    return 'HF-Space-API';
}

module.exports = {
    getClipImageEmbedding,
    getClipTextEmbedding,
    isClipAvailable,
    preloadCLIP,
    CLIP_DIMS,
    CLIP_MODEL,
    getClipModelLabel,
};