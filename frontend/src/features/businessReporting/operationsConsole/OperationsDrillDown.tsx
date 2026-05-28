import { X } from 'lucide-react';
import type { DrillDownView, OperationsConsoleData, QueueLaneRow } from './types';
import OperationsTimelineChart from './OperationsTimelineChart';

interface OperationsDrillDownProps {
  view: DrillDownView;
  consoleData: OperationsConsoleData;
  selectedLaneId?: string | null;
  onClose: () => void;
}

function LaneDetail({ lane }: { lane: QueueLaneRow }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Sessions" value={String(lane.sessions)} />
        <Stat label="Completed" value={String(lane.completed)} />
        <Stat label="Avg wait" value={`${lane.avgWaitMin.toFixed(1)} min`} />
        <Stat label="Abandon rate" value={`${lane.abandonPct}%`} />
        <Stat label="Abandoned" value={String(lane.abandoned)} />
        <Stat label="Queue now" value={String(lane.currentQueue)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-700/60 bg-gray-900/50 px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

const TITLES: Record<NonNullable<DrillDownView>, string> = {
  traffic: 'Traffic Detail',
  checkout: 'Checkout Detail',
  occupancy: 'Occupancy Detail',
  lane: 'Lane Detail',
};

export default function OperationsDrillDown({
  view,
  consoleData,
  selectedLaneId,
  onClose,
}: OperationsDrillDownProps) {
  if (!view) return null;

  const lane = selectedLaneId
    ? consoleData.queueLanes.find(l => l.id === selectedLaneId)
    : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden />
      <aside className="fixed top-0 right-0 h-full w-full max-w-md bg-gray-900 border-l border-gray-700 z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-white">
            {view === 'lane' && lane ? lane.name : TITLES[view]}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {view === 'lane' && lane && <LaneDetail lane={lane} />}

          {(view === 'traffic' || view === 'occupancy') && (
            <>
              <p className="text-xs text-gray-400">
                {view === 'traffic'
                  ? 'Visitor counts over the selected period. Closed hours appear muted on hourly view.'
                  : 'Average in-store occupancy by time bucket.'}
              </p>
              <OperationsTimelineChart
                timeline={consoleData.timeline}
                forcedMode={view === 'traffic' ? 'visitors' : 'occupancy'}
                hideToggle
              />
            </>
          )}

          {view === 'checkout' && (
            <>
              <p className="text-xs text-gray-400">
                Per-lane queue performance for the selected window. Sessions under 5 seconds are excluded.
              </p>
              <div className="space-y-2">
                {consoleData.queueLanes.map(l => (
                  <div key={l.id} className="rounded-lg border border-gray-700/60 p-3 bg-gray-800/40">
                    <div className="text-sm font-medium text-white">{l.name}</div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                      <Stat label="Sessions" value={String(l.sessions)} />
                      <Stat label="Avg wait" value={`${l.avgWaitMin.toFixed(1)}m`} />
                      <Stat label="Abandon" value={`${l.abandonPct}%`} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
