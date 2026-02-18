/**
 * EpisodeKPICards
 * 
 * Displays KPI delta cards for a behavior episode.
 * Shows value, direction, baseline comparison, and change percentage.
 */

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { EpisodeKpiCard } from '../../context/ReplayInsightContext';

interface EpisodeKPICardsProps {
  kpis: EpisodeKpiCard[];
}

const DIRECTION_CONFIG = {
  up: { icon: TrendingUp, color: 'text-red-400', bg: 'bg-red-500/10', label: '▲' },
  down: { icon: TrendingDown, color: 'text-amber-400', bg: 'bg-amber-500/10', label: '▼' },
  flat: { icon: Minus, color: 'text-gray-400', bg: 'bg-gray-500/10', label: '—' },
};

function formatValue(value: number | null, unit: string): string {
  if (value == null) return '—';
  switch (unit) {
    case 'percent':
      return `${value}%`;
    case 'seconds':
      return `${value}s`;
    case 'minutes':
      return `${value}m`;
    case 'per_minute':
      return `${value}/min`;
    case 'people':
    case 'visitors':
    case 'count':
    case 'lanes':
      return String(value);
    case 'score':
      return String(value);
    default:
      return String(value);
  }
}

export default function EpisodeKPICards({ kpis }: EpisodeKPICardsProps) {
  if (!kpis || kpis.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {kpis.map((kpi) => {
        const dir = DIRECTION_CONFIG[kpi.direction] || DIRECTION_CONFIG.flat;
        const DirIcon = dir.icon;

        return (
          <div
            key={kpi.id}
            className={`rounded-lg p-3 ${dir.bg} border border-gray-700/50`}
          >
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 truncate">
              {kpi.label}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-semibold text-white">
                {formatValue(kpi.value, kpi.unit)}
              </span>
              <DirIcon className={`w-3.5 h-3.5 ${dir.color}`} />
            </div>
            {kpi.baseline != null && (
              <div className="text-[10px] text-gray-500 mt-0.5">
                baseline: {formatValue(kpi.baseline, kpi.unit)}
                {kpi.change != null && (
                  <span className={kpi.change > 0 ? 'text-red-400' : 'text-green-400'}>
                    {' '}({kpi.change > 0 ? '+' : ''}{kpi.change}%)
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
