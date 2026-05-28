import { Clock, Users } from 'lucide-react';
import type { QueueLaneRow } from './types';

interface OperationsCheckoutPanelProps {
  lanes: QueueLaneRow[];
  totalQueueLength: number;
  avgWaitMin: number;
  abandonRate: number;
  onSelectLane?: (laneId: string) => void;
}

export default function OperationsCheckoutPanel({
  lanes,
  totalQueueLength,
  avgWaitMin,
  abandonRate,
  onSelectLane,
}: OperationsCheckoutPanelProps) {
  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-white">Checkout Lanes</h3>
        <span className="text-[10px] text-gray-500">{lanes.length} lanes</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-md bg-gray-900/60 px-2 py-1.5 border border-gray-700/50">
          <div className="text-[9px] text-gray-500">Queue now</div>
          <div className="text-lg font-bold text-white tabular-nums">{totalQueueLength}</div>
        </div>
        <div className="rounded-md bg-gray-900/60 px-2 py-1.5 border border-gray-700/50">
          <div className="text-[9px] text-gray-500 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> Avg wait</div>
          <div className="text-lg font-bold text-amber-400 tabular-nums">{avgWaitMin.toFixed(1)}m</div>
        </div>
        <div className="rounded-md bg-gray-900/60 px-2 py-1.5 border border-gray-700/50">
          <div className="text-[9px] text-gray-500">Abandon</div>
          <div className={`text-lg font-bold tabular-nums ${abandonRate > 15 ? 'text-red-400' : 'text-white'}`}>
            {abandonRate.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {lanes.length === 0 && (
          <p className="text-[10px] text-gray-500 text-center py-4">No queue sessions in this period</p>
        )}
        {lanes.map(lane => (
          <button
            key={lane.id}
            type="button"
            onClick={() => onSelectLane?.(lane.id)}
            className="w-full flex items-center gap-2 rounded-md border border-gray-700/60 bg-gray-900/40 px-2 py-1.5 hover:border-gray-500/60 text-left"
          >
            <Users className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-white truncate">{lane.name}</div>
              <div className="text-[9px] text-gray-500">
                {lane.sessions} sessions · {lane.avgWaitMin.toFixed(1)}m avg
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className={`text-xs font-semibold tabular-nums ${lane.currentQueue > 5 ? 'text-amber-400' : 'text-gray-300'}`}>
                {lane.currentQueue}
              </div>
              <div className={`text-[9px] ${lane.abandonPct > 15 ? 'text-red-400' : 'text-gray-500'}`}>
                {lane.abandonPct}% abandon
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
