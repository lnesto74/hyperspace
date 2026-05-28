import { useEffect, useMemo, useState } from 'react';
import type { OperationsTimeline } from './types';

type SeriesMode = 'visitors' | 'occupancy';

interface OperationsTimelineChartProps {
  timeline: OperationsTimeline;
  onDrillDown?: (mode: SeriesMode) => void;
  forcedMode?: SeriesMode;
  hideToggle?: boolean;
}

export default function OperationsTimelineChart({
  timeline,
  onDrillDown,
  forcedMode,
  hideToggle,
}: OperationsTimelineChartProps) {
  const [mode, setMode] = useState<SeriesMode>(forcedMode || 'visitors');
  const activeMode = forcedMode || mode;

  const visitorsHasData = timeline.visitors.some(p => p.value > 0);
  const occupancyHasData = timeline.occupancy.some(p => p.value > 0);

  useEffect(() => {
    if (forcedMode) return;
    if (!visitorsHasData && occupancyHasData) setMode('occupancy');
    else if (visitorsHasData && !occupancyHasData) setMode('visitors');
  }, [visitorsHasData, occupancyHasData, forcedMode]);

  const points = activeMode === 'visitors' ? timeline.visitors : timeline.occupancy;
  const maxVal = useMemo(
    () => Math.max(...points.map(p => p.value), 1),
    [points],
  );

  const grainLabel = timeline.grain === 'hour' ? 'Hourly' : timeline.grain === 'day' ? 'Daily' : 'Weekly';

  if (!points.length || !points.some(p => p.value > 0)) {
    return (
      <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-4 h-[220px] flex items-center justify-center">
        <span className="text-xs text-gray-500">No chart data for this range</span>
      </div>
    );
  }

  const visitorLabel = timeline.visitorSource === 'queue_proxy' ? 'Queue shoppers' : 'Visitors';

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3 flex flex-col h-full min-h-[220px]">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h3 className="text-xs font-semibold text-white">Store Timeline</h3>
          <p className="text-[10px] text-gray-500">
            {grainLabel}
            {timeline.visitorSource === 'queue_proxy' && activeMode === 'visitors' ? ' · queue proxy' : ''}
            {timeline.grain === 'hour' ? ' · closed hours muted' : ''}
          </p>
        </div>
        {!hideToggle && !forcedMode && (
        <div className="flex bg-gray-900/80 rounded-md p-0.5 border border-gray-700/60">
          <button
            type="button"
            onClick={() => setMode('visitors')}
            className={`px-2 py-0.5 text-[10px] rounded ${activeMode === 'visitors' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
          >
            {visitorLabel}
          </button>
          <button
            type="button"
            onClick={() => setMode('occupancy')}
            className={`px-2 py-0.5 text-[10px] rounded ${activeMode === 'occupancy' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
          >
            Occupancy
          </button>
        </div>
        )}
      </div>

      <button
        type="button"
        className="flex-1 flex flex-col text-left group"
        onClick={() => onDrillDown?.(mode)}
        title="Click for detail"
      >
        <div className="flex items-end gap-px flex-1 min-h-[120px]">
          {points.map((p, i) => {
            const h = Math.max((p.value / maxVal) * 100, p.value > 0 ? 4 : 0);
            const closed = timeline.grain === 'hour' && !p.isOpen;
            return (
              <div key={`${p.bucketStartTs}-${i}`} className="flex-1 flex flex-col justify-end items-center relative min-w-0">
                <div
                  className={`w-full rounded-t transition-all group-hover:opacity-90 ${
                    closed
                      ? 'bg-gray-600/40'
                      : activeMode === 'visitors'
                        ? 'bg-emerald-500/80'
                        : 'bg-blue-500/80'
                  }`}
                  style={{ height: `${h}%` }}
                />
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap pointer-events-none">
                  <div className="font-medium">{p.label}</div>
                  <div>{activeMode === 'visitors' ? 'Visitors' : 'Avg occ.'}: <b>{p.value}</b></div>
                  {closed && <div className="text-gray-400">Closed hour</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-gray-500 mt-1 pt-1 border-t border-gray-700/40">
          <span className="truncate">{points[0]?.label}</span>
          {points.length > 2 && (
            <span className="truncate mx-1">{points[Math.floor(points.length / 2)]?.label}</span>
          )}
          <span className="truncate">{points[points.length - 1]?.label}</span>
        </div>
      </button>
    </div>
  );
}
