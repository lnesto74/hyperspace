import { useMemo } from 'react';
import {
  OPERATIONS_HERO_KPIS,
  OPERATIONS_SECONDARY_KPIS,
} from '../personas';
import OperationsDataHealthBanner from './OperationsDataHealthBanner';
import OperationsHeroStrip from './OperationsHeroStrip';
import OperationsTimelineChart from './OperationsTimelineChart';
import OperationsCheckoutCollapsible from './OperationsCheckoutCollapsible';
import OperationsAlertsPanel from './OperationsAlertsPanel';
import OperationsFootfallPanel from './OperationsFootfallPanel';
import CategoryTrafficSection from '../components/CategoryTrafficSection';
import type { CategoryRankingRow } from '../components/CategoryRankingPanel';
import type { OperationsConsoleData, PeriodDeltas, TimelineGrain } from './types';

interface OperationsPulseConsoleProps {
  consoleData: OperationsConsoleData;
  kpiValues: Record<string, number | null | undefined>;
  periodDeltas?: PeriodDeltas;
  grain: TimelineGrain;
  onGrainChange: (grain: TimelineGrain) => void;
  topCategories?: CategoryRankingRow[];
  onOpenCategoryHeatmap?: (row: CategoryRankingRow) => void;
  venueId?: string;
  heatmapTimeframe?: 'day' | 'week' | 'month';
}

const GRAINS: { id: TimelineGrain; label: string }[] = [
  { id: 'hour', label: 'Hour' },
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
];

export default function OperationsPulseConsole({
  consoleData,
  kpiValues,
  periodDeltas,
  grain,
  onGrainChange,
  topCategories = [],
  onOpenCategoryHeatmap,
  venueId,
  heatmapTimeframe = 'day',
}: OperationsPulseConsoleProps) {
  const allKpiDefs = useMemo(
    () => [...OPERATIONS_HERO_KPIS, ...OPERATIONS_SECONDARY_KPIS],
    [],
  );

  const showFootfallSeries = consoleData.timeline.visitorSource === 'ingress';

  return (
    <div className="space-y-3">
      <OperationsHeroStrip
        heroIds={consoleData.heroKpiIds}
        kpiDefinitions={allKpiDefs}
        kpiValues={kpiValues}
        periodDeltas={periodDeltas}
      />

      {consoleData.dataHealth && (
        <OperationsDataHealthBanner health={consoleData.dataHealth} />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400 uppercase tracking-wide">Activity grain</span>
        <div className="flex bg-gray-800 rounded-md p-0.5 border border-gray-700/60">
          {GRAINS.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => onGrainChange(g.id)}
              className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
                grain === g.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <OperationsTimelineChart
        timeline={consoleData.timeline}
        showFootfallSeries={showFootfallSeries}
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div className="xl:col-span-8">
          <OperationsFootfallPanel
            footfall={consoleData.footfall}
            storeActivityByHour={consoleData.storeActivityByHour}
          />
        </div>
        <div className="xl:col-span-4">
          <OperationsAlertsPanel alerts={consoleData.alerts} />
        </div>
      </div>

      {topCategories.length > 0 && venueId && (
        <CategoryTrafficSection
          categories={topCategories}
          venueId={venueId}
          heatmapTimeframe={heatmapTimeframe}
          onOpenCategoryHeatmap={onOpenCategoryHeatmap}
          compact
        />
      )}

      <OperationsCheckoutCollapsible
        lanes={consoleData.queueLanes}
        totalQueueLength={kpiValues.currentQueueLength as number || 0}
        avgWaitMin={kpiValues.avgWaitingTimeMin as number || 0}
        abandonRate={kpiValues.abandonRate as number || 0}
      />
    </div>
  );
}
