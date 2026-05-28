import { API_BASE } from '../../config/api'
import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  ShoppingBag,
  RefreshCw,
  Building2,
  ChevronDown,
  ChevronRight,
  MonitorPlay,
} from 'lucide-react';
import { useVenue } from '../../context/VenueContext';
import { useHeatmap } from '../../context/HeatmapContext';
import { PERSONAS, getPersonaById, enforceKpiCap } from './personas';
import ReportingKpiStrip from './components/ReportingKpiStrip';
import OperationsPulseConsole from './operationsConsole/OperationsPulseConsole';
import type { OperationsConsoleData, TimelineGrain } from './operationsConsole/types';
import ReportingInsightsPanel from './components/ReportingInsightsPanel';
import ZonePerformanceViewport, { type ZonePerformanceItem } from './components/ZonePerformanceViewport';
import PebleEffectivenessViewport, { type CampaignPerformanceItem } from './components/PebleEffectivenessViewport';
import PersonaIconRail from './components/PersonaIconRail';
import CategoryRankingPanel, { CategoryRankingRow } from './components/CategoryRankingPanel';
import CategoryVisitsPanel from './components/CategoryVisitsPanel';
import CampaignRankingPanel, { CampaignRankingRow } from './components/CampaignRankingPanel';
import ExecutiveSummaryViewport, {
  type ExecutivePillar,
  type ExecutiveHighlights,
  type PeriodDeltas,
} from './components/ExecutiveSummaryViewport';
import type { DoohScreenMarker } from '../../components/shared/FloorPlanMiniMap';

type TimeRange = '1h' | '24h' | '7d' | 'custom';

interface TimeRangeOption {
  id: TimeRange;
  label: string;
  getRange: () => { startTs: number; endTs: number };
}

