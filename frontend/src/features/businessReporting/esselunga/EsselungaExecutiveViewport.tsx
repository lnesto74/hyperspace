import { useMemo, useState, useEffect, useRef } from 'react';
import { API_BASE } from '../../../config/api';
import {
  Users,
  Clock,
  Euro,
  TrendingUp,
  Store,
  ShoppingBag,
  CreditCard,
  Lightbulb,
  Download,
  Radio,
  FileText,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  DoorOpen,
} from 'lucide-react';
import type { EsselungaJourneyPayload, ExecutiveVariant, ActivityTimeline, ActivityTimelineSet } from './types';
import ErpCsvUploadPanel from './ErpCsvUploadPanel';
import { exportWeeklyExecutivePdf } from './exportWeeklyPdf';
import {
  RingGauge,
  HorizontalBarChart,
  FrescoDepartmentCard,
  JourneySignalsPanel,
  CheckoutLaneCards,
  HeroKpiStrip,
  SectionCard,
} from './EsselungaCharts';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';
import { HERO_KPI_TOOLTIPS } from './kpiTooltips';
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
  metricPreviewLoading?: boolean;
  /** Hide admin-only controls (ERP upload) on customer share links */
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
const DEFAULT_DWELL_SEC = 10;
const DEFAULT_ENGAGE_SEC = 30;

