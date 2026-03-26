const express = require('express');
const multer = require('multer');
const { verifyJWT } = require('../middleware/auth');
const { getRecommend } = require('../controllers/search.controller');
const {
    getAdvancedSearch,
    searchByImage,
    searchNearby,
    getNearbyPOIsEndpoint,
    searchByText,
    getClipDiagnostics,
    transcribeVoice,
} = require('../controllers/advanced-search.controller');
const { isClipImageSearchVipOnly, isClipTextSearchVipOnly } = require('../utils/search-feature-flags');
const { isLlmAvailable } = require('../utils/llm-query-parser');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype);
        if (allowed) cb(null, true);
        else cb(new Error('Chỉ chấp nhận ảnh: JPEG, PNG, GIF, WebP'), false);
    },
});

const uploadAudio = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /^audio\//i.test(file.mimetype);
        if (allowed) cb(null, true);
        else cb(new Error('Chỉ chấp nhận file audio (mimetype audio/*)'), false);
    },
});

/**
 * GET /search/advanced
 * AI-powered search for logged-in users.
 */
router.get('/advanced', verifyJWT, getAdvancedSearch);

/**
 * POST /search/by-image
 * Image-based search (VIP only).
 */
router.post('/by-image', verifyJWT, upload.single('file'), searchByImage);

/**
 * GET /search/clip-diagnostics
 * Verify ONNX CLIP + pgvector + clip_vectors (auth required).
 */
router.get('/clip-diagnostics', verifyJWT, getClipDiagnostics);

/**
 * GET /search/by-text
 * Text-to-image search: describe the room (e.g. "phòng có cửa sổ lớn"), get visually similar rooms.
 */
router.get('/by-text', verifyJWT, searchByText);

/**
 * POST /search/transcribe
 * Voice → text (Whisper). Use this for "search by voice" on the frontend.
 */
router.post('/transcribe', verifyJWT, uploadAudio.single('file'), transcribeVoice);

/**
 * GET /search/nearby
 * Find rooms near user's current location (auth required).
 */
router.get('/nearby', verifyJWT, searchNearby);

/**
 * GET /search/nearby-pois
 * Get nearby POIs for a specific lat/lng (auth required).
 */
router.get('/nearby-pois', verifyJWT, getNearbyPOIsEndpoint);

/**
 * GET /search/recommend
 * Personalized room recommendations (auth required).
 */
router.get('/recommend', verifyJWT, getRecommend);

/**
 * GET /search
 * Search API status/info endpoint.
 */
router.get('/', (req, res) => {
    const { isEmbeddingAvailable } = require('../utils/embedding');
    const { isClipAvailable } = require('../utils/clip');
    const { isGoogleMapsAvailable } = require('../utils/google-maps');
    const imageVip = isClipImageSearchVipOnly();
    const textVip = isClipTextSearchVipOnly();
    res.json({
        success: true,
        message: 'Search API',
        features: {
            basicSearch: 'GET /public/search',
            advancedSearch: 'GET /search/advanced (auth required)',
            imageSearch: `POST /search/by-image (auth; ${imageVip ? 'VIP only' : 'all logged-in users'})`,
            textToImageSearch: `GET /search/by-text?q=... (auth; ${textVip ? 'VIP only' : 'all logged-in users'})`,
            nearbySearch: 'GET /search/nearby (auth required)',
            nearbyPOIs: 'GET /search/nearby-pois (auth required)',
            recommendations: 'GET /search/recommend (auth required)',
            clipDiagnostics: 'GET /search/clip-diagnostics (auth) — ONNX CLIP + pgvector health',
        },
        embeddingEnabled: isEmbeddingAvailable(),
        clipEnabled: isClipAvailable(),
        googleMapsEnabled: isGoogleMapsAvailable(),
        geminiQueryParsingEnabled: isLlmAvailable(),
        clipImageSearchVipOnly: imageVip,
        clipTextSearchVipOnly: textVip,
        aiSetup: {
            roomTextEmbeddings: 'node scripts/generate-embeddings.js (pgvector + multilingual-e5)',
            clipImageVectors: 'node scripts/generate-clip-embeddings.js (pgvector + CLIP)',
            naturalLanguageFilters: 'Set GEMINI_API_KEY for LLM query parsing in advanced search',
        },
    });
});

module.exports = router;
