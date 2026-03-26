/**
 * Analyze a Vietnamese search query to extract structured intent.
 * Works without any API keys — pure keyword/regex matching.
 */

const PRICE_LOW_KEYWORDS = ['rẻ', 'giá rẻ', 'giá tốt', 'tiết kiệm', 'bình dân', 'giá mềm', 'phải chăng'];
const PRICE_HIGH_KEYWORDS = ['cao cấp', 'sang trọng', 'luxury', 'premium', 'đắt'];
const PRICE_REGEX = /(\d[\d.,]*)\s*(tr|triệu|trieu|k|nghìn|nghin|đ|dong|đồng|vnd)/gi;

const AMENITY_MAP = {
    'wifi': 'wifi',
    'wi-fi': 'wifi',
    'internet': 'wifi',
    'mạng': 'wifi',
    'điều hòa': 'điều hòa',
    'điều hoà': 'điều hòa',
    'máy lạnh': 'điều hòa',
    'may lanh': 'điều hòa',
    'máy giặt': 'máy giặt',
    'may giat': 'máy giặt',
    'bếp': 'bếp',
    'nấu ăn': 'bếp',
    'ban công': 'ban công',
    'ban cong': 'ban công',
    'bảo vệ': 'bảo vệ 24/7',
    'an ninh': 'bảo vệ 24/7',
    'thang máy': 'thang máy',
    'elevator': 'thang máy',
    'hồ bơi': 'hồ bơi',
    'bể bơi': 'hồ bơi',
    'pool': 'hồ bơi',
    'nóng lạnh': 'nóng lạnh',
    'bình nóng lạnh': 'nóng lạnh',
    'tủ lạnh': 'tủ lạnh',
    'parking': 'chỗ để xe',
    'để xe': 'chỗ để xe',
    'gửi xe': 'chỗ để xe',
    'giữ xe': 'chỗ để xe',
};

const ROOM_TYPE_MAP = {
    'studio': 'STUDIO',
    'phòng đơn': 'PRIVATE',
    'phòng riêng': 'PRIVATE',
    'phòng trọ': 'PRIVATE',
    'phòng ở ghép': 'SHARED',
    'ở ghép': 'SHARED',
    'share': 'SHARED',
    'shared': 'SHARED',
    'căn hộ': 'APARTMENT',
    'can ho': 'APARTMENT',
    'apartment': 'APARTMENT',
    'chung cư': 'APARTMENT',
    'mini': 'APARTMENT',
};

const LIFESTYLE_KEYWORDS = {
    quiet: ['yên tĩnh', 'im lặng', 'không ồn', 'tĩnh lặng'],
    student: ['sinh viên', 'gần trường', 'đại học', 'học sinh', 'near university', 'near school'],
    worker: ['đi làm', 'công nhân', 'nhân viên', 'văn phòng', 'office'],
    family: ['gia đình', 'vợ chồng', 'family', 'con nhỏ'],
    pet: ['thú cưng', 'pet', 'chó', 'mèo', 'nuôi thú'],
    clean: ['sạch sẽ', 'sạch', 'gọn gàng', 'ngăn nắp'],
    social: ['vui vẻ', 'hòa đồng', 'giao lưu'],
    cooking: ['nấu ăn', 'bếp', 'cooking'],
    nosmoking: ['không hút thuốc', 'cấm thuốc', 'no smoking'],
};

const LOCATION_REGEX = /(?:quận|quan|q\.?)\s*(\d{1,2}|[a-zàáảãạăắằẳẵặâấầẩẫậ\s]+)|(?:phường|phuong|p\.?)\s*(\d{1,2}|[a-zàáảãạăắằẳẵặâấầẩẫậ\s]+)|(?:tp\.?|thành phố)\s*([a-zàáảãạăắằẳẵặâấầẩẫậ\s]+)/gi;

/**
 * Analyze free-text query and extract structured search intent.
 */
