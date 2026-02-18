/**
 * NarrationPackBuilder
 * 
 * Builds Narration Packs for episodes — the data structure that feeds
 * Narrator v2 and the Replay Insight Panel.
 * 
 * No "we", no technical language, business-first phrasing.
 */

// Episode type → business-friendly category labels
const EPISODE_CATEGORIES = {
  QUEUE_BUILDUP_SPIKE: 'Checkout Operations',
  LANE_UNDERSUPPLY: 'Checkout Operations',
  LANE_OVERSUPPLY: 'Checkout Operations',
  ABANDONMENT_WAVE: 'Checkout Operations',
  QUEUE_SWITCHING: 'Checkout Operations',
  HIGH_PASSBY_LOW_BROWSE: 'Category Performance',
  BROWSE_NO_CONVERT_PROXY: 'Category Performance',
  PLACEMENT_PENALTY_CLUSTER: 'Merchandising',
  BRAND_UNFAIRNESS: 'Merchandising',
  CATEGORY_SPIKE_FROM_LAYOUT: 'Store Layout',
  BOTTLENECK_CORRIDOR: 'Store Flow',
  ROUTE_DETOUR: 'Store Flow',
  STORE_VISIT_TIME_SHIFT: 'Visitor Behavior',
  EXPOSURE_TO_ACTION_WIN: 'Retail Media',
  EXPOSURE_NO_FOLLOWTHROUGH: 'Retail Media',
  ATTENTION_QUALITY_DROP: 'Retail Media',
};

// Episode type → color for UI markers
const EPISODE_COLORS = {
  QUEUE_BUILDUP_SPIKE: '#ef4444',     // red
  LANE_UNDERSUPPLY: '#f97316',        // orange
  LANE_OVERSUPPLY: '#eab308',         // yellow
  ABANDONMENT_WAVE: '#dc2626',        // dark red
  QUEUE_SWITCHING: '#f59e0b',         // amber
  HIGH_PASSBY_LOW_BROWSE: '#8b5cf6',  // purple
  BROWSE_NO_CONVERT_PROXY: '#a855f7', // violet
  PLACEMENT_PENALTY_CLUSTER: '#6366f1', // indigo
  BRAND_UNFAIRNESS: '#7c3aed',        // deep purple
  CATEGORY_SPIKE_FROM_LAYOUT: '#22c55e', // green
  BOTTLENECK_CORRIDOR: '#f97316',     // orange
  ROUTE_DETOUR: '#f59e0b',           // amber
  STORE_VISIT_TIME_SHIFT: '#3b82f6',  // blue
  EXPOSURE_TO_ACTION_WIN: '#22c55e',  // green
  EXPOSURE_NO_FOLLOWTHROUGH: '#ef4444', // red
  ATTENTION_QUALITY_DROP: '#f97316',  // orange
};

// Episode type → severity
const EPISODE_SEVERITY = {
  QUEUE_BUILDUP_SPIKE: 'high',
  LANE_UNDERSUPPLY: 'high',
  LANE_OVERSUPPLY: 'low',
  ABANDONMENT_WAVE: 'high',
  QUEUE_SWITCHING: 'medium',
  HIGH_PASSBY_LOW_BROWSE: 'medium',
  BROWSE_NO_CONVERT_PROXY: 'medium',
  PLACEMENT_PENALTY_CLUSTER: 'medium',
  BRAND_UNFAIRNESS: 'low',
  CATEGORY_SPIKE_FROM_LAYOUT: 'low',
  BOTTLENECK_CORRIDOR: 'high',
  ROUTE_DETOUR: 'medium',
  STORE_VISIT_TIME_SHIFT: 'low',
  EXPOSURE_TO_ACTION_WIN: 'low',
  EXPOSURE_NO_FOLLOWTHROUGH: 'medium',
  ATTENTION_QUALITY_DROP: 'medium',
};

