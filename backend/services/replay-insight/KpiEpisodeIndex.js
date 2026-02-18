/**
 * KpiEpisodeIndex
 * 
 * Reverse index: KPI → most likely causal episode types, ranked.
 * Used by Narrator v2 to jump from KPI tile → "Replay Insight".
 */

// KPI ID → Episode types that most likely explain movement in this KPI
// Ordered by causal likelihood (first = most likely)
const KPI_TO_EPISODES = {
  // Queue KPIs
  queueWaitTime:        ['QUEUE_BUILDUP_SPIKE', 'LANE_UNDERSUPPLY', 'QUEUE_SWITCHING', 'BOTTLENECK_CORRIDOR'],
  avgWaitTime:          ['QUEUE_BUILDUP_SPIKE', 'LANE_UNDERSUPPLY', 'QUEUE_SWITCHING'],
  maxWaitTime:          ['QUEUE_BUILDUP_SPIKE', 'LANE_UNDERSUPPLY'],
  queueThroughput:      ['LANE_UNDERSUPPLY', 'LANE_OVERSUPPLY', 'QUEUE_BUILDUP_SPIKE'],
  queueAbandonmentRate: ['ABANDONMENT_WAVE', 'QUEUE_BUILDUP_SPIKE', 'QUEUE_SWITCHING'],
  avgOpenLanes:         ['LANE_UNDERSUPPLY', 'LANE_OVERSUPPLY'],
  peakOpenLanes:        ['LANE_UNDERSUPPLY', 'LANE_OVERSUPPLY'],
  laneUtilization:      ['LANE_OVERSUPPLY', 'LANE_UNDERSUPPLY'],

  // Shelf / Category KPIs
  browsingRate:         ['HIGH_PASSBY_LOW_BROWSE', 'BOTTLENECK_CORRIDOR', 'ROUTE_DETOUR'],
  categoryEngagement:   ['HIGH_PASSBY_LOW_BROWSE', 'CATEGORY_SPIKE_FROM_LAYOUT', 'ROUTE_DETOUR'],
  avgBrowseTime:        ['BROWSE_NO_CONVERT_PROXY', 'CATEGORY_SPIKE_FROM_LAYOUT'],
  passbyTraffic:        ['HIGH_PASSBY_LOW_BROWSE', 'ROUTE_DETOUR', 'BOTTLENECK_CORRIDOR'],
  avgPositionScore:     ['PLACEMENT_PENALTY_CLUSTER'],
  brandEfficiency:      ['BRAND_UNFAIRNESS'],
  categoryConversion:   ['BROWSE_NO_CONVERT_PROXY', 'EXPOSURE_TO_ACTION_WIN'],

  // Store-level Flow KPIs
  avgStoreVisit:        ['STORE_VISIT_TIME_SHIFT', 'BOTTLENECK_CORRIDOR'],
  totalVisitors:        ['STORE_VISIT_TIME_SHIFT'],
  dwellRate:            ['BOTTLENECK_CORRIDOR', 'HIGH_PASSBY_LOW_BROWSE'],
  peakOccupancy:        ['BOTTLENECK_CORRIDOR', 'QUEUE_BUILDUP_SPIKE'],
  avgDwellTime:         ['BOTTLENECK_CORRIDOR', 'BROWSE_NO_CONVERT_PROXY'],

  // DOOH / PEBLE KPIs
  eal:                  ['EXPOSURE_TO_ACTION_WIN', 'EXPOSURE_NO_FOLLOWTHROUGH'],
  tta:                  ['EXPOSURE_TO_ACTION_WIN', 'EXPOSURE_NO_FOLLOWTHROUGH'],
  ttaAccel:             ['EXPOSURE_TO_ACTION_WIN', 'EXPOSURE_NO_FOLLOWTHROUGH'],
  aqs:                  ['ATTENTION_QUALITY_DROP', 'EXPOSURE_NO_FOLLOWTHROUGH'],
  aar:                  ['EXPOSURE_TO_ACTION_WIN', 'EXPOSURE_NO_FOLLOWTHROUGH'],
  ces:                  ['EXPOSURE_TO_ACTION_WIN', 'ATTENTION_QUALITY_DROP'],
  peble:                ['EXPOSURE_TO_ACTION_WIN', 'EXPOSURE_NO_FOLLOWTHROUGH', 'ATTENTION_QUALITY_DROP'],
  seq:                  ['EXPOSURE_TO_ACTION_WIN', 'EXPOSURE_NO_FOLLOWTHROUGH'],
  dci:                  ['ROUTE_DETOUR', 'EXPOSURE_TO_ACTION_WIN'],
  impressions:          ['EXPOSURE_NO_FOLLOWTHROUGH', 'ATTENTION_QUALITY_DROP'],
  qualifiedRate:        ['ATTENTION_QUALITY_DROP'],
  premiumRate:          ['ATTENTION_QUALITY_DROP'],
};

/**
 * Get episode types that explain a KPI movement
 * @param {string} kpiId
 * @returns {string[]} Ordered list of episode types
 */
export function getEpisodeTypesForKpi(kpiId) {
  return KPI_TO_EPISODES[kpiId] || [];
}

/**
 * Get all KPIs that a given episode type can explain
 * @param {string} episodeType
 * @returns {string[]} KPI IDs
 */
export function getKpisForEpisodeType(episodeType) {
  const kpis = [];
  for (const [kpiId, episodeTypes] of Object.entries(KPI_TO_EPISODES)) {
    if (episodeTypes.includes(episodeType)) {
      kpis.push(kpiId);
    }
  }
  return kpis;
}

/**
 * Get the full reverse index
 */
export function getFullIndex() {
  return { ...KPI_TO_EPISODES };
}

export default {
  getEpisodeTypesForKpi,
  getKpisForEpisodeType,
  getFullIndex,
};
