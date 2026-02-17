/**
 * ViewPack Hashing Utilities
 * 
 * Generates stable, canonical hashes for ViewPack change detection.
 */

import crypto from 'crypto';

/**
 * Round a value based on its format
 * @param {number|null} value
 * @param {import('./types.js').KpiFormat} format
 * @returns {number|null}
 */
function roundValue(value, format) {
  if (value === null || value === undefined) return null;
  
  switch (format) {
    case 'pct':
    case 'index':
    case 'score':
    case 'sec':
    case 'min':
      // 1 decimal place
      return Math.round(value * 10) / 10;
    case 'count':
    case 'currency':
      // Integer
      return Math.round(value);
    default:
      return Math.round(value * 10) / 10;
  }
}

/**
 * Create canonical representation of a KPI for hashing
 * @param {import('./types.js').ViewPackKpi} kpi
 * @returns {Object}
 */
function canonicalizeKpi(kpi) {
  return {
    id: kpi.id,
    value: roundValue(kpi.value, kpi.format),
    status: kpi.status || 'na',
  };
}

/**
 * Create canonical JSON string with stable key ordering
 * @param {Object} obj
 * @returns {string}
 */
function stableStringify(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => `"${key}":${stableStringify(obj[key])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Generate hash for a ViewPack
 * Returns first 16 characters of base64url-encoded SHA256
 * 
 * @param {import('./types.js').ViewPack} viewPack
 * @returns {string}
 */
export function hashViewPack(viewPack) {
  const canonical = {
    venueId: viewPack.venueId,
    personaId: viewPack.personaId,
    stepId: viewPack.stepId,
    period: viewPack.period,
    kpis: viewPack.kpis.map(canonicalizeKpi),
  };

  const jsonStr = stableStringify(canonical);
  const hash = crypto.createHash('sha256').update(jsonStr).digest('base64url');
  
  return hash.substring(0, 16);
}

/**
 * Generate a simple hash for cache invalidation (less stable, includes time)
 * @param {string} venueId
 * @param {string} personaId
 * @param {string} stepId
 * @param {number} endTs
 * @returns {string}
 */
export function generateCacheKey(venueId, personaId, stepId, endTs) {
  // 5-minute bucket
  const timeBucket = Math.floor(endTs / (5 * 60 * 1000));
  const input = `${venueId}:${personaId}:${stepId}:${timeBucket}`;
  return crypto.createHash('md5').update(input).digest('hex').substring(0, 12);
}

/**
 * Hash arbitrary object for comparison
 * @param {Object} obj
 * @returns {string}
 */
export function hashObject(obj) {
  const jsonStr = stableStringify(obj);
  return crypto.createHash('sha256').update(jsonStr).digest('base64url').substring(0, 16);
}

export default {
  hashViewPack,
  generateCacheKey,
  hashObject,
  roundValue,
};
