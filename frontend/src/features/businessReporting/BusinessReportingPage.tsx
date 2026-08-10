import { API_BASE } from '../../config/api'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { useAuth } from '../../context/AuthContext';
import { useHeatmap } from '../../context/HeatmapContext';
import { PERSONAS, getPersonaById, enforceKpiCap } from './personas';
import ReportingKpiStrip from './components/ReportingKpiStrip';
import OperationsPulseConsole from './operationsConsole/OperationsPulseConsole';
import type { OperationsConsoleData, TimelineGrain, PeriodDeltas as OpsPeriodDeltas } from './operationsConsole/types';
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
import EsselungaExecutiveViewport from './esselunga/EsselungaExecutiveViewport';
import ZoneAuditViewport from './components/ZoneAuditViewport';
import type { EsselungaJourneyPayload, ExecutiveVariant, MetricThresholdSettings } from './esselunga/types';
import type { DoohScreenMarker } from '../../components/shared/FloorPlanMiniMap';
import { getDemoVenueId, getDemoLinkType, getDemoPublishedLayout } from '../../config/demo';
import DashboardBuilderViewport from './dashboardBuilder/DashboardBuilderViewport';
import { CUSTOM_DASHBOARD_PERSONA } from './dashboardBuilder/types';
import type { DashboardLayout } from './dashboardBuilder/types';
import type { DashboardDataContext } from './dashboardBuilder/WidgetRenderer';

type TimeRange = '1h' | '24h' | '7d' | '30d' | 'custom';