function clampThreshold(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function CategoryChip({ label }: { label: string }) {
  const v = getCategoryVisual(label);
  const Icon = v.Icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium"
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

  useEffect(() => {
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
    const v = clampThreshold(value, DEFAULT_DWELL_SEC);
    setDwellSec(v);
    queueMetricPreview(v, engagementSec);
  };

  const handleEngagementChange = (value: number) => {
    const v = clampThreshold(value, DEFAULT_ENGAGE_SEC);
    setEngagementSec(v);
    queueMetricPreview(dwellSec, v);
  };

  useEffect(() => () => window.clearTimeout(previewTimerRef.current), []);

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

  const aisleCategoryBars = useMemo(
    () => (aisles.categoryGroups || []).map(g => ({
      label: g.category,
      value: g.visits,
      sub: `${g.stoppingPowerPct}% stop · ${g.avgDwellMin}m`,
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
    if (journeySignals) return journeySignals;
    return {
      reconciliationRequired: true,
      ingress: {
        visitors: overview.perimeterEntrants ?? overview.totalVisitors,
        gateEstimated: overview.ingressDirectEstimated,
        recovered: overview.ingressRecovered ?? 0,
      },
      shopping: {
        aisleZoneVisits: aisles.totalAisleVisits,
        dwellVisits: aisles.dwellVisits ?? 0,
        stoppingPct: aisles.stoppingPowerPct,
        bypassPct: aisles.bypassPct,
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

  const spiLabel = overview.spi != null
    ? (erp.hasData ? `€${overview.spi}` : String(overview.spi))
    : '—';

  const visitorSub = overview.ingressRecovered
    ? `${overview.ingressDirectEstimated ?? overview.ingressUnique ?? 0} gate · ${overview.ingressRecovered} recovered`
    : overview.ingressEpisodes
      ? `${overview.ingressEpisodes.toLocaleString()} crossings`
      : 'Store entrants';

  const entrantSub = variant === 'live'
    ? `${livePerimeter.uniqueTracks.toLocaleString()} unique trails · perimeter cross`
    : `${(overview.perimeterUniqueTracks ?? 0).toLocaleString()} unique trails · selected period`;

  const heroItems = useMemo(() => {
    const items = [
      {
        icon: DoorOpen,
        label: 'Entrants',
        value: (variant === 'live' ? livePerimeter.count : (overview.perimeterEntrants ?? 0)).toLocaleString(),
        numericValue: variant === 'live' ? livePerimeter.count : (overview.perimeterEntrants ?? 0),
        sub: `Entrance 1121 · ${entrantSub}`,
        accent: '#22d3ee',
        tooltip: HERO_KPI_TOOLTIPS.Entrants,
        live: variant === 'live',
      },
      {
        icon: Users,
        label: 'Visitors (legacy)',
        value: overview.totalVisitors.toLocaleString(),
        sub: visitorSub,
        accent: '#3b82f6',
        tooltip: HERO_KPI_TOOLTIPS.Visitors,
      },
    ];

    if (variant === 'live') {
      const occSub = liveOccupancy.source === 'live_frame'
        ? 'live perception frame'
        : liveOccupancy.source === 'track_positions'
          ? 'latest LiDAR frame'
          : 'recent track activity';
      items.push({
        icon: Store,
        label: 'In store now',
        value: String(liveOccupancy.count),
        numericValue: liveOccupancy.count,
        sub: occSub,
        accent: '#06b6d4',
        tooltip: HERO_KPI_TOOLTIPS['In store now'],
        live: true,
      });
    }

    if (dwellReliable) {
      const dwellSub = overview.dwellP25Min != null && overview.dwellP75Min != null
        ? `median · p25–p75 ${overview.dwellP25Min}–${overview.dwellP75Min}m`
        : `${overview.dwellSessionCount ?? '—'} stitched visits`;
      items.push({
        icon: Clock,
        label: 'Median dwell',
        value: `${overview.medianStoreDwellMin ?? overview.avgStoreDwellMin}m`,
        sub: dwellSub,
        accent: '#8b5cf6',
        tooltip: HERO_KPI_TOOLTIPS['Avg dwell'],
      });
    }

    const aisleLabel = aisles.penetrationPct != null ? 'Aisle reach' : 'Aisle stopping';
    items.push({
      icon: ShoppingBag,
      label: aisleLabel,
      value: aisles.penetrationPct != null ? `${aisles.penetrationPct}%` : `${aisles.stoppingPowerPct}%`,
      sub: aisles.penetrationPct != null ? 'entrants with aisle dwell' : 'of aisle visits with dwell',
      accent: '#f59e0b',
      tooltip: HERO_KPI_TOOLTIPS[aisleLabel],
    });

    items.push({
      icon: CreditCard,
      label: 'Checkout',
      value: checkoutCount.toLocaleString(),
      sub: 'completed queue sessions',
      accent: '#22c55e',
      tooltip: HERO_KPI_TOOLTIPS.Checkout,
    });

    if (erp.hasData && overview.avgTicket != null) {
      items.push({
        icon: Euro,
        label: 'Avg ticket',
        value: `€${overview.avgTicket.toFixed(2)}`,
        sub: 'ERP',
        accent: '#f59e0b',
        tooltip: HERO_KPI_TOOLTIPS['Avg ticket'],
      });
    }

    if (erp.hasData && overview.spi != null) {
      items.push({
        icon: TrendingUp,
        label: 'SPI',
        value: spiLabel,
        sub: 'revenue / dwell',
        accent: '#10b981',
        tooltip: HERO_KPI_TOOLTIPS.SPI,
      });
    }

    return items;
  }, [
    overview, variant, dwellReliable, visitorSub, entrantSub, livePerimeter,
    aisles.penetrationPct, aisles.stoppingPowerPct,
    checkoutCount, erp.hasData, spiLabel, liveOccupancy,
  ]);

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

  return (
    <div className="space-y-4 max-h-[calc(100vh-12rem)] overflow-y-auto pr-1">
      <div className="rounded-xl border border-gray-700/60 bg-gray-800/30 overflow-hidden">
        <button
          type="button"
          onClick={() => setMetricsOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50"
        >
          <span className="text-[11px] text-gray-300 font-medium">
            Metric definitions
            <span className="text-gray-500 font-normal ml-2">
              stopping ≥ {dwellSec}s · engaged ≥ {engagementSec}s
              {metricThresholds?.source === 'preview' && (
                <span className="text-cyan-400 ml-1">· preview</span>
              )}
              {metricPreviewLoading && (
                <span className="text-amber-400/90 ml-1">· recalculating…</span>
              )}
            </span>
          </span>
          {metricsOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-600" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-600" />}
        </button>
        {metricsOpen && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-700/40 space-y-3">
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Crossings count every zone entry (≥300ms). <strong className="text-gray-400">Stopping</strong> and{' '}
              <strong className="text-gray-400">pass-through</strong> are recalculated live from visit durations when you move the sliders.
              {publicShare ? (
                <> Thresholds shown are configured for this store.</>
              ) : (
                <> Persist defaults under <strong className="text-gray-400">Venue → Settings</strong> or per-zone on KPI popups.</>
              )}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-[10px] uppercase tracking-wider text-amber-400/90">Stopping threshold</span>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={dwellSec}
                    onChange={(e) => handleDwellChange(parseInt(e.target.value, 10))}
                    className="flex-1 h-1.5 bg-gray-700 rounded-lg accent-amber-500"
                  />
                  <span className="text-xs text-white tabular-nums w-10 text-right">{dwellSec}s</span>
                </div>
                <span className="text-[9px] text-gray-600">Counts as dwell / stopping visit</span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-[10px] uppercase tracking-wider text-emerald-400/90">Engaged threshold</span>
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
                <span className="text-[9px] text-gray-600">Stored in data; shown when we add engagement KPIs</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Header */}
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
        {variant === 'hq' && (
          <button
            type="button"
            onClick={() => exportWeeklyExecutivePdf(journey, venueName)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-white"
          >
            <Download className="w-3 h-3" /> Export PDF
          </button>
        )}
        <div className="flex gap-2 text-[10px] text-gray-500 ml-auto">
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{taxonomy.fresco} fresco</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{taxonomy.aisles} aisles</span>
          <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">{taxonomy.checkout} checkout</span>
        </div>
      </div>

      {/* Live pulse + 3D heatmap hero */}
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

      {/* Hero KPI strip */}
      <HeroKpiStrip items={heroItems} />

      {/* Insights */}
      {insights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {insights.slice(0, 3).map(ins => (
            <div key={ins.id} className={`rounded-lg border p-3 ${INSIGHT_COLOR[ins.severity]}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Lightbulb className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-xs font-medium text-white">{ins.title}</span>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">{ins.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Journey funnel */}
      <SectionCard
        id="journey"
        title="Store journey signals"
        subtitle="Independent LiDAR measurements — not a conversion funnel"
      >
        <JourneySignalsPanel signals={signals} />
      </SectionCard>

      {/* Piazza del Fresco — always visible */}
      <SectionCard
        id="fresco"
        title="Piazza del Fresco"
        subtitle="Counter-zone engagement — how many crossings stop, and for how long"
      >
        {fresco.departments.length === 0 ? (
          <p className="text-xs text-gray-500 py-4 text-center">
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

      {/* Aisles */}
      <SectionCard
        id="aisles"
        title="Aisles & categories"
        subtitle="Of all aisle-zone crossings, what share stopped vs passed through"
      >
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-4 space-y-3">
            <div className="flex flex-wrap gap-4 justify-center xl:justify-start">
              <RingGauge value={aisles.stoppingPowerPct} label="Stopping" sub="crossings with dwell" color="#3b82f6" />
              <RingGauge value={aisles.bypassPct} label="Pass-through" sub="crossed, no dwell" color="#64748b" />
            </div>
            <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 px-3 py-2.5 text-[10px] text-gray-500 leading-relaxed">
              <span className="text-gray-300 font-medium">{(aisles.dwellVisits ?? 0).toLocaleString()}</span>
              {' '}dwell visits of{' '}
              <span className="text-gray-300 font-medium">{aisles.totalAisleVisits.toLocaleString()}</span>
              {' '}aisle crossings in this period.
              {' '}A dwell = LiDAR detected the shopper stopped in the zone (not just walked through).
            </div>
          </div>
          <div className="xl:col-span-8 space-y-4">
            {aisleCategoryBars.length > 0 && (
              <HorizontalBarChart rows={aisleCategoryBars.slice(0, 10)} maxBars={10} />
            )}
            {aisles.topAisles.length > 0 && (
              <div className="rounded-lg border border-gray-700/50 overflow-hidden">
                <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-900/95 z-10">
                      <tr className="text-gray-500 border-b border-gray-700/40">
                        <th className="text-left px-3 py-2 font-medium">Category</th>
                        <th className="text-left px-3 py-2 font-medium">Zone</th>
                        <th className="text-right px-3 py-2 font-medium">Visits</th>
                        <th className="text-right px-3 py-2 font-medium">Stop</th>
                        <th className="text-right px-3 py-2 font-medium">Dwell</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aisles.topAisles.map(row => (
                        <tr key={row.id} className="border-b border-gray-800/50 hover:bg-white/[0.02]">
                          <td className="px-3 py-2"><CategoryChip label={row.category} /></td>
                          <td className="px-3 py-2 text-gray-500 truncate max-w-[120px]">{row.name}</td>
                          <td className="px-3 py-2 text-right text-gray-200 tabular-nums">{row.visits.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{row.stoppingPowerPct}%</td>
                          <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{row.avgDwellMin}m</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Checkout */}
      <SectionCard
        id="checkout"
        title="Checkout lanes"
        subtitle="Queue sessions by channel — traditional, self-checkout, self-scan"
      >
        <CheckoutLaneCards channels={checkoutChannels} />
        {dwellReliable && checkout.frictionScore != null && checkout.avgWaitMin > 0 && (
          <div className="mt-3 rounded-lg border border-gray-700/50 bg-gray-800/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-gray-400">Checkout friction</span>
            <span className="text-white font-medium">{checkout.frictionScore}</span>
            <span className="text-gray-600">wait ÷ store dwell ({checkout.avgWaitMin}m avg wait)</span>
          </div>
        )}
      </SectionCard>

      {/* Media */}
      <SectionCard
        id="media"
        title="Retail media"
        subtitle="Campaign effectiveness across in-store screens"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <div className="flex items-center gap-4">
            <RingGauge value={media.ces} max={100} label="CES" color="#a78bfa" size={88} />
            <div>
              <h3 className="text-xs font-semibold text-white">Campaign effectiveness</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">PEBLE composite across active screens</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <RingGauge value={media.eal} max={100} label="EAL" color="#38bdf8" size={88} />
            <div>
              <h3 className="text-xs font-semibold text-white">Exposure lift</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">Incremental visits attributed to DOOH</p>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ERP — admin only (hidden on customer public links) */}
      {!publicShare && (
      <div className="rounded-lg border border-gray-700/40 bg-gray-800/20 overflow-hidden">
        <button
          type="button"
          onClick={() => setErpOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/40"
        >
          <span className="text-[10px] text-gray-500 flex items-center gap-1.5">
            <Euro className="w-3 h-3" />
            ERP / POS data
            {erp.hasData ? (
              <span className="text-emerald-500/80">· connected</span>
            ) : (
              <span>· optional — upload for ticket & SPI</span>
            )}
          </span>
          {erpOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-600" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-600" />}
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
      <div className="flex flex-wrap gap-2 pb-2 text-[10px] text-gray-600">
        {['journey', 'fresco', 'aisles', 'checkout', 'media'].map(id => (
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
