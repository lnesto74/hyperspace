import { useMemo, useState } from 'react';
import {
  OPERATIONS_HERO_KPIS,
  OPERATIONS_SECONDARY_KPIS,
} from '../personas';
import OperationsHeroStrip from './OperationsHeroStrip';
import OperationsTimelineChart from './OperationsTimelineChart';
import OperationsCheckoutPanel from './OperationsCheckoutPanel';
import OperationsAlertsPanel from './OperationsAlertsPanel';
import OperationsFootfallPanel from './OperationsFootfallPanel';
import OperationsSecondaryStrip from './OperationsSecondaryStrip';
import OperationsDrillDown from './OperationsDrillDown';
import type { DrillDownView, OperationsConsoleData, PeriodDeltas, TimelineGrain } from './types';

interface OperationsPulseConsoleProps {
  consoleData: OperationsConsoleData;
  kpiValues: Record<string, number | null | undefined>;
  periodDeltas?: PeriodDeltas;
  grain: TimelineGrain;
  onGrainChange: (grain: TimelineGrain) => void;
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
}: OperationsPulseConsoleProps) {
  const [drillDown, setDrillDown] = useState<DrillDownView>(null);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);

  const allKpiDefs = useMemo(
    () => [...OPERATIONS_HERO_KPIS, ...OPERATIONS_SECONDARY_KPIS],
    [],
  );

  const handleHeroSelect = (kpiId: string) => {
    if (kpiId === 'uniqueVisitors') setDrillDown('traffic');
    else if (kpiId === 'avgWaitingTimeMin' || kpiId === 'abandonRate') setDrillDown('checkout');
    else if (kpiId === 'totalInStore') setDrillDown('occupancy');
  };

  const handleTimelineDrill = (mode: 'visitors' | 'occupancy') => {
    setDrillDown(mode === 'visitors' ? 'traffic' : 'occupancy');
  };

  const handleLaneSelect = (laneId: string) => {
    setSelectedLaneId(laneId);
    setDrillDown('lane');
  };

  return (
    <div className="space-y-3">
      <OperationsHeroStrip
        heroIds={consoleData.heroKpiIds}
        kpiDefinitions={allKpiDefs}
        kpiValues={kpiValues}
        periodDeltas={periodDeltas}
        onSelect={handleHeroSelect}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-gray-500 uppercase tracking-wide">Timeline grain</span>
        <div className="flex bg-gray-800 rounded-md p-0.5 border border-gray-700/60">
          {GRAINS.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => onGrainChange(g.id)}
              className={`px-2.5 py-0.5 text-[10px] rounded transition-colors ${
                grain === g.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 min-h-[240px]">
        <div className="xl:col-span-7">
          <OperationsTimelineChart
            timeline={consoleData.timeline}
            onDrillDown={handleTimelineDrill}
          />
        </div>
        <div className="xl:col-span-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
          <OperationsCheckoutPanel
            lanes={consoleData.queueLanes}
            totalQueueLength={kpiValues.currentQueueLength as number || 0}
            avgWaitMin={kpiValues.avgWaitingTimeMin as number || 0}
            abandonRate={kpiValues.abandonRate as number || 0}
            onSelectLane={handleLaneSelect}
          />
          <OperationsAlertsPanel alerts={consoleData.alerts} />
        </div>
      </div>

      <OperationsFootfallPanel footfall={consoleData.footfall} />

      <OperationsSecondaryStrip
        kpiIds={consoleData.secondaryKpiIds}
        kpiDefinitions={allKpiDefs}
        kpiValues={kpiValues}
      />

      <OperationsDrillDown
        view={drillDown}
        consoleData={consoleData}
        selectedLaneId={selectedLaneId}
        onClose={() => {
          setDrillDown(null);
          setSelectedLaneId(null);
        }}
      />
    </div>
  );
}
