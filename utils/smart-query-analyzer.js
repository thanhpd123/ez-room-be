/**
 * Analyze a Vietnamese search query to extract structured intent.
 * Works without any API keys — pure keyword/regex matching.
 */

const PRICE_LOW_KEYWORDS = ['rẻ', 'giá rẻ', 'giá tốt', 'tiết kiệm', 'bình dân', 'giá mềm', 'phải chăng'];
const PRICE_HIGH_KEYWORDS = ['cao cấp', 'sang trọng', 'luxury', 'premium', 'đắt'];
const PRICE_REGEX = /(\d[\d.,]*)\s*(tr|triệu|trieu|củ|cu|k|nghìn|nghin|đ|dong|đồng|vnd)?/gi;
const PRICE_UPPER_BOUND_REGEX = /(?:duoi|dưới|toi da|tối đa|khong qua|không quá|nho hon|nhỏ hơn|<=?)\s*(\d[\d.,]*)\s*(tr|triệu|trieu|củ|cu|k|nghìn|nghin|đ|dong|đồng|vnd)?/i;
const PRICE_LOWER_BOUND_REGEX = /(?:tren|trên|tu|từ|toi thieu|tối thiểu|it nhat|ít nhất|lon hon|lớn hơn|>=?)\s*(\d[\d.,]*)\s*(tr|triệu|trieu|củ|cu|k|nghìn|nghin|đ|dong|đồng|vnd)?/i;
const PRICE_RANGE_REGEX = /(?:tu|từ)?\s*(\d[\d.,]*)\s*(tr|triệu|trieu|củ|cu|k|nghìn|nghin|đ|dong|đồng|vnd)?\s*(?:-|den|đến|toi|tới)\s*(\d[\d.,]*)\s*(tr|triệu|trieu|củ|cu|k|nghìn|nghin|đ|dong|đồng|vnd)?/i;
const PRICE_APPROX_REGEX = /(?:tam|tầm|khoang|khoảng|gan|gần|around|about)\s*(\d[\d.,]*)\s*(tr|triệu|trieu|củ|cu|k|nghìn|nghin|đ|dong|đồng|vnd)?/i;

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
    'wc riêng': 'wc riêng',
    'nhà vệ sinh riêng': 'wc riêng',
    've sinh rieng': 'wc riêng',
    'nội thất': 'nội thất',
    'day du noi that': 'nội thất',
    'full nội thất': 'nội thất',
    'full nội that': 'nội thất',
    'full furniture': 'nội thất',
    'bếp': 'bếp',
    'nấu ăn': 'bếp',
    'ban công': 'ban công',
    'ban cong': 'ban công',
    'cửa sổ': 'cửa sổ',
    'cua so': 'cửa sổ',
    'bảo vệ': 'bảo vệ 24/7',
    'an ninh': 'bảo vệ 24/7',
    'thang máy': 'thang máy',
    'elevator': 'thang máy',
    'camera': 'camera an ninh',
    'pccc': 'pccc',
    'hồ bơi': 'hồ bơi',
    'bể bơi': 'hồ bơi',
    'pool': 'hồ bơi',
    'nóng lạnh': 'nóng lạnh',
    'bình nóng lạnh': 'nóng lạnh',
    'tủ lạnh': 'tủ lạnh',
    'máy sấy': 'máy sấy',
    'may say': 'máy sấy',
    'giường': 'giường',
    'giuong': 'giường',
    'parking': 'chỗ để xe',
    'để xe': 'chỗ để xe',
    'gửi xe': 'chỗ để xe',
    'giữ xe': 'chỗ để xe',
    'free xe': 'chỗ để xe',
};

