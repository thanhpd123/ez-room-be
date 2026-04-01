const { translateTexts, getCacheStats } = require('../services/translate.service');

async function translate(req, res) {
    try {
        const { texts, from = 'vi', to = 'en' } = req.body;

        if (!Array.isArray(texts) || texts.length === 0) {
            return res.status(400).json({ success: false, message: 'texts must be a non-empty array' });
        }
        if (texts.length > 200) {
            return res.status(400).json({ success: false, message: 'Too many texts in one request (max 200)' });
        }
        const validFrom = ['vi', 'en'];
        const validTo = ['vi', 'en'];
        if (!validFrom.includes(from) || !validTo.includes(to)) {
            return res.status(400).json({ success: false, message: 'Supported languages: vi, en' });
        }

        const translations = await translateTexts(texts, from, to);
        return res.json({ success: true, translations });
    } catch (err) {
        console.error('Translation error:', err.message);
        const status = err.statusCode || (err.response?.status === 503 ? 503 : 500);
        return res.status(status).json({
            success: false,
            message:
                err.response?.status === 503
                    ? 'Translation model is warming up (first request can take ~20s), please retry.'
                    : err.message || 'Translation failed',
        });
    }
}

function translateCacheStats(req, res) {
    return res.json({ success: true, cache: getCacheStats() });
}

module.exports = { translate, translateCacheStats };
