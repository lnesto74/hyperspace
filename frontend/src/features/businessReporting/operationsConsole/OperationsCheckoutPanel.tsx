import { ChevronRight, Clock } from 'lucide-react';
import type { QueueLaneRow } from './types';

const PREVIEW_LANES = 3;

interface OperationsCheckoutPanelProps {
  lanes: QueueLaneRow[];
  totalQueueLength: number;
  avgWaitMin: number;
  abandonRate: number;
  onSelectLane?: (laneId: string) => void;
  onViewAll?: () => void;
}

export default function OperationsCheckoutPanel({
  lanes,
  totalQueueLength,
  avgWaitMin,
  abandonRate,
  onSelectLane,
  onViewAll,
}: OperationsCheckoutPanelProps) {
  const preview = lanes.slice(0, PREVIEW_LANES);
  const busiest = [...lanes].sort((a, b) => b.currentQueue - a.currentQueue || b.sessions - a.sessions)[0];

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-white">Checkout</h3>
        {lanes.length > PREVIEW_LANES && (
          <button type="button" onClick={onViewAll} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
            All {lanes.length} lanes <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
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

      {busiest && (
        <div className="text-[10px] text-gray-400 mb-2">
          Busiest: <span className="text-gray-200">{busiest.name}</span>
          {' '}· {busiest.sessions} sessions · {busiest.avgWaitMin.toFixed(1)}m avg
        </div>
      )}

      {preview.length > 0 ? (
        <div className="flex gap-1.5">
          {preview.map(lane => (
            <button
              key={lane.id}
              type="button"
              onClick={() => onSelectLane?.(lane.id)}
              className="flex-1 min-w-0 rounded-md border border-gray-700/60 bg-gray-900/40 px-2 py-1.5 hover:border-gray-500/60 text-left"
            >
              <div className="text-[10px] text-white truncate">{lane.name.replace(' - Queue', '')}</div>
              <div className="text-[9px] text-gray-500">{lane.sessions} sess · {lane.currentQueue} now</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-gray-500 text-center py-2">No queue sessions in this period</p>
      )}
    </div>
  );
}
