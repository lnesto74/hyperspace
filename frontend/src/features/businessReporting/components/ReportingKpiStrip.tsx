import { KpiFormat, KpiTileDefinition, KpiThresholds, MAX_KPIS_PER_PERSONA } from '../personas';

function formatValue(value: number | null | undefined, format: KpiFormat): string {
  if (value === null || value === undefined) return '—';
  switch (format) {
    case 'percent': return `${value.toFixed(1)}%`;
    case 'seconds': return `${Math.round(value)}s`;
    case 'minutes': return `${value.toFixed(1)}m`;
    case 'int': return Math.round(value).toLocaleString();
    case 'float': return value.toFixed(2);
    case 'score': return value.toFixed(1);
    case 'currency': return `$${value.toFixed(2)}`;
    default: return String(value);
  }
}

function getThresholdState(
  value: number | null | undefined,
  thresholds?: KpiThresholds,
): 'good' | 'warn' | 'bad' | 'neutral' {
  if (value === null || value === undefined || !thresholds) return 'neutral';
  const { good, warn, direction } = thresholds;
  if (direction === 'lower') {
    if (value <= good) return 'good';
    if (value <= warn) return 'warn';
    return 'bad';
  }
  if (value >= good) return 'good';
  if (value >= warn) return 'warn';
  return 'bad';
}

const STATE_TEXT: Record<string, string> = {
  good: 'text-green-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  neutral: 'text-white',
};

interface ReportingKpiStripProps {
  kpiDefinitions: KpiTileDefinition[];
  kpiValues: Record<string, number | null | undefined>;
}

export default function ReportingKpiStrip({
  kpiDefinitions,
  kpiValues,
}: ReportingKpiStripProps) {
  const defs = kpiDefinitions.slice(0, MAX_KPIS_PER_PERSONA);

  if (defs.length === 0) return null;

  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1">
      <div className="flex gap-2 min-w-max">
        {defs.map(def => {
          const value = kpiValues[def.id];
          const state = getThresholdState(value, def.thresholds);
          return (
            <div
              key={def.id}
              title={`${def.meaning}\n${def.tooltip}`}
              className="flex flex-col justify-center px-3 py-2 rounded-lg border border-gray-700/80 bg-gray-800/60 min-w-[108px] max-w-[140px] flex-shrink-0"
            >
              <span className="text-[10px] text-gray-500 truncate leading-tight">{def.title}</span>
              <span className={`text-lg font-semibold tabular-nums leading-tight mt-0.5 ${STATE_TEXT[state]}`}>
                {formatValue(value, def.format)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
