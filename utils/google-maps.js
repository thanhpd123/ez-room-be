/**
 * Location & nearby POI utilities.
 *   - Haversine distance calculation (no API)
 *   - OpenStreetMap Overpass API for nearby POIs (FREE, no key needed)
 */

const axios = require('axios');

// ────────────────── Haversine distance ──────────────────

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
    return (deg * Math.PI) / 180;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToScore(distKm) {
    if (distKm <= 0) return 100;
    if (distKm <= 1) return 100 - distKm * 15;
    if (distKm <= 5) return 85 - (distKm - 1) * 11.25;
    if (distKm <= 10) return 40 - (distKm - 5) * 5;
    if (distKm <= 20) return 15 - (distKm - 10) * 1.5;
    return 0;
}

// ────────────────── Overpass API (OpenStreetMap, FREE) ──────────────────

const OVERPASS_URLS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
];

const POI_CATEGORIES = {
    education: {
        label: 'Trường học',
        weight: 15,
        tags: ['"amenity"="school"', '"amenity"="university"', '"amenity"="college"'],
    },
    food: {
        label: 'Nhà hàng/Quán cà phê',
        weight: 10,
        tags: ['"amenity"="restaurant"', '"amenity"="cafe"', '"amenity"="fast_food"'],
    },
    healthcare: {
        label: 'Bệnh viện/Nhà thuốc',
        weight: 12,
        tags: ['"amenity"="hospital"', '"amenity"="clinic"', '"amenity"="pharmacy"'],
    },
    shopping: {
        label: 'Cửa hàng/Siêu thị',
        weight: 8,
        tags: ['"shop"="supermarket"', '"shop"="convenience"', '"shop"="mall"'],
    },
    transport: {
        label: 'Giao thông công cộng',
        weight: 15,
        tags: ['"amenity"="bus_station"', '"public_transport"="station"', '"railway"="station"'],
    },
    park: {
        label: 'Công viên',
        weight: 5,
        tags: ['"leisure"="park"'],
    },
    safety: {
        label: 'Công an',
        weight: 5,
        tags: ['"amenity"="police"'],
    },
};

// In-memory cache: "lat,lng" → { data, timestamp }
const nearbyCache = new Map();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getCacheKey(lat, lng) {
    return `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`;
}

/**
 * Query Overpass API for all POI categories at once (single request).
 * Tries multiple mirrors for reliability.
 */
async function queryOverpass(lat, lng, radiusMeters = 1000) {
    const query = `[out:json][timeout:10];(
        node["amenity"~"school|university|college|restaurant|cafe|fast_food|hospital|clinic|pharmacy|bus_station|police"](around:${radiusMeters},${lat},${lng});
        node["shop"~"supermarket|convenience"](around:${radiusMeters},${lat},${lng});
        node["leisure"="park"](around:${radiusMeters},${lat},${lng});
        node["public_transport"="station"](around:${radiusMeters},${lat},${lng});
    );out 80;`;

    for (const url of OVERPASS_URLS) {
        try {
            const res = await axios.post(url, `data=${encodeURIComponent(query)}`, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000,
            });
            return res.data.elements || [];
        } catch (err) {
            console.warn(`[Overpass] ${url} failed: ${err.message}`);
        }
    }
    return [];
}

/**
 * Categorize an OSM element into our POI categories.
 */
function categorizeElement(el) {
    const tags = el.tags || {};
    const amenity = tags.amenity || '';
    const shop = tags.shop || '';
    const leisure = tags.leisure || '';
    const publicTransport = tags.public_transport || '';
    const railway = tags.railway || '';

    if (['school', 'university', 'college'].includes(amenity)) return 'education';
    if (['restaurant', 'cafe', 'fast_food'].includes(amenity)) return 'food';
    if (['hospital', 'clinic', 'pharmacy'].includes(amenity)) return 'healthcare';
    if (['supermarket', 'convenience', 'mall'].includes(shop)) return 'shopping';
    if (['bus_station'].includes(amenity) || publicTransport === 'station' || railway === 'station') return 'transport';
    if (leisure === 'park') return 'park';
    if (amenity === 'police') return 'safety';
    return null;
}

/**
 * Get nearby POIs for a location. Uses cache to minimize API calls.
 * Returns: { categories, score (0-100), cached }
 */
async function getNearbyPOIs(lat, lng, radiusMeters = 1000) {
    if (!lat || !lng) return { categories: {}, score: 0, cached: false };

    const key = getCacheKey(lat, lng);
    const cached = nearbyCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return { ...cached.data, cached: true };
    }

    const elements = await queryOverpass(lat, lng, radiusMeters);

    const categories = {};
    for (const el of elements) {
        const cat = categorizeElement(el);
        if (!cat) continue;

        const elLat = el.lat || el.center?.lat;
        const elLng = el.lon || el.center?.lon;
        const name = el.tags?.name || el.tags?.['name:vi'] || cat;
        const dist = elLat && elLng ? haversineDistance(lat, lng, elLat, elLng) : null;

        if (!categories[cat]) {
            categories[cat] = {
                label: POI_CATEGORIES[cat].label,
                places: [],
                count: 0,
            };
        }
        categories[cat].places.push({ name, type: cat, distance: dist });
        categories[cat].count++;
    }

    // Compute score
    let totalScore = 0;
    const maxPossible = Object.values(POI_CATEGORIES).reduce((s, c) => s + c.weight, 0);
    for (const [cat, data] of Object.entries(categories)) {
        const weight = POI_CATEGORIES[cat]?.weight || 5;
        totalScore += Math.min(weight, data.count * (weight / 3));
    }
    const normalizedScore = Math.min(100, Math.round((totalScore / maxPossible) * 100));

    const data = { categories, score: normalizedScore };
    nearbyCache.set(key, { data, timestamp: Date.now() });

    return { ...data, cached: false };
}

async function computeNearbyPOIScore(lat, lng) {
    if (!lat || !lng) return 50;
    const { score } = await getNearbyPOIs(lat, lng, 1000);
    return score;
}

function isGoogleMapsAvailable() {
    return true; // Always available — uses free Overpass API
}

module.exports = {
    haversineDistance,
    distanceToScore,
    getNearbyPOIs,
    computeNearbyPOIScore,
    isGoogleMapsAvailable,
    POI_CATEGORIES,
};
