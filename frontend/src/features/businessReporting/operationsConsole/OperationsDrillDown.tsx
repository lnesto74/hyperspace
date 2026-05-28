import { X } from 'lucide-react';
import type { DrillDownView, OperationsConsoleData, QueueLaneRow, TimelinePoint } from './types';

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

function BucketTable({
  title,
  note,
  points,
  valueHeader,
  showTypical,
}: {
  title: string;
  note: string;
  points: TimelinePoint[];
  valueHeader: string;
  showTypical?: boolean;
}) {
  const sorted = [...points].filter(p => p.value > 0).sort((a, b) => b.value - a.value);
  const peak = sorted[0]?.value ?? 0;
  const typical = sorted.length
    ? Math.round(sorted.reduce((s, p) => s + p.value, 0) / sorted.length * 10) / 10
    : 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">{note}</p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Peak" value={String(peak)} />
        <Stat label={`Avg ${valueHeader.toLowerCase()}`} value={String(typical)} />
        <Stat label="Buckets with data" value={String(sorted.length)} />
        <Stat label="Grain" value={title} />
      </div>
      <div className="rounded-lg border border-gray-700/60 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-gray-900/80 text-gray-500 text-left">
              <th className="px-3 py-2 font-medium">Period</th>
              <th className="px-3 py-2 font-medium text-right">{valueHeader}</th>
              {showTypical && <th className="px-3 py-2 font-medium text-right">Typical</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => (
              <tr key={p.bucketStartTs} className="border-t border-gray-800/80">
                <td className="px-3 py-1.5 text-gray-300">{p.label}</td>
                <td className="px-3 py-1.5 text-right text-white font-medium tabular-nums">{p.value}</td>
                {showTypical && (
                  <td className="px-3 py-1.5 text-right text-gray-400 tabular-nums">
                    {p.avgVal != null ? p.avgVal : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TITLES: Record<NonNullable<DrillDownView>, string> = {
  traffic: 'Footfall Breakdown',
  checkout: 'Checkout Detail',
  occupancy: 'Shopper Activity Breakdown',
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

  const grainLabel = consoleData.timeline.grain === 'hour' ? 'hourly' : consoleData.timeline.grain;

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

          {view === 'occupancy' && (
            <BucketTable
              title={grainLabel}
              note="Peak and typical shopper counts per period — distinct perception IDs per LiDAR frame (same metric as MQTT live), open hours only."
              points={consoleData.timeline.occupancy}
              valueHeader="Peak shoppers"
              showTypical
            />
          )}

          {view === 'traffic' && (
            <BucketTable
              title={grainLabel}
              note="Ingress zone visits per period from configured footfall ROI."
              points={consoleData.timeline.visitors}
              valueHeader="Visits"
            />
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
