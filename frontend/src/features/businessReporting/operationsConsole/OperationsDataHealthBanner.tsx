import type { OpsDataHealth } from './types';

export default function OperationsDataHealthBanner({ health }: { health: OpsDataHealth }) {
  if (health.ingressRecording) return null;

  return (
    <div className="rounded-md border border-gray-700/50 bg-gray-800/50 px-3 py-1.5">
      <p className="text-[10px] text-gray-400 leading-snug">
        {health.message || 'Footfall zone not recording yet.'}
        {' '}Store activity charts use live occupancy until ingress visits are available.
      </p>
    </div>
  );
}
