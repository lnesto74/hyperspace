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
  MetricThresholdSettings,
} from './types';
import ErpCsvUploadPanel from './ErpCsvUploadPanel';
import {
  RingGauge,
  HorizontalBarChart,
  FrescoDepartmentCard,
  JourneySignalsPanel,
  CheckoutPanel,
  SectionCard,
  formatDwellDuration,
} from './EsselungaCharts';
import { ExecutiveHeader } from './ExecutiveHeadline';
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
  onMetricThresholdPreview?: (settings: MetricThresholdSettings) => void;
  onMetricThresholdsChange?: (settings: MetricThresholdSettings) => void;
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
/** See ExecutiveJourneyService for why the ranking bar sits at 15 and not higher. */
const DEFAULT_RANK_SEC = 15;
const DEFAULT_QUEUE_FLOOR_SEC = 10;
const DEFAULT_BAND_EDGES = [5, 10, 20, 60];

const BAND_TONES = [
  'bg-gray-600',
  'bg-sky-700/70',
  'bg-sky-500/70',
  'bg-emerald-500/70',
  'bg-emerald-400',
];

function bandLabels(edges: number[]): string[] {
  const [a, b, c, d] = edges;
  return [`under ${a}s`, `${a}–${b}s`, `${b}–${c}s`, `${c}–${d}s`, `over ${d}s`];
}

