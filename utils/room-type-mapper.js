/**
 * Shared room type mapping between FE format and DB enum.
 * Single source of truth for rental, room, and search controllers.
 */

const FE_TO_DB = {
    single: 'PRIVATE',
    double: 'SHARED',
    studio: 'STUDIO',
    apartment: 'APARTMENT',
};

const DB_TO_FE = {
    PRIVATE: 'single',
    SHARED: 'double',
    STUDIO: 'studio',
    APARTMENT: 'apartment',
};

const DB_LABELS = {
    PRIVATE: { value: 'single', label: 'Phòng đơn' },
    SHARED: { value: 'double', label: 'Phòng đôi' },
    STUDIO: { value: 'studio', label: 'Studio' },
    APARTMENT: { value: 'apartment', label: 'Căn hộ' },
};

const ALLOWED_DB = ['PRIVATE', 'SHARED', 'STUDIO', 'APARTMENT'];

/**
 * Map FE roomType (single, double, studio, apartment) to DB enum.
 * @param {string} [feType]
 * @param {{ returnNullForInvalid?: boolean }} [opts]
 * @returns {string|null} DB enum or null when invalid and returnNullForInvalid
 */
function mapFeToDb(feType, opts = {}) {
    const { returnNullForInvalid = false } = opts;
    if (!feType || typeof feType !== 'string') {
        return returnNullForInvalid ? null : 'PRIVATE';
    }
    const lower = feType.trim().toLowerCase();
    if (FE_TO_DB[lower]) return FE_TO_DB[lower];
    const upper = feType.trim().toUpperCase();
    if (ALLOWED_DB.includes(upper)) return upper;
    return returnNullForInvalid ? null : 'PRIVATE';
}

/**
 * Map DB room_type enum to FE format.
 * @param {string} [dbType]
 * @param {string} [defaultFallback='single']
 */
function mapDbToFe(dbType, defaultFallback = 'single') {
    if (!dbType) return defaultFallback;
    return DB_TO_FE[dbType] ?? (dbType.toLowerCase && dbType.toLowerCase()) ?? defaultFallback;
}

/**
 * Get label object for DB enum (for public room-types API).
 */
function getLabelForDb(dbType) {
    return dbType ? DB_LABELS[dbType] : null;
}

module.exports = {
    mapFeToDb,
    mapDbToFe,
    getLabelForDb,
    ROOM_TYPE_LABELS: DB_LABELS,
};
