const Redis = require('ioredis');

// Connect to Redis if REDIS_URL is provided, otherwise fallback to null (cache disabled)
const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

if (redisClient) {
    redisClient.on('connect', () => console.log('Redis connected successfully.'));
    redisClient.on('error', (err) => console.error('Redis connection error:', err));
} else {
    console.warn('No REDIS_URL found, Redis cache is disabled. Set REDIS_URL in .env to enable caching.');
}

module.exports = redisClient;
