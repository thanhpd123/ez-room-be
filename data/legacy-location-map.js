/**
 * Legacy location map – old (63 provinces) ↔ new (34 provinces) Vietnam 2025.
 * When user inputs old address, we match against equivalent names so results still show.
 *
 * Extend this map from: https://provinces.open-api.vn/ or official Nghị quyết sáp nhập 07/2025.
 * Format: Each group = [canonical name, ...alias/old names]. All are equivalent for search.
 *
 * Used by: getPublicRentals, getPublicSearch (city + district filters + text query).
 */

const CITY_EQUIVALENCE_GROUPS = [
    // Major cities – common aliases
    ['Thành phố Hồ Chí Minh', 'TP. Hồ Chí Minh', 'TP Hồ Chí Minh', 'TPHCM', 'Hồ Chí Minh', 'Sài Gòn', 'Saigon', 'HCM'],
    ['Thành phố Hà Nội', 'TP. Hà Nội', 'TP Hà Nội', 'Hà Nội', 'Ha Noi', 'HN'],
    ['Thành phố Hải Phòng', 'TP. Hải Phòng', 'Hải Phòng'],
    ['Thành phố Đà Nẵng', 'TP. Đà Nẵng', 'Đà Nẵng', 'Da Nang'],
    ['Thành phố Cần Thơ', 'TP. Cần Thơ', 'Cần Thơ'],
    ['Thành phố Huế', 'TP. Huế', 'Huế', 'Hue'],
    // Merged provinces (63→34, 07/2025). Verify from official Nghị quyết – extend as needed.
    ['Tỉnh Cà Mau', 'Tỉnh Bạc Liêu', 'Bạc Liêu', 'Cà Mau'],
    ['Tỉnh Đắk Lắk', 'Tỉnh Đắk Nông', 'Đắk Nông', 'Đắk Lắk'],
    ['Tỉnh Gia Lai', 'Tỉnh Kon Tum', 'Kon Tum', 'Gia Lai'],
    // Add more groups from: https://provinces.open-api.vn/ or official merger list
];

const DISTRICT_EQUIVALENCE_GROUPS = [
    // Common district aliases (e.g. "Quận 1" vs "Q.1" vs "Q1")
    ['Quận 1', 'Q.1', 'Q1', 'Quận I'],
    ['Quận 2', 'Q.2', 'Q2', 'Quận II'],
    ['Quận 3', 'Q.3', 'Q3', 'Quận III'],
    ['Quận 4', 'Q.4', 'Q4', 'Quận IV'],
    ['Quận 5', 'Q.5', 'Q5', 'Quận V'],
    ['Quận 6', 'Q.6', 'Q6', 'Quận VI'],
    ['Quận 7', 'Q.7', 'Q7', 'Quận VII'],
    ['Quận 8', 'Q.8', 'Q8', 'Quận VIII'],
    ['Quận 9', 'Q.9', 'Q9', 'Quận IX'],
    ['Quận 10', 'Q.10', 'Q10', 'Quận X'],
    ['Quận 11', 'Q.11', 'Q11'],
    ['Quận 12', 'Q.12', 'Q12'],
];

function buildLookup(groups) {
    const toGroup = new Map();
    groups.forEach((group) => {
        const normalizedGroup = group.map((s) => s.trim().toLowerCase());
        group.forEach((name) => {
            const key = name.trim().toLowerCase();
            if (!toGroup.has(key)) {
                toGroup.set(key, group);
            }
        });
    });
    return toGroup;
}

const cityLookup = buildLookup(CITY_EQUIVALENCE_GROUPS);
const districtLookup = buildLookup(DISTRICT_EQUIVALENCE_GROUPS);

/**
 * Get all equivalent names for a city (for OR filter).
 * Returns [input] if no mapping, or the full group if found.
 */
function expandCity(input) {
    if (!input || typeof input !== 'string') return [];
    const key = input.trim().toLowerCase();
    if (!key) return [];
    const group = cityLookup.get(key);
    if (group) return [...new Set(group)];
    return [input.trim()];
}

/**
 * Get all equivalent names for a district.
 */
function expandDistrict(input) {
    if (!input || typeof input !== 'string') return [];
    const key = input.trim().toLowerCase();
    if (!key) return [];
    const group = districtLookup.get(key);
    if (group) return [...new Set(group)];
    return [input.trim()];
}

/**
 * Check if a search query (q) contains any known legacy name; return equivalent names for location matching.
 * Used to expand text search so "Bình Thuận" in q also matches city="Tỉnh Khánh Hòa" etc.
 */
function extractLocationTermsFromQuery(q) {
    if (!q || typeof q !== 'string' || q.length < 2) return { cities: [], districts: [] };
    const normalized = q.trim().toLowerCase();
    const cities = new Set();
    const districts = new Set();

    cityLookup.forEach((group, key) => {
        if (normalized.includes(key) || group.some((g) => normalized.includes(g.trim().toLowerCase()))) {
            group.forEach((c) => cities.add(c));
        }
    });
    districtLookup.forEach((group, key) => {
        if (normalized.includes(key) || group.some((g) => normalized.includes(g.trim().toLowerCase()))) {
            group.forEach((d) => districts.add(d));
        }
    });

    return { cities: Array.from(cities), districts: Array.from(districts) };
}

module.exports = {
    expandCity,
    expandDistrict,
    extractLocationTermsFromQuery,
    CITY_EQUIVALENCE_GROUPS,
    DISTRICT_EQUIVALENCE_GROUPS,
};