export class NarrationPackBuilder {
  /**
   * Build a narration pack for an episode
   * @param {Object} episode - Scored + enriched episode
   * @returns {Object} Narration pack ready for frontend / Narrator v2
   */
  buildPack(episode) {
    const kpiCards = this._buildKpiCards(episode.kpi_deltas);
    const timeLabel = this._formatTimeLabel(episode.start_ts, episode.end_ts);

    return {
      episode_id: episode.id,
      episode_type: episode.episode_type,
      category: EPISODE_CATEGORIES[episode.episode_type] || 'General',
      color: EPISODE_COLORS[episode.episode_type] || '#6b7280',
      severity: EPISODE_SEVERITY[episode.episode_type] || 'low',
      
      // Display content
      title: episode.title,
      business_summary: episode.business_summary,
      time_label: timeLabel,
      
      // KPI cards for the panel
      kpis: kpiCards,
      
      // Replay data
      replay_window: episode.replay_window || {
        start: episode.start_ts - 30000,
        end: episode.end_ts + 30000,
        zones: [],
      },
      highlight_zones: episode.highlight_zones || [],
      representative_tracks: episode.representative_tracks || [],
      
      // Actions
      recommended_actions: episode.recommended_actions || [],
      
      // Metadata
      confidence: episode.confidence,
      score: episode.score,
      scope: episode.scope,
      features: episode.features,
    };
  }

  /**
   * Build narration packs for multiple episodes
   */
  buildPacks(episodes) {
    return episodes.map(ep => this.buildPack(ep));
  }

  /**
   * Build a narration context for Narrator v2 OpenAI integration.
   * This is what gets injected into the GPT-4 prompt.
   */
  buildNarrator2Context(episode) {
    const pack = this.buildPack(episode);

    return {
      episode_type: pack.episode_type,
      category: pack.category,
      severity: pack.severity,
      title: pack.title,
      business_summary: pack.business_summary,
      time_label: pack.time_label,
      kpis: pack.kpis.map(k => ({
        id: k.id,
        label: k.label,
        value: k.value,
        unit: k.unit,
        direction: k.direction,
        baseline: k.baseline,
      })),
      recommended_actions: pack.recommended_actions,
      features: pack.features,
    };
  }

  /**
   * Build KPI cards from episode kpi_deltas
   */
  _buildKpiCards(kpiDeltas) {
    if (!kpiDeltas) return [];

    const cards = [];
    for (const [kpiId, delta] of Object.entries(kpiDeltas)) {
      cards.push({
        id: kpiId,
        label: this._humanizeKpiId(kpiId),
        value: delta.value,
        unit: delta.unit || '',
        direction: delta.direction || 'flat',
        baseline: delta.baseline || null,
        change: delta.baseline != null && delta.baseline > 0
          ? Math.round(((delta.value - delta.baseline) / delta.baseline) * 100)
          : null,
      });
    }
    return cards;
  }

  /**
   * Convert camelCase KPI ID to human-readable label
   */
  _humanizeKpiId(kpiId) {
    const overrides = {
      queueWaitTime: 'Avg Wait Time',
      queueThroughput: 'Throughput',
      queueAbandonmentRate: 'Abandonment Rate',
      avgOpenLanes: 'Open Lanes',
      maxWaitTime: 'Max Wait Time',
      laneUtilization: 'Lane Utilization',
      passbyTraffic: 'Pass-by Traffic',
      browsingRate: 'Browsing Rate',
      categoryEngagement: 'Category Engagement',
      categoryConversion: 'Conversion (Proxy)',
      avgBrowseTime: 'Avg Browse Time',
      peakOccupancy: 'Peak Occupancy',
      avgDwellTime: 'Avg Dwell Time',
      avgStoreVisit: 'Avg Store Visit',
      impressions: 'Impressions',
      eal: 'Behavioral Lift (EAL)',
      tta: 'Time-to-Action (TTA)',
      aar: 'Attention-to-Action (AAR)',
      aqs: 'Attention Quality (AQS)',
    };

    return overrides[kpiId] || kpiId
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();
  }

  /**
   * Format time label for display
   */
  _formatTimeLabel(startTs, endTs) {
    const start = new Date(startTs);
    const end = new Date(endTs);

    const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const startTime = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const endTime = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

    return `${dateStr}, ${startTime}–${endTime}`;
  }
}

export { EPISODE_CATEGORIES, EPISODE_COLORS, EPISODE_SEVERITY };
export default NarrationPackBuilder;
