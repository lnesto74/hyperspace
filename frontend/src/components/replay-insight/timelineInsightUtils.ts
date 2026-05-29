import type { TimelineMarker } from '../../context/ReplayInsightContext';

export type InsightDisplayMode = 'off' | 'top20' | 'high' | 'all';

export type EpisodeCategory = 'checkout' | 'merchandising' | 'flow' | 'dooh' | 'other';

const CHECKOUT_TYPES = new Set([
  'QUEUE_BUILDUP_SPIKE',
  'LANE_UNDERSUPPLY',
  'LANE_OVERSUPPLY',
  'ABANDONMENT_WAVE',
  'QUEUE_SWITCHING',
]);

const MERCH_TYPES = new Set([
  'HIGH_PASSBY_LOW_BROWSE',
  'BROWSE_NO_CONVERT_PROXY',
]);

const FLOW_TYPES = new Set([
  'BOTTLENECK_CORRIDOR',
  'ROUTE_DETOUR',
  'STORE_VISIT_TIME_SHIFT',
]);

const DOOH_TYPES = new Set([
  'EXPOSURE_TO_ACTION_WIN',
  'EXPOSURE_NO_FOLLOWTHROUGH',
  'ATTENTION_QUALITY_DROP',
]);

export const CATEGORY_COLORS: Record<EpisodeCategory, string> = {
  checkout: '#ef4444',
  merchandising: '#8b5cf6',
  flow: '#f59e0b',
  dooh: '#22c55e',
  other: '#6b7280',
};

export const INSIGHT_FETCH_PARAMS: Record<
  Exclude<InsightDisplayMode, 'off'>,
  { minScore?: number; limit?: number }
> = {
  top20: { minScore: 0.45, limit: 24 },
  high: { minScore: 0.65, limit: 20 },
  /** Cap fetch size; client buckets into slots — balanced server-side by category */
  all: { limit: 120 },
};

export function getTimelineIntervalMins(dateRange: 'today' | 'yesterday' | 'week'): number {
  return dateRange === 'week' ? 60 : 30;
}

export function getEpisodeCategory(episodeType: string): EpisodeCategory {
  if (CHECKOUT_TYPES.has(episodeType)) return 'checkout';
  if (MERCH_TYPES.has(episodeType)) return 'merchandising';
  if (FLOW_TYPES.has(episodeType)) return 'flow';
  if (DOOH_TYPES.has(episodeType)) return 'dooh';
  return 'other';
}

export function getCategoryColor(episodeType: string): string {
  return CATEGORY_COLORS[getEpisodeCategory(episodeType)];
}

export interface MarkerSlotBucket {
  slotKey: number;
  markers: TimelineMarker[];
  topMarker: TimelineMarker;
}

/** Group markers into timeline slots; one visual chip per bucket. */
export function bucketMarkersBySlot(
  markers: TimelineMarker[],
  timelineStartTs: number,
  slotIntervalMs: number,
): MarkerSlotBucket[] {
  if (!markers.length || slotIntervalMs <= 0) return [];

  const buckets = new Map<number, TimelineMarker[]>();

  for (const marker of markers) {
    const midTs = (marker.start_ts + marker.end_ts) / 2;
    const slotKey = Math.floor((midTs - timelineStartTs) / slotIntervalMs) * slotIntervalMs + timelineStartTs;
    const list = buckets.get(slotKey) || [];
    list.push(marker);
    buckets.set(slotKey, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slotKey, list]) => {
      const sorted = [...list].sort((a, b) => b.score - a.score);
      return { slotKey, markers: sorted, topMarker: sorted[0] };
    });
}
