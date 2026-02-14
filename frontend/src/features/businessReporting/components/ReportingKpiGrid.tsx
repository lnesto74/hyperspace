import { KpiTileDefinition, MAX_KPIS_PER_PERSONA } from '../personas';
import ReportingKpiTile from './ReportingKpiTile';

interface ReportingKpiGridProps {
  kpiDefinitions: KpiTileDefinition[];
  kpiValues: Record<string, number | null | undefined>;
  previousValues?: Record<string, number | null>;
}

export default function ReportingKpiGrid({ 
  kpiDefinitions, 
  kpiValues, 
  previousValues 
}: ReportingKpiGridProps) {
  // Enforce KPI cap
  const cappedDefinitions = kpiDefinitions.slice(0, MAX_KPIS_PER_PERSONA);
  
  if (import.meta.env.DEV && kpiDefinitions.length > MAX_KPIS_PER_PERSONA) {
    console.warn(
      `[ReportingKpiGrid] Received ${kpiDefinitions.length} KPIs, capping to ${MAX_KPIS_PER_PERSONA}`
    );
  }
  
  if (cappedDefinitions.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-8 text-center">
        <p className="text-gray-400">No KPIs configured for this persona.</p>
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {cappedDefinitions.map((definition) => (
        <ReportingKpiTile
          key={definition.id}
          definition={definition}
          value={kpiValues[definition.id]}
          previousValue={previousValues?.[definition.id]}
        />
      ))}
    </div>
  );
}
