/**
 * Narrator2 Utility Functions
 */

/**
 * Safe JSON parse with fallback
 * @param {string} str
 * @param {any} fallback
 * @returns {any}
 */
export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Clamp a number between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Create a timeout promise
 * @param {number} ms
 * @returns {Promise<never>}
 */
export function timeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
}

/**
 * Race a promise against a timeout
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 * @template T
 */
export function withTimeout(promise, ms) {
  return Promise.race([promise, timeout(ms)]);
}

/**
 * Format duration in ms to human readable
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

/**
 * Truncate string to max length
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(str, maxLength) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Deep clone an object (simple version)
 * @param {T} obj
 * @returns {T}
 * @template T
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Pick specific keys from an object
 * @param {Object} obj
 * @param {string[]} keys
 * @returns {Object}
 */
export function pick(obj, keys) {
  const result = {};
  for (const key of keys) {
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specific keys from an object
 * @param {Object} obj
 * @param {string[]} keys
 * @returns {Object}
 */
export function omit(obj, keys) {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

export default {
  safeJsonParse,
  clamp,
  timeout,
  withTimeout,
  formatDuration,
  truncate,
  deepClone,
  pick,
  omit,
};
