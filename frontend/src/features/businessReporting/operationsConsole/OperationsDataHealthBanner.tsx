import { AlertTriangle, Database } from 'lucide-react';
import type { OpsDataHealth } from './types';

export default function OperationsDataHealthBanner({ health }: { health: OpsDataHealth }) {
  if (health.ingressRecording) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 flex gap-2 items-start">
      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-xs font-medium text-amber-200">Ingress not recording — charts use checkout queue as proxy</div>
        <p className="text-[10px] text-amber-200/80 mt-0.5 leading-snug">
          {health.message || 'Footfall zone has 0 visits in this period.'}
          {' '}Live DB is updating ({health.queueVisitorCount} queue shoppers in range).
        </p>
        {!health.savedFootfallRoiId && (
          <p className="text-[10px] text-amber-300/90 mt-1">
            Save <strong>Entrance 1121</strong> as footfall ROI in Venue Settings, then verify tracks cross the polygon on the floorplan.
          </p>
        )}
      </div>
      <Database className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-1" title="DB is receiving live writes" />
    </div>
  );
}
