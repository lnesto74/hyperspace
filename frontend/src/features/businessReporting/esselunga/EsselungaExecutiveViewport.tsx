import { useMemo, useState, useEffect, useRef } from 'react';
import { API_BASE } from '../../../config/api';
import {
  Euro,
  Lightbulb,
  Download,
  Radio,
  FileText,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  EsselungaJourneyPayload,
  ExecutiveVariant,
  ActivityTimeline,
  ActivityTimelineSet,
  HeadlineKpi,
} from './types';
import ErpCsvUploadPanel from './ErpCsvUploadPanel';
import {
  RingGauge,
  HorizontalBarChart,
  FrescoDepartmentCard,
  JourneySignalsPanel,
  CheckoutLaneCards,
  SectionCard,
  formatDwellDuration,
} from './EsselungaCharts';
import { VerdictBanner, HeadlineKpiGrid } from './ExecutiveHeadline';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';
import { ExecutivePulseBand } from './ExecutiveVisuals';
import { useHeatmap } from '../../../context/HeatmapContext';

interface EsselungaExecutiveViewportProps {
  journey: EsselungaJourneyPayload;
  venueId: string;
  venueName: string;
  variant: ExecutiveVariant;
  onVariantChange: (v: ExecutiveVariant) => void;
  onRefresh: () => void;
  /** Debounced preview — recomputes stopping % from visit durations at new thresholds */
  onMetricThresholdPreview?: (dwellSec: number, engagementSec: number) => void;
  onMetricThresholdsChange?: (dwellSec: number, engagementSec: number) => void;
  metricPreviewLoading?: boolean;
  /** Hide admin-only controls (ERP upload, threshold calibration) on customer share links */
  publicShare?: boolean;
}

const CHANNEL_COLORS: Record<string, string> = {
  traditional: '#38bdf8',
  selfCheckout: '#8b5cf6',
  selfScan: '#06b6d4',
};

const INSIGHT_COLOR = {
  good: 'border-green-500/40 bg-green-500/10',
  warn: 'border-amber-500/40 bg-amber-500/10',
  bad: 'border-red-500/40 bg-red-500/10',
  info: 'border-blue-500/40 bg-blue-500/10',
};

const LIVE_OCCUPANCY_POLL_MS = 10_000;

/** Esselunga's KPI specification fixes Stopping Power at a pause over 5 seconds. */
const DEFAULT_DWELL_SEC = 5;
const DEFAULT_ENGAGE_SEC = 60;

function clampThreshold(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * ROI names are drawn for the person who mapped the store: "Shelf 15 -
 * Engagement (Right)" says which polygon and which side of the aisle. A store
 * director reading a report wants the shelf and the side, without the word
 * "Engagement", which is our vocabulary rather than theirs.
 */
function zoneDisplayName(name: string) {
  return name
    .replace(/\s*-\s*Engagement\b/i, '')
    .replace(/\s*\(([^)]+)\)\s*$/, ' · $1')
    .trim() || name;
}

/** A headline number with the sentence that explains it, rather than a dial. */
function AisleStat({
  value,
  label,
  caption,
  color,
}: {
  value: string;
  label: string;
  caption: string;
  color: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-3xl font-semibold tabular-nums leading-none shrink-0" style={{ color }}>
        {value}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-100">{label}</span>
        <span className="block text-[13px] text-gray-400 leading-snug">{caption}</span>
      </span>
    </div>
  );
}

