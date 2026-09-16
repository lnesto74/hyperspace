import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { KpiTileDefinition } from '../personas';
import ReportingKpiStrip from '../components/ReportingKpiStrip';
import ReportingInsightsPanel from '../components/ReportingInsightsPanel';
import CategoryVisitsPanel from '../components/CategoryVisitsPanel';
import type { CategoryRankingRow } from '../components/CategoryRankingPanel';
import ZonePerformanceViewport, { type ZonePerformanceItem } from '../components/ZonePerformanceViewport';
import PebleEffectivenessViewport, { type CampaignPerformanceItem } from '../components/PebleEffectivenessViewport';
import CampaignRankingPanel, { type CampaignRankingRow } from '../components/CampaignRankingPanel';
import type {
  ExecutivePillar,
  ExecutiveHighlights,
  PeriodDeltas as ExecPeriodDeltas,
} from '../components/ExecutiveSummaryViewport';
import OperationsHeroStrip from '../operationsConsole/OperationsHeroStrip';
import OperationsAlertsPanel from '../operationsConsole/OperationsAlertsPanel';
import OperationsTimelineChart from '../operationsConsole/OperationsTimelineChart';
import OperationsFootfallPanel from '../operationsConsole/OperationsFootfallPanel';
import type {
  OperationsConsoleData,
  PeriodDeltas as OpsPeriodDeltas,
  TimelineGrain,
} from '../operationsConsole/types';
import { ExecutiveHeader } from '../esselunga/ExecutiveHeadline';
import {
  ActivityTimelineChart,
  ExecutivePulseBand,
} from '../esselunga/ExecutiveVisuals';
import {
  CheckoutPanel,
  FrescoDepartmentCard,
  JourneySignalsPanel,
  RingGauge,
} from '../esselunga/EsselungaCharts';
import type {
  ActivityTimeline,
  ActivityTimelineSet,
  EsselungaJourneyPayload,
} from '../esselunga/types';
import type { DoohScreenMarker } from '../../../components/shared/FloorPlanMiniMap';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';
import type { WidgetId } from './types';
import { getWidget } from './registry';
import type { DailyKpiPayload, DailyKpiRangeDay } from '../dailyKpi/types';
import { buildHeadline, buildHeadlineKpis, departmentMinutes, firstDepartment, queueBySlot, queueLanes, slotSeries, checkRows } from '../dailyKpi/viewModel';

export interface DashboardDataContext {
  venueId: string;
  venueName: string;
  /** Merged defs for Ops/Exec/Media lookup (custom board). */
  kpiDefinitions: KpiTileDefinition[];
  /** Narrow strip for the generic KPI strip widget. */
  stripKpiDefinitions?: KpiTileDefinition[];
  kpiValues: Record<string, number | null | undefined>;
  periodDeltas?: ExecPeriodDeltas & Partial<OpsPeriodDeltas>;
  topCategories?: CategoryRankingRow[];
  deadZones: ZonePerformanceItem[];
  topZones: ZonePerformanceItem[];
  zoneUtilThresholdPct?: number;
  topCampaigns: CampaignPerformanceItem[];
  underperformingCampaigns: CampaignPerformanceItem[];
  campaignRanking?: CampaignRankingRow[];
  doohScreens: DoohScreenMarker[];
  dataWindowStartTs?: number;
  dataWindowEndTs?: number;
  executivePillars: ExecutivePillar[];
  executiveHighlights: ExecutiveHighlights;
  operationsConsole?: OperationsConsoleData | null;
  journey?: EsselungaJourneyPayload | null;
  dailyKpi?: DailyKpiPayload | null;
  dailyKpiRange?: DailyKpiRangeDay[];
  heatmapTimeframe: 'day' | 'week' | 'month';
  opsGrain?: TimelineGrain;
  onOpsGrainChange?: (grain: TimelineGrain) => void;
  onOpenCategoryHeatmap?: (row: CategoryRankingRow) => void;
  onExpandHeatmap?: () => void;
  /** When true, tiles show a spinner instead of empty “no data” states. */
  loading?: boolean;
}

const OPS_GRAINS: { id: TimelineGrain; label: string }[] = [
  { id: 'hour', label: 'Hour' },
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
];

