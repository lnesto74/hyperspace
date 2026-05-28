import { useState } from 'react';
import type { FootfallSummary, StoreActivityHourRow } from './types';

interface OperationsFootfallPanelProps {
  footfall: FootfallSummary;
  storeActivityByHour?: StoreActivityHourRow[];
}

const CHART_H = 80;

export default function OperationsFootfallPanel({
  footfall,
  storeActivityByHour = [],
}: OperationsFootfallPanelProps) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const useFootfall = footfall.ingressRecording && footfall.visitsByHour.some(h => h.visits > 0);
  const rows = useFootfall
    ? footfall.visitsByHour.map(h => ({ hour: h.hour, value: h.visits, isOpen: h.isOpen }))
    : storeActivityByHour.map(h => ({ hour: h.hour, value: h.avgOccupancy, isOpen: h.isOpen }));

  const maxVal = Math.max(...rows.map(r => r.value), 0.1);
  const peakRow = rows.reduce((best, r) => (r.value > (best?.value || 0) ? r : best), rows[0]);
  const hoveredRow = hoveredHour != null ? rows.find(r => r.hour === hoveredHour) : null;

  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="text-xs font-semibold text-white">
            {useFootfall ? 'Footfall by Open Hour' : 'Store Activity by Hour'}
          </h3>
          <p className="text-[10px] text-gray-500">
            {useFootfall
              ? `${footfall.footfallZoneName || 'Ingress'} · ${footfall.hoursLabel}`
              : 'Peak concurrent shoppers by hour (until ingress zone records visits)'}
          </p>
          {!useFootfall && footfall.warning && (
            <p className="text-[10px] text-gray-400 mt-1 line-clamp-2">{footfall.warning}</p>
          )}
        </div>
        {useFootfall ? (
          <div className="text-right">
            <div className="text-lg font-bold text-white tabular-nums">{footfall.totalVisitsOpenHours}</div>
            <div className="text-[9px] text-gray-500">open-hour visits</div>
          </div>
        ) : peakRow && peakRow.value > 0 ? (
          <div className="text-right">
            <div className="text-lg font-bold text-white tabular-nums">{Math.round(peakRow.value * 10) / 10}</div>
            <div className="text-[9px] text-gray-500">peak at {peakRow.hour}:00</div>
          </div>
        ) : null}
      </div>

      <div
        className="relative"
        onMouseLeave={() => setHoveredHour(null)}
      >
        {hoveredRow && hoveredHour != null && (
          <div
            className="absolute z-20 pointer-events-none bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap shadow-lg"
            style={{
              left: `${((hoveredHour + 0.5) / 24) * 100}%`,
              transform: 'translateX(-50%)',
              bottom: CHART_H + 4,
            }}
          >
            {hoveredRow.hour}:00 · {useFootfall ? `${hoveredRow.value} visits` : `${hoveredRow.value} peak`}
            {!hoveredRow.isOpen && ' (closed)'}
          </div>
        )}

        <div className="flex items-end gap-0.5" style={{ height: CHART_H }}>
          {rows.map(row => {
            const barH = Math.max(Math.round((row.value / maxVal) * (CHART_H - 8)), row.value > 0 ? 3 : 0);
            const isHovered = hoveredHour === row.hour;
            return (
              <div
                key={row.hour}
                className="flex-1 flex flex-col items-center justify-end h-full"
                onMouseEnter={() => setHoveredHour(row.hour)}
              >
                <div
                  className={`w-full rounded-t transition-colors ${
                    row.isOpen
                      ? isHovered ? 'bg-white/75' : 'bg-white/55'
                      : isHovered ? 'bg-white/20' : 'bg-white/12'
                  }`}
                  style={{ height: barH }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[8px] text-gray-600 mt-1">
        <span>00</span>
        <span>12</span>
        <span>23</span>
      </div>
    </div>
  );
}