function CategoryChip({ label }: { label: string }) {
  const v = getCategoryVisual(label);
  const Icon = v.Icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium"
      style={{ backgroundColor: v.bg, color: v.color }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export default function EsselungaExecutiveViewport({
  journey,
  venueId,
  venueName,
  variant,
  onVariantChange,
  onRefresh,
  onMetricThresholdPreview,
  onMetricThresholdsChange,
  metricPreviewLoading = false,
  publicShare = false,
}: EsselungaExecutiveViewportProps) {
  const [erpOpen, setErpOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const { overview, fresco, aisles, checkout, media, erp, insights, taxonomy, journeySignals, metricThresholds,
    activityTimeline, activityTimelines, heatmapCategories, storeHours, range: journeyRange } = journey;
  const { openHeatmapModal, openHeatmapForCategory } = useHeatmap();

  const [dwellSec, setDwellSec] = useState(
    clampThreshold(metricThresholds?.dwellSec ?? DEFAULT_DWELL_SEC, DEFAULT_DWELL_SEC),
  );
  const [engagementSec, setEngagementSec] = useState(
    clampThreshold(metricThresholds?.engagementSec ?? DEFAULT_ENGAGE_SEC, DEFAULT_ENGAGE_SEC),
  );
  const previewTimerRef = useRef<number>();
  const sliderTouchedRef = useRef(false);

  useEffect(() => {
    if (sliderTouchedRef.current) return;
    if (Number.isFinite(metricThresholds?.dwellSec)) {
      setDwellSec(clampThreshold(metricThresholds!.dwellSec, DEFAULT_DWELL_SEC));
    }
    if (Number.isFinite(metricThresholds?.engagementSec)) {
      setEngagementSec(clampThreshold(metricThresholds!.engagementSec, DEFAULT_ENGAGE_SEC));
    }
  }, [metricThresholds?.dwellSec, metricThresholds?.engagementSec, journey.generatedAt]);

  const queueMetricPreview = (dwell: number, engage: number) => {
    if (!onMetricThresholdPreview) return;
    window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      onMetricThresholdPreview(
        clampThreshold(dwell, DEFAULT_DWELL_SEC),
        clampThreshold(engage, DEFAULT_ENGAGE_SEC),
      );
    }, 450);
  };

  const handleDwellChange = (value: number) => {
    sliderTouchedRef.current = true;
    const v = clampThreshold(value, DEFAULT_DWELL_SEC);
    setDwellSec(v);
    queueMetricPreview(v, engagementSec);
  };

  const handleEngagementChange = (value: number) => {
    sliderTouchedRef.current = true;
    const v = clampThreshold(value, DEFAULT_ENGAGE_SEC);
    setEngagementSec(v);
    queueMetricPreview(dwellSec, v);
  };

  useEffect(() => () => window.clearTimeout(previewTimerRef.current), []);

  useEffect(() => {
    onMetricThresholdsChange?.(dwellSec, engagementSec);
  }, [dwellSec, engagementSec, onMetricThresholdsChange]);

  const [livePerimeter, setLivePerimeter] = useState({
    count: overview.perimeterEntrants ?? 0,
    uniqueTracks: overview.perimeterUniqueTracks ?? 0,
  });

  useEffect(() => {
    setLivePerimeter({
      count: overview.perimeterEntrants ?? 0,
      uniqueTracks: overview.perimeterUniqueTracks ?? 0,
    });
  }, [overview.perimeterEntrants, overview.perimeterUniqueTracks]);

  useEffect(() => {
    if (!venueId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const startTs = journeyRange?.startTs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
        const res = await fetch(
          `${API_BASE}/api/reporting/live-perimeter-entrants?venueId=${encodeURIComponent(venueId)}&startTs=${startTs}&endTs=${Date.now()}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setLivePerimeter({
          count: data.count ?? 0,
          uniqueTracks: data.uniqueTracks ?? 0,
        });
      } catch {
        // keep last value
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), LIVE_OCCUPANCY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [venueId, journeyRange?.startTs, journey.generatedAt]);

  const [liveOccupancy, setLiveOccupancy] = useState({
    count: overview.currentOccupancy,
    source: overview.currentOccupancySource ?? 'live_frame',
  });

  useEffect(() => {
    setLiveOccupancy({
      count: overview.currentOccupancy,
      source: overview.currentOccupancySource ?? 'live_frame',
    });
  }, [overview.currentOccupancy, overview.currentOccupancySource]);

  useEffect(() => {
    if (variant !== 'live' || !venueId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/reporting/live-occupancy?venueId=${encodeURIComponent(venueId)}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setLiveOccupancy({
          count: data.count ?? 0,
          source: data.source ?? 'live_frame',
        });
      } catch {
        // keep last value on transient errors
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), LIVE_OCCUPANCY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [variant, venueId]);

  const dwellReliable = overview.avgStoreDwellReliable !== false
    && (overview.medianStoreDwellMin ?? overview.avgStoreDwellMin) > 0;

  /**
   * The server resolves the headline numbers and their week-on-week deltas, so
   * this tab and the exported PDF cannot quietly disagree. The only value
   * overridden here is the live entrant count, which keeps ticking between
   * refreshes.
   */
  const headlineKpis = useMemo<HeadlineKpi[]>(() => {
    const base = journey.headlineKpis ?? [];
    if (variant !== 'live') return base;
    return base.map((kpi) => {
      if (kpi.id !== 'entrants' || livePerimeter.count === kpi.value) return kpi;
      const deltaPct = kpi.previous != null && kpi.previous > 0
        ? Math.round(((livePerimeter.count - kpi.previous) / kpi.previous) * 1000) / 10
        : null;
      return {
        ...kpi,
        value: livePerimeter.count,
        display: livePerimeter.count.toLocaleString(),
        deltaPct,
        direction: deltaPct == null || deltaPct === 0 ? 'flat' : deltaPct > 0 ? 'up' : 'down',
        good: deltaPct == null || deltaPct === 0 ? null : (deltaPct > 0) === kpi.higherIsBetter,
      };
    });
  }, [journey.headlineKpis, variant, livePerimeter.count]);

  const rangeLabel = useMemo(() => {
    const start = new Date(journeyRange.startTs);
    const end = new Date(journeyRange.endTs);
    const hm: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    if (start.toDateString() === end.toDateString()) {
      return `${start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`
        + ` · ${start.toLocaleTimeString(undefined, hm)}–${end.toLocaleTimeString(undefined, hm)}`;
    }
    const dm: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    return `${start.toLocaleDateString(undefined, dm)} – ${end.toLocaleDateString(undefined, dm)}`;
  }, [journeyRange.startTs, journeyRange.endTs]);

  const generatedAtLabel = useMemo(
    () => new Date(journey.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    [journey.generatedAt],
  );

  const aisleCategoryBars = useMemo(
    () => (aisles.categoryGroups || []).map(g => ({
      label: g.category,
      value: g.visits,
      sub: `${g.stoppingPowerPct}% stop · ${formatDwellDuration(g.avgDwellSec, g.avgDwellMin)}`,
    })),
    [aisles.categoryGroups],
  );

  const checkoutChannels = useMemo(
    () => checkout.channels.map(ch => ({
      ...ch,
      color: CHANNEL_COLORS[ch.id] || '#64748b',
    })),
    [checkout.channels],
  );

  const checkoutCount = checkout.completed ?? checkoutChannels.reduce((s, c) => s + (c.completed ?? c.sessions), 0);

  const signals = useMemo(() => {
    const base = journeySignals;
    return {
      reconciliationRequired: base?.reconciliationRequired ?? true,
      ingress: {
        visitors: overview.perimeterEntrants ?? overview.totalVisitors ?? base?.ingress?.visitors ?? 0,
        gateEstimated: overview.ingressDirectEstimated ?? base?.ingress?.gateEstimated,
        recovered: overview.ingressRecovered ?? base?.ingress?.recovered ?? 0,
      },
      shopping: {
        aisleZoneVisits: aisles.totalAisleVisits,
        dwellVisits: aisles.dwellVisits ?? 0,
        stoppingPct: aisles.stoppingPowerPct ?? 0,
        passThroughPct: aisles.passThroughPct,
        bypassPct: aisles.bypassPct ?? null,
      },
      checkout: {
        sessionsCompleted: checkoutCount,
        totalSessions: checkoutChannels.reduce((s, c) => s + c.sessions, 0),
        avgWaitMin: checkout.avgWaitMin,
        abandonPct: checkoutChannels.length
          ? Math.round(checkoutChannels.reduce((s, c) => s + c.abandonPct, 0) / checkoutChannels.length * 10) / 10
          : 0,
        laneCount: checkoutChannels.length,
      },
    };
  }, [journeySignals, overview, aisles, checkout, checkoutCount, checkoutChannels]);

  const heatmapTimeframe = variant === 'hq' ? 'week' as const : 'week' as const;

  const rhythmTimelines = useMemo((): ActivityTimelineSet | null => {
    if (activityTimelines) return activityTimelines;
    if (!activityTimeline) return null;
    const emptyHourly = (): ActivityTimeline => ({
      grain: 'hour',
      visitors: Array.from({ length: 24 }, (_, i) => ({
        label: `${String(i).padStart(2, '0')}:00`,
        value: 0,
      })),
      dwells: Array.from({ length: 24 }, (_, i) => ({
        label: `${String(i).padStart(2, '0')}:00`,
        value: 0,
      })),
    });
    if (activityTimeline.grain === 'hour') {
      return { hourly: activityTimeline, daily: { grain: 'day', visitors: [], dwells: [] } };
    }
    return { hourly: emptyHourly(), daily: activityTimeline };
  }, [activityTimelines, activityTimeline]);

  const handleExpandHeatmap = () => {
    const first = heatmapCategories?.[0];
    if (first?.roiIds?.length) {
      openHeatmapModal({
        zoneIds: first.roiIds,
        categoryLabel: first.category,
        timeframe: heatmapTimeframe,
        venueId,
      });
    } else {
      openHeatmapModal({ zoneIds: [], venueId });
    }
  };

  const handleFocusCategory = (row: { category: string; roiIds?: string[] }) => {
    if (row.roiIds?.length) {
      openHeatmapForCategory(row.roiIds, row.category, heatmapTimeframe, venueId);
    }
  };

  /**
   * Rendered by the same code that produces the scheduled daily email, so what
   * downloads here is byte-for-byte the document management receives.
   */
  const handleDownloadPdf = () => {
    const params = new URLSearchParams({
      venueId,
      startTs: String(journeyRange.startTs),
      endTs: String(journeyRange.endTs),
      variant,
      dwellThresholdSec: String(dwellSec),
      engagementThresholdSec: String(engagementSec),
    });
    window.open(`${API_BASE}/api/reporting/esselunga-executive/pdf?${params}`, '_blank', 'noopener');
  };

  const passThroughPct = aisles.passThroughPct
    ?? Math.max(0, Math.round((100 - (aisles.stoppingPowerPct ?? 0)) * 10) / 10);

  return (
    <div className="space-y-4 max-h-[calc(100vh-12rem)] overflow-y-auto pr-1">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 justify-between sticky top-0 z-10 bg-gray-900/95 backdrop-blur py-1 -mx-1 px-1">
        <div className="flex bg-gray-800/80 rounded-lg p-0.5 border border-gray-700/50">
          <button
            type="button"
            onClick={() => onVariantChange('live')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              variant === 'live' ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Radio className="w-3 h-3" /> Store Director
          </button>
          <button
            type="button"
            onClick={() => onVariantChange('hq')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              variant === 'hq' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30' : 'text-gray-400 hover:text-white'
            }`}
          >
            <FileText className="w-3 h-3" /> HQ Weekly
          </button>
        </div>
        <button
          type="button"
          onClick={handleDownloadPdf}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-white"
        >
          <Download className="w-3 h-3" /> Download report
        </button>
        <div className="flex gap-2 text-xs text-gray-400 ml-auto">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{taxonomy.fresco} fresco</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{taxonomy.aisles} aisles</span>
          <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">{taxonomy.checkout} checkout</span>
        </div>
      </div>

      <VerdictBanner
        headline={journey.headline}
        venueName={venueName}
        rangeLabel={rangeLabel}
        generatedAtLabel={generatedAtLabel}
      />

      <HeadlineKpiGrid items={headlineKpis} />

      {/* What to act on */}
      {insights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {insights.slice(0, 3).map(ins => (
            <div key={ins.id} className={`rounded-lg border p-3 ${INSIGHT_COLOR[ins.severity]}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-xs font-medium text-white">{ins.title}</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{ins.message}</p>
              {ins.action && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-start gap-1">
                  <ArrowRight className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                  {ins.action}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Rhythm of the day + floor heatmap */}
      {rhythmTimelines && (
        <ExecutivePulseBand
          venueId={venueId}
          venueName={venueName}
          timelines={rhythmTimelines}
          storeHoursLabel={storeHours?.hoursLabel}
          heatmapCategories={heatmapCategories ?? []}
          liveOccupancy={variant === 'live' ? liveOccupancy.count : overview.currentOccupancy}
          onExpandHeatmap={handleExpandHeatmap}
          onFocusCategory={handleFocusCategory}
          heatmapTimeframe={heatmapTimeframe}
        />
      )}

      {/* --- The journey, in the order the shopper walks it --- */}

      <SectionCard
        id="entrance"
        title="1 · Entrance"
        subtitle="Who came in, counted where trajectories cross the entrance line. These three signals are measured independently, so they do not divide into one another."
      >
        <JourneySignalsPanel signals={signals} />
      </SectionCard>

      <SectionCard
        id="fresco"
        title="2 · Piazza del Fresco"
        subtitle="The service counters, where a crossing that turns into a pause is the signal worth watching. Stopping is the share of crossings that paused; dwell is how long those pauses lasted."
      >
        {fresco.departments.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">
            No service counters detected. Tag banco fixtures with Pesce, Pane, Salumi, etc.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {fresco.departments.map(dept => {
              const visual = getCategoryVisual(dept.label);
              return (
                <FrescoDepartmentCard
                  key={dept.id}
                  label={dept.label}
                  visits={dept.visits}
                  dwellVisits={dept.dwellVisits}
                  avgDwellSec={dept.avgDwellSec}
                  stoppingPct={dept.stoppingPct ?? dept.browsingPct}
                  passThroughPct={dept.passThroughPct ?? Math.round((100 - dept.browsingPct) * 10) / 10}
                  hasQueueZones={dept.hasQueueZones}
                  waitingPct={dept.waitingPct}
                  abandonPct={dept.abandonPct}
                  color={visual.color}
                  bg={visual.bg}
                  Icon={visual.Icon}
                />
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        id="aisles"
        title="3 · Aisles & categories"
        subtitle={`Shelf zones grouped by the category they carry. A stop is a pause of ${metricThresholds?.dwellSec ?? dwellSec} seconds or more, which is Esselunga's own definition of stopping power.`}
      >
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-4 space-y-4">
            <div className="space-y-4">
              <AisleStat
                value={`${aisles.stoppingPowerPct}%`}
                label="Stopping power"
                caption="of aisle crossings became a stop at the shelf"
                color="#60a5fa"
              />
              <AisleStat
                value={`${passThroughPct}%`}
                label="Pass-through"
                caption="crossed the zone without stopping"
                color="#94a3b8"
              />
              {aisles.bypassPct != null && (
                <AisleStat
                  value={`${aisles.bypassPct}%`}
                  label="Bypass"
                  caption="of store visitors never entered the category"
                  color="#fb923c"
                />
              )}
            </div>
            <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 px-4 py-3.5 text-[13px] text-gray-400 leading-relaxed space-y-2">
              <p>
                <span className="text-gray-300 font-medium">{(aisles.dwellVisits ?? 0).toLocaleString()}</span>
                {' '}stops of{' '}
                <span className="text-gray-300 font-medium">{aisles.totalAisleVisits.toLocaleString()}</span>
                {' '}aisle crossings in this period.
              </p>
              <p>
                <span className="text-gray-400">Pass-through</span> and <span className="text-gray-400">bypass</span> answer
                different questions. Pass-through is the share of crossings that did not stop; bypass is the share of store
                visitors who never entered the category at all.
              </p>
            </div>
          </div>
          <div className="xl:col-span-8 space-y-4">
            {aisleCategoryBars.length > 0 && (
              <div className="space-y-2">
                <p className="text-[13px] text-gray-400 leading-relaxed">
                  Categories are counted in shoppers, not crossings, so these totals are smaller than
                  the per-zone visits below — one shopper passing a shelf four times is one shopper here
                  and four visits there. Only zones tagged with a category can appear.
                </p>
                <HorizontalBarChart
                  rows={aisleCategoryBars.slice(0, 10)}
                  maxBars={10}
                  valueLabel="shoppers"
                />
              </div>
            )}
            {aisles.topAisles.length > 0 && (
              <div className="rounded-lg border border-gray-700/50 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-gray-400 border-b border-gray-700/40">
                        <th className="text-left px-4 py-3 font-medium">Category</th>
                        <th className="text-left px-4 py-3 font-medium">Zone</th>
                        <th className="text-right px-4 py-3 font-medium">Visits</th>
                        <th className="text-right px-4 py-3 font-medium">Stop</th>
                        <th className="text-right px-4 py-3 font-medium">Dwell</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aisles.topAisles.map(row => (
                        <tr key={row.id} className="border-b border-gray-800/50 last:border-0 hover:bg-white/[0.02]">
                          <td className="px-4 py-3.5"><CategoryChip label={row.category} /></td>
                          <td className="px-4 py-3.5 text-gray-300">{zoneDisplayName(row.name)}</td>
                          <td className="px-4 py-3.5 text-right text-white tabular-nums font-medium">{row.visits.toLocaleString()}</td>
                          <td className="px-4 py-3.5 text-right text-gray-200 tabular-nums">{row.stoppingPowerPct}%</td>
                          <td className="px-4 py-3.5 text-right text-gray-200 tabular-nums">{formatDwellDuration(row.avgDwellSec, row.avgDwellMin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(aisles.untaggedZones ?? 0) > 0 && (
              <p className="text-[13px] text-gray-400 leading-relaxed">
                {aisles.untaggedZones} of {(aisles.untaggedZones ?? 0) + (aisles.taggedZones ?? 0)} shelf
                zones have no category assigned in the shelf mapper, so they group as Uncategorized here.
                Their visits and dwell are still counted — only the category split is affected.
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        id="checkout"
        title="4 · Checkout"
        subtitle="Queue sessions by channel. A session starts when a shopper joins the queue zone and ends when they leave it, so the wait is time queuing rather than time at the till."
      >
        <CheckoutLaneCards channels={checkoutChannels} />
        {dwellReliable && checkout.frictionScore != null && checkout.avgWaitMin > 0 && (
          <div className="mt-3 rounded-lg border border-gray-700/50 bg-gray-800/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-gray-400">Checkout friction</span>
            <span className="text-white font-medium">{checkout.frictionScore}</span>
            <span className="text-gray-400">
              wait ÷ shopping dwell ({formatDwellDuration(undefined, checkout.avgWaitMin)} avg wait)
            </span>
          </div>
        )}
      </SectionCard>

      {/*
        With no screens reporting, both gauges read zero, and a zero an
        executive cannot act on is worse than an absent section.
      */}
      {(media.ces > 0 || media.eal > 0) && (
      <SectionCard
        id="media"
        title="5 · Retail media"
        subtitle="How in-store screens performed, measured as exposure to the screen followed by a visit to the promoted category."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <div className="flex items-center gap-4">
            <RingGauge value={media.ces} max={100} label="CES" color="#a78bfa" size={88} />
            <div>
              <h3 className="text-xs font-semibold text-white">Campaign effectiveness</h3>
              <p className="text-xs text-gray-400 mt-0.5">PEBLE composite across active screens</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <RingGauge value={media.eal} max={100} label="EAL" color="#38bdf8" size={88} />
            <div>
              <h3 className="text-xs font-semibold text-white">Exposure lift</h3>
              <p className="text-xs text-gray-400 mt-0.5">Incremental visits attributed to DOOH</p>
            </div>
          </div>
        </div>
      </SectionCard>
      )}

      {/*
        Calibration lives below the report, not above it. These are the knobs
        that decide what the numbers mean, and an executive reading the page
        should meet the answer before the instrument.
      */}
      <div className="rounded-xl border border-gray-700/60 bg-gray-800/30 overflow-hidden">
        <button
          type="button"
          onClick={() => setMetricsOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50"
        >
          <span className="text-[11px] text-gray-300 font-medium flex items-center gap-1.5">
            <SlidersHorizontal className="w-3 h-3 text-gray-400" />
            How these numbers are defined
            <span className="text-gray-400 font-normal ml-1">
              a stop is {metricThresholds?.dwellSec ?? dwellSec}s or longer
              {metricThresholds?.source === 'preview' && (
                <span className="text-cyan-400 ml-1">· preview</span>
              )}
              {metricPreviewLoading && (
                <span className="text-amber-400/90 ml-1">· recalculating…</span>
              )}
            </span>
          </span>
          {metricsOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </button>
        {metricsOpen && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-700/40 space-y-3">
            <dl className="text-xs text-gray-400 leading-relaxed space-y-1.5">
              <div>
                <dt className="inline text-gray-400 font-medium">Crossing · </dt>
                <dd className="inline">any entry into a zone lasting at least 300ms.</dd>
              </div>
              <div>
                <dt className="inline text-gray-400 font-medium">Stopping power · </dt>
                <dd className="inline">
                  share of crossings where the shopper paused for {metricThresholds?.dwellSec ?? dwellSec}s or more.
                  Esselunga's KPI specification fixes this at 5s.
                </dd>
              </div>
              <div>
                <dt className="inline text-gray-400 font-medium">Bypass · </dt>
                <dd className="inline">share of store visitors who never entered the category, i.e. 100 − penetration.</dd>
              </div>
              <div>
                <dt className="inline text-gray-400 font-medium">Shopping dwell · </dt>
                <dd className="inline">
                  median time a visit spends inside tracked zones. This is not entrance-to-exit time in the store.
                </dd>
              </div>
            </dl>
            {publicShare ? (
              <p className="text-xs text-gray-400">Thresholds shown are those configured for this store.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4 pt-1 border-t border-gray-700/30">
                <label className="block space-y-1.5">
                  <span className="text-xs uppercase tracking-wider text-amber-400/90">Stopping threshold</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={120}
                      step={1}
                      value={dwellSec}
                      onChange={(e) => handleDwellChange(parseInt(e.target.value, 10))}
                      className="flex-1 h-1.5 bg-gray-700 rounded-lg accent-amber-500"
                    />
                    <span className="text-xs text-white tabular-nums w-10 text-right">{dwellSec}s</span>
                  </div>
                  <span className="text-[11px] text-gray-400">Explore only — the report ships at 5s</span>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs uppercase tracking-wider text-emerald-400/90">Engaged threshold</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={15}
                      max={300}
                      step={5}
                      value={engagementSec}
                      onChange={(e) => handleEngagementChange(parseInt(e.target.value, 10))}
                      className="flex-1 h-1.5 bg-gray-700 rounded-lg accent-emerald-500"
                    />
                    <span className="text-xs text-white tabular-nums w-10 text-right">{engagementSec}s</span>
                  </div>
                  <span className="text-[11px] text-gray-400">Separates a long browse from a pause</span>
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ERP — admin only (hidden on customer public links) */}
      {!publicShare && (
      <div className="rounded-lg border border-gray-700/40 bg-gray-800/20 overflow-hidden">
        <button
          type="button"
          onClick={() => setErpOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/40"
        >
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
            <Euro className="w-3 h-3" />
            ERP / POS data
            {erp.hasData ? (
              <span className="text-emerald-500/80">· connected</span>
            ) : (
              <span>· optional — upload for basket value & space yield</span>
            )}
          </span>
          {erpOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </button>
        {erpOpen && (
          <div className="px-3 pb-3 border-t border-gray-700/30">
            <ErpCsvUploadPanel
              venueId={venueId}
              hasData={erp.hasData}
              lastUpload={erp.lastUpload}
              onUploaded={onRefresh}
              compact
            />
          </div>
        )}
      </div>
      )}

      {/* Quick nav anchors */}
      <div className="flex flex-wrap gap-2 pb-2 text-xs text-gray-400">
        {['entrance', 'fresco', 'aisles', 'checkout', 'media'].map(id => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md hover:bg-gray-800 hover:text-gray-400 capitalize"
          >
            {id} <ArrowRight className="w-2.5 h-2.5" />
          </a>
        ))}
      </div>
    </div>
  );
}