function resolveRhythmTimelines(journey?: EsselungaJourneyPayload | null): ActivityTimelineSet | null {
  if (!journey) return null;
  if (journey.activityTimelines) return journey.activityTimelines;
  const single = journey.activityTimeline;
  if (!single) return null;
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
  if (single.grain === 'hour') {
    return { hourly: single, daily: { grain: 'day', visitors: [], dwells: [] } };
  }
  return { hourly: emptyHourly(), daily: single };
}

function Empty({ label }: { label: string }) {
  return (
    <div className="h-full min-h-[100px] flex items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-900/40 px-3 text-center">
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function DailyKpiSlice({ widgetId, payload }: { widgetId: WidgetId; payload: DailyKpiPayload }) {
  if (widgetId === 'store-rhythm-v2') {
    const slots = slotSeries(payload);
    const max = Math.max(1, ...slots.map((s) => s.entrances || 0));
    return (
      <div className="flex items-end gap-1 h-24">
        {slots.map((s) => (
          <div key={s.slot} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full h-16 flex items-end bg-gray-900/50 rounded">
              <div className="w-full bg-cyan-500/70 rounded-t" style={{ height: `${((s.entrances || 0) / max) * 100}%` }} />
            </div>
            <span className="text-[9px] text-gray-400">{s.slot}</span>
          </div>
        ))}
      </div>
    );
  }
  if (widgetId === 'department-minutes') {
    const rows = departmentMinutes(payload);
    const max = Math.max(0.01, ...rows.filter((d) => d.minutes != null).map((d) => d.minutes as number));
    return (
      <div className="space-y-1">
        {rows.map((d) => (
          <div key={d.dept} className="flex items-center gap-2 text-[11px]">
            <span className="w-36 truncate text-gray-300">{d.dept}</span>
            {d.zeroObservation ? (
              <span className="text-amber-300">nessuna osservazione — da verificare</span>
            ) : (
              <>
                <div className="flex-1 h-1.5 bg-gray-900 rounded">
                  <div className={`h-full rounded ${d.dept === 'Corsie / fuori zona' ? 'bg-violet-400' : 'bg-sky-400'}`} style={{ width: `${((d.minutes || 0) / max) * 100}%` }} />
                </div>
                <span className="tabular-nums text-gray-200 w-10 text-right">{d.minutes?.toFixed(2)}</span>
              </>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (widgetId === 'first-department') {
    const first = firstDepartment(payload);
    return (
      <div className="space-y-1">
        {first.map((f) => (
          <div key={f.dst} className="flex justify-between text-[11px] text-gray-300">
            <span>{f.dst}</span>
            <span className="tabular-nums">{Math.round(f.share * 100)}%</span>
          </div>
        ))}
      </div>
    );
  }
  if (widgetId === 'queue-by-slot') {
    const slots = queueBySlot(payload);
    return (
      <div className="space-y-1 text-[11px] text-gray-300">
        {slots.map((s) => (
          <div key={s.slot} className="flex justify-between">
            <span>{s.slot}</span>
            <span className="tabular-nums">coda {s.wait?.toFixed(2) ?? '—'} · servizio {s.service?.toFixed(2) ?? '—'}</span>
          </div>
        ))}
      </div>
    );
  }
  if (widgetId === 'queue-by-lane') {
    const lanes = queueLanes(payload).filter((l) => l.roi_group === 'CHECKOUT_QUEUE');
    return (
      <table className="w-full text-[11px] text-gray-300">
        <tbody>
          {lanes.map((l) => (
            <tr key={String(l.lane)}>
              <td className="py-0.5">Cassa {String(l.lane)}</td>
              <td className="py-0.5 text-right tabular-nums">{Number(l.WAITING || 0).toFixed(1)} min</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (widgetId === 'behaviour-mix') {
    const row = payload.kpis.find((k) => k.kpi_id === 'behaviour_share');
    if (!row || row.status === 'unreliable') {
      return <p className="text-[11px] text-gray-500" title={row?.status_reason || undefined}>— non calcolato</p>;
    }
    return <pre className="text-[10px] text-gray-400 whitespace-pre-wrap">{JSON.stringify(row.payload, null, 0)}</pre>;
  }
  const checks = checkRows(payload);
  return (
    <ul className="space-y-1 text-[11px]">
      {checks.map((c) => (
        <li key={c.check_id} className={c.passed ? 'text-emerald-400' : 'text-rose-400'}>
          {c.passed ? 'pass' : 'fail'} · {c.check_id}
        </li>
      ))}
    </ul>
  );
}

function WidgetLoader({ title }: { title?: string }) {
  return (
    <div className="h-full min-h-[100px] flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-700/70 bg-gray-900/40 px-3">
      <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
      <p className="text-[11px] text-gray-400">
        {title ? `Loading ${title}…` : 'Loading…'}
      </p>
    </div>
  );
}

function Shell({ title, legacy, children }: { title: string; legacy?: boolean; children: ReactNode }) {
  return (
    <div className="h-full rounded-lg border border-gray-700/80 bg-gray-800/40 overflow-hidden flex flex-col">
      <div className="px-3 py-1.5 border-b border-gray-700/60 flex-shrink-0">
        <span className="text-[11px] font-medium text-gray-300">{title}</span>
        {legacy && (
          <p className="text-[10px] text-amber-300/90 mt-0.5">
            Calcolo precedente, basato su zone_visits / queue_sessions. Da dismettere.
          </p>
        )}
      </div>
      <div className="p-2 flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

/** True while a fetch is in flight and this tile has no usable payload yet. */
function shouldShowLoader(widgetId: WidgetId, ctx: DashboardDataContext): boolean {
  if (!ctx.loading) return false;
  const def = getWidget(widgetId);
  if (def.needsJourney) return !ctx.journey;
  if (def.needsDailyKpi) return !ctx.dailyKpi;
  if (def.needsOps) return !ctx.operationsConsole;
  // Shared strips / maps: keep prior content on refresh; spinner only on first load.
  const hasKpis = Object.keys(ctx.kpiValues || {}).length > 0;
  return !ctx.journey && !ctx.operationsConsole && !hasKpis;
}

export default function WidgetRenderer({
  widgetId,
  ctx,
}: {
  widgetId: WidgetId;
  ctx: DashboardDataContext;
}) {
  const def = getWidget(widgetId);
  const journey = ctx.journey;
  const ops = ctx.operationsConsole;

  if (shouldShowLoader(widgetId, ctx)) {
    return <WidgetLoader title={def.name} />;
  }

  switch (widgetId) {
    case 'ops-hero-kpi-strip': {
      if (!ops) return <Empty label="Ops KPIs need Operations Pulse data for this range." />;
      return (
        <OperationsHeroStrip
          heroIds={ops.heroKpiIds}
          kpiDefinitions={ctx.kpiDefinitions}
          kpiValues={ctx.kpiValues}
          periodDeltas={ctx.periodDeltas as OpsPeriodDeltas | undefined}
        />
      );
    }
    case 'ops-alerts-panel': {
      if (!ops) return <Empty label="Ops alerts need Operations Pulse data." />;
      return <OperationsAlertsPanel alerts={ops.alerts || []} />;
    }
    case 'ops-store-activity-chart': {
      if (!ops?.timeline) return <Empty label="Store activity needs Operations Pulse data." />;
      const grain = ctx.opsGrain || ops.timeline.grain || 'hour';
      return (
        <Shell title={def.name}>
          <div className="space-y-2">
            {ctx.onOpsGrainChange && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-gray-500 uppercase tracking-wide">Activity grain</span>
                <div className="flex bg-gray-900/70 rounded-md p-0.5 border border-gray-700/60">
                  {OPS_GRAINS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => ctx.onOpsGrainChange?.(g.id)}
                      className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                        grain === g.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <OperationsTimelineChart
              timeline={ops.timeline}
              showFootfallSeries={ops.timeline.visitorSource === 'ingress'}
            />
          </div>
        </Shell>
      );
    }
    case 'ops-footfall-by-hour': {
      if (!ops?.footfall) return <Empty label="Footfall needs Operations Pulse data." />;
      return (
        <Shell title={def.name}>
          <OperationsFootfallPanel
            footfall={ops.footfall}
            storeActivityByHour={ops.storeActivityByHour}
          />
        </Shell>
      );
    }
    case 'reporting-kpi-strip':
      return (
        <ReportingKpiStrip
          kpiDefinitions={ctx.stripKpiDefinitions ?? ctx.kpiDefinitions}
          kpiValues={ctx.kpiValues}
        />
      );
    case 'reporting-insights-panel':
      return (
        <Shell title={def.name}>
          <ReportingInsightsPanel
            kpiDefinitions={ctx.stripKpiDefinitions ?? ctx.kpiDefinitions}
            kpiValues={ctx.kpiValues}
            personaName="Custom dashboard"
            compact
          />
        </Shell>
      );
    case 'exec-store-health-pillars': {
      if (!ctx.executivePillars.length) return <Empty label="No store-health pillars for this range." />;
      return (
        <Shell title={def.name}>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
            {ctx.executivePillars.map((p) => (
              <div key={p.id} className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{p.label}</div>
                <div className="text-[11px] text-gray-400 truncate">{p.metric}</div>
                <div className="text-lg font-semibold text-white tabular-nums">
                  {p.format === 'percent' ? `${p.value.toFixed(1)}%`
                    : p.format === 'minutes' ? `${p.value.toFixed(1)}m`
                      : p.format === 'score' ? p.value.toFixed(1)
                        : Math.round(p.value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </Shell>
      );
    }
    case 'exec-highlight-chips': {
      const h = ctx.executiveHighlights;
      const chips = [
        h.topZone && { k: 'Best zone', v: h.topZone.name, s: `${h.topZone.utilization}% engagement` },
        h.topCategory && { k: 'Top category', v: h.topCategory.category, s: `${h.topCategory.engagementRate}% engagement` },
        h.topCampaign && { k: 'Top campaign', v: h.topCampaign.name, s: `CES ${h.topCampaign.ces}` },
        ctx.deadZones.length > 0 && { k: 'Shelf issues', v: `${ctx.deadZones.length} zones`, s: h.worstZone?.name },
      ].filter(Boolean) as Array<{ k: string; v: string; s?: string }>;
      if (!chips.length) return <Empty label="No executive highlights for this range." />;
      return (
        <Shell title={def.name}>
          <div className="grid grid-cols-2 gap-2">
            {chips.map((c) => (
              <div key={c.k} className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-3 py-2">
                <div className="text-[10px] text-gray-500">{c.k}</div>
                <div className="text-xs text-white truncate">{c.v}</div>
                {c.s && <div className="text-[10px] text-gray-400 truncate">{c.s}</div>}
              </div>
            ))}
          </div>
        </Shell>
      );
    }
    case 'category-visits-panel': {
      if (!ctx.topCategories?.length) return <Empty label="No category traffic in this range." />;
      return (
        <Shell title={def.name}>
          <CategoryVisitsPanel
            categories={ctx.topCategories}
            onOpenHeatmap={ctx.onOpenCategoryHeatmap}
            compact
          />
        </Shell>
      );
    }
    case 'zone-performance-map':
      return (
        <Shell title={def.name}>
          <ZonePerformanceViewport
            venueId={ctx.venueId}
            deadZones={ctx.deadZones}
            topZones={ctx.topZones}
            zoneUtilThresholdPct={ctx.zoneUtilThresholdPct}
          />
        </Shell>
      );
    case 'peble-screen-campaign-map':
      return (
        <Shell title={def.name}>
          <PebleEffectivenessViewport
            venueId={ctx.venueId}
            topCampaigns={ctx.topCampaigns}
            underperformingCampaigns={ctx.underperformingCampaigns}
            doohScreens={ctx.doohScreens}
            dataWindowStartTs={ctx.dataWindowStartTs}
            dataWindowEndTs={ctx.dataWindowEndTs}
          />
        </Shell>
      );
    case 'campaign-ranking-table': {
      if (!ctx.campaignRanking?.length) return <Empty label="No campaigns in this range." />;
      return (
        <Shell title={def.name}>
          <CampaignRankingPanel campaigns={ctx.campaignRanking} />
        </Shell>
      );
    }
    case 'exec-header-headline': {
      if (!journey) return <Empty label="Esselunga headline needs journey data." />;
      const range = journey.range;
      const tz = (journey.storeHours as { timeZone?: string } | undefined)?.timeZone || 'Europe/Rome';
      return (
        <ExecutiveHeader
          headline={journey.headline}
          venueName={ctx.venueName}
          rangeLabel={`${new Date(range.startTs).toLocaleString('en-GB', { timeZone: tz })} → ${new Date(range.endTs).toLocaleString('en-GB', { timeZone: tz })}`}
          generatedAtLabel={new Date(journey.generatedAt).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}
          kpis={journey.headlineKpis || []}
        />
      );
    }
    case 'exec-action-insights': {
      if (!journey?.insights?.length) return <Empty label="No action insights for this range." />;
      return (
        <Shell title={def.name}>
          <div className="space-y-2">
            {journey.insights.slice(0, 3).map((ins) => (
              <div
                key={ins.id || ins.title}
                className="rounded-lg border border-gray-700/70 bg-gray-900/50 px-3 py-2"
              >
                <div className="text-xs font-semibold text-white">{ins.title}</div>
                <p className="text-[11px] text-gray-400 mt-0.5">{ins.message}</p>
                {ins.action && (
                  <p className="text-[11px] text-cyan-400/90 mt-1 italic">Action: {ins.action}</p>
                )}
              </div>
            ))}
          </div>
        </Shell>
      );
    }
    case 'activity-timeline-chart': {
      const timelines = resolveRhythmTimelines(journey);
      if (!timelines) return <Empty label="No store rhythm for this range." />;
      return (
        <Shell title={def.name}>
          <ActivityTimelineChart
            timelines={timelines}
            storeHoursLabel={journey?.storeHours?.hoursLabel}
          />
        </Shell>
      );
    }
    case 'floor-visual-toggle': {
      const timelines = resolveRhythmTimelines(journey);
      if (!timelines || !journey) return <Empty label="Floor visual needs journey data." />;
      return (
        <ExecutivePulseBand
          venueId={ctx.venueId}
          venueName={ctx.venueName}
          timelines={timelines}
          storeHoursLabel={journey.storeHours?.hoursLabel}
          heatmapCategories={journey.heatmapCategories || []}
          liveOccupancy={journey.overview?.currentOccupancy ?? 0}
          onExpandHeatmap={ctx.onExpandHeatmap}
          onFocusCategory={ctx.onOpenCategoryHeatmap
            ? (row) => ctx.onOpenCategoryHeatmap?.({
              category: row.category,
              zoneCount: row.zoneCount,
              roiIds: row.roiIds,
              totalVisits: row.totalVisits,
              browsingRate: row.browsingRate,
              engagementRate: row.engagementRate,
              conversionRate: row.conversionRate,
              avgBrowseTimeMin: row.avgBrowseTimeMin,
            })
            : undefined}
          heatmapTimeframe={ctx.heatmapTimeframe}
        />
      );
    }
    case 'journey-signals-panel': {
      if (!journey) return <Empty label="No entrance signals for this range." />;
      const a = journey.aisles || {};
      const ch = journey.checkout?.channels || [];
      const ov = journey.overview || {};
      const completed = journey.checkout?.completed
        ?? ch.reduce((s, c) => s + (c.completed ?? c.sessions), 0);
      const signals = {
        reconciliationRequired: journey.journeySignals?.reconciliationRequired ?? true,
        ingress: {
          visitors: ov.perimeterEntrants ?? ov.totalVisitors ?? journey.journeySignals?.ingress?.visitors ?? 0,
          gateEstimated: ov.ingressDirectEstimated ?? journey.journeySignals?.ingress?.gateEstimated,
          recovered: ov.ingressRecovered ?? journey.journeySignals?.ingress?.recovered ?? 0,
        },
        shopping: {
          aisleZoneVisits: a.totalAisleVisits ?? 0,
          dwellVisits: a.dwellVisits ?? 0,
          stoppingPct: a.stoppingPowerPct ?? 0,
          passThroughPct: a.passThroughPct,
          bypassPct: a.bypassPct ?? null,
        },
        checkout: {
          sessionsCompleted: completed,
          totalSessions: ch.reduce((s, c) => s + c.sessions, 0),
          avgWaitMin: journey.checkout?.avgWaitMin ?? 0,
          abandonPct: ch.length
            ? Math.round(ch.reduce((s, c) => s + c.abandonPct, 0) / ch.length * 10) / 10
            : 0,
          laneCount: ch.length,
        },
      };
      return (
        <Shell title={def.name}>
          <JourneySignalsPanel signals={signals} />
        </Shell>
      );
    }
    case 'fresco-department-cards': {
      const depts = (journey?.fresco?.departments || []).filter((d) => d.visits > 0);
      if (!depts.length) return <Empty label="No fresco counter data for this range." />;
      return (
        <Shell title={def.name}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {depts.map((d) => {
              const visual = getCategoryVisual(d.label);
              return (
                <FrescoDepartmentCard
                  key={d.id}
                  label={d.label}
                  visits={d.visits}
                  dwellVisits={d.dwellVisits}
                  episodes={d.episodes}
                  fragmentsPerEpisode={d.fragmentsPerEpisode}
                  medianDwellSec={d.medianDwellSec}
                  p75DwellSec={d.p75DwellSec}
                  dwellReliable={d.dwellReliable}
                  dwellUnavailableReason={d.dwellUnavailableReason}
                  reportable={d.reportable}
                  stoppingPct={d.stoppingPct ?? d.browsingPct}
                  passThroughPct={d.passThroughPct}
                  hasQueueZones={d.hasQueueZones}
                  waitingPct={d.waitingPct}
                  abandonPct={d.abandonPct}
                  medianEngagementSec={d.medianEngagementSec}
                  p75EngagementSec={d.p75EngagementSec}
                  engagementReliable={d.engagementReliable}
                  geometryRadii={journey?.categoryPresence}
                  color={visual.color}
                  bg={visual.bg}
                  Icon={visual.Icon}
                />
              );
            })}
          </div>
        </Shell>
      );
    }
    case 'aisle-stat-stack': {
      const a = journey?.aisles;
      if (!a) return <Empty label="No aisle stats for this range." />;
      const pass = a.passThroughPct ?? Math.max(0, Math.round((100 - (a.stoppingPowerPct ?? 0)) * 10) / 10);
      const stats = [
        ['Stopping power', `${a.stoppingPowerPct ?? 0}%`],
        a.engagementRatePct != null ? ['Engagement', `${a.engagementRatePct}%`] : null,
        ['Pass-through', `${pass}%`],
        a.penetrationPct != null ? ['Penetration', `${a.penetrationPct}%`] : null,
        a.bypassPct != null ? ['Bypass', `${a.bypassPct}%`] : null,
      ].filter(Boolean) as [string, string][];
      return (
        <Shell title={def.name}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-gray-900/50 border border-gray-700/60 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
                <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </Shell>
      );
    }
    case 'checkout-panel': {
      if (!journey?.checkout) return <Empty label="No checkout data for this range." />;
      const CHANNEL_COLORS: Record<string, string> = {
        traditional: '#38bdf8',
        self: '#a78bfa',
        express: '#34d399',
      };
      const channels = (journey.checkout.channels || []).map((ch) => ({
        ...ch,
        color: CHANNEL_COLORS[ch.id] || '#64748b',
      }));
      return (
        <Shell title={def.name}>
          <CheckoutPanel
            channels={channels}
            frictionScore={journey.checkout.frictionScore}
            showFriction
          />
        </Shell>
      );
    }
    case 'media-ring-gauges': {
      const ces = journey?.media?.ces ?? 0;
      const eal = journey?.media?.eal ?? 0;
      if (ces === 0 && eal === 0) return <Empty label="No retail media scores in this range." />;
      return (
        <Shell title={def.name}>
          <div className="flex items-center justify-around py-2">
            <RingGauge value={ces} max={100} label="CES" color="#a78bfa" size={72} />
            <RingGauge value={eal} max={100} label="EAL" color="#38bdf8" size={72} />
          </div>
        </Shell>
      );
    }
    case 'esselunga-headline-v2': {
      if (!ctx.dailyKpi) return <Empty label="daily_kpi non ancora calcolato per questo giorno." />;
      return (
        <ExecutiveHeader
          headline={buildHeadline(ctx.dailyKpi, ctx.dailyKpiRange)}
          venueName={ctx.venueName}
          rangeLabel={ctx.dailyKpi.day}
          generatedAtLabel={ctx.dailyKpi.day}
          kpis={buildHeadlineKpis(ctx.dailyKpi, ctx.dailyKpiRange)}
        />
      );
    }
    case 'store-rhythm-v2':
    case 'department-minutes':
    case 'queue-by-lane':
    case 'queue-by-slot':
    case 'first-department':
    case 'behaviour-mix':
    case 'daily-checks': {
      if (!ctx.dailyKpi) return <Empty label="daily_kpi non ancora calcolato per questo giorno." />;
      return (
        <Shell title={def.name}>
          <DailyKpiSlice widgetId={widgetId} payload={ctx.dailyKpi} />
        </Shell>
      );
    }
    default:
      return <Empty label={`Unknown widget: ${widgetId}`} />;
  }
}
