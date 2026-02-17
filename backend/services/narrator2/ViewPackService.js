/**
 * ViewPack Assembly Service
 * 
 * Builds ViewPacks by fetching KPI data from existing APIs,
 * applying thresholds, and caching results.
 */

import { periodToTimeRange, MAX_KPIS_PER_VIEWPACK, MAX_PAYLOAD_SIZE } from './types.js';
import { 
  getStepDefinition, 
  getRequiredFeatureFlags,
  getKpiIdsForStep,
  getKpiMetadata,
  mapKpiIdToApiField,
  getPrimarySourceForStep,
  getDeepLinkForStep,
} from './PersonaStepRegistry.js';
import { cacheGet, cacheSet, generateViewpackKey } from './CacheLayer.js';
import { evaluateStatus } from './Thresholds.js';
import { hashViewPack } from './Hashing.js';
import KpiSourceAdapter from './KpiSourceAdapter.js';

/**
 * @typedef {import('./types.js').ViewPack} ViewPack
 * @typedef {import('./types.js').ViewPackKpi} ViewPackKpi
 * @typedef {import('./types.js').ViewPackRequest} ViewPackRequest
 */

/**
 * Build a ViewPack for the given parameters
 * @param {ViewPackRequest} params
 * @returns {Promise<{viewPack: ViewPack|null, cache: {hit: boolean, layer: string}, error?: string}>}
 */
export async function buildViewPack(params) {
  const startTime = Date.now();
  const { venueId, personaId, stepId, period, startTs, endTs, context } = params;

  // Resolve time range
  let timeRange;
  if (startTs && endTs) {
    timeRange = { startTs: parseInt(startTs), endTs: parseInt(endTs) };
  } else if (period) {
    timeRange = periodToTimeRange(period);
  } else {
    timeRange = periodToTimeRange('day');
  }

  const effectivePeriod = period || 'day';

  // Get step definition
  const stepDef = getStepDefinition(personaId, stepId);
  if (!stepDef) {
    return { viewPack: null, cache: { hit: false, layer: 'none' }, error: `Invalid persona-step combination: ${personaId}/${stepId}` };
  }

  // Check feature flags
  const requiredFlags = getRequiredFeatureFlags(personaId, stepId);
  if (requiredFlags.length > 0 && !KpiSourceAdapter.checkFeatureFlags(requiredFlags)) {
    return { 
      viewPack: null, 
      cache: { hit: false, layer: 'none' }, 
      error: `Required feature flags not enabled: ${requiredFlags.join(', ')}` 
    };
  }

  // Check cache
  const cacheKey = generateViewpackKey(venueId, personaId, stepId, effectivePeriod, timeRange.endTs);
  const cached = await cacheGet('viewpack', cacheKey);
  
  if (cached.hit) {
    console.log(`[ViewPackService] Cache hit (${cached.layer}) in ${Date.now() - startTime}ms`);
    return { viewPack: cached.data, cache: { hit: true, layer: cached.layer } };
  }

  // Fetch data from appropriate source
  let rawData = null;
  const usedEndpoints = [];

  try {
    rawData = await fetchKpiData(venueId, personaId, stepId, stepDef, timeRange, usedEndpoints);
  } catch (err) {
    console.error('[ViewPackService] Data fetch error:', err.message);
    return { viewPack: null, cache: { hit: false, layer: 'none' }, error: `Failed to fetch KPI data: ${err.message}` };
  }

  if (!rawData) {
    return { viewPack: null, cache: { hit: false, layer: 'none' }, error: 'No KPI data available' };
  }

  // Build KPIs from raw data
  const kpis = buildKpisFromData(rawData, stepDef);

  // Build supporting data (small snippets only)
  const supporting = buildSupportingData(rawData, stepDef);

  // Get feature flags state
  const featureFlags = KpiSourceAdapter.getFeatureFlags();

  // Assemble ViewPack
  const viewPack = {
    venueId,
    personaId,
    stepId,
    period: effectivePeriod,
    timeRange,
    title: stepDef.title,
    computedAt: Date.now(),
    kpis: kpis.slice(0, MAX_KPIS_PER_VIEWPACK),
    supporting,
    evidence: {
      sampleN: rawData.sampleN || rawData.totalVisitors || null,
      notes: null,
    },
    source: {
      usedEndpoints,
      featureFlags,
    },
  };

  // Check payload size
  const payloadSize = JSON.stringify(viewPack).length;
  if (payloadSize > MAX_PAYLOAD_SIZE) {
    console.warn(`[ViewPackService] Payload too large (${payloadSize} bytes), truncating supporting`);
    viewPack.supporting = {};
  }

  // Cache the result
  await cacheSet('viewpack', cacheKey, viewPack);

  console.log(`[ViewPackService] Built viewpack in ${Date.now() - startTime}ms (${kpis.length} KPIs, ${payloadSize} bytes)`);
  return { viewPack, cache: { hit: false, layer: 'none' } };
}

