/**
 * Persona + Step Registry
 * 
 * JSON-driven registry for persona-based KPI storytelling.
 * Loads from PersonaStepRegistry.json for deterministic, config-driven behavior.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load JSON registry
const registryPath = join(__dirname, 'PersonaStepRegistry.json');
const REGISTRY_JSON = JSON.parse(readFileSync(registryPath, 'utf-8'));

/**
 * KPI ID mapping: Registry ID → API response field
 * Maps user-friendly KPI names to actual API response keys
 * 
 * Source references:
 * - Zone KPIs: GET /roi/:roiId/kpis → response.kpis.<field>
 * - Shelf KPIs: Derived from zone_kpi_* + planogram tables
 * - PEBLE KPIs: GET /dooh-attribution/kpis
 * - Reporting KPIs: GET /reporting/summary → response.kpis.<field>
 */
export const KPI_ID_MAP = {
  // ═══════════════════════════════════════════════════════════════
  // PEBLE™ / DOOH Attribution KPIs (from /dooh-attribution/kpis)
  // ═══════════════════════════════════════════════════════════════
  'PEBLE': 'ces',                    // Composite Effectiveness Score
  'EAL': 'eal',                      // Exposure-to-Action Lift (same as liftRel)
  'AQS': 'aqs',                      // Attention Quality Score (from /reporting/summary)
  'TTA': 'ttaAccel',                 // Time-to-Action acceleration
  'DCI': 'engagementLiftS',          // Depth of Category Index (engagement lift seconds)
  'CES': 'ces',                      // Campaign Effectiveness Score
  'AAR': 'aar',                      // Attention-to-Action Rate
  'SEQ': 'seq',                      // Screen Engagement Quality
  'pExposed': 'pExposed',            // Exposed conversion rate
  'pControl': 'pControl',            // Control conversion rate
  'confidenceScore': 'confidenceMean',
  'liftRel': 'liftRel',              // Relative lift (same as EAL)
  'liftAbs': 'liftAbs',              // Absolute lift
  
  // ═══════════════════════════════════════════════════════════════
  // Zone KPIs (from KpiSourceAdapter direct DB queries)
  // DB: zone_kpi_daily, zone_kpi_hourly, zone_visits, zone_occupancy
  // ═══════════════════════════════════════════════════════════════
  'totalVisitors': 'totalVisitors',  // SUM(visits)
  'occupancyRate': 'avgOccupancy',   // computed from sum_occupancy/total_occupancy_samples
  'avgOccupancy': 'avgOccupancy',
  'peakOccupancy': 'peakOccupancy',  // MAX(peak_occupancy)
  'avgDwellTime': 'avgDwellTime',    // time_spent_ms / visits / 60000
  'avgDwellTimeMs': 'avgDwellTime',  // same field, minutes
  'engagementRate': 'engagementRate', // engagements_cumulative / visits * 100
  'bounceRate': 'bounceRate',        // bounces / visits * 100
  
  // Queue/Checkout KPIs (Operations Grade - 8 KPIs)
  // A. Capacity & Staffing
  'avgConcurrentOpenLanes': 'avgConcurrentOpenLanes',  // avg lanes serving simultaneously
  'peakConcurrentOpenLanes': 'peakConcurrentOpenLanes', // max concurrent lanes
  'lanesUsedCoverage': 'lanesUsedCoverage',            // distinct queue zones used
  // B. Customer Experience
  'avgQueueWaitTime': 'avgQueueWaitTime',              // avg wait time in minutes
  'p95QueueWaitTime': 'p95QueueWaitTime',              // 95th percentile wait time
  // C. Flow & Efficiency
  'queueThroughput': 'queueThroughput',                // customers served per hour
  'avgServiceTime': 'avgServiceTime',                  // avg service duration
  // D. Failure Signal
  'queueAbandonmentRate': 'queueAbandonmentRate',      // % abandoned sessions
  // Legacy mappings (for backward compatibility)
  'queueWaitTime': 'avgQueueWaitTime',
  'cashierOpenCount': 'avgConcurrentOpenLanes',
  'openLanes': 'lanesUsedCoverage',
  'passByTraffic': 'totalVisitors',
  'conversionRate': 'conversionRate',
  'alertIndex': 'alertCount',
  
  // ═══════════════════════════════════════════════════════════════
  // Shelf / Planogram KPIs (from KpiSourceAdapter)
  // DB: zone_kpi_* + planograms, shelf_planograms, sku_items
  // ═══════════════════════════════════════════════════════════════
  'browsingRate': 'browsingRate',    // dwells_cumulative / visits * 100
  'avgBrowseTime': 'avgDwellTime',   // same as dwell time for shelf zones
  'passbyCount': 'passbyCount',
  'shareOfShelf': 'shareOfShelf',
  'avgPositionScore': 'avgPositionScore',
  'efficiencyIndex': 'efficiencyIndex',
  'slotUtilizationRate': 'slotUtilizationRate',
  'deadZoneCount': 'deadZones',
  'brandEfficiencyIndex': 'brandEfficiency',
  
  // Category KPIs (derived from zone KPIs)
  'categoryEngagementRate': 'engagementRate',
  'categoryDwellTime': 'avgDwellTime',
  'categoryConversionRate': 'conversionRate',
  'categoryRevenuePerVisit': 'revenuePerVisit',
  'categoryComparisonIndex': 'categoryIndex',
  
  // ═══════════════════════════════════════════════════════════════
  // Business Reporting KPIs (from /reporting/summary → kpis.<field>)
  // ═══════════════════════════════════════════════════════════════
  'aal': 'aal',                      // reporting-specific metric
  'aqs': 'aqs',                      // Attention Quality Score
  'eal': 'eal',                      // Exposure-to-Action Lift
  
  // Executive KPIs
  'avgBasketValue': 'avgBasketValue',
  'revenuePerSqm': 'revenuePerSqm',
  'operationalEfficiencyIndex': 'efficiencyIndex',
  'underperformingZones': 'underperformingCount',
};