const TIME_RANGES: TimeRangeOption[] = [
  {
    id: '1h',
    label: '1h',
    getRange: () => ({
      startTs: Date.now() - 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
  {
    id: '24h',
    label: '24h',
    getRange: () => ({
      startTs: Date.now() - 24 * 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
  {
    id: '7d',
    label: '7d',
    getRange: () => ({
      startTs: Date.now() - 7 * 24 * 60 * 60 * 1000,
      endTs: Date.now(),
    }),
  },
];

const ZONE_MAP_PERSONAS = new Set(['merchandising']);
const PEBLE_MAP_PERSONAS = new Set(['retail-media']);
const EXECUTIVE_PERSONAS = new Set(['executive']);

interface BusinessReportingPageProps {
  onClose: () => void;
}

export default function BusinessReportingPage({ onClose }: BusinessReportingPageProps) {
  const { venue, venues } = useVenue();
  const { openHeatmapForCategory } = useHeatmap();
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(venue?.id || null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(PERSONAS[0].id);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>('24h');
  const [opsGrain, setOpsGrain] = useState<TimelineGrain>('hour');
  const [kpiValues, setKpiValues] = useState<Record<string, number | null>>({});
  const [supporting, setSupporting] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; skuCount?: number }>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [campaignsExpanded, setCampaignsExpanded] = useState(false);

  const selectedPersona = useMemo(
    () => getPersonaById(selectedPersonaId) || PERSONAS[0],
    [selectedPersonaId],
  );

  const kpiDefinitions = useMemo(
    () => enforceKpiCap(selectedPersona),
    [selectedPersona],
  );

  const deadZones = useMemo(
    () => (supporting.deadZones as ZonePerformanceItem[]) || [],
    [supporting.deadZones],
  );

  const topZones = useMemo(
    () => (supporting.topZones as ZonePerformanceItem[]) || [],
    [supporting.topZones],
  );

  const operationsConsole = useMemo(
    () => supporting.operationsConsole as OperationsConsoleData | undefined,
    [supporting.operationsConsole],
  );

  const showOperationsConsole = selectedPersonaId === 'store-manager' && !!operationsConsole;

  const showZoneMap = ZONE_MAP_PERSONAS.has(selectedPersonaId)
    && selectedVenueId
    && (deadZones.length > 0 || topZones.length > 0);

  const executivePillars = useMemo(
    () => (supporting.executivePillars as ExecutivePillar[]) || [],
    [supporting.executivePillars],
  );
  const executiveHighlights = useMemo(
    () => (supporting.highlights as ExecutiveHighlights) || {},
    [supporting.highlights],
  );
  const periodDeltas = useMemo(
    () => (supporting.periodDeltas as PeriodDeltas) || {},
    [supporting.periodDeltas],
  );

  const showExecutiveSummary = EXECUTIVE_PERSONAS.has(selectedPersonaId)
    && selectedVenueId
    && executivePillars.length > 0;

  const topCampaigns = useMemo(
    () => (supporting.topCampaigns as CampaignPerformanceItem[]) || [],
    [supporting.topCampaigns],
  );
  const underperformingCampaigns = useMemo(
    () => (supporting.underperformingCampaigns as CampaignPerformanceItem[]) || [],
    [supporting.underperformingCampaigns],
  );
  const doohScreens = useMemo(
    () => (supporting.doohScreens as DoohScreenMarker[]) || [],
    [supporting.doohScreens],
  );
  const campaignRanking = useMemo(
    () => (supporting.campaignRanking as CampaignRankingRow[]) || [],
    [supporting.campaignRanking],
  );

  const showPebleMap = PEBLE_MAP_PERSONAS.has(selectedPersonaId)
    && selectedVenueId
    && (topCampaigns.length > 0 || underperformingCampaigns.length > 0 || doohScreens.length > 0);

  const zoneUtilThresholdPct = (supporting.zoneUtilThresholdPct as number | undefined) ?? 5;

  const fetchData = async () => {
    if (!selectedVenueId) return;

    setLoading(true);
    setError(null);

    try {
      const timeRangeOption = TIME_RANGES.find(t => t.id === selectedTimeRange);
      const { startTs, endTs } = timeRangeOption?.getRange() || TIME_RANGES[1].getRange();

      const params = new URLSearchParams({
        personaId: selectedPersonaId,
        venueId: selectedVenueId,
        startTs: String(startTs),
        endTs: String(endTs),
      });

      if (selectedPersonaId === 'merchandising' && selectedCategoryId !== 'all') {
        params.set('categoryId', selectedCategoryId);
      }

      if (selectedPersonaId === 'store-manager') {
        params.set('grain', opsGrain);
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 90000);

      let response: Response;
      try {
        response = await fetch(`${API_BASE}/api/reporting/summary?${params}`, {
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status === 404) {
          setError('Business Reporting feature is not enabled. Set FEATURE_BUSINESS_REPORTING=true.');
          return;
        }
        let detail = response.statusText || `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.message) detail = errBody.message;
          else if (errBody?.error) detail = errBody.error;
        } catch { /* ignore */ }
        throw new Error(detail);
      }

      const data = await response.json();
      setKpiValues(data.kpis || {});
      setSupporting(data.supporting || {});
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch reporting data:', err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Request timed out — 7d reports can take up to 90s on a busy server. Try again or use 24h.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedVenueId, selectedPersonaId, selectedTimeRange, selectedCategoryId, opsGrain]);

  const handleTimeRangeChange = (rangeId: TimeRange) => {
    setSelectedTimeRange(rangeId);
    if (selectedPersonaId === 'store-manager') {
      setOpsGrain(rangeId === '7d' ? 'day' : 'hour');
    }
  };

  useEffect(() => {
    if (venue?.id && !selectedVenueId) {
      setSelectedVenueId(venue.id);
    }
  }, [venue?.id]);

  useEffect(() => {
    const fetchCategories = async () => {
      if (!selectedVenueId) return;
      try {
        const res = await fetch(`${API_BASE}/api/reporting/categories?venueId=${selectedVenueId}`);
        if (res.ok) {
          const data = await res.json();
          setCategories(data.categories || []);
        }
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      }
    };
    fetchCategories();
  }, [selectedVenueId]);

  const topCategories = supporting.topCategories as CategoryRankingRow[] | undefined;

  const heatmapTimeframe = selectedTimeRange === '7d' ? 'week' as const : 'day' as const;

  const handleCategoryHeatmap = (row: CategoryRankingRow) => {
    if (!row.roiIds?.length || !selectedVenueId) return;
    openHeatmapForCategory(row.roiIds, row.category, heatmapTimeframe, selectedVenueId);
  };

  const showCategoryVisits = Array.isArray(topCategories) && topCategories.length > 0
    && selectedPersonaId === 'merchandising';

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden">
      {/* Command strip header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-3 bg-gray-800 flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5 flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs hidden sm:inline">Back</span>
          </button>
          <div className="h-5 w-px bg-gray-700 flex-shrink-0" />
          <h1 className="text-white text-sm font-semibold truncate">Business Reporting</h1>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Building2 className="w-3.5 h-3.5 text-gray-500 hidden sm:block" />
          <select
            value={selectedVenueId || ''}
            onChange={(e) => setSelectedVenueId(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-xs text-white max-w-[140px] sm:max-w-none"
          >
            {(venues || []).map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>

          <div className="flex bg-gray-700 rounded-md p-0.5">
            {TIME_RANGES.map(tr => (
              <button
                key={tr.id}
                onClick={() => handleTimeRangeChange(tr.id)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  selectedTimeRange === tr.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tr.label}
              </button>
            ))}
          </div>

          {selectedPersonaId === 'merchandising' && categories.length > 0 && (
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-xs text-white max-w-[120px] hidden md:block"
            >
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={fetchData}
            disabled={loading}
            className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-gray-300 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {lastUpdated && (
            <span className="text-[10px] text-gray-500 hidden lg:inline">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-3 py-3 space-y-3">
          <PersonaIconRail
            selectedPersonaId={selectedPersonaId}
            onSelect={setSelectedPersonaId}
          />

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {loading && !error && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          )}

          {!loading && !error && (
            <>
              {showOperationsConsole && operationsConsole ? (
                <OperationsPulseConsole
                  consoleData={operationsConsole}
                  kpiValues={kpiValues}
                  periodDeltas={periodDeltas}
                  grain={opsGrain}
                  onGrainChange={setOpsGrain}
                  topCategories={topCategories}
                  onOpenCategoryHeatmap={handleCategoryHeatmap}
                  venueId={selectedVenueId!}
                  heatmapTimeframe={heatmapTimeframe}
                />
              ) : (
                <ReportingKpiStrip
                  kpiDefinitions={kpiDefinitions}
                  kpiValues={kpiValues}
                />
              )}

              {showExecutiveSummary && (
                <ExecutiveSummaryViewport
                  venueId={selectedVenueId!}
                  pillars={executivePillars}
                  highlights={executiveHighlights}
                  periodDeltas={periodDeltas}
                  deadZones={deadZones}
                  topZones={topZones}
                  zoneUtilThresholdPct={zoneUtilThresholdPct}
                  topCategories={topCategories}
                  onOpenCategoryHeatmap={handleCategoryHeatmap}
                />
              )}

              {showCategoryVisits && selectedPersonaId !== 'executive' && (
                <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-700/60">
                    <span className="text-xs font-medium text-white">Category Traffic</span>
                    <span className="text-[10px] text-gray-500 ml-2">Latticini · Frutta · Surgelati · …</span>
                  </div>
                  <div className="p-3">
                    <CategoryVisitsPanel
                      categories={topCategories!}
                      onOpenHeatmap={handleCategoryHeatmap}
                      compact={selectedPersonaId === 'store-manager'}
                    />
                  </div>
                </div>
              )}

              {showZoneMap && (
                <ZonePerformanceViewport
                  venueId={selectedVenueId!}
                  deadZones={deadZones}
                  topZones={topZones}
                  zoneUtilThresholdPct={zoneUtilThresholdPct}
                />
              )}

              {showPebleMap && (
                <PebleEffectivenessViewport
                  venueId={selectedVenueId!}
                  topCampaigns={topCampaigns}
                  underperformingCampaigns={underperformingCampaigns}
                  doohScreens={doohScreens}
                  dataWindowStartTs={supporting.dataWindowStartTs as number | undefined}
                  dataWindowEndTs={supporting.dataWindowEndTs as number | undefined}
                />
              )}

              {!showOperationsConsole && (
                <ReportingInsightsPanel
                  kpiDefinitions={kpiDefinitions}
                  kpiValues={kpiValues}
                  personaName={selectedPersona.name}
                  compact
                />
              )}

              {Array.isArray(campaignRanking) && campaignRanking.length > 0
                && (selectedPersonaId === 'retail-media' || selectedPersonaId === 'executive') && (
                <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCampaignsExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-left">
                      {campaignsExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                      <MonitorPlay className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-medium text-white">Campaign Performance Ranking</span>
                      <span className="text-[10px] text-gray-500">({campaignRanking.length})</span>
                    </div>
                  </button>
                  {campaignsExpanded && (
                    <div className="px-3 pb-3 border-t border-gray-700/60 pt-2">
                      <CampaignRankingPanel campaigns={campaignRanking} />
                    </div>
                  )}
                </div>
              )}

              {Array.isArray(topCategories) && topCategories.length > 0
                && selectedPersonaId !== 'retail-media'
                && selectedPersonaId !== 'store-manager'
                && selectedPersonaId !== 'executive'
                && selectedPersonaId !== 'merchandising' && (
                <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCategoriesExpanded(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-left">
                      {categoriesExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                      <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium text-white">Category Performance Ranking</span>
                      <span className="text-[10px] text-gray-500">({topCategories.length})</span>
                    </div>
                    {selectedPersonaId === 'merchandising' && selectedCategoryId !== 'all' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCategoryId('all');
                        }}
                        className="text-[10px] text-amber-400 hover:text-amber-300"
                      >
                        Clear filter
                      </button>
                    )}
                  </button>
                  {categoriesExpanded && (
                    <div className="px-3 pb-3 border-t border-gray-700/60 pt-2">
                      <CategoryRankingPanel
                        categories={topCategories}
                        selectedCategoryId={selectedPersonaId === 'merchandising' ? selectedCategoryId : undefined}
                        onSelectCategory={
                          selectedPersonaId === 'merchandising'
                            ? (categoryId) => setSelectedCategoryId(categoryId)
                            : undefined
                        }
                      />
                    </div>
                  )}
                </div>
              )}

            </>
          )}
        </div>
      </div>
    </div>
  );
}
