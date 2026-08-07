import type { LucideIcon } from 'lucide-react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';
import { KpiTooltip, AnimatedValue } from './ExecutiveVisuals';
import { FRESCO_TOOLTIPS, JOURNEY_SIGNAL_TOOLTIPS } from './kpiTooltips';
import { formatDwellDuration } from './formatDuration';

export { formatDwellDuration };

export interface BarRow {
  label: string;
  value: number;
  sub?: string;
  color?: string;
}

interface RingGaugeProps {
  value: number;
  max?: number;
  label: string;
  sub?: string;
  color?: string;
  size?: number;
}

export function RingGauge({ value, max = 100, label, sub, color = '#38bdf8', size = 72 }: RingGaugeProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const display = typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : String(value);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-sm font-semibold text-white tabular-nums">{display}</div>
          {max === 100 && <div className="text-[10px] text-gray-400">%</div>}
        </div>
      </div>
      <div className="text-xs text-gray-400 text-center">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 text-center">{sub}</div>}
    </div>
  );
}

export function HorizontalBarChart({
  rows,
  valueLabel = 'visits',
  maxBars = 12,
}: {
  rows: BarRow[];
  valueLabel?: string;
  maxBars?: number;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, maxBars);
  const max = Math.max(...sorted.map(r => r.value), 1);

  return (
    <div className="space-y-3.5">
      {sorted.map(row => {
        const visual = getCategoryVisual(row.label);
        const Icon = visual.Icon;
        const w = Math.max(4, (row.value / max) * 100);
        return (
          <div key={row.label} className="group">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: visual.bg }}
                >
                  <Icon className="w-4 h-4" style={{ color: visual.color }} />
                </span>
                <span className="text-sm text-gray-100 truncate font-medium">{row.label}</span>
              </div>
              <span className="text-sm text-gray-200 tabular-nums shrink-0 font-medium">
                {row.value.toLocaleString()}
                {row.sub ? <span className="text-gray-400 ml-2 font-normal">{row.sub}</span> : null}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-800/80 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${w}%`, backgroundColor: row.color || visual.color }}
              />
            </div>
          </div>
        );
      })}
      {sorted.length === 0 && (
        <p className="text-xs text-gray-400 py-6 text-center">No category data for this period</p>
      )}
      <p className="text-[11px] text-gray-400 text-right pt-1">Sorted by {valueLabel}</p>
    </div>
  );
}

export function FrescoDepartmentCard({
  label,
  visits,
  dwellVisits = 0,
  episodes = 0,
  fragmentsPerEpisode = 0,
  medianDwellSec = null,
  p75DwellSec = null,
  dwellReliable = false,
  dwellUnavailableReason = null,
  reportable = true,
  stoppingPct = null,
  passThroughPct = null,
  hasQueueZones = false,
  waitingPct = 0,
  abandonPct = 0,
  color,
  bg,
  Icon,
}: {
  label: string;
  visits: number;
  dwellVisits?: number;
  episodes?: number;
  fragmentsPerEpisode?: number;
  medianDwellSec?: number | null;
  p75DwellSec?: number | null;
  dwellReliable?: boolean;
  dwellUnavailableReason?: string | null;
  reportable?: boolean;
  stoppingPct?: number | null;
  passThroughPct?: number | null;
  hasQueueZones?: boolean;
  waitingPct?: number;
  abandonPct?: number;
  color: string;
  bg: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
}) {
  // Typical-to-long rather than a single figure: the spread is the honest part.
  // A lone number here reads as a measurement when it is an estimate rebuilt
  // from fragments, and four counters printing the same one is what made the
  // old card look precise and be wrong.
  const dwellLabel = dwellReliable && medianDwellSec != null
    ? (p75DwellSec != null && p75DwellSec > medianDwellSec
      ? `${formatDwellDuration(medianDwellSec)}–${formatDwellDuration(p75DwellSec)}`
      : formatDwellDuration(medianDwellSec))
    : '—';
  const stopPct = stoppingPct == null ? null : Math.min(100, stoppingPct);

  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: bg }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{label}</div>
          <div className="text-xs text-gray-400 flex items-center">
            {visits.toLocaleString()} zone crossings
            <KpiTooltip text={FRESCO_TOOLTIPS.crossings} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-white tabular-nums">
            {stopPct == null ? '—' : `${stopPct}%`}
          </div>
          <div className="text-[11px] text-gray-400 flex items-center justify-end">
            stopping
            <KpiTooltip text={FRESCO_TOOLTIPS.stopping} />
          </div>
        </div>
      </div>

      {!reportable && (
        <p className="text-[11px] text-amber-400/90 leading-snug">
          Too few crossings to report. Either the counter is not mapped to a zone or the
          sensors do not cover it — not a counter nobody visits.
        </p>
      )}
      {reportable && !dwellReliable && dwellUnavailableReason === 'quantised_durations' && (
        <p className="text-[11px] text-amber-400/90 leading-snug">
          Dwell not shown: this period reaches back before 6 Aug 2026, when zone durations
          were recorded in whole 5-second steps. Every counter would read the same 15s.
          Stopping rate is unaffected.
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
          <div className="text-base font-bold text-white tabular-nums">
            {reportable ? dwellVisits.toLocaleString() : '—'}
          </div>
          <div className="text-[11px] text-gray-400 leading-tight flex items-center">
            stops
            <KpiTooltip text={FRESCO_TOOLTIPS.dwellVisits} />
          </div>
        </div>
        <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
          <div className="text-base font-bold text-white tabular-nums">{dwellLabel}</div>
          <div className="text-[11px] text-gray-400 leading-tight flex items-center">
            typical dwell
            <KpiTooltip text={FRESCO_TOOLTIPS.avgDwell} />
          </div>
        </div>
        {hasQueueZones ? (
          <>
            <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
              <div className={`text-base font-bold tabular-nums ${waitingPct > 15 ? 'text-amber-400' : 'text-white'}`}>
                {waitingPct}%
              </div>
              <div className="text-[11px] text-gray-400 leading-tight flex items-center">
                in queue
                <KpiTooltip text={FRESCO_TOOLTIPS.queue} />
              </div>
            </div>
            <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
              <div className={`text-base font-bold tabular-nums ${abandonPct > 10 ? 'text-amber-400' : 'text-white'}`}>
                {abandonPct}%
              </div>
              <div className="text-[11px] text-gray-400 leading-tight flex items-center">
                queue abandon
                <KpiTooltip text={FRESCO_TOOLTIPS.abandon} />
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-2 rounded-md bg-gray-900/50 px-2.5 py-2 flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-gray-300 tabular-nums">
                {passThroughPct == null ? '—' : `${passThroughPct}%`}
              </div>
              <div className="text-[11px] text-gray-400 flex items-center">
                pass-through
                <KpiTooltip text={FRESCO_TOOLTIPS.passThrough} />
              </div>
            </div>
          </div>
        )}
      </div>

      {reportable && episodes > 0 && (
        <p className="text-[10px] text-gray-500 leading-snug flex items-center">
          {episodes.toLocaleString()} visits rebuilt from {fragmentsPerEpisode.toFixed(1)} tracker
          fragments each
          <KpiTooltip text={FRESCO_TOOLTIPS.episodes} />
        </p>
      )}
    </div>
  );
}

export function DonutSplit({
  browsingPct,
  waitingPct,
  size = 88,
}: {
  browsingPct: number;
  waitingPct: number;
  size?: number;
}) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const browseLen = (browsingPct / 100) * c;
  const waitLen = (waitingPct / 100) * c;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#34d399"
          strokeWidth={10}
          strokeDasharray={`${browseLen} ${c - browseLen}`}
          strokeLinecap="butt"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={10}
          strokeDasharray={`${waitLen} ${c - waitLen}`}
          strokeDashoffset={-browseLen}
          strokeLinecap="butt"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-xs text-emerald-400 font-medium">{browsingPct}%</span>
        <span className="text-[10px] text-gray-400">browse</span>
      </div>
    </div>
  );
}

export function JourneyFunnel({
  steps,
}: {
  steps: Array<{ label: string; value: number; color: string }>;
}) {
  const max = Math.max(...steps.map(s => s.value), 1);
  return (
    <div className="flex items-end justify-between gap-2 h-32 px-1">
      {steps.map((step, i) => {
        const h = Math.max(12, (step.value / max) * 100);
        return (
          <div key={step.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className="text-xs font-semibold text-white tabular-nums">{step.value.toLocaleString()}</span>
            <div
              className="w-full rounded-t-md transition-all"
              style={{ height: `${h}%`, backgroundColor: step.color, opacity: 0.85 - i * 0.08 }}
            />
            <span className="text-[11px] text-gray-400 text-center leading-tight">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  accent = '#38bdf8',
  delta,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  delta?: string;
}) {
  return (
    <div
      className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-3 relative overflow-hidden"
    >
      <div className="flex items-start justify-between gap-2 relative">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
            <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
          </div>
          <div className="text-xl font-bold text-white tabular-nums">{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
        {delta && <span className="text-xs text-gray-400 shrink-0">{delta}</span>}
      </div>
    </div>
  );
}

export function JourneySignalsPanel({
  signals,
}: {
  signals: {
    reconciliationRequired?: boolean;
    ingress: { visitors: number; gateEstimated?: number; recovered: number };
    shopping: {
      aisleZoneVisits: number;
      dwellVisits: number;
      stoppingPct: number;
      passThroughPct?: number;
      bypassPct: number | null;
    };
    checkout: { sessionsCompleted: number; totalSessions: number; avgWaitMin: number; abandonPct: number; laneCount: number };
  };
}) {
  const { ingress, shopping, checkout } = signals;

  const cards = [
    {
      title: 'Entrants',
      tooltip: JOURNEY_SIGNAL_TOOLTIPS.Entrants,
      value: ingress.visitors.toLocaleString(),
      lines: [
        ingress.recovered > 0
          ? `${ingress.gateEstimated ?? '—'} at gate · ${ingress.recovered} recovered`
          : 'Entrants at entrance gate',
        'Estimated unique visitors',
      ],
      color: '#3b82f6',
    },
    {
      title: 'Shelf engagement',
      tooltip: JOURNEY_SIGNAL_TOOLTIPS['Shelf engagement'],
      value: `${shopping.stoppingPct}%`,
      lines: [
        `${shopping.dwellVisits.toLocaleString()} dwells of ${shopping.aisleZoneVisits.toLocaleString()} aisle crossings`,
        'Stopping rate — not linked to visitor count',
      ],
      color: '#f59e0b',
    },
    {
      title: 'Checkout',
      tooltip: JOURNEY_SIGNAL_TOOLTIPS.Checkout,
      value: checkout.sessionsCompleted.toLocaleString(),
      lines: [
        `${checkout.totalSessions.toLocaleString()} queue sessions · ${formatDwellDuration(undefined, checkout.avgWaitMin)} avg wait`,
        checkout.laneCount > 0 ? `${checkout.laneCount} lanes · ${checkout.abandonPct}% abandon` : 'No lanes mapped',
      ],
      color: '#22c55e',
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">
        Three independent LiDAR signals — not a conversion funnel. Zone visits and queue sessions
        cannot be divided by visitor count until track reconciliation.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cards.map(card => (
          <div key={card.title} className="rounded-xl border border-gray-700/60 bg-gray-800/50 p-4 h-full">
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1 flex items-center">
              {card.title}
              <KpiTooltip text={card.tooltip} />
            </div>
            <div className="text-2xl font-bold tabular-nums mb-2" style={{ color: card.color }}>
              {card.value}
            </div>
            {card.lines.map(line => (
              <div key={line} className="text-xs text-gray-400 leading-snug">{line}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface CheckoutLaneView {
  id: string;
  label: string;
  sessions: number;
  completed?: number;
  avgWaitMin: number;
  avgWaitSec?: number;
  abandonPct: number;
  currentQueue: number;
}

interface CheckoutChannelView extends CheckoutLaneView {
  color: string;
  lanes?: CheckoutLaneView[];
}

const waitSec = (l: CheckoutLaneView) => l.avgWaitSec ?? Math.round((l.avgWaitMin || 0) * 60);

/**
 * Load across the tills of one channel. A single card per channel hides the
 * question anyone standing in the store actually asks — which till is the
 * queue forming at — even though every lane is measured separately.
 */
function LaneLoadChart({ lanes }: { lanes: CheckoutLaneView[] }) {
  const max = Math.max(...lanes.map(l => l.sessions), 1);
  const slowest = lanes.reduce((a, b) => (waitSec(b) > waitSec(a) ? b : a), lanes[0]);

  return (
    <div>
      <div className="flex items-end gap-1 h-24">
        {lanes.map(lane => {
          const hot = lane.id === slowest.id && waitSec(slowest) > 0;
          return (
            <div
              key={lane.id}
              className="flex-1 flex flex-col justify-end min-w-0"
              title={`${lane.label} · ${lane.sessions.toLocaleString()} shoppers · ${formatDwellDuration(lane.avgWaitSec, lane.avgWaitMin)} wait`}
            >
              <div
                className={`w-full rounded-t transition-colors ${hot ? 'bg-amber-400/80' : 'bg-cyan-500/60'}`}
                style={{ height: `${Math.max(3, (lane.sessions / max) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1.5">
        {lanes.map(lane => (
          <div key={lane.id} className="flex-1 min-w-0 text-center">
            <span className="text-[11px] text-gray-400 tabular-nums">
              {lane.label.replace('#', '')}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        Lane number · shoppers who joined that queue. Amber is the longest average wait.
      </p>
    </div>
  );
}

export function CheckoutPanel({
  channels,
  frictionScore,
  showFriction,
}: {
  channels: CheckoutChannelView[];
  frictionScore?: number | null;
  showFriction?: boolean;
}) {
  if (channels.length === 0) {
    return <p className="text-xs text-gray-400 py-6 text-center">No checkout lanes detected.</p>;
  }

  return (
    <div className="space-y-4">
      {channels.map(ch => {
        const lanes = ch.lanes ?? [];
        const slowest = lanes.length
          ? lanes.reduce((a, b) => (waitSec(b) > waitSec(a) ? b : a), lanes[0])
          : null;
        const byWait = [...lanes].sort((a, b) => waitSec(b) - waitSec(a)).slice(0, 5);

        return (
          <div key={ch.id} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <span className="text-base font-semibold text-white">{ch.label}</span>
                {lanes.length > 0 && (
                  <span className="text-xs text-gray-400 ml-2">
                    {lanes.length} {lanes.length === 1 ? 'lane' : 'lanes'} mapped
                  </span>
                )}
              </div>
              {ch.currentQueue > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                  {ch.currentQueue} in queue now
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-4">
              <Stat value={(ch.completed ?? ch.sessions).toLocaleString()} label="completed" />
              <Stat value={formatDwellDuration(ch.avgWaitSec, ch.avgWaitMin)} label="avg wait" />
              <Stat
                value={`${ch.abandonPct}%`}
                label="abandon"
                tone={ch.abandonPct > 15 ? 'warn' : undefined}
              />
              {showFriction && frictionScore != null && (
                <Stat value={String(frictionScore)} label="friction" />
              )}
              {slowest && waitSec(slowest) > 0 && (
                <Stat
                  value={formatDwellDuration(slowest.avgWaitSec, slowest.avgWaitMin)}
                  label={`worst lane (${slowest.label})`}
                  tone="warn"
                />
              )}
            </div>

            {lanes.length > 1 && (
              <>
                <div className="h-px bg-gray-700/50 my-4" />
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-8">
                    <h4 className="text-[13px] font-medium text-gray-200 mb-2">
                      Shoppers queued per lane
                    </h4>
                    <LaneLoadChart lanes={lanes} />
                  </div>
                  <div className="lg:col-span-4">
                    <h4 className="text-[13px] font-medium text-gray-200 mb-2">Longest waits</h4>
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-700/50">
                          <th className="text-left font-normal pb-1.5">Lane</th>
                          <th className="text-right font-normal pb-1.5">Shoppers</th>
                          <th className="text-right font-normal pb-1.5">Wait</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byWait.map(lane => (
                          <tr key={lane.id} className="border-b border-gray-800/60 last:border-0">
                            <td className="py-2 text-gray-200">{lane.label}</td>
                            <td className="py-2 text-right text-gray-300 tabular-nums">
                              {lane.sessions.toLocaleString()}
                            </td>
                            <td className="py-2 text-right text-white tabular-nums">
                              {formatDwellDuration(lane.avgWaitSec, lane.avgWaitMin)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'warn' }) {
  return (
    <div className="min-w-0">
      <div className={`text-xl font-bold tabular-nums ${tone === 'warn' ? 'text-amber-400' : 'text-white'}`}>
        {value}
      </div>
      <div className="text-xs text-gray-400 truncate">{label}</div>
    </div>
  );
}

export function HeroKpiStrip({
  items,
}: {
  items: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
    numericValue?: number;
    sub?: string;
    accent: string;
    tooltip?: string;
    live?: boolean;
  }>;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto overflow-y-visible pb-1 -mx-1 px-1 snap-x snap-mandatory">
      {items.map(item => {
        const Icon = item.icon;
        const tip = item.tooltip;
        return (
          <div
            key={item.label}
            className="snap-start shrink-0 min-w-[150px] sm:min-w-[172px] flex-1 rounded-xl border border-gray-700/60 bg-gray-800/50 p-3 flex flex-col"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: item.accent }} />
              <span className="text-xs text-gray-400 uppercase tracking-wider whitespace-nowrap">{item.label}</span>
              {item.live && (
                <span className="relative flex h-1.5 w-1.5 ml-auto">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ backgroundColor: item.accent }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: item.accent }} />
                </span>
              )}
              {tip && <KpiTooltip text={tip} />}
            </div>
            <div className="text-xl font-bold text-white">
              {item.live && item.numericValue != null ? (
                <AnimatedValue value={item.numericValue} className="text-xl font-bold text-white" />
              ) : (
                <span className="tabular-nums">{item.value}</span>
              )}
            </div>
            {item.sub && <div className="text-xs text-gray-400 mt-1 leading-snug">{item.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  children,
  id,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-xl border border-gray-700/60 bg-gray-800/30 overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-700/50">
        <h2 className="text-lg font-semibold text-white tracking-tight">{title}</h2>
        {subtitle && <p className="text-[13px] text-gray-400 mt-1.5 leading-relaxed max-w-3xl">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}
