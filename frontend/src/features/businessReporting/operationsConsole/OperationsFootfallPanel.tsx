import type { FootfallSummary } from './types';

interface OperationsFootfallPanelProps {
  footfall: FootfallSummary;
}

export default function OperationsFootfallPanel({ footfall }: OperationsFootfallPanelProps) {
  const maxVisits = Math.max(...footfall.visitsByHour.map(h => h.visits), 1);

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="text-xs font-semibold text-white">Footfall by Open Hour</h3>
          <p className="text-[10px] text-gray-500">
            {footfall.configured
              ? `${footfall.footfallZoneName || 'Ingress zone'} · ${footfall.hoursLabel}`
              : 'Configure footfall ROI in Venue Settings'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-emerald-400 tabular-nums">{footfall.totalVisitsOpenHours}</div>
          <div className="text-[9px] text-gray-500">open-hour visits</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 text-center">
        <div className="rounded bg-gray-900/50 py-1">
          <div className="text-[9px] text-gray-500">Avg / open hr</div>
          <div className="text-sm font-semibold text-white">{footfall.avgVisitsPerOpenHour}</div>
        </div>
        <div className="rounded bg-gray-900/50 py-1">
          <div className="text-[9px] text-gray-500">Peak hour</div>
          <div className="text-sm font-semibold text-white">
            {footfall.peakOpenHour ? `${footfall.peakOpenHour}:00` : '—'}
          </div>
        </div>
        <div className="rounded bg-gray-900/50 py-1">
          <div className="text-[9px] text-gray-500">Peak visits</div>
          <div className="text-sm font-semibold text-white">{footfall.peakOpenHourVisits || '—'}</div>
        </div>
      </div>

      <div className="flex items-end gap-0.5 h-16">
        {footfall.visitsByHour.map(row => {
          const h = Math.max((row.visits / maxVisits) * 100, row.visits > 0 ? 6 : 0);
          return (
            <div key={row.hour} className="flex-1 flex flex-col items-center justify-end group relative">
              <div
                className={`w-full rounded-t ${row.isOpen ? 'bg-emerald-500/70' : 'bg-gray-600/30'}`}
                style={{ height: `${h}%` }}
              />
              <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap">
                {row.hour}:00 · {row.visits}{!row.isOpen && ' (closed)'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[8px] text-gray-600 mt-1">
        <span>00</span>
        <span>12</span>
        <span>23</span>
      </div>
    </div>
  );
}
