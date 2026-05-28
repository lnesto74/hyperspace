import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import OperationsCheckoutPanel from './OperationsCheckoutPanel';
import type { QueueLaneRow } from './types';

interface OperationsCheckoutCollapsibleProps {
  lanes: QueueLaneRow[];
  totalQueueLength: number;
  avgWaitMin: number;
  abandonRate: number;
}

export default function OperationsCheckoutCollapsible(props: OperationsCheckoutCollapsibleProps) {
  const [open, setOpen] = useState(false);
  const { lanes, totalQueueLength, avgWaitMin, abandonRate } = props;

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800/60 transition-colors"
      >
        <div className="flex items-center gap-2 text-left">
          {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
          <span className="text-xs font-medium text-white">Checkout Performance</span>
          <span className="text-[10px] text-gray-500">
            wait {avgWaitMin.toFixed(1)}m · queue {totalQueueLength} · abandon {abandonRate.toFixed(1)}%
          </span>
        </div>
        <span className="text-[10px] text-gray-500">{lanes.length} lanes</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-gray-700/60 pt-2">
          <OperationsCheckoutPanel {...props} />
        </div>
      )}
    </div>
  );
}