/**
 * Fetch KPI data from appropriate sources
 * @param {string} venueId
 * @param {string} personaId
 * @param {string} stepId
 * @param {Object} stepDef
 * @param {{startTs: number, endTs: number}} timeRange
 * @param {string[]} usedEndpoints
 * @returns {Promise<any>}
 */
async function fetchKpiData(venueId, personaId, stepId, stepDef, timeRange, usedEndpoints) {
  const { startTs, endTs } = timeRange;

  // Get primary source from registry
  const primarySource = getPrimarySourceForStep(personaId, stepId);

  // Route based on primary source
  switch (primarySource) {
    case '/api/reporting/summary':
      usedEndpoints.push('/api/reporting/summary');
      // Map persona ID for reporting API (uses different format)
      const reportingPersonaId = mapPersonaIdForReporting(personaId);
      const reportingData = await KpiSourceAdapter.getReportingSummary(venueId, reportingPersonaId, startTs, endTs);
      if (reportingData) {
        return { 
          ...reportingData.kpis, 
          supporting: reportingData.supporting,
          sampleN: reportingData.kpis?.totalVisitors,
        };
      }
      // Fallback to venue KPIs
      usedEndpoints.push('/api/venues/:venueId/kpis');
      return KpiSourceAdapter.getVenueKpis(venueId, startTs, endTs);

    case '/api/venues/:venueId/kpis':
      usedEndpoints.push('/api/venues/:venueId/kpis');
      return KpiSourceAdapter.getVenueKpis(venueId, startTs, endTs);

    case '/api/dooh/kpis':
      usedEndpoints.push('/api/dooh/kpis');
      const doohData = await KpiSourceAdapter.getDoohKpis(venueId, startTs, endTs);
      if (doohData && doohData.buckets) {
        return aggregateDoohBuckets(doohData.buckets);
      }
      return doohData;

    case '/api/dooh-attribution/kpis':
      usedEndpoints.push('/api/dooh-attribution/kpis');
      const attrData = await KpiSourceAdapter.getDoohAttributionKpis(venueId, startTs, endTs);
      if (attrData && attrData.buckets) {
        return aggregateAttributionBuckets(attrData.buckets);
      }
      return attrData;

    default:
      usedEndpoints.push('/api/venues/:venueId/kpis');
      return KpiSourceAdapter.getVenueKpis(venueId, startTs, endTs);
  }
}

/**
 * Map new persona IDs to reporting API persona IDs
 * @param {string} personaId
 * @returns {string}
 */
function mapPersonaIdForReporting(personaId) {
  const mapping = {
    'store_manager': 'store-manager',
    'category_manager': 'merchandising',
    'retail_media_manager': 'retail-media',
    'executive': 'executive',
  };
  return mapping[personaId] || personaId;
}

/**
 * Aggregate DOOH KPI buckets into summary
 * @param {Array} buckets
 * @returns {Object}
 */
function aggregateDoohBuckets(buckets) {
  if (!buckets || buckets.length === 0) {
    return null;
  }

  const totals = {
    impressions: 0,
    qualifiedImpressions: 0,
    premiumImpressions: 0,
    uniqueVisitors: 0,
    totalAttentionS: 0,
    aqsSum: 0,
    count: 0,
  };

  for (const bucket of buckets) {
    totals.impressions += bucket.impressions || 0;
    totals.qualifiedImpressions += bucket.qualified_impressions || bucket.qualifiedImpressions || 0;
    totals.premiumImpressions += bucket.premium_impressions || bucket.premiumImpressions || 0;
    totals.uniqueVisitors += bucket.unique_visitors || bucket.uniqueVisitors || 0;
    totals.totalAttentionS += bucket.total_attention_s || bucket.totalAttentionS || 0;
    totals.aqsSum += (bucket.avg_aqs || bucket.avgAqs || 0) * (bucket.impressions || 1);
    totals.count++;
  }

  return {
    impressions: totals.impressions,
    qualifiedImpressions: totals.qualifiedImpressions,
    premiumImpressions: totals.premiumImpressions,
    uniqueVisitors: totals.uniqueVisitors,
    avgAqs: totals.count > 0 ? totals.aqsSum / totals.impressions : 0,
    avgAttentionS: totals.impressions > 0 ? totals.totalAttentionS / totals.impressions : 0,
    sampleN: totals.impressions,
  };
}