interface TimeRangeOption {
  id: TimeRange;
  label: string;
  getRange: () => { startTs: number; endTs: number };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A single `now` per range keeps the span exactly the advertised duration; two
 * `Date.now()` calls can straddle a millisecond and push 30d past the server's
 * 30-day ceiling.
 *
 * The end is floored to `alignMs` so a trailing window stays on the same cache
 * key for that whole bucket. Without this, every open of "last 24h" ended at a
 * different millisecond and never hit the server cache, so each refresh paid
 * for a cold Esselunga recompute on the live ingest process.
 */
function trailingRange(durationMs: number, alignMs = 30_000) {
  return () => {
    const endTs = Math.floor(Date.now() / alignMs) * alignMs;
    return { startTs: endTs - durationMs, endTs };
  };
}

const TIME_RANGES: TimeRangeOption[] = [
  { id: '1h', label: '1h', getRange: trailingRange(HOUR_MS, 30_000) },
  { id: '24h', label: '24h', getRange: trailingRange(DAY_MS, 5 * 60_000) },
  { id: '7d', label: '7d', getRange: trailingRange(7 * DAY_MS, 5 * 60_000) },
  { id: '30d', label: '30d', getRange: trailingRange(30 * DAY_MS, 5 * 60_000) },
];

/** Ranges whose timelines are more readable bucketed by day than by hour. */
const DAY_GRAIN_RANGES = new Set<TimeRange>(['7d', '30d']);

/**
 * Generous enough to absorb a cold cache on the widest range, while still
 * failing with a clear message rather than hanging forever.
 */
const REQUEST_TIMEOUT_MS = 120000;

const ZONE_MAP_PERSONAS = new Set(['merchandising']);
const PEBLE_MAP_PERSONAS = new Set(['retail-media']);
const EXECUTIVE_PERSONAS = new Set(['executive']);
const ESSELUNGA_PERSONA = 'esselunga-executive';
const AUDIT_PERSONA = 'measurement-audit';

interface BusinessReportingPageProps {
  onClose: () => void;
  /** Customer-facing share link — Esselunga Executive only, no admin chrome */
  publicDashboard?: boolean;
}

export default function BusinessReportingPage({ onClose, publicDashboard = false }: BusinessReportingPageProps) {
  const { venue, venueList } = useVenue();
  const { isSuperadmin } = useAuth();
  const { openHeatmapForCategory, openHeatmapModal } = useHeatmap();
  const pinnedVenueId = publicDashboard ? getDemoVenueId() : null;
  const publicCustomLayout = useMemo<DashboardLayout | null>(
    () => (publicDashboard && getDemoLinkType() === 'custom-dashboard' ? getDemoPublishedLayout() : null),
    [publicDashboard],
  );
  const isPublicCustomBoard = publicDashboard && !!publicCustomLayout;
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(pinnedVenueId || venue?.id || null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(
    publicDashboard
      ? (getDemoLinkType() === 'custom-dashboard' ? CUSTOM_DASHBOARD_PERSONA : ESSELUNGA_PERSONA)
      : PERSONAS[0].id,
  );
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>(publicDashboard ? '7d' : '24h');
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
  const [esselungaVariant, setEsselungaVariant] = useState<ExecutiveVariant>('live');
  const [metricPreviewLoading, setMetricPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewSeqRef = useRef(0);
  const esselungaMetricsRef = useRef<MetricThresholdSettings | null>(null);

  useEffect(() => {
    if (!publicDashboard) return;
    const id = pinnedVenueId || venue?.id;
    if (id) setSelectedVenueId(id);
  }, [publicDashboard, pinnedVenueId, venue?.id]);

  const isCustomDashboard = selectedPersonaId === CUSTOM_DASHBOARD_PERSONA;

  const selectedPersona = useMemo(
    () => getPersonaById(isCustomDashboard ? 'executive' : selectedPersonaId) || PERSONAS[0],
    [selectedPersonaId, isCustomDashboard],
  );

  /** Custom boards mix Ops + Exec + Media tiles — merge defs so hero IDs resolve. */
  const kpiDefinitions = useMemo(() => {
    if (!isCustomDashboard) return enforceKpiCap(selectedPersona);
    const byId = new Map<string, (typeof selectedPersona.kpis)[number]>();
    for (const id of ['store-manager', 'executive', 'retail-media'] as const) {
      const p = getPersonaById(id);
      for (const k of p?.kpis || []) byId.set(k.id, k);
    }
    return Array.from(byId.values());
  }, [isCustomDashboard, selectedPersona]);

  const stripKpiDefinitions = useMemo(
    () => enforceKpiCap(getPersonaById('executive') || selectedPersona),
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

  const esselungaJourney = useMemo(
    () => supporting.esselungaJourney as EsselungaJourneyPayload | undefined,
    [supporting.esselungaJourney],
  );

  const showEsselungaExecutive = selectedPersonaId === ESSELUNGA_PERSONA && !!selectedVenueId;
  const showCustomDashboard = isCustomDashboard && !!selectedVenueId;

  // Gated in three places on purpose: the rail hides it, this refuses to render
  // it, and the API routes reject the request. A hidden button is not access
  // control, and the effect below covers a persona left selected in state when
  // a different account signs in.
  const showMeasurementAudit = selectedPersonaId === AUDIT_PERSONA && !!selectedVenueId && isSuperadmin;

  useEffect(() => {
    if (!isSuperadmin && selectedPersonaId === AUDIT_PERSONA) {
      setSelectedPersonaId(PERSONAS[0].id);
    }
  }, [isSuperadmin, selectedPersonaId]);

  // The audit reads raw sample counts rather than rollups, so it is capped at a
  // week; longer selections fall back to the last 24 hours instead of erroring.
  const auditRange = useMemo(() => {
    const option = TIME_RANGES.find((t) => t.id === selectedTimeRange) || TIME_RANGES[1];
    const range = option.getRange();
    return range.endTs - range.startTs > 7 * DAY_MS ? TIME_RANGES[1].getRange() : range;
  }, [selectedTimeRange]);

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

  const fetchData = async (
    metricOpts?: MetricThresholdSettings,
    opts?: { silent?: boolean },
  ) => {
    if (!selectedVenueId) return;

    // The audit tab is not a KPI persona — it reads the raw-feed forensics and
    // per-zone endpoints itself, and the summary route rejects an id it has no
    // KPI set for.
    if (selectedPersonaId === AUDIT_PERSONA) {
      setLoading(false);
      setError(null);
      return;
    }

    const isPreview = !!(opts?.silent && metricOpts);
    let previewSeq = 0;

    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    } else if (metricOpts) {
      previewAbortRef.current?.abort();
      previewAbortRef.current = new AbortController();
      previewSeq = ++previewSeqRef.current;
      setMetricPreviewLoading(true);
    }

    try {
      const timeRangeOption = TIME_RANGES.find(t => t.id === selectedTimeRange);
      const { startTs, endTs } = timeRangeOption?.getRange() || TIME_RANGES[1].getRange();

      const fetchPersona = async (personaId: string, extra?: Record<string, string>) => {
        const params = new URLSearchParams({
          personaId,
          venueId: selectedVenueId,
          startTs: String(startTs),
          endTs: String(endTs),
          ...extra,
        });
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(`${API_BASE}/api/reporting/summary?${params}`, {
            signal: controller.signal,
          });
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error('Business Reporting feature is not enabled. Set FEATURE_BUSINESS_REPORTING=true.');
            }
            let detail = response.statusText || `HTTP ${response.status}`;
            try {
              const errBody = await response.json();
              if (errBody?.message) detail = errBody.message;
              else if (errBody?.error) detail = errBody.error;
            } catch { /* ignore */ }
            throw new Error(detail);
          }
          return response.json();
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      // Custom board pulls Ops + Executive + Esselunga so mixed tiles have data.
      if (selectedPersonaId === CUSTOM_DASHBOARD_PERSONA && !isPreview) {
        const [exec, ops, ess] = await Promise.all([
          fetchPersona('executive'),
          fetchPersona('store-manager', { grain: opsGrain }),
          fetchPersona(ESSELUNGA_PERSONA, { variant: esselungaVariant }),
        ]);
        setKpiValues({ ...(ops.kpis || {}), ...(exec.kpis || {}) });
        const journey = ess.supporting?.esselungaJourney as EsselungaJourneyPayload | undefined;
        setSupporting({
          ...(exec.supporting || {}),
          operationsConsole: ops.supporting?.operationsConsole,
          esselungaJourney: journey,
          periodDeltas: {
            ...((ops.supporting?.periodDeltas as object) || {}),
            ...((exec.supporting?.periodDeltas as object) || {}),
          },
          topCategories:
            exec.supporting?.topCategories
            ?? ops.supporting?.topCategories
            ?? journey?.heatmapCategories,
          topCampaigns: exec.supporting?.topCampaigns ?? ops.supporting?.topCampaigns,
          underperformingCampaigns:
            exec.supporting?.underperformingCampaigns ?? ops.supporting?.underperformingCampaigns,
          campaignRanking: exec.supporting?.campaignRanking,
          doohScreens: exec.supporting?.doohScreens ?? ops.supporting?.doohScreens,
        });
        setLastUpdated(new Date());
        return;
      }

      const paramsExtra: Record<string, string> = {};
      if (selectedPersonaId === 'merchandising' && selectedCategoryId !== 'all') {
        paramsExtra.categoryId = selectedCategoryId;
      }
      if (selectedPersonaId === 'store-manager') {
        paramsExtra.grain = opsGrain;
      }
      if (selectedPersonaId === ESSELUNGA_PERSONA) {
        paramsExtra.variant = esselungaVariant;
        const th = metricOpts ?? esselungaMetricsRef.current;
        if (th) {
          paramsExtra.dwellThresholdSec = String(th.dwellSec);
          paramsExtra.engagementThresholdSec = String(th.engagementSec);
          paramsExtra.engagementRankSec = String(th.engagementRankSec);
          paramsExtra.queueFloorSec = String(th.queueFloorSec);
        }
        if (isPreview) paramsExtra.metricPreview = 'true';
      }

      if (isPreview) {
        const params = new URLSearchParams({
          personaId: selectedPersonaId,
          venueId: selectedVenueId,
          startTs: String(startTs),
          endTs: String(endTs),
          ...paramsExtra,
        });
        const controller = previewAbortRef.current!;
        const response = await fetch(`${API_BASE}/api/reporting/summary?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.statusText || `HTTP ${response.status}`);
        const data = await response.json();
        if (previewSeq !== previewSeqRef.current) return;
        const next = data.supporting?.esselungaJourney as EsselungaJourneyPayload | undefined;
        if (!next) return;
        setSupporting((prev) => {
          const prevJ = prev.esselungaJourney as EsselungaJourneyPayload | undefined;
          if (!prevJ) return data.supporting || {};
          return {
            ...prev,
            esselungaJourney: {
              ...prevJ,
              aisles: next.aisles,
              fresco: next.fresco,
              journeySignals: next.journeySignals,
              heatmapCategories: next.heatmapCategories,
              activityTimeline: next.activityTimeline,
              activityTimelines: next.activityTimelines,
              metricThresholds: next.metricThresholds,
              generatedAt: next.generatedAt,
            },
          };
        });
        setKpiValues((prev) => ({
          ...prev,
          stoppingPowerPct: data.kpis?.stoppingPowerPct ?? prev.stoppingPowerPct,
          aislePenetrationPct: data.kpis?.aislePenetrationPct ?? prev.aislePenetrationPct,
        }));
        setLastUpdated(new Date());
        return;
      }

      const data = await fetchPersona(selectedPersonaId, paramsExtra);
      setKpiValues(data.kpis || {});
      setSupporting(data.supporting || {});
      setLastUpdated(new Date());
    } catch (err) {
      if (isPreview) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('Metric threshold preview failed:', err);
        return;
      }
      console.error('Failed to fetch reporting data:', err);
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError(
          `Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. `
          + 'The server may be busy ingesting — retry, or narrow the range.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    } finally {
      if (!opts?.silent) setLoading(false);
      if (isPreview && previewSeq === previewSeqRef.current) {
        setMetricPreviewLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedVenueId, selectedPersonaId, selectedTimeRange, selectedCategoryId, opsGrain, esselungaVariant]);

  const handleTimeRangeChange = (rangeId: TimeRange) => {
    setSelectedTimeRange(rangeId);
    if (selectedPersonaId === 'store-manager') {
      setOpsGrain(DAY_GRAIN_RANGES.has(rangeId) ? 'day' : 'hour');
    }
  };

  useEffect(() => {
    if (
      selectedPersonaId === ESSELUNGA_PERSONA
      && esselungaVariant === 'hq'
      && !DAY_GRAIN_RANGES.has(selectedTimeRange)
    ) {
      setSelectedTimeRange('7d');
    }
  }, [selectedPersonaId, esselungaVariant]);

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

  const heatmapTimeframe = DAY_GRAIN_RANGES.has(selectedTimeRange) ? 'week' as const : 'day' as const;

  const handleCategoryHeatmap = useCallback((row: CategoryRankingRow) => {
    if (!row.roiIds?.length || !selectedVenueId) return;
    openHeatmapForCategory(row.roiIds, row.category, heatmapTimeframe, selectedVenueId);
  }, [openHeatmapForCategory, selectedVenueId, heatmapTimeframe]);

  const selectedVenueName = useMemo(
    () => (venueList || []).find(v => v.id === selectedVenueId)?.name || 'Store',
    [venueList, selectedVenueId],
  );

  const showCategoryVisits = Array.isArray(topCategories) && topCategories.length > 0
    && selectedPersonaId === 'merchandising';

  const customDashboardData: DashboardDataContext | null = useMemo(() => {
    if (!showCustomDashboard || !selectedVenueId) return null;
    const categoriesForBoard = (topCategories?.length
      ? topCategories
      : esselungaJourney?.heatmapCategories) as CategoryRankingRow[] | undefined;
    return {
      venueId: selectedVenueId,
      venueName: selectedVenueName,
      kpiDefinitions,
      stripKpiDefinitions,
      kpiValues,
      periodDeltas,
      topCategories: categoriesForBoard,
      deadZones,
      topZones,
      zoneUtilThresholdPct,
      topCampaigns,
      underperformingCampaigns,
      campaignRanking,
      doohScreens,
      dataWindowStartTs: supporting.dataWindowStartTs as number | undefined,
      dataWindowEndTs: supporting.dataWindowEndTs as number | undefined,
      executivePillars,
      executiveHighlights,
      operationsConsole,
      journey: esselungaJourney,
      heatmapTimeframe,
      onOpenCategoryHeatmap: handleCategoryHeatmap,
      onExpandHeatmap: () => {
        const first = esselungaJourney?.heatmapCategories?.[0];
        if (first?.roiIds?.length) {
          openHeatmapForCategory(first.roiIds, first.category, heatmapTimeframe, selectedVenueId);
        } else {
          openHeatmapModal({ zoneIds: [], venueId: selectedVenueId });
        }
      },
    };
  }, [
    showCustomDashboard, selectedVenueId, selectedVenueName, kpiDefinitions, stripKpiDefinitions,
    kpiValues, periodDeltas, topCategories, deadZones, topZones, zoneUtilThresholdPct, topCampaigns,
    underperformingCampaigns, campaignRanking, doohScreens, supporting.dataWindowStartTs,
    supporting.dataWindowEndTs, executivePillars, executiveHighlights, operationsConsole,
    esselungaJourney, heatmapTimeframe, handleCategoryHeatmap, openHeatmapForCategory, openHeatmapModal,
  ]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden">
      {/* Command strip header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-3 bg-gray-800 flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {!publicDashboard && (
            <>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5 flex-shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-xs hidden sm:inline">Back</span>
              </button>
              <div className="h-5 w-px bg-gray-700 flex-shrink-0" />
            </>
          )}
          <h1 className="text-white text-sm font-semibold truncate">
            {isPublicCustomBoard
              ? `${publicCustomLayout?.name || 'Shared dashboard'} · ${selectedVenueName}`
              : publicDashboard
                ? `Executive Dashboard · ${selectedVenueName}`
                : 'Business Reporting'}
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!publicDashboard && (
            <>
              <Building2 className="w-3.5 h-3.5 text-gray-400 hidden sm:block" />
              <select
                value={selectedVenueId || ''}
                onChange={(e) => setSelectedVenueId(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-xs text-white max-w-[140px] sm:max-w-none"
              >
                {(venueList || []).map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </>
          )}

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
            onClick={() => fetchData()}
            disabled={loading}
            className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-gray-300 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {lastUpdated && (
            <span className="text-xs text-gray-400 hidden lg:inline">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-3 py-3 space-y-3">
          {!publicDashboard && (
            <PersonaIconRail
              selectedPersonaId={selectedPersonaId}
              onSelect={setSelectedPersonaId}
            />
          )}

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
              {showCustomDashboard && customDashboardData ? (
                <DashboardBuilderViewport
                  data={customDashboardData}
                  readOnly={isPublicCustomBoard}
                  fixedLayout={publicCustomLayout}
                />
              ) : showMeasurementAudit ? (
                <ZoneAuditViewport
                  venueId={selectedVenueId!}
                  startTs={auditRange.startTs}
                  endTs={auditRange.endTs}
                />
              ) : showEsselungaExecutive ? (
                esselungaJourney ? (
                <EsselungaExecutiveViewport
                  journey={esselungaJourney}
                  venueId={selectedVenueId!}
                  venueName={selectedVenueName}
                  variant={esselungaVariant}
                  onVariantChange={setEsselungaVariant}
                  onRefresh={() => fetchData()}
                  onMetricThresholdPreview={(settings) => {
                    esselungaMetricsRef.current = settings;
                    void fetchData(settings, { silent: true });
                  }}
                  onMetricThresholdsChange={(settings) => {
                    esselungaMetricsRef.current = settings;
                  }}
                  metricPreviewLoading={metricPreviewLoading}
                  publicShare={publicDashboard}
                />
                ) : (
                  <div className="text-center py-8 text-gray-400 text-xs">No journey data for this period.</div>
                )
              ) : (
                <>
              {showOperationsConsole && operationsConsole ? (
                <OperationsPulseConsole
                  consoleData={operationsConsole}
                  kpiValues={kpiValues}
                  periodDeltas={periodDeltas as unknown as OpsPeriodDeltas}
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

              {showCategoryVisits && (
                <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-700/60">
                    <span className="text-xs font-medium text-white">Category Traffic</span>
                    <span className="text-xs text-gray-400 ml-2">Latticini · Frutta · Surgelati · …</span>
                  </div>
                  <div className="p-3">
                    <CategoryVisitsPanel
                      categories={topCategories!}
                      onOpenHeatmap={handleCategoryHeatmap}
                      compact={false}
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
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                      <MonitorPlay className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-medium text-white">Campaign Performance Ranking</span>
                      <span className="text-xs text-gray-400">({campaignRanking.length})</span>
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
                        ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                      <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium text-white">Category Performance Ranking</span>
                      <span className="text-xs text-gray-400">({topCategories.length})</span>
                    </div>
                    {selectedPersonaId === 'merchandising' && selectedCategoryId !== 'all' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCategoryId('all');
                        }}
                        className="text-xs text-amber-400 hover:text-amber-300"
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