/**
 * KPI metadata for display and thresholds
 * Source: HYPERSPACE_WIKI + DATABASE_AND_API documentation
 */
export const KPI_METADATA = {
  // ═══════════════════════════════════════════════════════════════
  // PEBLE™ / DOOH Attribution KPIs
  // ═══════════════════════════════════════════════════════════════
  'PEBLE': { label: 'PEBLE™ Score', format: 'score', thresholds: { green: 70, amber: 50, direction: 'higher' }, hint: 'Post-Exposure Behavioral Lift' },
  'EAL': { label: 'EAL™', format: 'pct', unit: '%', thresholds: { green: 20, amber: 5, direction: 'higher' }, hint: 'Exposure-to-Action Lift (relative lift)' },
  'AQS': { label: 'AQS™', format: 'score', thresholds: { green: 70, amber: 50, direction: 'higher' }, hint: 'Attention Quality Score (0-100)' },
  'TTA': { label: 'TTA™', format: 'pct', unit: '%', thresholds: { green: 15, amber: 5, direction: 'higher' }, hint: 'Time-to-Action acceleration' },
  'DCI': { label: 'DCI™', format: 'sec', unit: 's', thresholds: { green: 10, amber: 5, direction: 'higher' }, hint: 'Engagement lift (seconds)' },
  'CES': { label: 'CES™', format: 'score', thresholds: { green: 70, amber: 50, direction: 'higher' }, hint: 'Campaign Effectiveness Score' },
  'AAR': { label: 'AAR', format: 'score', thresholds: { green: 0.7, amber: 0.4, direction: 'higher' }, hint: 'Attention-to-Action Rate' },
  'SEQ': { label: 'SEQ', format: 'score', thresholds: { green: 70, amber: 50, direction: 'higher' }, hint: 'Screen Engagement Quality' },
  'pExposed': { label: 'P(Exposed)', format: 'pct', unit: '%', thresholds: { green: 30, amber: 15, direction: 'higher' }, hint: 'Exposed conversion rate' },
  'pControl': { label: 'P(Control)', format: 'pct', unit: '%', hint: 'Control group conversion rate' },
  'confidenceScore': { label: 'Confidence', format: 'pct', unit: '%', thresholds: { green: 80, amber: 60, direction: 'higher' }, hint: 'Attribution confidence' },
  'liftRel': { label: 'Relative Lift', format: 'pct', unit: '%', thresholds: { green: 20, amber: 5, direction: 'higher' }, hint: 'Relative conversion lift vs control' },
  'liftAbs': { label: 'Absolute Lift', format: 'pct', unit: '%', thresholds: { green: 10, amber: 3, direction: 'higher' }, hint: 'Absolute conversion lift' },
  
  // ═══════════════════════════════════════════════════════════════
  // Zone KPIs (from /roi/:roiId/kpis)
  // DB: zone_kpi_daily, zone_kpi_hourly, zone_visits, zone_occupancy
  // ═══════════════════════════════════════════════════════════════
  'totalVisitors': { label: 'Total Visitors', format: 'count', thresholds: { green: 500, amber: 200, direction: 'higher' }, hint: 'Zone/store visitors' },
  'avgOccupancy': { label: 'Avg Occupancy', format: 'count', unit: 'pax', thresholds: { green: 80, amber: 100, direction: 'lower' }, hint: 'Average people in zone' },
  'occupancyRate': { label: 'Occupancy Rate', format: 'pct', unit: '%', thresholds: { green: 70, amber: 90, direction: 'lower' }, hint: 'Current zone occupancy' },
  'peakOccupancy': { label: 'Peak Occupancy', format: 'count', unit: 'pax', thresholds: { green: 100, amber: 150, direction: 'lower' }, hint: 'Maximum simultaneous visitors' },
  'avgDwellTime': { label: 'Avg Dwell Time', format: 'min', unit: 'min', thresholds: { green: 5, amber: 2, direction: 'higher' }, hint: 'Average time spent (from zone_visits.duration_ms)' },
  'avgDwellTimeMs': { label: 'Avg Dwell Time', format: 'sec', unit: 'ms', thresholds: { green: 300000, amber: 120000, direction: 'higher' }, hint: 'Average time spent in ms' },
  'engagementRate': { label: 'Engagement Rate', format: 'pct', unit: '%', thresholds: { green: 60, amber: 30, direction: 'higher' }, hint: 'Meaningful interactions (zone_visits.is_engagement)' },
  'bounceRate': { label: 'Bounce Rate', format: 'pct', unit: '%', thresholds: { green: 20, amber: 50, direction: 'lower' }, hint: 'Left quickly without engagement' },
  
  // Queue/Checkout KPIs (Operations Grade - 8 KPIs)
  // A. Capacity & Staffing
  'avgConcurrentOpenLanes': { label: 'Avg Open Lanes', format: 'decimal', unit: 'lanes', thresholds: { green: 4, amber: 2, direction: 'higher' }, hint: 'Average lanes serving simultaneously' },
  'peakConcurrentOpenLanes': { label: 'Peak Open Lanes', format: 'count', unit: 'lanes', thresholds: { green: 6, amber: 3, direction: 'higher' }, hint: 'Maximum concurrent lanes' },
  'lanesUsedCoverage': { label: 'Lanes Used', format: 'count', unit: 'lanes', thresholds: { green: 6, amber: 3, direction: 'higher' }, hint: 'Distinct lanes with activity' },
  // B. Customer Experience
  'avgQueueWaitTime': { label: 'Avg Wait Time', format: 'min', unit: 'min', thresholds: { green: 2, amber: 4, direction: 'lower' }, hint: 'Average queue waiting time' },
  'p95QueueWaitTime': { label: 'P95 Wait Time', format: 'min', unit: 'min', thresholds: { green: 4, amber: 8, direction: 'lower' }, hint: '95% of customers waited less than this' },
  // C. Flow & Efficiency
  'queueThroughput': { label: 'Throughput', format: 'decimal', unit: '/hr', thresholds: { green: 1, amber: 0.5, direction: 'higher' }, hint: 'Customers served per hour' },
  'avgServiceTime': { label: 'Avg Service Time', format: 'min', unit: 'min', thresholds: { green: 3, amber: 5, direction: 'lower' }, hint: 'Average time to serve customer' },
  // D. Failure Signal
  'queueAbandonmentRate': { label: 'Abandonment Rate', format: 'pct', unit: '%', thresholds: { green: 5, amber: 15, direction: 'lower' }, hint: 'Left queue without service' },
  // Legacy/compatibility KPIs
  'queueWaitTime': { label: 'Queue Wait Time', format: 'min', unit: 'min', thresholds: { green: 2, amber: 5, direction: 'lower' }, hint: 'Average queue wait' },
  'cashierOpenCount': { label: 'Open Lanes', format: 'count', thresholds: { green: 4, amber: 2, direction: 'higher' }, hint: 'Active checkout lanes' },
  'passByTraffic': { label: 'Pass-By Traffic', format: 'count', thresholds: { green: 500, amber: 200, direction: 'higher' }, hint: 'Total visitors' },
  'conversionRate': { label: 'Conversion Rate', format: 'pct', unit: '%', thresholds: { green: 30, amber: 15, direction: 'higher' }, hint: 'Visitor to buyer' },
  'alertIndex': { label: 'Alert Index', format: 'count', thresholds: { green: 0, amber: 3, direction: 'lower' }, hint: 'Active alerts' },
  
  // ═══════════════════════════════════════════════════════════════
  // Shelf / Planogram KPIs (canonical IDs from wiki)
  // DB: zone_kpi_* + planograms, shelf_planograms, sku_items
  // ═══════════════════════════════════════════════════════════════
  'browsingRate': { label: 'Browsing Rate', format: 'pct', unit: '%', thresholds: { green: 60, amber: 30, direction: 'higher' }, hint: 'Visitors who browsed (based on zone visits)' },
  'avgBrowseTime': { label: 'Avg Browse Time', format: 'min', unit: 'min', thresholds: { green: 3, amber: 1, direction: 'higher' }, hint: 'Time at shelves (zone_visits.duration_ms)' },
  'passbyCount': { label: 'Pass-By Count', format: 'count', thresholds: { green: 200, amber: 50, direction: 'higher' }, hint: 'Visits - Dwells' },
  'shareOfShelf': { label: 'Share of Shelf', format: 'pct', unit: '%', thresholds: { green: 20, amber: 10, direction: 'higher' }, hint: 'From planogram slot counts' },
  'avgPositionScore': { label: 'Position Score', format: 'score', thresholds: { green: 80, amber: 60, direction: 'higher' }, hint: 'Shelf placement quality (planogram + scoring)' },
  'efficiencyIndex': { label: 'Efficiency Index', format: 'index', thresholds: { green: 1.2, amber: 0.8, direction: 'higher' }, hint: 'Performance vs shelf share' },
  'slotUtilizationRate': { label: 'Slot Utilization', format: 'pct', unit: '%', thresholds: { green: 90, amber: 70, direction: 'higher' }, hint: 'Shelf slots filled' },
  'deadZoneCount': { label: 'Dead Zones', format: 'count', thresholds: { green: 0, amber: 3, direction: 'lower' }, hint: 'Low-traffic areas' },
  'brandEfficiencyIndex': { label: 'Brand Efficiency', format: 'index', thresholds: { green: 1.2, amber: 0.8, direction: 'higher' }, hint: 'Brand performance index' },
  
  // Category KPIs (derived)
  'categoryEngagementRate': { label: 'Category Engagement', format: 'pct', unit: '%', thresholds: { green: 50, amber: 25, direction: 'higher' }, hint: 'Category interaction rate' },
  'categoryDwellTime': { label: 'Category Dwell', format: 'min', unit: 'min', thresholds: { green: 3, amber: 1, direction: 'higher' }, hint: 'Time in category' },
  'categoryConversionRate': { label: 'Category Conversion', format: 'pct', unit: '%', thresholds: { green: 20, amber: 10, direction: 'higher' }, hint: 'Category purchase rate' },
  'categoryRevenuePerVisit': { label: 'Revenue/Visit', format: 'currency', unit: '$', thresholds: { green: 15, amber: 8, direction: 'higher' }, hint: 'Category revenue per visit' },
  'categoryComparisonIndex': { label: 'Category Index', format: 'index', thresholds: { green: 1.2, amber: 0.8, direction: 'higher' }, hint: 'vs category benchmark' },
  
  // ═══════════════════════════════════════════════════════════════
  // Business Reporting / Executive KPIs
  // ═══════════════════════════════════════════════════════════════
  'aal': { label: 'AAL', format: 'score', thresholds: { green: 70, amber: 50, direction: 'higher' }, hint: 'Aggregate Attention Level' },
  'aqs': { label: 'AQS', format: 'score', thresholds: { green: 70, amber: 50, direction: 'higher' }, hint: 'Attention Quality Score' },
  'eal': { label: 'EAL', format: 'pct', unit: '%', thresholds: { green: 20, amber: 5, direction: 'higher' }, hint: 'Exposure-to-Action Lift' },
  'avgBasketValue': { label: 'Avg Basket Value', format: 'currency', unit: '$', thresholds: { green: 50, amber: 25, direction: 'higher' }, hint: 'Average transaction' },
  'revenuePerSqm': { label: 'Revenue/sqm', format: 'currency', unit: '$/sqm', thresholds: { green: 100, amber: 50, direction: 'higher' }, hint: 'Space productivity' },
  'operationalEfficiencyIndex': { label: 'Op. Efficiency', format: 'index', thresholds: { green: 1.0, amber: 0.7, direction: 'higher' }, hint: 'Overall efficiency' },
  'underperformingZones': { label: 'Underperforming Zones', format: 'count', thresholds: { green: 0, amber: 3, direction: 'lower' }, hint: 'Zones needing attention' },
};

