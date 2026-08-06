import { Clock } from 'lucide-react';
import type { QueueLaneRow } from './types';

interface OperationsCheckoutPanelProps {
  lanes: QueueLaneRow[];
  totalQueueLength: number;
  avgWaitMin: number;
  abandonRate: number;
}

export default function OperationsCheckoutPanel({
  lanes,
  totalQueueLength,
  avgWaitMin,
  abandonRate,
}: OperationsCheckoutPanelProps) {
  const busiest = [...lanes].sort((a, b) => b.currentQueue - a.currentQueue || b.sessions - a.sessions)[0];

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-white">Checkout</h3>
        {lanes.length > 0 && (
          <span className="text-xs text-gray-400">{lanes.length} lanes</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="rounded-md bg-gray-900/60 px-2 py-1.5 border border-gray-700/50">
          <div className="text-[11px] text-gray-400">Queue now</div>
          <div className="text-lg font-bold text-white tabular-nums">{totalQueueLength}</div>
        </div>
        <div className="rounded-md bg-gray-900/60 px-2 py-1.5 border border-gray-700/50">
          <div className="text-[11px] text-gray-400 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> Avg wait</div>
          <div className={`text-lg font-bold tabular-nums ${avgWaitMin > 5 ? 'text-red-400' : 'text-white'}`}>{avgWaitMin.toFixed(1)}m</div>
        </div>
        <div className="rounded-md bg-gray-900/60 px-2 py-1.5 border border-gray-700/50">
          <div className="text-[11px] text-gray-400">Abandon</div>
          <div className={`text-lg font-bold tabular-nums ${abandonRate > 15 ? 'text-red-400' : 'text-white'}`}>
            {abandonRate.toFixed(1)}%
          </div>
        </div>
      </div>

      {busiest && (
        <div className="text-xs text-gray-400 mb-2">
          Busiest: <span className="text-gray-200">{busiest.name}</span>
          {' '}· {busiest.sessions} sessions · {busiest.avgWaitMin.toFixed(1)}m avg
        </div>
      )}

      {lanes.length > 0 ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {lanes.map(lane => (
            <div
              key={lane.id}
              className="rounded-md border border-gray-700/60 bg-gray-900/40 px-2.5 py-2"
            >
              <div className="text-xs text-white truncate mb-1.5">{lane.name.replace(' - Queue', '')}</div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
                <LaneStat label="Sessions" value={String(lane.sessions)} />
                <LaneStat label="Completed" value={String(lane.completed)} />
                <LaneStat label="Avg wait" value={`${lane.avgWaitMin.toFixed(1)}m`} />
                <LaneStat label="Abandon" value={`${lane.abandonPct}%`} />
                <LaneStat label="Left queue" value={String(lane.abandoned)} />
                <LaneStat label="Queue now" value={String(lane.currentQueue)} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-2">No queue sessions in this period</p>
      )}
    </div>
  );
}

function LaneStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="text-xs text-white tabular-nums">{value}</div>
    </div>
  );
}
