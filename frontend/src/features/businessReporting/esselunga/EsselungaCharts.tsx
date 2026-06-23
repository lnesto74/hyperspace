import type { LucideIcon } from 'lucide-react';
import { getCategoryVisual } from '../operationsConsole/categoryVisuals';

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
      className="rounded-xl border border-gray-700/60 bg-gradient-to-br from-gray-800/80 to-gray-900/40 p-3 relative overflow-hidden"
      style={{ borderTopColor: accent, borderTopWidth: 2 }}
    >
      <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 blur-2xl" style={{ backgroundColor: accent }} />
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

export function ChannelCompareChart({
  channels,
}: {
  channels: Array<{ label: string; sessions: number; avgWaitMin: number; abandonPct: number; color: string }>;
}) {
  const maxSessions = Math.max(...channels.map(c => c.sessions), 1);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {channels.map(ch => (
        <div key={ch.label} className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-3">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ch.color }} />
            <span className="text-sm font-medium text-white">{ch.label}</span>
          </div>
          <div className="h-16 flex items-end gap-1 mb-3">
            <div
              className="flex-1 rounded-t-md"
              style={{
                height: `${Math.max(8, (ch.sessions / maxSessions) * 100)}%`,
                backgroundColor: ch.color,
                opacity: 0.7,
              }}
            />
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div>
              <div className="text-sm font-semibold text-white">{ch.sessions}</div>
              <div className="text-[8px] text-gray-500">sessions</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{ch.avgWaitMin}m</div>
              <div className="text-[8px] text-gray-500">wait</div>
            </div>
            <div>
              <div className={`text-sm font-semibold ${ch.abandonPct > 15 ? 'text-amber-400' : 'text-white'}`}>
                {ch.abandonPct}%
              </div>
              <div className="text-[8px] text-gray-500">abandon</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
