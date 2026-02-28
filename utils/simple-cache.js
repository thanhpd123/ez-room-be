/**
 * Simple in-memory TTL cache for reference data (amenities, room-types).
 * Cache is invalidated after TTL_MS; no distributed invalidation.
 */
const TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map();

function get(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function set(key, value) {
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

function invalidate(keyOrPrefix) {
    if (!keyOrPrefix) {
        cache.clear();
        return;
    }
    for (const k of cache.keys()) {
        if (k === keyOrPrefix || k.startsWith(keyOrPrefix + ':')) cache.delete(k);
    }
}

module.exports = { get, set, invalidate };
