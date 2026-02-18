/**
 * TimelineInsightMarkers
 * 
 * Renders color-coded episode markers as an overlay on the existing timeline.
 * Absolutely positioned — does NOT modify TimelineReplay internals.
 */

import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { useReplayInsight } from '../../context/ReplayInsightContext';

const EPISODE_COLORS: Record<string, string> = {
  QUEUE_BUILDUP_SPIKE: '#ef4444',
  LANE_UNDERSUPPLY: '#f97316',
  LANE_OVERSUPPLY: '#eab308',
  ABANDONMENT_WAVE: '#dc2626',
  QUEUE_SWITCHING: '#f59e0b',
  HIGH_PASSBY_LOW_BROWSE: '#8b5cf6',
  BROWSE_NO_CONVERT_PROXY: '#a855f7',
  BOTTLENECK_CORRIDOR: '#f97316',
  ROUTE_DETOUR: '#f59e0b',
  STORE_VISIT_TIME_SHIFT: '#3b82f6',
  EXPOSURE_TO_ACTION_WIN: '#22c55e',
  EXPOSURE_NO_FOLLOWTHROUGH: '#ef4444',
  ATTENTION_QUALITY_DROP: '#f97316',
};

const EPISODE_SHORT_LABELS: Record<string, string> = {
  QUEUE_BUILDUP_SPIKE: 'Queue spike',
  LANE_UNDERSUPPLY: 'Lane gap',
  LANE_OVERSUPPLY: 'Overcapacity',
  ABANDONMENT_WAVE: 'Abandonments',
  QUEUE_SWITCHING: 'Lane hopping',
  HIGH_PASSBY_LOW_BROWSE: 'Low engagement',
  BROWSE_NO_CONVERT_PROXY: 'Hesitation',
  BOTTLENECK_CORRIDOR: 'Congestion',
  ROUTE_DETOUR: 'Route detour',
  STORE_VISIT_TIME_SHIFT: 'Visit shift',
  EXPOSURE_TO_ACTION_WIN: 'DOOH success',
  EXPOSURE_NO_FOLLOWTHROUGH: 'DOOH miss',
  ATTENTION_QUALITY_DROP: 'Attention drop',
};

interface TimelineInsightMarkersProps {
  timelineStartTs: number;
  timelineEndTs: number;
  containerWidth: number;
  isVisible: boolean;
}

export default function TimelineInsightMarkers({
  timelineStartTs,
  timelineEndTs,
  containerWidth,
  isVisible,
}: TimelineInsightMarkersProps) {
  const { timelineMarkers, fetchTimelineMarkers, selectEpisode } = useReplayInsight();
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch markers when timeline range changes
  useEffect(() => {
    if (isVisible && timelineStartTs && timelineEndTs) {
      fetchTimelineMarkers(timelineStartTs, timelineEndTs);
    }
  }, [isVisible, timelineStartTs, timelineEndTs, fetchTimelineMarkers]);

  if (!isVisible || timelineMarkers.length === 0 || containerWidth <= 0) return null;

  const totalDuration = timelineEndTs - timelineStartTs;
  if (totalDuration <= 0) return null;

  // Calculate x position for a timestamp
  const tsToX = (ts: number) => {
    const ratio = (ts - timelineStartTs) / totalDuration;
    return Math.max(0, Math.min(containerWidth, ratio * containerWidth));
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-0 left-0 right-0 h-full pointer-events-none z-10"
      style={{ width: containerWidth }}
    >
      {timelineMarkers.map((marker) => {
        const midTs = (marker.start_ts + marker.end_ts) / 2;
        const x = tsToX(midTs);
        const width = Math.max(4, tsToX(marker.end_ts) - tsToX(marker.start_ts));
        const color = EPISODE_COLORS[marker.episode_type] || '#6b7280';
        const label = EPISODE_SHORT_LABELS[marker.episode_type] || marker.episode_type;
        const isHovered = hoveredMarker === marker.id;

        return (
          <div key={marker.id}>
            {/* Episode range bar */}
            <div
              className="absolute top-0 h-full opacity-15 pointer-events-auto cursor-pointer transition-opacity hover:opacity-30"
              style={{
                left: tsToX(marker.start_ts),
                width,
                backgroundColor: color,
              }}
              onMouseEnter={() => setHoveredMarker(marker.id)}
              onMouseLeave={() => setHoveredMarker(null)}
              onClick={() => selectEpisode(marker.id)}
            />

            {/* Marker dot */}
            <div
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: x - 6,
                top: -4,
              }}
              onMouseEnter={() => setHoveredMarker(marker.id)}
              onMouseLeave={() => setHoveredMarker(null)}
              onClick={() => selectEpisode(marker.id)}
            >
              <div
                className="w-3 h-3 rounded-full border-2 border-gray-900 shadow-sm transition-transform"
                style={{
                  backgroundColor: color,
                  transform: isHovered ? 'scale(1.5)' : 'scale(1)',
                }}
              />
            </div>

            {/* Tooltip */}
            {isHovered && (
              <div
                className="absolute z-50 pointer-events-none"
                style={{
                  left: Math.min(x - 80, containerWidth - 180),
                  top: -52,
                }}
              >
                <div className="bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg border border-gray-600 whitespace-nowrap">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Zap className="w-3 h-3" style={{ color }} />
                    <span className="font-medium">{label}</span>
                  </div>
                  <div className="text-gray-400 text-[10px]">
                    {marker.title || 'Click to view insight'}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
