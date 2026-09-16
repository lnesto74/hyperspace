import { Lightbulb, ArrowRight } from 'lucide-react';
import { MeasureChip } from './MeasureChip';
import type { DailyKpiPayload, DailyKpiRangeDay } from './types';
import {
  buildInsights,
  departmentMinutes,
  firstDepartment,
  queueBySlot,
  queueLanes,
  slotSeries,
} from './viewModel';

const INSIGHT_COLOR = {
  good: 'border-green-500/40 bg-green-500/10',
  warn: 'border-amber-500/40 bg-amber-500/10',
  bad: 'border-red-500/40 bg-red-500/10',
  info: 'border-blue-500/40 bg-blue-500/10',
};

export function DailyExecutiveSections({
  payload,
  rangeDays = [],
}: {
  payload: DailyKpiPayload;
  rangeDays?: DailyKpiRangeDay[];
}) {
  const insights = buildInsights(payload, rangeDays);
  const depts = departmentMinutes(payload);
  const first = firstDepartment(payload);
  const slots = slotSeries(payload);
  const qSlots = queueBySlot(payload);
  const lanes = queueLanes(payload).filter((l) => l.roi_group === 'CHECKOUT_QUEUE');
  const maxEnt = Math.max(1, ...slots.map((s) => s.entrances || 0));
  const maxDept = Math.max(0.01, ...depts.filter((d) => d.minutes != null).map((d) => d.minutes as number));
  const maxFirst = Math.max(0.01, ...first.map((f) => f.share || 0));
  const maxWait = Math.max(0.01, ...qSlots.map((s) => s.wait || 0), ...qSlots.map((s) => s.service || 0));

  if (typeof console !== 'undefined') {
    const pane = depts.find((d) => d.dept === 'Pane');
    if (pane?.zeroObservation) {
      console.info('[daily-kpi] Pane ha zero osservazioni raw — i crossing del report legacy sono un mismatch di tassonomia');
    }
  }

  return (
    <div className="space-y-4">
      {insights.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {insights.map((ins) => (
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

      <section className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-4">
        <h2 className="text-sm font-medium text-white mb-1">Ritmo della giornata</h2>
        <p className="text-[12px] text-gray-400 mb-3">
          Ingressi per fascia di 2 ore (MISURATO). La serie a 15 minuti e le presenze al minuto arrivano quando il job legge il parquet.
        </p>
        <div className="flex items-end gap-2 h-28">
          {slots.map((s) => (
            <div key={s.slot} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="w-full flex flex-col justify-end h-20 bg-gray-900/60 rounded">
                <div
                  className="w-full rounded-t bg-cyan-500/70"
                  style={{ height: `${Math.round(((s.entrances || 0) / maxEnt) * 100)}%` }}
                  title={`${s.slot}: ${s.entrances ?? '—'} ingressi`}
                />
              </div>
              <span className="text-[10px] text-gray-400 tabular-nums">{s.slot}</span>
              <span className="text-[10px] text-gray-300 tabular-nums">{s.entrances ?? '—'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-4">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-medium text-white">Minuti per cliente per reparto</h2>
          <MeasureChip label="ESTIMATED" method="persone-minuto nel reparto ÷ ingressi della fascia" />
        </div>
        <p className="text-[12px] text-gray-400 mb-3">
          Sostituisce Stopping power, Engagement, Pass-through, Penetration e Bypass. Corsie / fuori zona è lì dove il cliente è visibile ma fuori dai ROI.
        </p>
        <div className="space-y-1.5">
          {depts.map((d) => (
            <div key={d.dept} className="flex items-center gap-2 text-xs">
              <span className="w-44 shrink-0 text-gray-300 truncate">{d.dept}</span>
              {d.zeroObservation ? (
                <span className="text-amber-300/90">nessuna osservazione — da verificare</span>
              ) : d.status === 'unreliable' ? (
                <span className="text-gray-500" title={d.statusReason || undefined}>—</span>
              ) : (
                <>
                  <div className="flex-1 h-2 bg-gray-900 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${d.dept === 'Corsie / fuori zona' ? 'bg-violet-400' : 'bg-sky-400'}`}
                      style={{ width: `${Math.round(((d.minutes || 0) / maxDept) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right tabular-nums text-gray-200">{d.minutes?.toFixed(2)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-4">
        <h2 className="text-sm font-medium text-white mb-3">Primo reparto dopo l’ingresso</h2>
        <div className="space-y-1.5">
          {first.map((f) => (
            <div key={f.dst} className="flex items-center gap-2 text-xs">
              <span className="w-44 shrink-0 text-gray-300 truncate">{f.dst}</span>
              <div className="flex-1 h-2 bg-gray-900 rounded overflow-hidden">
                <div className="h-full rounded bg-emerald-400" style={{ width: `${Math.round((f.share / maxFirst) * 100)}%` }} />
              </div>
              <span className="w-14 text-right tabular-nums text-gray-200">{Math.round(f.share * 100)}%</span>
            </div>
          ))}
          {first.length === 0 && <p className="text-xs text-gray-500">Nessuna transizione misurata.</p>}
        </div>
      </section>

      <section className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-4">
        <h2 className="text-sm font-medium text-white mb-1">Piazza del Fresco</h2>
        <p className="text-[12px] text-gray-400 mb-3">
          Solo minuti per cliente (niente crossing / stop / category dwell / engagement per-track).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="py-1 font-medium">Reparto</th>
                <th className="py-1 font-medium">Minuti / cliente</th>
                <th className="py-1 font-medium">Indice di scelta</th>
              </tr>
            </thead>
            <tbody>
              {depts.filter((d) => !['Ingresso', 'Corsie / fuori zona', 'Coda cassa', 'Cassa (servizio)', 'Scaffali senza categoria'].includes(d.dept)).map((d) => (
                <tr key={d.dept} className="border-t border-gray-800">
                  <td className="py-1.5 text-gray-200">{d.dept}</td>
                  <td className="py-1.5 tabular-nums text-gray-300">
                    {d.zeroObservation ? 'nessuna osservazione — da verificare' : (d.minutes?.toFixed(2) ?? '—')}
                  </td>
                  <td className="py-1.5 text-gray-500">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-4">
        <h2 className="text-sm font-medium text-white mb-3">Casse — attesa vs servizio per fascia</h2>
        <div className="flex items-end gap-2 h-28 mb-4">
          {qSlots.map((s) => (
            <div key={s.slot} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full h-20 flex items-end gap-0.5">
                <div className="flex-1 bg-amber-400/80 rounded-t" style={{ height: `${Math.round(((s.wait || 0) / maxWait) * 100)}%` }} title={`coda ${s.wait ?? '—'}`} />
                <div className="flex-1 bg-sky-400/70 rounded-t" style={{ height: `${Math.round(((s.service || 0) / maxWait) * 100)}%` }} title={`servizio ${s.service ?? '—'}`} />
              </div>
              <span className="text-[10px] text-gray-400">{s.slot}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mb-2">Ambra = attesa in coda / cliente · azzurro = servizio / cliente</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 text-left">
              <th className="py-1 font-medium">Cassa</th>
              <th className="py-1 font-medium">WAITING min</th>
              <th className="py-1 font-medium">Persone in media</th>
              <th className="py-1 font-medium">Transit</th>
              <th className="py-1 font-medium">Fixed</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((l) => (
              <tr key={String(l.lane)} className="border-t border-gray-800 text-gray-300">
                <td className="py-1.5">Cassa {String(l.lane)}</td>
                <td className="py-1.5 tabular-nums">{Number(l.WAITING || 0).toFixed(1)}</td>
                <td className="py-1.5 tabular-nums">{l.mean_people_waiting ?? '—'}</td>
                <td className="py-1.5 tabular-nums">{Number(l.TRANSIT || 0).toFixed(1)}</td>
                <td className="py-1.5 tabular-nums">{Number(l.FIXED || 0).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
