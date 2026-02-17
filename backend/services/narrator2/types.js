/**
 * Narrator2 Type Definitions
 * 
 * ViewPack contract for persona+step storytelling data.
 * All types are documented via JSDoc for JavaScript compatibility.
 */

/**
 * @typedef {'hour'|'day'|'week'|'month'} Period
 */

/**
 * @typedef {'store_manager'|'category_manager'|'retail_media_manager'|'executive'} PersonaId
 */

/**
 * @typedef {'operations_pulse'|'checkout_pressure'|'category_engagement'|'shelf_quality'|'dooh_effectiveness'|'attention_to_action'|'business_overview'|'growth_opportunities'} StepId
 */

/**
 * @typedef {'pct'|'sec'|'min'|'count'|'index'|'score'|'currency'} KpiFormat
 */

/**
 * @typedef {'green'|'amber'|'red'|'na'} KpiStatus
 */

/**
 * @typedef {Object} ViewPackKpi
 * @property {string} id - Stable KPI key (matches existing KPI names)
 * @property {string} label - UI display label
 * @property {number|null} value - KPI value
 * @property {string} [unit] - Display unit (e.g., '%', 'min', 'pax')
 * @property {KpiFormat} format - Value format type
 * @property {number|null} [delta] - Change from previous period
 * @property {KpiStatus} [status] - Threshold status
 * @property {string} [hint] - 1-line business hint
 */

/**
 * @typedef {Object} TimeRange
 * @property {number} startTs - Start timestamp in ms
 * @property {number} endTs - End timestamp in ms
 */

/**
 * @typedef {Object} ViewPackEvidence
 * @property {number} [sampleN] - Sample size
 * @property {string} [notes] - Additional notes
 */

/**
 * @typedef {Object} ViewPackSource
 * @property {string[]} usedEndpoints - List of API endpoints used
 * @property {Record<string, boolean>} featureFlags - Active feature flags
 */

/**
 * @typedef {Object} ViewPack
 * @property {string} venueId - Venue identifier
 * @property {PersonaId} personaId - Persona identifier
 * @property {StepId} stepId - Step identifier
 * @property {Period} period - Time period
 * @property {TimeRange} timeRange - Exact time range used
 * @property {string} title - Display title for this viewpack
 * @property {number} [computedAt] - Timestamp when computed
 * @property {ViewPackKpi[]} kpis - KPI array (max 7)
 * @property {Record<string, unknown>} [supporting] - Optional small supporting data
 * @property {ViewPackEvidence} [evidence] - Evidence metadata
 * @property {ViewPackSource} source - Data source information
 */

/**
 * @typedef {Object} ViewPackRequest
 * @property {string} venueId - Required venue ID
 * @property {PersonaId} personaId - Required persona ID
 * @property {StepId} stepId - Required step ID
 * @property {Period} [period] - Time period shortcut
 * @property {number} [startTs] - Start timestamp (alternative to period)
 * @property {number} [endTs] - End timestamp (alternative to period)
 * @property {Record<string, unknown>} [context] - Optional context
 */

/**
 * @typedef {Object} NarrationResponse
 * @property {string} headline - Main headline
 * @property {string[]} bullets - 2-4 bullet points
 * @property {Array<{label: string, uiIntent: string}>} recommendedActions - UI actions
 * @property {'low'|'medium'|'high'} confidence - Confidence level
 */

/**
 * @typedef {Object} CacheInfo
 * @property {boolean} hit - Whether cache was hit
 * @property {'L1'|'L2'|'none'} layer - Cache layer used
 */

/**
 * @typedef {Object} ViewPackHashResponse
 * @property {string} hash - Content hash (16 chars)
 * @property {number} computedAt - Timestamp
 * @property {CacheInfo} cache - Cache info
 */

// Valid persona IDs (from PersonaStepRegistry.json)
export const VALID_PERSONAS = ['store_manager', 'category_manager', 'retail_media_manager', 'executive'];

// Valid step IDs (from PersonaStepRegistry.json)
export const VALID_STEPS = [
  'operations_pulse',
  'checkout_pressure',
  'category_engagement',
  'shelf_quality',
  'dooh_effectiveness',
  'attention_to_action',
  'business_overview',
  'growth_opportunities',
];

// Valid periods
export const VALID_PERIODS = ['hour', 'day', 'week', 'month'];

// Max KPIs per viewpack
export const MAX_KPIS_PER_VIEWPACK = 7;

// Max payload size in bytes
export const MAX_PAYLOAD_SIZE = 20 * 1024; // 20KB

/**
 * Convert period to time range
 * @param {Period} period
 * @param {number} [now] - Reference timestamp (default: Date.now())
 * @returns {TimeRange}
 */
export function periodToTimeRange(period, now = Date.now()) {
  const endTs = now;
  let startTs;
  
  switch (period) {
    case 'hour':
      startTs = endTs - 60 * 60 * 1000;
      break;
    case 'day':
      startTs = endTs - 24 * 60 * 60 * 1000;
      break;
    case 'week':
      startTs = endTs - 7 * 24 * 60 * 60 * 1000;
      break;
    case 'month':
      startTs = endTs - 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      startTs = endTs - 24 * 60 * 60 * 1000; // default to day
  }
  
  return { startTs, endTs };
}

/**
 * Validate ViewPack request parameters
 * @param {ViewPackRequest} params
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateViewPackRequest(params) {
  if (!params.venueId) {
    return { valid: false, error: 'venueId is required' };
  }
  
  if (!params.personaId || !VALID_PERSONAS.includes(params.personaId)) {
    return { valid: false, error: `personaId must be one of: ${VALID_PERSONAS.join(', ')}` };
  }
  
  if (!params.stepId || !VALID_STEPS.includes(params.stepId)) {
    return { valid: false, error: `stepId must be one of: ${VALID_STEPS.join(', ')}` };
  }
  
  // Must have either period OR (startTs + endTs)
  if (!params.period && (!params.startTs || !params.endTs)) {
    return { valid: false, error: 'Either period or (startTs + endTs) is required' };
  }
  
  if (params.period && !VALID_PERIODS.includes(params.period)) {
    return { valid: false, error: `period must be one of: ${VALID_PERIODS.join(', ')}` };
  }
  
  if (params.startTs && params.endTs && params.endTs <= params.startTs) {
    return { valid: false, error: 'endTs must be greater than startTs' };
  }
  
  return { valid: true };
}
