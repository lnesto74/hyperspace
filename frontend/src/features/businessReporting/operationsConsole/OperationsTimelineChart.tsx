import { useEffect, useMemo, useState } from 'react';
import TimelineRangeBrush from './TimelineRangeBrush';
import BarCategoryBadges from './BarCategoryBadges';
import { CATEGORY_BADGE_MAX_BARS } from './categoryVisuals';
import { buildYAxisTicks } from './chartYAxis';
import type { OperationsTimeline } from './types';

type SeriesMode = 'occupancy' | 'footfall';

interface OperationsTimelineChartProps {
  timeline: OperationsTimeline;
  forcedMode?: SeriesMode;
  hideToggle?: boolean;
  showFootfallSeries?: boolean;
}

const CHART_H = 140;
const MIN_WINDOW = 4;
const DEFAULT_WINDOW = 24;

export default function OperationsTimelineChart({
  timeline,
  forcedMode,
  hideToggle,
  showFootfallSeries = false,
}: OperationsTimelineChartProps) {
  const [mode, setMode] = useState<SeriesMode>(forcedMode || 'occupancy');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(DEFAULT_WINDOW);
  const activeMode = forcedMode || mode;

  const footfallPoints = timeline.visitors;
  const occupancyPoints = timeline.occupancy;
  const footfallHasData = showFootfallSeries && footfallPoints.some(p => p.value > 0);
  const occupancyHasData = occupancyPoints.some(p => p.value > 0);

  useEffect(() => {
    if (forcedMode) return;
    if (!occupancyHasData && footfallHasData) setMode('footfall');
    else setMode('occupancy');
  }, [footfallHasData, occupancyHasData, forcedMode]);

  const points = activeMode === 'occupancy' ? occupancyPoints : footfallPoints;
  const altPoints = activeMode === 'occupancy' ? footfallPoints : occupancyPoints;

  useEffect(() => {
    const window = Math.min(DEFAULT_WINDOW, Math.max(MIN_WINDOW, points.length));
    setRangeStart(Math.max(0, points.length - window));
    setRangeEnd(points.length);
    setHoveredIdx(null);
  }, [points.length, activeMode, timeline.grain]);

  const handleRangeChange = (start: number, end: number) => {
    setRangeStart(start);
    setRangeEnd(end);
  };

  const visiblePoints = useMemo(
    () => points.slice(rangeStart, rangeEnd),
    [points, rangeStart, rangeEnd],
  );

  const maxVal = useMemo(
    () => Math.max(...visiblePoints.map(p => p.value), 0.1),
    [visiblePoints],
  );

  const yTicks = useMemo(() => buildYAxisTicks(maxVal), [maxVal]);
  const showCategoryBadges = activeMode === 'occupancy' && visiblePoints.length <= CATEGORY_BADGE_MAX_BARS;
  const chartPlotH = CHART_H + (showCategoryBadges ? 20 : 0);

  const grainLabel = timeline.grain === 'hour' ? 'Hourly' : timeline.grain === 'day' ? 'Daily' : 'Weekly';
  const valueLabel = activeMode === 'footfall' ? 'Visits' : 'Peak shoppers';

  if (!points.length || !points.some(p => p.value > 0)) {
    const altHasData = altPoints.some(p => p.value > 0);
    return (
      <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-4 min-h-[200px] flex flex-col items-center justify-center gap-1">
        <span className="text-xs text-gray-500">No store activity data for this range</span>
        {altHasData && !forcedMode && (
          <button
            type="button"
            className="text-[10px] text-gray-400 hover:text-white"
            onClick={() => setMode(activeMode === 'occupancy' ? 'footfall' : 'occupancy')}
          >
            Switch to {activeMode === 'occupancy' ? 'footfall' : 'ingress visits'} →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3 flex flex-col min-h-[220px] overflow-visible">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h3 className="text-xs font-semibold text-white">Store Activity</h3>
          <p className="text-[10px] text-gray-500">
            {grainLabel} · {activeMode === 'occupancy' ? 'peak IDs per frame (same as MQTT live)' : 'ingress crossings (entry + exit)'}
            {showCategoryBadges && ' · top categories on bars when zoomed in'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {footfallHasData && !hideToggle && !forcedMode && (
            <div className="flex bg-gray-900/80 rounded-md p-0.5 border border-gray-700/60">
              <button
                type="button"
                onClick={() => setMode('occupancy')}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  activeMode === 'occupancy' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Shoppers
              </button>
              <button
                type="button"
                onClick={() => setMode('footfall')}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  activeMode === 'footfall' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Footfall
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col overflow-visible">
        <div
          className="relative w-full overflow-visible pt-7 flex gap-1.5"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <div
            className="flex flex-col justify-between shrink-0 text-[9px] text-gray-500 tabular-nums py-0.5"
            style={{ height: chartPlotH, minWidth: 24 }}
            aria-hidden
          >
            {yTicks.map(tick => (
              <span key={tick} className="leading-none">{tick}</span>
            ))}
          </div>
          <div
            className="flex items-end justify-center gap-1 flex-1 min-w-0"
            style={{ height: chartPlotH }}
          >
            {visiblePoints.map((p, i) => {
              const barH = Math.max(Math.round((p.value / maxVal) * CHART_H), p.value > 0 ? 4 : 0);
              const closed = timeline.grain === 'hour' && !p.isOpen;
              const barWidth = visiblePoints.length === 1
                ? 80
                : Math.max(8, Math.min(48, Math.floor(600 / visiblePoints.length)));
              const isHovered = hoveredIdx === i;
              return (
                <div
                  key={`${p.bucketStartTs}-${rangeStart + i}`}
                  className="relative flex flex-col justify-end items-center h-full"
                  style={{ width: barWidth, minWidth: 6, flex: visiblePoints.length > 12 ? 1 : undefined }}
                  onMouseEnter={() => setHoveredIdx(i)}
                >
                  {isHovered && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap pointer-events-none shadow-lg">
                      <div className="font-medium">{p.label}</div>
                      <div>{valueLabel}: <b>{p.value}</b></div>
                      {activeMode === 'occupancy' && p.avgVal != null && p.avgVal !== p.value && (
                        <div className="text-gray-400">Typical: {p.avgVal}</div>
                      )}
                      {p.topCategories && p.topCategories.length > 0 && (
                        <div className="text-gray-400 mt-0.5 border-t border-gray-700/60 pt-0.5">
                          {p.topCategories.map(c => (
                            <div key={c.category}>{c.category}: {c.visits.toLocaleString()}</div>
                          ))}
                        </div>
                      )}
                      {closed && <div className="text-gray-400">Closed hour</div>}
                    </div>
                  )}
                  {showCategoryBadges && (p.topCategories?.length ?? 0) > 0 && (
                    <BarCategoryBadges categories={p.topCategories!} />
                  )}
                  <div
                    className={`w-full rounded-t transition-colors ${
                      closed ? 'bg-white/15' : isHovered ? 'bg-white/80' : 'bg-white/55'
                    }`}
                    style={{ height: barH }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-between text-[9px] text-gray-500 mt-2 pl-7 pr-0.5">
          <span className="truncate max-w-[30%]">{visiblePoints[0]?.label}</span>
          {visiblePoints.length > 2 && (
            <span className="truncate max-w-[30%] text-center">
              {visiblePoints[Math.floor(visiblePoints.length / 2)]?.label}
            </span>
          )}
          <span className="truncate max-w-[30%] text-right">{visiblePoints[visiblePoints.length - 1]?.label}</span>
        </div>

        <TimelineRangeBrush
          points={points}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onRangeChange={handleRangeChange}
          minWindow={MIN_WINDOW}
        />
      </div>
    </div>
  );
}
