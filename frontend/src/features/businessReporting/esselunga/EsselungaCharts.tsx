import type { LucideIcon } from 'lucide-react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';
import { KpiTooltip, AnimatedValue } from './ExecutiveVisuals';
import { FRESCO_TOOLTIPS, JOURNEY_SIGNAL_TOOLTIPS } from './kpiTooltips';

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
          {max === 100 && <div className="text-[8px] text-gray-500">%</div>}
        </div>
      </div>
      <div className="text-[10px] text-gray-400 text-center">{label}</div>
      {sub && <div className="text-[9px] text-gray-600 text-center">{sub}</div>}
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
    <div className="space-y-2">
      {sorted.map(row => {
        const visual = getCategoryVisual(row.label);
        const Icon = visual.Icon;
        const w = Math.max(4, (row.value / max) * 100);
        return (
          <div key={row.label} className="group">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: visual.bg }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: visual.color }} />
                </span>
                <span className="text-xs text-gray-200 truncate font-medium">{row.label}</span>
              </div>
              <span className="text-xs text-gray-400 tabular-nums shrink-0">
                {row.value.toLocaleString()}
                {row.sub ? <span className="text-gray-600 ml-1">{row.sub}</span> : null}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-800/80 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${w}%`, backgroundColor: row.color || visual.color }}
              />
            </div>
          </div>
        );
      })}
      {sorted.length === 0 && (
        <p className="text-xs text-gray-500 py-6 text-center">No category data for this period</p>
      )}
      <p className="text-[9px] text-gray-600 text-right pt-1">Sorted by {valueLabel}</p>
    </div>
  );
}

export function formatDwellDuration(avgDwellSec?: number, avgDwellMin?: number): string {
  const sec = avgDwellSec ?? Math.round((avgDwellMin ?? 0) * 60);
  if (sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function FrescoDepartmentCard({
  label,
  visits,
  dwellVisits = 0,
  avgDwellSec = 0,
  stoppingPct = 0,
  passThroughPct = 0,
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
  avgDwellSec?: number;
  stoppingPct?: number;
  passThroughPct?: number;
  hasQueueZones?: boolean;
  waitingPct?: number;
  abandonPct?: number;
  color: string;
  bg: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
}) {
  const dwellLabel = formatDwellDuration(avgDwellSec);
  const stopPct = Math.min(100, stoppingPct);

  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: bg }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{label}</div>
          <div className="text-[10px] text-gray-500 flex items-center">
            {visits.toLocaleString()} zone crossings
            <KpiTooltip text={FRESCO_TOOLTIPS.crossings} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-white tabular-nums">{stopPct}%</div>
          <div className="text-[9px] text-gray-500 flex items-center justify-end">
            stopping
            <KpiTooltip text={FRESCO_TOOLTIPS.stopping} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
          <div className="text-base font-bold text-white tabular-nums">{dwellVisits.toLocaleString()}</div>
          <div className="text-[9px] text-gray-500 leading-tight flex items-center">
            dwell visits
            <KpiTooltip text={FRESCO_TOOLTIPS.dwellVisits} />
          </div>
        </div>
        <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
          <div className="text-base font-bold text-white tabular-nums">{dwellLabel}</div>
          <div className="text-[9px] text-gray-500 leading-tight flex items-center">
            avg dwell
            <KpiTooltip text={FRESCO_TOOLTIPS.avgDwell} />
          </div>
        </div>
        {hasQueueZones ? (
          <>
            <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
              <div className={`text-base font-bold tabular-nums ${waitingPct > 15 ? 'text-amber-400' : 'text-white'}`}>
                {waitingPct}%
              </div>
              <div className="text-[9px] text-gray-500 leading-tight flex items-center">
                in queue
                <KpiTooltip text={FRESCO_TOOLTIPS.queue} />
              </div>
            </div>
            <div className="rounded-md bg-gray-900/50 px-2.5 py-2">
              <div className={`text-base font-bold tabular-nums ${abandonPct > 10 ? 'text-amber-400' : 'text-white'}`}>
                {abandonPct}%
              </div>
              <div className="text-[9px] text-gray-500 leading-tight flex items-center">
                queue abandon
                <KpiTooltip text={FRESCO_TOOLTIPS.abandon} />
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-2 rounded-md bg-gray-900/50 px-2.5 py-2 flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-gray-300 tabular-nums">{passThroughPct}%</div>
              <div className="text-[9px] text-gray-500 flex items-center">
                pass-through
                <KpiTooltip text={FRESCO_TOOLTIPS.passThrough} />
              </div>
            </div>
          </div>
        )}
      </div>
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
        <span className="text-[10px] text-emerald-400 font-medium">{browsingPct}%</span>
        <span className="text-[8px] text-gray-600">browse</span>
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
            <span className="text-[9px] text-gray-500 text-center leading-tight">{step.label}</span>
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
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
          </div>
          <div className="text-xl font-bold text-white tabular-nums">{value}</div>
          {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
        </div>
        {delta && <span className="text-[10px] text-gray-500 shrink-0">{delta}</span>}
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
    shopping: { aisleZoneVisits: number; dwellVisits: number; stoppingPct: number; bypassPct: number };
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
        `${checkout.totalSessions.toLocaleString()} queue sessions · ${checkout.avgWaitMin}m avg wait`,
        checkout.laneCount > 0 ? `${checkout.laneCount} lanes · ${checkout.abandonPct}% abandon` : 'No lanes mapped',
      ],
      color: '#22c55e',
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-gray-500 leading-relaxed">
        Three independent LiDAR signals — not a conversion funnel. Zone visits and queue sessions
        cannot be divided by visitor count until track reconciliation.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cards.map(card => (
          <div key={card.title} className="rounded-xl border border-gray-700/60 bg-gray-800/50 p-4 h-full">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 flex items-center">
              {card.title}
              <KpiTooltip text={card.tooltip} />
            </div>
            <div className="text-2xl font-bold tabular-nums mb-2" style={{ color: card.color }}>
              {card.value}
            </div>
            {card.lines.map(line => (
              <div key={line} className="text-[10px] text-gray-500 leading-snug">{line}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CheckoutLaneCards({
  channels,
}: {
  channels: Array<{
    label: string;
    sessions: number;
    completed?: number;
    avgWaitMin: number;
    abandonPct: number;
    currentQueue: number;
    color: string;
  }>;
}) {
  if (channels.length === 0) {
    return <p className="text-xs text-gray-500 py-6 text-center">No checkout lanes detected.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {channels.map(ch => (
        <div
          key={ch.label}
          className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-sm font-semibold text-white">{ch.label}</span>
            {ch.currentQueue > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                {ch.currentQueue} in queue
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xl font-bold text-white tabular-nums">
                {(ch.completed ?? ch.sessions).toLocaleString()}
              </div>
              <div className="text-[10px] text-gray-500">completed</div>
            </div>
            <div>
              <div className="text-xl font-bold text-white tabular-nums">{ch.avgWaitMin}m</div>
              <div className="text-[10px] text-gray-500">avg wait</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-300 tabular-nums">{ch.sessions}</div>
              <div className="text-[10px] text-gray-500">sessions</div>
            </div>
            <div>
              <div className={`text-lg font-semibold tabular-nums ${ch.abandonPct > 15 ? 'text-amber-400' : 'text-gray-300'}`}>
                {ch.abandonPct}%
              </div>
              <div className="text-[10px] text-gray-500">abandon</div>
            </div>
          </div>
        </div>
      ))}
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
              <span className="text-[10px] text-gray-400 uppercase tracking-wider whitespace-nowrap">{item.label}</span>
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
            {item.sub && <div className="text-[10px] text-gray-500 mt-1 leading-snug">{item.sub}</div>}
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
      <div className="px-4 py-3 border-b border-gray-700/50">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
