import { useEffect, useMemo, useState } from 'react';
import type { OperationsTimeline } from './types';

type SeriesMode = 'occupancy' | 'footfall';

interface OperationsTimelineChartProps {
  timeline: OperationsTimeline;
  onDrillDown?: (mode: 'occupancy' | 'traffic') => void;
  forcedMode?: SeriesMode;
  hideToggle?: boolean;
  showFootfallSeries?: boolean;
}

const CHART_H = 140;

export default function OperationsTimelineChart({
  timeline,
  onDrillDown,
  forcedMode,
  hideToggle,
  showFootfallSeries = false,
}: OperationsTimelineChartProps) {
  const [mode, setMode] = useState<SeriesMode>(forcedMode || 'occupancy');
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

  const maxVal = useMemo(
    () => Math.max(...points.map(p => p.value), 0.1),
    [points],
  );

  const grainLabel = timeline.grain === 'hour' ? 'Hourly' : timeline.grain === 'day' ? 'Daily' : 'Weekly';

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
            Switch to {activeMode === 'occupancy' ? 'footfall' : 'shopper count'} →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3 flex flex-col min-h-[220px]">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h3 className="text-xs font-semibold text-white">Store Activity</h3>
          <p className="text-[10px] text-gray-500">
            {grainLabel} · {activeMode === 'occupancy' ? 'avg shoppers in store' : 'ingress visits'}
            {timeline.grain === 'hour' && activeMode === 'occupancy' ? ' · closed hours muted' : ''}
          </p>
        </div>
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

      <button
        type="button"
        className="flex flex-col text-left group"
        onClick={() => onDrillDown?.(activeMode === 'occupancy' ? 'occupancy' : 'traffic')}
        title="Click for detail"
      >
        <div
          className="flex items-end justify-center gap-1 w-full"
          style={{ height: CHART_H }}
        >
          {points.map((p, i) => {
            const barH = Math.max(Math.round((p.value / maxVal) * CHART_H), p.value > 0 ? 4 : 0);
            const closed = timeline.grain === 'hour' && !p.isOpen;
            const barWidth = points.length === 1 ? 80 : Math.max(8, Math.min(48, Math.floor(600 / points.length)));
            return (
              <div
                key={`${p.bucketStartTs}-${i}`}
                className="flex flex-col justify-end items-center relative"
                style={{ width: barWidth, minWidth: 6, flex: points.length > 12 ? 1 : undefined }}
              >
                <div
                  className={`w-full rounded-t transition-all group-hover:opacity-100 ${
                    closed ? 'bg-white/15' : 'bg-white/60 group-hover:bg-white/75'
                  }`}
                  style={{ height: barH }}
                />
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap pointer-events-none">
                  <div className="font-medium">{p.label}</div>
                  <div>{activeMode === 'footfall' ? 'Visits' : 'Avg shoppers'}: <b>{p.value}</b></div>
                  {closed && <div className="text-gray-400">Closed hour</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-gray-500 mt-2 pt-1 border-t border-gray-700/40">
          <span className="truncate max-w-[30%]">{points[0]?.label}</span>
          {points.length > 2 && (
            <span className="truncate max-w-[30%] text-center">{points[Math.floor(points.length / 2)]?.label}</span>
          )}
          <span className="truncate max-w-[30%] text-right">{points[points.length - 1]?.label}</span>
        </div>
      </button>
    </div>
  );
}
