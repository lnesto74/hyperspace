import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface DwellGeometryRadii {
  categoryDwellRadiusM?: number;
  engagementRadiusM?: number;
  dwellGapS?: number;
}

const DEFAULTS = {
  categoryDwellRadiusM: 2.0,
  engagementRadiusM: 0.5,
  dwellGapS: 3,
};

/** Compact top-down shelf geometry: engagement strip + category dwell halo + A/B/C. */
export function DwellGeometryDiagram({
  categoryDwellRadiusM = DEFAULTS.categoryDwellRadiusM,
  engagementRadiusM = DEFAULTS.engagementRadiusM,
  className = '',
  compact = false,
}: DwellGeometryRadii & { className?: string; compact?: boolean }) {
  const dM = Number.isFinite(categoryDwellRadiusM) ? categoryDwellRadiusM! : DEFAULTS.categoryDwellRadiusM;
  const eM = Number.isFinite(engagementRadiusM) ? engagementRadiusM! : DEFAULTS.engagementRadiusM;
  const w = compact ? 220 : 260;
  const h = compact ? 92 : 110;
  const shelfX = 8;
  const shelfW = 18;
  const aisleStart = shelfX + shelfW;
  const aisleW = w - aisleStart - 12;
  // Map metres onto aisle width using dwell radius as full scale.
  const pxPerM = aisleW / Math.max(dM * 1.35, 0.1);
  const engW = Math.max(6, eM * pxPerM);
  const dwellW = Math.max(engW + 8, dM * pxPerM);
  const top = 18;
  const bandH = compact ? 44 : 52;
  const axisY = top + bandH + 14;

  const aX = aisleStart + engW * 0.45;
  const bX = aisleStart + engW + (dwellW - engW) * 0.55;
  const cX = aisleStart + dwellW + (aisleW - dwellW) * 0.45;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className={className}
      role="img"
      aria-label={`Category dwell within ${dM} metres; engagement within ${eM} metres of the shelf`}
    >
      {/* Shelf */}
      <rect x={shelfX} y={top} width={shelfW} height={bandH} rx={2} fill="#374151" />
      <text x={shelfX + shelfW / 2} y={top - 5} textAnchor="middle" fill="#9ca3af" fontSize="7" fontFamily="system-ui,sans-serif">
        SHELF
      </text>

      {/* Dwell halo (dashed) */}
      <rect
        x={aisleStart}
        y={top}
        width={dwellW}
        height={bandH}
        fill="rgba(56,189,248,0.06)"
        stroke="#38bdf8"
        strokeWidth={1.2}
        strokeDasharray="3 2"
        rx={2}
      />
      <text x={aisleStart + dwellW / 2} y={top - 5} textAnchor="middle" fill="#7dd3fc" fontSize="7" fontFamily="system-ui,sans-serif">
        {dM.toFixed(1)} m category dwell
      </text>

      {/* Engagement strip */}
      <rect
        x={aisleStart}
        y={top}
        width={engW}
        height={bandH}
        fill="rgba(56,189,248,0.28)"
        stroke="none"
      />
      <text x={aisleStart + engW / 2} y={top + 11} textAnchor="middle" fill="#e0f2fe" fontSize="6.5" fontFamily="system-ui,sans-serif">
        {eM.toFixed(1)} m eng.
      </text>

      {/* Markers A B C */}
      <circle cx={aX} cy={top + bandH / 2} r={5} fill="#38bdf8" />
      <text x={aX} y={top + bandH / 2 + 2.5} textAnchor="middle" fill="#0f172a" fontSize="7" fontWeight="700" fontFamily="system-ui,sans-serif">A</text>

      <circle cx={bX} cy={top + bandH / 2} r={5} fill="#f8fafc" stroke="#94a3b8" strokeWidth={1} />
      <text x={bX} y={top + bandH / 2 + 2.5} textAnchor="middle" fill="#0f172a" fontSize="7" fontWeight="700" fontFamily="system-ui,sans-serif">B</text>

      <circle cx={cX} cy={top + bandH / 2} r={5} fill="#64748b" />
      <line x1={cX - 4} y1={top + bandH / 2} x2={cX + 4} y2={top + bandH / 2} stroke="#cbd5e1" strokeWidth={1.2} />
      <text x={cX} y={top + bandH / 2 + 2.5} textAnchor="middle" fill="#e2e8f0" fontSize="7" fontWeight="700" fontFamily="system-ui,sans-serif">C</text>

      {/* Axis */}
      <line x1={aisleStart} y1={axisY} x2={aisleStart + dwellW + 18} y2={axisY} stroke="#64748b" strokeWidth={1} />
      <text x={aisleStart} y={axisY + 10} textAnchor="middle" fill="#94a3af" fontSize="6.5" fontFamily="system-ui,sans-serif">0</text>
      <text x={aisleStart + engW} y={axisY + 10} textAnchor="middle" fill="#94a3af" fontSize="6.5" fontFamily="system-ui,sans-serif">{eM.toFixed(1)} m</text>
      <text x={aisleStart + dwellW} y={axisY + 10} textAnchor="middle" fill="#94a3af" fontSize="6.5" fontFamily="system-ui,sans-serif">{dM.toFixed(1)} m</text>

      {/* Legend keys */}
      <text x={8} y={h - 4} fill="#94a3af" fontSize="6.5" fontFamily="system-ui,sans-serif">
        A pick/read · B decide in aisle · C pass-by
      </text>
    </svg>
  );
}

export function DwellGeometryHelp({
  radii,
  children,
}: {
  radii?: DwellGeometryRadii | null;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const dM = radii?.categoryDwellRadiusM ?? DEFAULTS.categoryDwellRadiusM;
  const eM = radii?.engagementRadiusM ?? DEFAULTS.engagementRadiusM;
  const gapS = radii?.dwellGapS ?? DEFAULTS.dwellGapS;

  const updatePos = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popW = 300;
    const left = Math.min(
      Math.max(12 + popW / 2, rect.left + rect.width / 2),
      window.innerWidth - 12 - popW / 2,
    );
    setPos({ top: rect.top - 8, left });
  };

  const show = () => {
    updatePos();
    setOpen(true);
  };
  const hide = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <span className="relative inline-flex items-center">
      {children}
      <button
        ref={btnRef}
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-sky-500/40 text-[9px] leading-none text-sky-300/90 hover:bg-sky-500/10 hover:text-sky-200"
        aria-label="How category dwell and engagement are measured"
      >
        ?
      </button>
      {open && (
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-[80] w-[300px] -translate-x-1/2 -translate-y-full rounded-lg border border-sky-700/50 bg-gray-950/95 p-3 shadow-xl backdrop-blur-sm"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-1.5 text-[11px] font-semibold text-sky-200">
            Category dwell vs engagement
          </div>
          <DwellGeometryDiagram
            categoryDwellRadiusM={dM}
            engagementRadiusM={eM}
            compact
          />
          <p className="mt-2 text-[10px] leading-snug text-gray-400">
            <span className="text-sky-300">A</span> reaches the shelf face (a stop).{' '}
            <span className="text-sky-200">B</span> is nearby in the aisle (category visit, not a stop).{' '}
            <span className="text-gray-300">C</span> is a pass-by. Stopping % = A among A+B.
            Category dwell on the card is the median time within {dM.toFixed(1)} m among stops only.
          </p>
        </div>
      )}
    </span>
  );
}
