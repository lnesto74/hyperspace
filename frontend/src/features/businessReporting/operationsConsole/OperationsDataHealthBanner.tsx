import type { OpsDataHealth } from './types';

export default function OperationsDataHealthBanner({ health }: { health: OpsDataHealth }) {
  if (health.ingressRecording) {
    return (
      <div className="rounded-md border border-gray-700/50 bg-gray-800/50 px-3 py-1.5">
        <p className="text-[10px] text-gray-400 leading-snug">
          Ingress zone is recording visits — footfall charts use entrance data.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-700/50 bg-gray-800/50 px-3 py-1.5">
      <p className="text-[10px] text-gray-400 leading-snug">
        <span className="text-gray-300">Entrance zone monitoring</span>
        {' '}— baseline started today; visits will switch to ingress when tracks cross the polygon.
        {' '}Until then, shopper counts use LiDAR frame data (same as live MQTT).
      </p>
      {health.message && (
        <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{health.message}</p>
      )}
    </div>
  );
}
