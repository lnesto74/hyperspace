import { KpiTileDefinition } from '../personas';
import { formatKpiValue, getThresholdState, STATE_TEXT } from './kpiFormat';

interface OperationsSecondaryStripProps {
  kpiIds: string[];
  kpiDefinitions: KpiTileDefinition[];
  kpiValues: Record<string, number | null | undefined>;
}

export default function OperationsSecondaryStrip({
  kpiIds,
  kpiDefinitions,
  kpiValues,
}: OperationsSecondaryStripProps) {
  const defs = kpiIds
    .map(id => kpiDefinitions.find(d => d.id === id))
    .filter(Boolean) as KpiTileDefinition[];

  if (!defs.length) return null;

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex gap-2 min-w-max">
        {defs.map(def => {
          const value = kpiValues[def.id];
          const state = getThresholdState(value, def.thresholds);
          return (
            <div
              key={def.id}
              title={`${def.meaning}\n${def.tooltip}`}
              className="flex flex-col justify-center px-3 py-2 rounded-lg border border-gray-700/60 bg-gray-900/40 min-w-[96px] flex-shrink-0"
            >
              <span className="text-[9px] text-gray-500 truncate">{def.title}</span>
              <span className={`text-sm font-semibold tabular-nums ${STATE_TEXT[state]}`}>
                {formatKpiValue(value, def.format)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