/**
 * Get the raw registry data
 */
export function getRegistry() {
  return REGISTRY_JSON;
}

/**
 * Get all valid persona IDs
 * @returns {string[]}
 */
export function getValidPersonas() {
  return Object.keys(REGISTRY_JSON.personas);
}

/**
 * Get persona definition
 * @param {string} personaId
 * @returns {Object|null}
 */
export function getPersona(personaId) {
  return REGISTRY_JSON.personas[personaId] || null;
}

/**
 * Get persona label (display name)
 * @param {string} personaId
 * @returns {string}
 */
export function getPersonaLabel(personaId) {
  const persona = getPersona(personaId);
  return persona?.label || personaId;
}

/**
 * Get persona goal
 * @param {string} personaId
 * @returns {string}
 */
export function getPersonaGoal(personaId) {
  const persona = getPersona(personaId);
  return persona?.goal || '';
}

/**
 * Get all steps for a persona
 * @param {string} personaId
 * @returns {Array<{id: string, title: string, description: string}>}
 */
export function getStepsForPersona(personaId) {
  const persona = getPersona(personaId);
  if (!persona) return [];
  return persona.steps.map(s => ({
    id: s.id,
    title: s.title,
    description: s.description,
  }));
}

/**
 * Get step definition for a persona-step combination
 * @param {string} personaId
 * @param {string} stepId
 * @returns {Object|null}
 */
