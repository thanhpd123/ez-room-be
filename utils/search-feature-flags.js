/**
 * Feature flags for CLIP-based search (VIP gating + ops).
 * Set to false/0/no/off to open a feature to all logged-in users (e.g. staging).
 */

function parseEnvBool(name, defaultValue) {
    const v = process.env[name];
    if (v === undefined || v === '') return defaultValue;
    return !/^false|0|no|off$/i.test(String(v).trim());
}

/** POST /search/by-image — VIP only when true (default: true). */
function isClipImageSearchVipOnly() {
    return parseEnvBool('CLIP_IMAGE_SEARCH_VIP_ONLY', true);
}

/** GET /search/by-text — VIP only when true (default: true). */
function isClipTextSearchVipOnly() {
    return parseEnvBool('CLIP_TEXT_SEARCH_VIP_ONLY', true);
}

module.exports = {
    isClipImageSearchVipOnly,
    isClipTextSearchVipOnly,
    parseEnvBool,
};