/**
 * Aggregate Attribution KPI buckets into summary
 * @param {Array} buckets
 * @returns {Object}
 */
function aggregateAttributionBuckets(buckets) {
  if (!buckets || buckets.length === 0) {
    return null;
  }

  const totals = {
    exposedCount: 0,
    controlsCount: 0,
    pExposedSum: 0,
    pControlSum: 0,
    cesSum: 0,
    aarSum: 0,
    count: 0,
  };

  for (const bucket of buckets) {
    totals.exposedCount += bucket.exposed_count || bucket.exposedCount || 0;
    totals.controlsCount += bucket.controls_count || bucket.controlsCount || 0;
    totals.pExposedSum += bucket.p_exposed || bucket.pExposed || 0;
    totals.pControlSum += bucket.p_control || bucket.pControl || 0;
    totals.cesSum += bucket.ces_score || bucket.cesScore || 0;
    totals.aarSum += bucket.aar_score || bucket.aarScore || 0;
    totals.count++;
  }

  const avgPExposed = totals.count > 0 ? totals.pExposedSum / totals.count : 0;
  const avgPControl = totals.count > 0 ? totals.pControlSum / totals.count : 0;

  return {
    exposedCount: totals.exposedCount,
    controlsCount: totals.controlsCount,
    ces: totals.count > 0 ? totals.cesSum / totals.count : 0,
    aar: totals.count > 0 ? totals.aarSum / totals.count : 0,
    liftRel: avgPControl > 0 ? ((avgPExposed - avgPControl) / avgPControl) * 100 : 0,
    ttaAccel: 0, // Requires more data
    confidenceMean: 0.7, // Default
    sampleN: totals.exposedCount,
  };
}

/**
 * Build ViewPackKpi array from raw data using registry KPI IDs
 * @param {Object} rawData
 * @param {Object} stepDef
 * @returns {ViewPackKpi[]}
 */
function buildKpisFromData(rawData, stepDef) {
  const kpis = [];

  // Get KPI IDs from step definition (JSON registry)
  const kpiIds = stepDef.kpis || [];

  for (const kpiId of kpiIds) {
    // Map registry KPI ID to API field name
    const apiField = mapKpiIdToApiField(kpiId);
    
    // Get metadata (label, format, thresholds, etc.)
    const metadata = getKpiMetadata(kpiId);
    
    // Extract value using mapped field name
    const value = extractKpiValue(rawData, apiField);
    
    // Evaluate status against thresholds
    const status = evaluateStatus(value, metadata.thresholds);

    kpis.push({
      id: kpiId,
      label: metadata.label,
      value,
      unit: metadata.unit,
      format: metadata.format,
      delta: null, // Could compute from previous period
      status,
      hint: metadata.hint,
    });
  }

  return kpis;
}

/**
 * Extract KPI value from raw data (handles various key formats)
 * @param {Object} data
 * @param {string} kpiId
 * @returns {number|null}
 */
function extractKpiValue(data, kpiId) {
  if (!data) return null;

  // Helper to safely parse value (preserves 0)
  const safeParseValue = (val) => {
    if (val === null || val === undefined) return null;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
  };

  // Direct match
  if (data[kpiId] !== undefined) {
    return safeParseValue(data[kpiId]);
  }

  // Snake case conversion
  const snakeCase = kpiId.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (data[snakeCase] !== undefined) {
    return safeParseValue(data[snakeCase]);
  }

  // Nested in kpis object
  if (data.kpis && data.kpis[kpiId] !== undefined) {
    return safeParseValue(data.kpis[kpiId]);
  }

  return null;
}

/**
 * Build small supporting data snippets
 * @param {Object} rawData
 * @param {Object} stepDef
 * @returns {Record<string, unknown>}
 */
function buildSupportingData(rawData, stepDef) {
  const supporting = {};
  
  if (!stepDef.supportingFields || !rawData.supporting) {
    return supporting;
  }

  for (const field of stepDef.supportingFields) {
    const value = rawData.supporting?.[field];
    if (value) {
      // Truncate arrays to max 3 items
      if (Array.isArray(value)) {
        supporting[field] = value.slice(0, 3);
      } else {
        supporting[field] = value;
      }
    }
  }

  return supporting;
}

/**
 * Get hash for a ViewPack
 * @param {ViewPack} viewPack
 * @returns {string}
 */
export function getViewPackHash(viewPack) {
  return hashViewPack(viewPack);
}

export default {
  buildViewPack,
  getViewPackHash,
};
