import { useMemo } from 'react';
import type { DailyKpiPayload, DailyKpiRangeDay, KpiLabel } from '../dailyKpi/types';
import { buildExecutiveCanvas, type PulseMetric, type TimeBucket } from './canvasModel';
import './executiveCanvas.css';

export type CanvasDetail = 'journey' | 'departments' | 'checkout' | 'audit' | 'heatmap';

const NAV: Array<{ id: string; label: string; detail: CanvasDetail | null }> = [
  { id: 'overview', label: 'Overview', detail: null },
  { id: 'journey', label: 'Journey', detail: 'journey' },
  { id: 'departments', label: 'Departments', detail: 'departments' },
  { id: 'checkout', label: 'Checkout', detail: 'checkout' },
  { id: 'insights', label: 'Insights', detail: 'journey' },
];

function MeasureDot({ measure, method }: { measure: KpiLabel | null; method?: string }) {
  if (measure === 'MEASURED') {
    return <span className="text-[10px] text-emerald-400" title={method || 'Seen by the sensors'}>●</span>;
  }
  if (measure === 'ESTIMATED') {
    return <span className="text-[10px] text-violet-300" title={method || 'Derived from measured totals'}>◐</span>;
  }
  return null;
}

function Explore({ onClick, children }: { onClick?: () => void; children: string }) {
  if (!onClick) return null;
  return (
    <button type="button" onClick={onClick} className="text-[12px] text-cyan-300 hover:text-cyan-200">
      {children}
    </button>
  );
}