const ROOM_TYPE_MAP = {
    'studio': 'STUDIO',
    'phòng đơn': 'PRIVATE',
    'phòng riêng': 'PRIVATE',
    'phòng trọ': 'PRIVATE',
    'phòng': 'PRIVATE',
    'tro': 'PRIVATE',
    'trọ': 'PRIVATE',
    'phòng ở ghép': 'SHARED',
    'ở ghép': 'SHARED',
    'o ghep': 'SHARED',
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

const LOCATION_REGEXES = [
    /\b(?:quận|quan)\s*(\d{1,2}|[a-zàáảãạăắằẳẵặâấầẩẫậ\s]{2,30})/gi,
    /\bq\.?\s*(\d{1,2})\b/gi,
    /\b(?:phường|phuong)\s*(\d{1,2}|[a-zàáảãạăắằẳẵặâấầẩẫậ\s]{2,30})/gi,
    /\bp\.?\s*(\d{1,2})\b/gi,
    /\b(?:tp\.?|thành phố)\s*([a-zàáảãạăắằẳẵặâấầẩẫậ\s]{2,40})/gi,
];

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
    const normalized = lower
        .replace(/[“”"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    let remaining = normalized;

    // Extract price hints
    if (PRICE_LOW_KEYWORDS.some((kw) => normalized.includes(kw))) {
        result.priceHint = 'low';
    }
    if (PRICE_HIGH_KEYWORDS.some((kw) => normalized.includes(kw))) {
        result.priceHint = 'high';
    }

    const hasPriceCue = /\b(gia|giá|budget|ngan sach|ngân sách|trieu|triệu|tr|cu|củ|k|vnd|dong|đồng|duoi|dưới|tren|trên|toi da|tối đa|toi thieu|tối thiểu|khoang|khoảng|tam|tầm)\b/i.test(normalized);

    const parseMoney = (numRaw, unitRaw = '') => {
        if (!numRaw) return null;
        let num = parseFloat(String(numRaw).replace(/[.,]/g, ''));
        if (Number.isNaN(num)) return null;
        const unit = String(unitRaw || '').toLowerCase();
        if (!unit) {
            if (!hasPriceCue) return null;
            // Assume "million" for casual VN pricing language like "5 củ" fallback / plain numbers.
            // Keep small values practical for room-rental context.
            if (num <= 200) num *= 1_000_000;
            return num;
        }
        if (unit.startsWith('tr') || unit === 'triệu' || unit === 'trieu' || unit === 'củ' || unit === 'cu') {
            num *= 1_000_000;
        } else if (unit === 'k' || unit.startsWith('ngh')) {
            num *= 1_000;
        }
        return num;
    };

    const rangeMatch = normalized.match(PRICE_RANGE_REGEX);
    const approxMatch = normalized.match(PRICE_APPROX_REGEX);
    const upperBoundMatch = normalized.match(PRICE_UPPER_BOUND_REGEX);
    const lowerBoundMatch = normalized.match(PRICE_LOWER_BOUND_REGEX);
    if (rangeMatch) {
        const left = parseMoney(rangeMatch[1], rangeMatch[2]);
        const right = parseMoney(rangeMatch[3], rangeMatch[4] || rangeMatch[2]);
        if (left != null && right != null) {
            result.extractedPrice = {
                min: Math.min(left, right),
                max: Math.max(left, right),
            };
        }
    } else if (approxMatch) {
        const center = parseMoney(approxMatch[1], approxMatch[2]);
        if (center != null) {
            result.extractedPrice = {
                min: Math.round(center * 0.8),
                max: Math.round(center * 1.2),
            };
        }
    } else {
        const max = upperBoundMatch ? parseMoney(upperBoundMatch[1], upperBoundMatch[2]) : null;
        const min = lowerBoundMatch ? parseMoney(lowerBoundMatch[1], lowerBoundMatch[2]) : null;
        if (min != null || max != null) {
            result.extractedPrice = { min: min != null ? min : null, max: max != null ? max : null };
        }
    }

    const priceValues = [];
    for (const m of normalized.matchAll(PRICE_REGEX)) {
        const numRaw = m[1];
        const unitRaw = m[2];
        const matchIndex = m.index != null ? m.index : -1;
        if (!unitRaw && matchIndex >= 0) {
            const leftCtx = normalized.slice(Math.max(0, matchIndex - 12), matchIndex);
            if (/\b(?:q|quận|quan|p|phường|phuong)\s*$/i.test(leftCtx)) continue;
        }
        const val = parseMoney(numRaw, unitRaw);
        if (val != null) priceValues.push(val);
    }
    if (priceValues.length > 0) {
        const values = priceValues.sort((a, b) => a - b);

        if (!result.extractedPrice && values.length > 0) {
            result.extractedPrice = {
                min: values[0],
                max: values.length > 1 ? values[values.length - 1] : null,
            };
        }
    }

    // Extract amenities
    for (const [keyword, canonical] of Object.entries(AMENITY_MAP)) {
        if (normalized.includes(keyword) && !result.amenityHints.includes(canonical)) {
            result.amenityHints.push(canonical);
            remaining = remaining.replace(keyword, ' ');
        }
    }

    // Extract room type
    for (const [keyword, dbType] of Object.entries(ROOM_TYPE_MAP)) {
        if (normalized.includes(keyword)) {
            result.roomTypeHint = dbType;
            remaining = remaining.replace(keyword, ' ');
            break;
        }
    }

    // Extract lifestyle hints
    for (const [category, keywords] of Object.entries(LIFESTYLE_KEYWORDS)) {
        if (keywords.some((kw) => normalized.includes(kw))) {
            result.lifestyleHints.push(category);
        }
    }

    // Extract location hints
    for (const regex of LOCATION_REGEXES) {
        const locMatches = [...normalized.matchAll(regex)];
        for (const m of locMatches) {
            const val = (m[1] || '').trim();
            if (val) result.locationHints.push(val);
        }
    }
    result.locationHints = [...new Set(result.locationHints)];

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