function analyzeQuery(text) {
    const result = {
        cleanedQuery: '',
        priceHint: null,       // { min, max } in VND or 'low'/'high'
        extractedPrice: null,  // { min, max } numbers
        amenityHints: [],
        roomTypeHint: null,
        lifestyleHints: [],
        locationHints: [],
        keywords: [],
    };

    if (!text || typeof text !== 'string') return result;

    const lower = text.toLowerCase().trim();
    let remaining = lower;

    // Extract price hints
    if (PRICE_LOW_KEYWORDS.some((kw) => lower.includes(kw))) {
        result.priceHint = 'low';
    }
    if (PRICE_HIGH_KEYWORDS.some((kw) => lower.includes(kw))) {
        result.priceHint = 'high';
    }

    const priceMatches = [...lower.matchAll(PRICE_REGEX)];
    if (priceMatches.length > 0) {
        const values = priceMatches.map((m) => {
            let num = parseFloat(m[1].replace(/[.,]/g, ''));
            const unit = m[2].toLowerCase();
            if (unit.startsWith('tr') || unit === 'triệu' || unit === 'trieu') num *= 1_000_000;
            else if (unit === 'k' || unit.startsWith('ngh')) num *= 1_000;
            return num;
        }).sort((a, b) => a - b);

        result.extractedPrice = {
            min: values[0],
            max: values.length > 1 ? values[values.length - 1] : null,
        };
    }

    // Extract amenities
    for (const [keyword, canonical] of Object.entries(AMENITY_MAP)) {
        if (lower.includes(keyword) && !result.amenityHints.includes(canonical)) {
            result.amenityHints.push(canonical);
            remaining = remaining.replace(keyword, ' ');
        }
    }

    // Extract room type
    for (const [keyword, dbType] of Object.entries(ROOM_TYPE_MAP)) {
        if (lower.includes(keyword)) {
            result.roomTypeHint = dbType;
            remaining = remaining.replace(keyword, ' ');
            break;
        }
    }

    // Extract lifestyle hints
    for (const [category, keywords] of Object.entries(LIFESTYLE_KEYWORDS)) {
        if (keywords.some((kw) => lower.includes(kw))) {
            result.lifestyleHints.push(category);
        }
    }

    // Extract location hints
    const locMatches = [...lower.matchAll(LOCATION_REGEX)];
    for (const m of locMatches) {
        const val = (m[1] || m[2] || m[3] || '').trim();
        if (val) result.locationHints.push(val);
    }

    // Remaining keywords (after removing recognized entities)
    result.cleanedQuery = remaining.replace(/\s+/g, ' ').trim();
    result.keywords = result.cleanedQuery.split(' ').filter((w) => w.length > 1);

    return result;
}

/**
 * Compute lifestyle compatibility between search hints and a LifestyleProfile.
 * Returns score 0-100.
 */
function computeLifestyleCompatibility(lifestyleHints, profile) {
    if (!lifestyleHints?.length || !profile) return 50;

    let score = 50;
    const checks = {
        quiet: () => {
            if (profile.noise_tolerance === 'LOW' || profile.quiet_hours_preference) score += 15;
        },
        student: () => {
            if (profile.occupation_type === 'STUDENT') score += 15;
        },
        worker: () => {
            if (profile.occupation_type === 'OFFICE' || profile.work_from_home) score += 10;
        },
        pet: () => {
            if (profile.pets_allowed) score += 15; else score -= 10;
        },
        clean: () => {
            if (profile.cleanliness === 'HIGH' || profile.cleanliness === 'VERY_HIGH') score += 10;
        },
        nosmoking: () => {
            if (!profile.smoking) score += 10; else score -= 15;
        },
        cooking: () => {
            if (profile.cooking_frequency && profile.cooking_frequency !== 'NEVER') score += 10;
        },
        social: () => {
            if (profile.social_level === 'HIGH' || profile.social_level === 'VERY_HIGH') score += 10;
        },
    };

    for (const hint of lifestyleHints) {
        if (checks[hint]) checks[hint]();
    }

    return Math.min(100, Math.max(0, score));
}

module.exports = { analyzeQuery, computeLifestyleCompatibility };
