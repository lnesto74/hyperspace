/**
 * Two-tier Cache Layer for Narrator2
 * 
 * L1: In-memory LRU cache (always active)
 * L2: Redis (optional, only if REDIS_URL is set)
 */

/**
 * Simple LRU Cache implementation
 */
class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }
    const item = this.cache.get(key);
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key, value, ttlMs = 60000) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

/**
 * Redis client wrapper (lazy initialization)
 */
let redisClient = null;
let redisConnected = false;

async function getRedisClient() {
  if (redisClient !== null) {
    return redisConnected ? redisClient : null;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    redisClient = false; // Mark as checked but not available
    return null;
  }

  try {
    // Dynamic import to avoid requiring redis if not used
    const redis = await import('redis');
    redisClient = redis.createClient({ url: redisUrl });
    
    redisClient.on('error', (err) => {
      console.warn('[Narrator2 Cache] Redis error:', err.message);
      redisConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('[Narrator2 Cache] Redis connected');
      redisConnected = true;
    });

    await redisClient.connect();
    redisConnected = true;
    return redisClient;
  } catch (err) {
    console.warn('[Narrator2 Cache] Redis unavailable:', err.message);
    redisClient = false;
    return null;
  }
}

// L1 cache instances
const viewpackCache = new LRUCache(200);
const narrationCache = new LRUCache(100);

// Cache key prefixes
const VIEWPACK_PREFIX = 'narr2:viewpack:';
const NARRATION_PREFIX = 'narr2:narration:';

// TTL settings
const L1_TTL_MS = 60 * 1000;       // 60 seconds
const L2_TTL_SEC = 10 * 60;        // 10 minutes

/**
 * @typedef {Object} CacheResult
 * @property {any} data - Cached data (null if miss)
 * @property {boolean} hit - Whether cache was hit
 * @property {'L1'|'L2'|'none'} layer - Which cache layer served the data
 */

/**
 * Generate cache key for viewpack
 * @param {string} venueId
 * @param {string} personaId
 * @param {string} stepId
 * @param {string} period
 * @param {number} endTs
 * @returns {string}
 */
export function generateViewpackKey(venueId, personaId, stepId, period, endTs) {
  // 5-minute bucket for better cache hit rate
  const timeBucket = Math.floor(endTs / (5 * 60 * 1000));
  return `${venueId}:${personaId}:${stepId}:${period}:${timeBucket}`;
}

/**
 * Generate cache key for narration
 * @param {string} viewpackHash
 * @returns {string}
 */
export function generateNarrationKey(viewpackHash) {
  return viewpackHash;
}

/**
 * Get from cache (L1 first, then L2)
 * @param {string} type - 'viewpack' or 'narration'
 * @param {string} key
 * @returns {Promise<CacheResult>}
 */
export async function cacheGet(type, key) {
  const startTime = Date.now();
  const l1Cache = type === 'viewpack' ? viewpackCache : narrationCache;
  const prefix = type === 'viewpack' ? VIEWPACK_PREFIX : NARRATION_PREFIX;

  // Try L1 first
  const l1Data = l1Cache.get(key);
  if (l1Data !== null) {
    console.log(`[Narrator2 Cache] L1 hit for ${type}:${key} (${Date.now() - startTime}ms)`);
    return { data: l1Data, hit: true, layer: 'L1' };
  }

  // Try L2 (Redis) if available
  try {
    const redis = await getRedisClient();
    if (redis) {
      const redisKey = prefix + key;
      const redisData = await redis.get(redisKey);
      if (redisData) {
        const parsed = JSON.parse(redisData);
        // Backfill L1
        l1Cache.set(key, parsed, L1_TTL_MS);
        console.log(`[Narrator2 Cache] L2 hit for ${type}:${key} (${Date.now() - startTime}ms)`);
        return { data: parsed, hit: true, layer: 'L2' };
      }
    }
  } catch (err) {
    console.warn(`[Narrator2 Cache] L2 get error:`, err.message);
  }

  console.log(`[Narrator2 Cache] Miss for ${type}:${key} (${Date.now() - startTime}ms)`);
  return { data: null, hit: false, layer: 'none' };
}

/**
 * Set in cache (both L1 and L2)
 * @param {string} type - 'viewpack' or 'narration'
 * @param {string} key
 * @param {any} data
 * @returns {Promise<void>}
 */
export async function cacheSet(type, key, data) {
  const l1Cache = type === 'viewpack' ? viewpackCache : narrationCache;
  const prefix = type === 'viewpack' ? VIEWPACK_PREFIX : NARRATION_PREFIX;

  // Set L1
  l1Cache.set(key, data, L1_TTL_MS);

  // Set L2 (Redis) if available (fire and forget)
  try {
    const redis = await getRedisClient();
    if (redis) {
      const redisKey = prefix + key;
      const serialized = JSON.stringify(data);
      await redis.setEx(redisKey, L2_TTL_SEC, serialized);
    }
  } catch (err) {
    console.warn(`[Narrator2 Cache] L2 set error:`, err.message);
  }
}

/**
 * Invalidate cache entry
 * @param {string} type - 'viewpack' or 'narration'
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function cacheInvalidate(type, key) {
  const l1Cache = type === 'viewpack' ? viewpackCache : narrationCache;
  const prefix = type === 'viewpack' ? VIEWPACK_PREFIX : NARRATION_PREFIX;

  l1Cache.delete(key);

  try {
    const redis = await getRedisClient();
    if (redis) {
      await redis.del(prefix + key);
    }
  } catch (err) {
    console.warn(`[Narrator2 Cache] L2 invalidate error:`, err.message);
  }
}

/**
 * Get cache statistics
 * @returns {Object}
 */
export function getCacheStats() {
  return {
    l1: {
      viewpackSize: viewpackCache.size(),
      narrationSize: narrationCache.size(),
    },
    l2: {
      available: redisConnected,
      url: process.env.REDIS_URL ? '(configured)' : '(not configured)',
    },
  };
}

/**
 * Clear all caches (for testing)
 */
export function clearAllCaches() {
  viewpackCache.clear();
  narrationCache.clear();
}

export default {
  generateViewpackKey,
  generateNarrationKey,
  cacheGet,
  cacheSet,
  cacheInvalidate,
  getCacheStats,
  clearAllCaches,
};
