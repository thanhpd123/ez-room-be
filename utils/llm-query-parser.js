/**
 * LLM-based query parsing for smarter search.
 * Converts natural language (e.g. "phòng cho sinh viên gần trường giá khoảng 3 triệu")
 * into structured filters. Uses Gemini when GEMINI_API_KEY is set.
 */

const AMENITY_MAP = {
    wifi: 'wifi',
    'wi-fi': 'wifi',
    internet: 'wifi',
    'điều hòa': 'điều hòa',
    'máy lạnh': 'điều hòa',
    'máy giặt': 'máy giặt',
    bếp: 'bếp',
    'nấu ăn': 'bếp',
    'ban công': 'ban công',
    'bảo vệ': 'bảo vệ 24/7',
    'thang máy': 'thang máy',
    'hồ bơi': 'hồ bơi',
    'nóng lạnh': 'nóng lạnh',
    'tủ lạnh': 'tủ lạnh',
    'chỗ để xe': 'chỗ để xe',
    'để xe': 'chỗ để xe',
};

const ROOM_TYPE_MAP = {
    studio: 'STUDIO',
    'phòng đơn': 'PRIVATE',
    'phòng riêng': 'PRIVATE',
    'căn hộ': 'APARTMENT',
    'chung cư': 'APARTMENT',
    'ở ghép': 'SHARED',
    shared: 'SHARED',
};

function isLlmAvailable() {
    return !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

/**
 * Call Gemini to parse query into JSON. Returns null on failure or missing key.
 */
async function parseQueryWithLlm(query) {
    if (!query || typeof query !== 'string' || query.trim().length < 2) return null;
    if (!isLlmAvailable()) return null;

    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `You are a search filter extractor for a Vietnamese room-rental site. Extract structured filters from the user's query. Reply with ONLY a JSON object, no markdown or explanation.

Query: "${query.trim().slice(0, 500)}"

Output schema (use null for missing):
{
  "price_min": number or null (VND),
  "price_max": number or null (VND). E.g. "3 triệu" -> 3000000, "5 tr" -> 5000000,
  "district": string or null (e.g. "Quận 1", "Q1"),
  "city": string or null (e.g. "TP Hồ Chí Minh", "Hà Nội"),
  "amenities": array of strings (canonical: wifi, điều hòa, máy giặt, bếp, ban công, thang máy, hồ bơi, nóng lạnh, tủ lạnh, chỗ để xe),
  "room_type": one of "STUDIO","PRIVATE","SHARED","APARTMENT" or null,
  "near_poi": string or null (e.g. "university", "school", "metro", "market"),
  "target": string or null (e.g. "student", "worker", "family")
}`;

        const result = await model.generateContent(prompt);
        const text = result?.response?.text?.() || '';
        if (!text) return null;

        const cleaned = text.replace(/```json?\s*|\s*```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (!parsed || typeof parsed !== 'object') return null;

        return {
            price_min: typeof parsed.price_min === 'number' ? parsed.price_min : null,
            price_max: typeof parsed.price_max === 'number' ? parsed.price_max : null,
            district: typeof parsed.district === 'string' ? parsed.district.trim() || null : null,
            city: typeof parsed.city === 'string' ? parsed.city.trim() || null : null,
            amenities: Array.isArray(parsed.amenities) ? parsed.amenities.filter((a) => typeof a === 'string') : [],
            room_type: ROOM_TYPE_MAP[parsed.room_type] || parsed.room_type || null,
            near_poi: typeof parsed.near_poi === 'string' ? parsed.near_poi.trim() || null : null,
            target: typeof parsed.target === 'string' ? parsed.target.trim() || null : null,
        };
    } catch (err) {
        console.warn('[LLM query parser]', err.message);
        return null;
    }
}

/**
 * Merge LLM result into the existing analyzeQuery result (regex-based).
 * LLM values override or fill in when regex didn't find something.
 */
function mergeLlmIntoAnalysis(analysis, llmResult) {
    if (!llmResult) return analysis;

    const out = { ...analysis };

    if (llmResult.price_min != null || llmResult.price_max != null) {
        if (!out.extractedPrice) out.extractedPrice = { min: null, max: null };
        if (llmResult.price_min != null) out.extractedPrice.min = llmResult.price_min;
        if (llmResult.price_max != null) out.extractedPrice.max = llmResult.price_max;
    }
    if (llmResult.district && !out.locationHints?.length) out.locationHints = [llmResult.district];
    else if (llmResult.district && Array.isArray(out.locationHints)) out.locationHints.push(llmResult.district);
    if (llmResult.city && Array.isArray(out.locationHints)) out.locationHints.push(llmResult.city);
    if (llmResult.amenities?.length) {
        const set = new Set(out.amenityHints || []);
        llmResult.amenities.forEach((a) => set.add(a));
        out.amenityHints = [...set];
    }
    if (llmResult.room_type) out.roomTypeHint = llmResult.room_type;
    if (llmResult.near_poi) out.nearPoiHint = llmResult.near_poi;
    if (llmResult.target) out.targetHint = llmResult.target;

    return out;
}

module.exports = {
    isLlmAvailable,
    parseQueryWithLlm,
    mergeLlmIntoAnalysis,
};
