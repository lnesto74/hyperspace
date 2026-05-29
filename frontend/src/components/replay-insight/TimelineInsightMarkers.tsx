/**
 * Insight event rail — rendered below the KPI histogram (never on top of bars).
 */

import { useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { useReplayInsight } from '../../context/ReplayInsightContext';
import {
  bucketMarkersBySlot,
  getCategoryColor,
  getEpisodeCategory,
  INSIGHT_FETCH_PARAMS,
  type InsightDisplayMode,
} from './timelineInsightUtils';

const CATEGORY_LABELS: Record<string, string> = {
  checkout: 'Checkout',
  merchandising: 'Merchandising',
  flow: 'Flow',
  dooh: 'DOOH',
  other: 'Other',
};

interface TimelineInsightMarkersProps {
  timelineStartTs: number;
  timelineEndTs: number;
  slotIntervalMs: number;
  containerWidth: number;
  isVisible: boolean;
  insightMode: InsightDisplayMode;
  activeSlotIndex?: number;
  slotCount?: number;
}

export default function TimelineInsightMarkers({
  timelineStartTs,
  timelineEndTs,
  slotIntervalMs,
  containerWidth,
  isVisible,
  insightMode,
  activeSlotIndex = -1,
  slotCount = 0,
}: TimelineInsightMarkersProps) {
  const { timelineMarkers, fetchTimelineMarkers, selectEpisode } = useReplayInsight();
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);
  const [expandedBucket, setExpandedBucket] = useState<number | null>(null);

  useEffect(() => {
    if (!isVisible || insightMode === 'off' || !timelineStartTs || !timelineEndTs) return;
    const fetchOpts = INSIGHT_FETCH_PARAMS[insightMode];
    fetchTimelineMarkers(timelineStartTs, timelineEndTs, fetchOpts);
  }, [isVisible, insightMode, timelineStartTs, timelineEndTs, fetchTimelineMarkers]);

  const buckets = useMemo(
    () => bucketMarkersBySlot(timelineMarkers, timelineStartTs, slotIntervalMs),
    [timelineMarkers, timelineStartTs, slotIntervalMs],
  );

  if (!isVisible || insightMode === 'off' || containerWidth <= 0) return null;

  const totalDuration = timelineEndTs - timelineStartTs;
  if (totalDuration <= 0) return null;

  const tsToX = (ts: number) => {
    const ratio = (ts - timelineStartTs) / totalDuration;
    return Math.max(0, Math.min(containerWidth, ratio * containerWidth));
  };

  return (
    <div className="relative h-full w-full px-2" style={{ width: containerWidth }}>
      {/* Playhead slot tint — synced with histogram, no full-height line */}
      {activeSlotIndex >= 0 && slotCount > 0 && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none transition-all duration-300 ease-out rounded-sm"
          style={{
            left: `${(activeSlotIndex / slotCount) * 100}%`,
            width: `${100 / slotCount}%`,
            backgroundColor: 'rgba(251, 191, 36, 0.07)',
            borderLeft: '1px solid rgba(251, 191, 36, 0.25)',
            borderRight: '1px solid rgba(251, 191, 36, 0.25)',
          }}
        />
      )}

      {/* Category legend (compact) */}
      <div className="absolute top-0 left-2 flex gap-2 text-[8px] text-gray-500 pointer-events-none z-0">
        {(['checkout', 'merchandising', 'flow', 'dooh'] as const).map(cat => (
          <span key={cat} className="inline-flex items-center gap-0.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: getCategoryColor(
                cat === 'checkout' ? 'QUEUE_BUILDUP_SPIKE'
                  : cat === 'merchandising' ? 'HIGH_PASSBY_LOW_BROWSE'
                    : cat === 'flow' ? 'BOTTLENECK_CORRIDOR'
                      : 'EXPOSURE_TO_ACTION_WIN',
              ) }}
            />
            {CATEGORY_LABELS[cat]}
          </span>
        ))}
      </div>

      {buckets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-600">
          No insight events in this range
        </div>
      )}

      {buckets.map(bucket => {
        const midTs = bucket.slotKey + slotIntervalMs / 2;
        const x = tsToX(midTs);
        const isMulti = bucket.markers.length > 1;
        const isHovered = hoveredBucket === bucket.slotKey;
        const isExpanded = expandedBucket === bucket.slotKey;
        const color = getCategoryColor(bucket.topMarker.episode_type);
        const category = getEpisodeCategory(bucket.topMarker.episode_type);

        return (
          <div key={bucket.slotKey}>
            {/* Thin tick — single event */}
            {!isMulti && (
              <button
                type="button"
                className="absolute bottom-1 pointer-events-auto cursor-pointer group"
                style={{ left: x - 1 }}
                onMouseEnter={() => setHoveredBucket(bucket.slotKey)}
                onMouseLeave={() => setHoveredBucket(null)}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => selectEpisode(bucket.topMarker.id)}
                title={bucket.topMarker.title}
              >
                <div
                  className="w-0.5 h-4 rounded-full transition-transform group-hover:scale-y-125"
                  style={{ backgroundColor: color }}
                />
                <div
                  className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rotate-45 border border-gray-900"
                  style={{ backgroundColor: color }}
                />
              </button>
            )}

            {/* Cluster chip — multiple events in same slot */}
            {isMulti && (
              <button
                type="button"
                className="absolute bottom-0.5 pointer-events-auto cursor-pointer"
                style={{ left: x - 10 }}
                onMouseEnter={() => setHoveredBucket(bucket.slotKey)}
                onMouseLeave={() => {
                  if (!isExpanded) setHoveredBucket(null);
                }}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => {
                  if (isExpanded) {
                    selectEpisode(bucket.topMarker.id);
                  } else {
                    setExpandedBucket(bucket.slotKey);
                  }
                }}
              >
                <span
                  className="inline-flex items-center justify-center min-w-[18px] h-[14px] px-1 rounded text-[9px] font-medium border border-gray-800 shadow-sm transition-transform"
                  style={{
                    backgroundColor: `${color}33`,
                    color,
                    transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                  }}
                >
                  {bucket.markers.length}
                </span>
              </button>
            )}

            {/* Tooltip / expanded list */}
            {(isHovered || isExpanded) && (
              <div
                className="absolute z-50 pointer-events-auto"
                style={{
                  left: Math.min(Math.max(x - 70, 4), containerWidth - 150),
                  bottom: 22,
                }}
                onMouseLeave={() => {
                  setHoveredBucket(null);
                  setExpandedBucket(null);
                }}
              >
                <div className="bg-gray-800 text-white text-xs rounded-lg px-2.5 py-2 shadow-lg border border-gray-600 max-w-[160px]">
                  {isMulti ? (
                    <>
                      <div className="text-[10px] text-gray-400 mb-1">
                        {bucket.markers.length} events · {CATEGORY_LABELS[category]}
                      </div>
                      <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                        {bucket.markers.slice(0, 6).map(m => (
                          <li key={m.id}>
                            <button
                              type="button"
                              className="text-left w-full hover:text-white text-gray-300 text-[10px] truncate"
                              onClick={() => selectEpisode(m.id)}
                            >
                              {m.title || m.episode_type}
                            </button>
                          </li>
                        ))}
                      </ul>
                      {bucket.markers.length > 6 && (
                        <div className="text-[9px] text-gray-500 mt-0.5">+{bucket.markers.length - 6} more</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Zap className="w-3 h-3 shrink-0" style={{ color }} />
                        <span className="font-medium truncate">{bucket.topMarker.title || category}</span>
                      </div>
                      <div className="text-gray-400 text-[10px]">Click to view insight</div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
