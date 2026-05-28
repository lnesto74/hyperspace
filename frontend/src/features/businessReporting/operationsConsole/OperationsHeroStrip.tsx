import { TrendingDown, TrendingUp } from 'lucide-react';
import { KpiTileDefinition } from '../personas';
import { formatKpiValue, getThresholdState, STATE_BG, STATE_TEXT } from './kpiFormat';
import type { PeriodDeltas } from './types';

interface OperationsHeroStripProps {
  heroIds: string[];
  kpiDefinitions: KpiTileDefinition[];
  kpiValues: Record<string, number | null | undefined>;
  periodDeltas?: PeriodDeltas;
  visitorSource?: 'ingress' | 'queue_proxy' | 'none';
  onSelect?: (kpiId: string) => void;
}

const DELTA_FOR_KPI: Record<string, keyof PeriodDeltas> = {
  uniqueVisitors: 'visitorsDeltaPct',
  avgWaitingTimeMin: 'visitsDeltaPct',
};

export default function OperationsHeroStrip({
  heroIds,
  kpiDefinitions,
  kpiValues,
  periodDeltas,
  visitorSource,
  onSelect,
}: OperationsHeroStripProps) {
  const defs = heroIds
    .map(id => kpiDefinitions.find(d => d.id === id))
    .filter(Boolean) as KpiTileDefinition[];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {defs.map(def => {
        const value = kpiValues[def.id];
        const state = getThresholdState(value, def.thresholds);
        const deltaKey = DELTA_FOR_KPI[def.id];
        const delta = deltaKey && periodDeltas ? periodDeltas[deltaKey] : null;
        const deltaUp = delta != null && delta > 0;
        const deltaBad = def.id === 'uniqueVisitors'
          ? delta != null && delta < 0
          : def.id === 'abandonRate' || def.id === 'avgWaitingTimeMin'
            ? delta != null && delta > 0
            : false;

        return (
          <button
            key={def.id}
            type="button"
            onClick={() => onSelect?.(def.id)}
            className={`rounded-lg border p-3 text-left transition-colors hover:border-gray-500/60 ${STATE_BG[state]}`}
          >
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">
              {def.id === 'uniqueVisitors' && visitorSource === 'queue_proxy' ? 'Queue shoppers' : def.title}
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-2xl font-bold tabular-nums ${STATE_TEXT[state]}`}>
                {formatKpiValue(value, def.format)}
              </span>
              {delta != null && (
                <span className={`flex items-center text-[10px] ${deltaBad ? 'text-red-400' : deltaUp ? 'text-green-400' : 'text-gray-500'}`}>
                  {deltaUp ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                  {Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
          <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">
            {def.id === 'uniqueVisitors' && visitorSource === 'queue_proxy'
              ? 'Distinct shoppers who entered a checkout queue (ingress zone not recording yet).'
              : def.id === 'totalInStore'
                ? 'Live store occupancy from zone snapshots (excludes checkout queues).'
                : def.meaning}
          </p>
          </button>
        );
      })}
    </div>
  );
}