export function getStepDefinition(personaId, stepId) {
  const persona = getPersona(personaId);
  if (!persona) return null;
  return persona.steps.find(s => s.id === stepId) || null;
}

/**
 * Check if a persona-step combination is valid
 * @param {string} personaId
 * @param {string} stepId
 * @returns {boolean}
 */
export function isValidPersonaStep(personaId, stepId) {
  return getStepDefinition(personaId, stepId) !== null;
}

/**
 * Get all valid step IDs across all personas
 * @returns {string[]}
 */
export function getAllStepIds() {
  const stepIds = new Set();
  for (const persona of Object.values(REGISTRY_JSON.personas)) {
    for (const step of persona.steps) {
      stepIds.add(step.id);
    }
  }
  return Array.from(stepIds);
}

/**
 * Get KPI IDs for a step
 * @param {string} personaId
 * @param {string} stepId
 * @returns {string[]}
 */
export function getKpiIdsForStep(personaId, stepId) {
  const step = getStepDefinition(personaId, stepId);
  return step?.kpis || [];
}

/**
 * Get deep link for a step
 * @param {string} personaId
 * @param {string} stepId
 * @returns {{label: string, route: string}|null}
 */
export function getDeepLinkForStep(personaId, stepId) {
  const step = getStepDefinition(personaId, stepId);
  return step?.deepLink || null;
}