function Pulse({ items }: { items: PulseMetric[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
      {items.map((m) => (
        <div key={m.id} className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="ex-kicker">{m.label}</span>
            <MeasureDot measure={m.measure} method={m.method} />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[36px] leading-none font-semibold text-white tabular-nums">{m.display}</span>
            {m.unit && <span className="text-[13px] text-gray-400">{m.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Allocation({ buckets, visitMin }: { buckets: TimeBucket[]; visitMin: number | null }) {
  const max = Math.max(0.01, ...buckets.map((b) => b.minutes));
  return (
    <div className="space-y-3">
      {buckets.map((b) => (
        <div key={b.id}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-[12px] uppercase tracking-wider text-gray-400">{b.label}</span>
            <span className="text-[13px] tabular-nums text-gray-200">{b.minutes.toLocaleString('it-IT', { maximumFractionDigits: 2 })} min</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${b.id === 'aisles' ? 'bg-cyan-400' : b.id === 'fresh' ? 'bg-emerald-400/80' : b.id === 'checkout' ? 'bg-amber-400/80' : 'bg-gray-500'}`}
              style={{ width: `${Math.round((b.minutes / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      {visitMin != null && (
        <p className="text-[11px] text-gray-500">Shares of the {visitMin.toLocaleString('it-IT', { maximumFractionDigits: 1 })}-minute journey. Unmapped aisle time is measured presence outside department ROIs.</p>
      )}
    </div>
  );
}

function FlowChart({
  flow,
  peakSlot,
}: {
  flow: Array<{ slot: string; entrances: number | null }>;
  peakSlot: string | null;
}) {
  const vals = flow.map((f) => f.entrances || 0);
  const max = Math.max(1, ...vals);
  const W = 360, H = 120, L = 8, R = 8, T = 16, B = 22;
  const n = flow.length;
  const x = (i: number) => L + (i / Math.max(n - 1, 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const d = flow.map((f, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(f.entrances || 0).toFixed(1)}`).join(' ');
  const area = `${d} L${x(n - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[120px]" role="img">
      <path d={area} fill="rgba(34,211,238,0.10)" />
      <path d={d} fill="none" stroke="#22d3ee" strokeWidth="2" />
      {flow.map((f, i) => (
        <g key={f.slot}>
          <circle cx={x(i)} cy={y(f.entrances || 0)} r={f.slot === peakSlot ? 4 : 3} fill="#22d3ee" />
          <text x={x(i)} y={H - 4} textAnchor="middle" fill="#9ca3af" fontSize="11">{f.slot}</text>
        </g>
      ))}
    </svg>
  );
}

function WaitSpark({ slots, peak }: { slots: Array<{ slot: string; wait: number | null }>; peak: string | null }) {
  const max = Math.max(0.01, ...slots.map((s) => s.wait || 0));
  return (
    <div className="flex items-end gap-1.5 h-16">
      {slots.map((s) => (
        <div key={s.slot} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${s.slot}: ${s.wait ?? '—'} min`}>
          <div
            className={`w-full rounded-sm ${s.slot === peak ? 'bg-amber-400' : 'bg-cyan-500/50'}`}
            style={{ height: `${Math.max(6, Math.round(((s.wait || 0) / max) * 100))}%` }}
          />
          <span className="text-[10px] text-gray-500 tabular-nums">{s.slot}</span>
        </div>
      ))}
    </div>
  );
}

export default function ExecutiveCanvas({
  payload,
  rangeDays = [],
  venueName,
  liveCount,
  onOpenDetail,
}: {
  payload: DailyKpiPayload;
  rangeDays?: DailyKpiRangeDay[];
  venueName: string;
  liveCount?: number | null;
  onOpenDetail?: (target: CanvasDetail) => void;
}) {
  const model = useMemo(
    () => buildExecutiveCanvas(payload, rangeDays, venueName),
    [payload, rangeDays, venueName],
  );

  return (
    <div className="ex-canvas space-y-8 pb-4" data-testid="executive-canvas">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">{model.venueName}</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">
            Store performance · {model.dayLabel}
            {liveCount != null && <span className="text-cyan-300"> · {liveCount} in store now</span>}
          </p>
        </div>
        <nav className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-current={n.detail == null ? 'page' : undefined}
              onClick={() => {
                if (n.detail && onOpenDetail) onOpenDetail(n.detail);
              }}
              className={`px-2.5 py-1 text-[11px] uppercase tracking-wider rounded-md ${
                n.detail == null
                  ? 'text-white bg-gray-800'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </div>

      <section id="ex-pulse">
        <Pulse items={model.pulse} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,0.9fr)]">
        <section id="ex-journey">
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-medium text-white">Customer journey</h2>
              <p className="text-[13px] text-gray-400 mt-0.5">From entrance to checkout — where customers go and how long they stay.</p>
            </div>
            <Explore onClick={onOpenDetail ? () => onOpenDetail('journey') : undefined}>Explore full journey →</Explore>
          </div>
          <button
            type="button"
            className="ex-ribbon text-left w-full"
            onClick={onOpenDetail ? () => onOpenDetail('journey') : undefined}
          >
            <div className="ex-track" aria-hidden />
            {model.journey.map((st) => (
              <div key={st.id} className="ex-stage">
                <div className="ex-node" aria-hidden />
                <div className="ex-kicker mb-2">{st.label}</div>
                <div className="text-[26px] font-semibold text-white tabular-nums leading-none">{st.primary}</div>
                {st.secondary && <p className="text-[12px] text-gray-400 mt-1.5 leading-snug">{st.secondary}</p>}
              </div>
            ))}
          </button>
        </section>

        <section id="ex-signals">
          <h2 className="text-base font-medium text-white mb-4">Today&apos;s signals</h2>
          <ol className="space-y-4">
            {model.signals.map((s, i) => (
              <li key={s.id} className="flex gap-3">
                <span className={`text-[11px] tabular-nums mt-0.5 ${
                  s.kind === 'attention' ? 'text-amber-300' : s.kind === 'positive' ? 'text-emerald-300' : 'text-cyan-300'
                }`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <p className="text-[13px] text-white font-medium leading-snug">{s.title}</p>
                  <p className="text-[12px] text-gray-400 mt-0.5 leading-snug">{s.body}</p>
                </div>
              </li>
            ))}
            {model.signals.length === 0 && (
              <p className="text-[13px] text-gray-500">No standout signals for this day.</p>
            )}
          </ol>
        </section>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <section id="ex-allocation">
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-medium text-white">Time allocation</h2>
              <p className="text-[13px] text-gray-400 mt-0.5">
                How the customer spends the {model.visitMin != null ? `${model.visitMin.toLocaleString('it-IT', { maximumFractionDigits: 1 })}-minute` : ''} journey.
              </p>
            </div>
            <Explore onClick={onOpenDetail ? () => onOpenDetail('departments') : undefined}>Explore departments →</Explore>
          </div>
          <Allocation buckets={model.allocation} visitMin={model.visitMin} />
        </section>

        <section id="ex-flow">
          <h2 className="text-base font-medium text-white mb-1">Customer flow through the day</h2>
          <p className="text-[13px] text-gray-400 mb-3">08:00 → 20:00{model.peakSlot ? ` · peak ${model.peakSlot}` : ''}</p>
          <FlowChart flow={model.flow} peakSlot={model.peakSlot} />
        </section>

        <section id="ex-checkout">
          <div className="flex items-end justify-between gap-3 mb-3">
            <h2 className="text-base font-medium text-white">Checkout performance</h2>
            <Explore onClick={onOpenDetail ? () => onOpenDetail('checkout') : undefined}>Explore checkout →</Explore>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[28px] font-semibold text-white tabular-nums leading-none">{model.checkout.waitDisplay}</span>
            <span className="text-[12px] text-gray-400">min average wait</span>
          </div>
          {model.checkout.healthy != null && (
            <p className={`text-[12px] mb-3 ${model.checkout.healthy ? 'text-emerald-300' : 'text-amber-300'}`}>
              {model.checkout.healthy ? 'Status healthy' : 'Status watch'}
              {model.checkout.peakSlot ? ` · peak ${model.checkout.peakSlot}` : ''}
            </p>
          )}
          <WaitSpark slots={model.checkout.slots} peak={model.checkout.peakSlot} />
          {model.checkout.busiest.length > 0 && (
            <p className="text-[12px] text-gray-400 mt-3">Busiest checkouts {model.checkout.busiest.join(' · ')}</p>
          )}
        </section>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-800">
        <button
          type="button"
          onClick={onOpenDetail ? () => onOpenDetail('heatmap') : undefined}
          className="text-[13px] text-gray-300 hover:text-white"
        >
          Store flow — open the live floorplan
        </button>
        <button
          type="button"
          onClick={onOpenDetail ? () => onOpenDetail('audit') : undefined}
          className="text-[12px] text-gray-500 hover:text-gray-300"
        >
          Data quality · View methodology
        </button>
      </section>
    </div>
  );
}