function clampThreshold(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const SLIDER_ACCENT: Record<string, string> = {
  amber: 'accent-amber-500 text-amber-400/90',
  emerald: 'accent-emerald-500 text-emerald-400/90',
  sky: 'accent-sky-500 text-sky-400/90',
  violet: 'accent-violet-500 text-violet-400/90',
};

function ThresholdSlider({
  label, accent, min, max, step, value, onChange, hint,
}: {
  label: string;
  accent: keyof typeof SLIDER_ACCENT;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  const [accentClass, labelClass] = SLIDER_ACCENT[accent].split(' ');
  return (
    <label className="block space-y-1.5">
      <span className={`text-xs uppercase tracking-wider ${labelClass}`}>{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className={`flex-1 h-1.5 bg-gray-700 rounded-lg ${accentClass}`}
        />
        <span className="text-xs text-white tabular-nums w-10 text-right">{value}s</span>
      </div>
      <span className="text-[11px] text-gray-400">{hint}</span>
    </label>
  );
}

/**
 * The distribution as a single bar. A mean says how long the average visit
 * lasted; this says whether the zone is losing people at the first second or
 * holding them and then losing them, which is a different fix.
 */
function BandBar({ bands, edges, className = '' }: { bands?: number[] | null; edges: number[]; className?: string }) {
  if (!bands?.length) return null;
  const labels = bandLabels(edges);
  return (
    <div className={`flex h-1.5 w-full overflow-hidden rounded-full bg-gray-800 ${className}`}>
      {bands.map((share, i) => (
        share > 0 ? (
          <div
            key={labels[i]}
            className={BAND_TONES[i]}
            style={{ width: `${share}%` }}
            title={`${labels[i]} · ${share}% of crossings`}
          />
        ) : null
      ))}
    </div>
  );
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

  const [settings, setSettings] = useState<MetricThresholdSettings>(() => ({
    dwellSec: clampThreshold(metricThresholds?.dwellSec ?? DEFAULT_DWELL_SEC, DEFAULT_DWELL_SEC),
    engagementSec: clampThreshold(metricThresholds?.engagementSec ?? DEFAULT_ENGAGE_SEC, DEFAULT_ENGAGE_SEC),
    engagementRankSec: clampThreshold(metricThresholds?.engagementRankSec ?? DEFAULT_RANK_SEC, DEFAULT_RANK_SEC),
    queueFloorSec: clampThreshold(metricThresholds?.queueFloorSec ?? DEFAULT_QUEUE_FLOOR_SEC, DEFAULT_QUEUE_FLOOR_SEC),
    bandEdgesSec: metricThresholds?.bandEdgesSec?.length === 4 ? metricThresholds.bandEdgesSec : DEFAULT_BAND_EDGES,
  }));
  const { dwellSec, engagementSec, engagementRankSec, queueFloorSec, bandEdgesSec } = settings;
  const previewTimerRef = useRef<number>();
  const sliderTouchedRef = useRef(false);

  useEffect(() => {
    if (sliderTouchedRef.current) return;
    if (!metricThresholds) return;
    setSettings(prev => ({
      dwellSec: clampThreshold(metricThresholds.dwellSec, prev.dwellSec),
      engagementSec: clampThreshold(metricThresholds.engagementSec, prev.engagementSec),
      engagementRankSec: clampThreshold(metricThresholds.engagementRankSec ?? NaN, prev.engagementRankSec),
      queueFloorSec: clampThreshold(metricThresholds.queueFloorSec ?? NaN, prev.queueFloorSec),
      bandEdgesSec: metricThresholds.bandEdgesSec?.length === 4 ? metricThresholds.bandEdgesSec : prev.bandEdgesSec,
    }));
  }, [metricThresholds, journey.generatedAt]);

  const applySetting = (patch: Partial<MetricThresholdSettings>) => {
    sliderTouchedRef.current = true;
    setSettings(prev => {
      const next = { ...prev, ...patch };
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = window.setTimeout(() => onMetricThresholdPreview?.(next), 450);
      return next;
    });
  };

  useEffect(() => () => window.clearTimeout(previewTimerRef.current), []);

  useEffect(() => {
    onMetricThresholdsChange?.(settings);
  }, [settings, onMetricThresholdsChange]);

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
      engagementRankSec: String(engagementRankSec),
      queueFloorSec: String(queueFloorSec),
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

      <ExecutiveHeader
        headline={journey.headline}
        venueName={venueName}
        rangeLabel={rangeLabel}
        generatedAtLabel={generatedAtLabel}
        kpis={headlineKpis}
      />

      {/* What to act on */}
      {insights.length > 0 && (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
        >
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
        subtitle="The service counters, where a crossing that turns into a pause is the signal worth watching. The tracker holds a shopper's identity for about 13 seconds, so visits are rebuilt by rejoining fragments before anything is measured. Dwell is the typical length of a pause and is a lower bound; compare counters on stopping rate, which is the sturdier of the two."
      >
        {fresco.departments.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">
            No service counters detected. Tag banco fixtures with Pesce, Pane, Salumi, etc.
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
          >
            {fresco.departments.map(dept => {
              const visual = getCategoryVisual(dept.label);
              return (
                <FrescoDepartmentCard
                  key={dept.id}
                  label={dept.label}
                  visits={dept.visits}
                  dwellVisits={dept.dwellVisits}
                  episodes={dept.episodes}
                  fragmentsPerEpisode={dept.fragmentsPerEpisode}
                  medianDwellSec={dept.medianDwellSec}
                  p75DwellSec={dept.p75DwellSec}
                  dwellReliable={dept.dwellReliable}
                  dwellUnavailableReason={dept.dwellUnavailableReason}
                  reportable={dept.reportable}
                  stoppingPct={dept.stoppingPct ?? dept.browsingPct}
                  passThroughPct={dept.passThroughPct}
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
                caption={`of aisle crossings paused ${metricThresholds?.dwellSec ?? dwellSec}s or more`}
                color="#60a5fa"
              />
              {aisles.engagementRatePct != null && (
                <AisleStat
                  value={`${aisles.engagementRatePct}%`}
                  label="Engagement rate"
                  caption={`held past ${metricThresholds?.engagementRankSec ?? engagementRankSec}s — the bar that ranks fixtures`}
                  color="#34d399"
                />
              )}
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
                  caption="of entrance tracks never seen in aisle or fresco"
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
                different questions. Pass-through is the share of aisle crossings that did not stop; bypass is the share of
                people seen at the entrance who were never seen in an aisle or fresco zone.
              </p>
              <p>
                Rank fixtures by <span className="text-gray-400">engagement rate</span> rather than stopping power. At
                5 seconds most zones land within a few points of one another; at{' '}
                {metricThresholds?.engagementRankSec ?? engagementRankSec} seconds the same zones spread roughly five
                times wider, because holding a shopper that long is a deliberate act rather than a slow walk.
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
                        <th className="text-right px-4 py-3 font-medium">Held</th>
                        <th className="text-right px-4 py-3 font-medium">Dwell</th>
                        <th className="text-left px-4 py-3 font-medium w-32">How long they stayed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aisles.topAisles.map(row => (
                        <tr key={row.id} className="border-b border-gray-800/50 last:border-0 hover:bg-white/[0.02]">
                          <td className="px-4 py-3.5"><CategoryChip label={row.category} /></td>
                          <td className="px-4 py-3.5 text-gray-300">{zoneDisplayName(row.name)}</td>
                          <td className="px-4 py-3.5 text-right text-white tabular-nums font-medium">{row.visits.toLocaleString()}</td>
                          <td className="px-4 py-3.5 text-right text-gray-200 tabular-nums">{row.stoppingPowerPct}%</td>
                          <td className="px-4 py-3.5 text-right text-emerald-300 tabular-nums font-medium">
                            {row.engagementRatePct != null ? `${row.engagementRatePct}%` : '—'}
                          </td>
                          <td className="px-4 py-3.5 text-right text-gray-200 tabular-nums">{formatDwellDuration(row.avgDwellSec, row.avgDwellMin)}</td>
                          <td className="px-4 py-3.5"><BandBar bands={row.bands} edges={bandEdgesSec} /></td>
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
        <CheckoutPanel
          channels={checkoutChannels}
          frictionScore={checkout.frictionScore}
          showFriction={dwellReliable && checkout.avgWaitMin > 0}
        />
        {dwellReliable && checkout.frictionScore != null && checkout.avgWaitMin > 0 && (
          <p className="mt-3 text-[13px] text-gray-400 leading-relaxed">
            Friction is the wait divided by shopping dwell, so {checkout.frictionScore} means a
            shopper spends that fraction of their trip queuing.
          </p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <dt className="inline text-gray-400 font-medium">Engagement rate · </dt>
                <dd className="inline">
                  share of crossings held past {metricThresholds?.engagementRankSec ?? engagementRankSec}s. This is
                  the number to rank fixtures by: measured across the shelf zones it spreads about five times wider
                  than stopping power, which at 5s puts most zones within a few points of each other.
                </dd>
              </div>
              <div>
                <dt className="inline text-gray-400 font-medium">Mean dwell · </dt>
                <dd className="inline">
                  total time in the zone divided by distinct shoppers, with no minimum. Filtering to long visits
                  first makes the figure larger but less able to tell two zones apart, because it pulls every zone
                  up toward the threshold.
                </dd>
              </div>
              <div>
                <dt className="inline text-gray-400 font-medium">Bypass · </dt>
                <dd className="inline">
                  of distinct tracks seen at the entrance, the share never seen in an aisle or fresco zone
                  (100 − penetration).
                </dd>
              </div>
              <div>
                <dt className="inline text-gray-400 font-medium">Checkout wait · </dt>
                <dd className="inline">
                  measured over queue visits of {metricThresholds?.queueFloorSec ?? queueFloorSec}s or more. Most
                  crossings of a queue zone are shoppers walking past it, and counting those reports a wait of a
                  few seconds.
                </dd>
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
              <div className="space-y-4 pt-1 border-t border-gray-700/30">
                <div className="grid sm:grid-cols-2 gap-4">
                  <ThresholdSlider
                    label="Stopping threshold"
                    accent="amber"
                    min={1}
                    max={120}
                    step={1}
                    value={dwellSec}
                    onChange={(v) => applySetting({ dwellSec: v })}
                    hint="Explore only — the report ships at Esselunga's 5s"
                  />
                  <ThresholdSlider
                    label="Ranking bar"
                    accent="emerald"
                    min={5}
                    max={60}
                    step={1}
                    value={engagementRankSec}
                    onChange={(v) => applySetting({ engagementRankSec: v })}
                    hint="Higher separates zones more sharply but reports on fewer of them"
                  />
                  <ThresholdSlider
                    label="Queue floor"
                    accent="sky"
                    min={1}
                    max={60}
                    step={1}
                    value={queueFloorSec}
                    onChange={(v) => applySetting({ queueFloorSec: v })}
                    hint="Below this, a queue-zone crossing is a shopper walking past"
                  />
                  <ThresholdSlider
                    label="Engaged threshold"
                    accent="violet"
                    min={15}
                    max={300}
                    step={5}
                    value={engagementSec}
                    onChange={(v) => applySetting({ engagementSec: v })}
                    hint="Separates a long browse from a pause"
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-xs uppercase tracking-wider text-gray-400">Dwell bands</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {bandEdgesSec.map((edge, i) => (
                      <input
                        key={`edge-${i}`}
                        type="number"
                        min={1}
                        max={600}
                        value={edge}
                        onChange={(e) => {
                          const next = [...bandEdgesSec];
                          next[i] = Math.max(1, parseInt(e.target.value, 10) || 1);
                          applySetting({ bandEdgesSec: next });
                        }}
                        className="w-16 rounded border border-gray-700 bg-gray-900/60 px-2 py-1 text-xs text-white tabular-nums"
                      />
                    ))}
                    <span className="text-[11px] text-gray-400">
                      seconds — the four cuts behind every distribution bar on this page
                    </span>
                  </div>
                  <BandBar bands={aisles.bands} edges={bandEdgesSec} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {bandLabels(bandEdgesSec).map((label, i) => (
                      <span key={label} className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <span className={`w-2 h-2 rounded-sm ${BAND_TONES[i]}`} />
                        {label}
                        {aisles.bands?.[i] != null && (
                          <span className="text-gray-500 tabular-nums">{aisles.bands[i]}%</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
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