/**
 * Map a registry KPI ID to API response field
 * @param {string} kpiId
 * @returns {string}
 */
export function mapKpiIdToApiField(kpiId) {
  return KPI_ID_MAP[kpiId] || kpiId;
}

/**
 * Get KPI metadata (label, format, thresholds, etc.)
 * @param {string} kpiId
 * @returns {Object}
 */
export function getKpiMetadata(kpiId) {
  return KPI_METADATA[kpiId] || {
    label: kpiId,
    format: 'count',
    hint: '',
  };
}

/**
 * Get required feature flags for a step
 * @param {string} personaId
 * @param {string} stepId
 * @returns {string[]}
 */
export function getRequiredFeatureFlags(personaId, stepId) {
  // DOOH steps require FEATURE_DOOH_KPIS or FEATURE_DOOH_ATTRIBUTION
  if (personaId === 'retail_media_manager') {
    if (stepId === 'dooh_effectiveness') {
      return ['FEATURE_DOOH_KPIS'];
    }
    if (stepId === 'attention_to_action') {
      return ['FEATURE_DOOH_ATTRIBUTION'];
    }
  }
  return [];
}

/**
 * Get primary data source endpoint for a step
 * @param {string} personaId
 * @param {string} stepId
 * @returns {string}
 */
export function getPrimarySourceForStep(personaId, stepId) {
  // Map persona-step to appropriate API endpoint
  const sourceMap = {
    'store_manager:operations_pulse': '/api/reporting/summary',
    'store_manager:checkout_pressure': '/api/reporting/summary',
    'category_manager:category_engagement': '/api/reporting/summary',
    'category_manager:shelf_quality': '/api/reporting/summary',
    'retail_media_manager:dooh_effectiveness': '/api/dooh-attribution/kpis',
    'retail_media_manager:attention_to_action': '/api/dooh-attribution/kpis',
    'executive:business_overview': '/api/reporting/summary',
    'executive:growth_opportunities': '/api/reporting/summary',
  };
  
  return sourceMap[`${personaId}:${stepId}`] || '/api/venues/:venueId/kpis';
}

export default {
  getRegistry,
  getValidPersonas,
  getPersona,
  getPersonaLabel,
  getPersonaGoal,
  getStepsForPersona,
  getStepDefinition,
  isValidPersonaStep,
  getAllStepIds,
  getKpiIdsForStep,
  getDeepLinkForStep,
  mapKpiIdToApiField,
  getKpiMetadata,
  getRequiredFeatureFlags,
  getPrimarySourceForStep,
  KPI_ID_MAP,
  KPI_METADATA,
};
