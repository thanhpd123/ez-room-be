const axios = require('axios');
const crypto = require('crypto');

// In-memory LRU-like cache: cacheKey → translation
const cache = new Map();
const MAX_CACHE_SIZE = 20000;

const LANG_CODES = {
    vi: 'vi',
    en: 'en',
};

function makeCacheKey(text, pair) {
    return crypto.createHash('md5').update(`${pair}:${text}`).digest('hex');
}

function addToCache(key, value) {
    if (cache.size >= MAX_CACHE_SIZE) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
}

// ── Provider: Google Translate (unofficial, no key required) ─────────────────
// Uses the same endpoint as browser extensions. Highly reliable, zero config.
async function googleTranslateOne(text, from, to) {
    const params = new URLSearchParams({
        client: 'gtx',
        sl: from,
        tl: to,
        dt: 't',
        q: text,
    });

    const res = await axios.get(
        `https://translate.googleapis.com/translate_a/single?${params}`,
        {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
        }
    );

    // Response shape: [[["translated","original",...], ...], ...]
    const parts = res.data?.[0];
    if (!Array.isArray(parts)) return text;
    return parts.map((p) => (Array.isArray(p) ? p[0] : '')).join('').trim() || text;
}

// ── Provider: HuggingFace Inference API (optional, needs HF_API_KEY) ─────────
// Requires a free HF token. Uses the 2025 router endpoint.
async function huggingFaceTranslateBatch(texts, from, to) {
    const HF_API_KEY = process.env.HF_API_KEY || '';
    if (!HF_API_KEY) throw new Error('No HF_API_KEY set');

    const modelMap = {
        'vi-en': 'Helsinki-NLP/opus-mt-vi-en',
        'en-vi': 'Helsinki-NLP/opus-mt-en-vi',
    };
    const model = modelMap[`${from}-${to}`];
    if (!model) throw new Error(`No HF model for ${from}-${to}`);

    // HuggingFace moved to a new router URL in 2025
    const res = await axios.post(
        `https://router.huggingface.co/hf-inference/models/${model}`,
        { inputs: texts },
        {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${HF_API_KEY}`,
            },
            timeout: 45000,
        }
    );

    const data = Array.isArray(res.data) ? res.data : [res.data];
    return texts.map((_, i) => {
        const item = data[i];
        return (typeof item === 'string' ? item : item?.translation_text) || texts[i];
    });
}

// ── Main translation with concurrency limit for Google provider ───────────────
const CONCURRENCY = 15; // allow 15 parallel requests — fast enough, won't overwhelm Google

async function runWithConcurrency(tasks, limit) {
    const results = [];
    const queue = [...tasks];

    async function worker() {
        while (queue.length > 0) {
            const { fn, index } = queue.shift();
            try {
                results[index] = await fn();
            } catch (err) {
                results[index] = null; // will be handled by caller
            }
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(tasks.length, limit); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return results;
}

/**
 * Translate an array of texts from `from` to `to`.
 * Primary: Google Translate (no key, no config).
 * Optional: HuggingFace when HF_API_KEY is set (batched, higher quality).
 *
 * Results are cached in memory to avoid redundant API calls.
 */
async function translateTexts(texts, from, to) {
    if (!LANG_CODES[from] || !LANG_CODES[to]) {
        throw Object.assign(new Error(`Unsupported languages: ${from}, ${to}`), { statusCode: 400 });
    }
    if (from === to) return texts;

    const pair = `${from}-${to}`;
    const results = new Array(texts.length);
    const pending = [];
    const pendingIndices = [];

    // Separate cache hits from misses
    for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        if (!text || !text.trim()) {
            results[i] = text || '';
            continue;
        }
        const key = makeCacheKey(text, pair);
        if (cache.has(key)) {
            results[i] = cache.get(key);
        } else {
            pending.push(text);
            pendingIndices.push(i);
        }
    }

    if (pending.length === 0) return results;

    // Always use Google Translate (fast, reliable, no API key needed).
    // HuggingFace is available as an optional upgrade but Google is the default.
    const translated = await translateWithGoogle(pending, from, to, pair);
    for (let j = 0; j < pending.length; j++) {
        results[pendingIndices[j]] = translated[j] || pending[j];
    }

    return results;
}

async function translateWithGoogle(texts, from, to, pair) {
    const tasks = texts.map((text, index) => ({
        index,
        fn: async () => {
            try {
                const tr = await googleTranslateOne(text, from, to);
                addToCache(makeCacheKey(text, pair), tr);
                return tr;
            } catch {
                return text; // return original on error
            }
        },
    }));

    // Use proper concurrency so all texts run in parallel (up to CONCURRENCY limit)
    // rather than waiting for full batches to complete serially.
    const rawResults = await runWithConcurrency(tasks, CONCURRENCY);
    return texts.map((t, i) => rawResults[i] ?? t);
}

function getCacheStats() {
    return { size: cache.size, maxSize: MAX_CACHE_SIZE };
}

module.exports = { translateTexts, getCacheStats };
