import { useCallback, useRef, useState } from 'react';

export interface TimelineBrushPoint {
  value: number;
  label: string;
}

interface TimelineRangeBrushProps {
  points: TimelineBrushPoint[];
  rangeStart: number;
  rangeEnd: number;
  onRangeChange: (start: number, end: number) => void;
  minWindow?: number;
}

type DragMode = 'left' | 'right' | 'move';

const BRUSH_H = 40;
const HANDLE_W = 8;
const MIN_WINDOW_DEFAULT = 4;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function indexAtX(clientX: number, rect: DOMRect, count: number): number {
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 0.999999);
  return clamp(Math.floor(ratio * count), 0, count - 1);
}

export default function TimelineRangeBrush({
  points,
  rangeStart,
  rangeEnd,
  onRangeChange,
  minWindow = MIN_WINDOW_DEFAULT,
}: TimelineRangeBrushProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startIdx: number;
    origStart: number;
    origEnd: number;
  } | null>(null);

  const [dragging, setDragging] = useState(false);
  const count = points.length;
  const maxVal = Math.max(...points.map(p => p.value), 0.1);

  const leftPct = (rangeStart / count) * 100;
  const widthPct = ((rangeEnd - rangeStart) / count) * 100;

  const finishDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    const track = trackRef.current;
    if (!drag || !track || count === 0) return;

    const rect = track.getBoundingClientRect();
    const idx = indexAtX(e.clientX, rect, count);
    const window = drag.origEnd - drag.origStart;

    if (drag.mode === 'left') {
      const nextStart = clamp(idx, 0, drag.origEnd - minWindow);
      onRangeChange(nextStart, drag.origEnd);
    } else if (drag.mode === 'right') {
      const nextEnd = clamp(idx + 1, drag.origStart + minWindow, count);
      onRangeChange(drag.origStart, nextEnd);
    } else {
      const deltaIdx = idx - drag.startIdx;
      const nextStart = clamp(drag.origStart + deltaIdx, 0, count - window);
      onRangeChange(nextStart, nextStart + window);
    }
  }, [count, minWindow, onRangeChange]);

  const startDrag = useCallback((mode: DragMode, clientX: number) => {
    const track = trackRef.current;
    if (!track || count === 0) return;
    const rect = track.getBoundingClientRect();
    dragRef.current = {
      mode,
      startIdx: indexAtX(clientX, rect, count),
      origStart: rangeStart,
      origEnd: rangeEnd,
    };
    setDragging(true);

    const onUp = () => {
      finishDrag();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
  }, [rangeStart, rangeEnd, finishDrag, onPointerMove]);

  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (!trackRef.current || count === 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const idx = indexAtX(e.clientX, rect, count);
    const window = rangeEnd - rangeStart;

    if (idx < rangeStart) {
      const nextStart = clamp(idx - Math.floor(window / 2), 0, count - window);
      onRangeChange(nextStart, nextStart + window);
    } else if (idx >= rangeEnd) {
      const nextStart = clamp(idx - Math.floor(window / 2), 0, count - window);
      onRangeChange(nextStart, nextStart + window);
    } else {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      startDrag('move', e.clientX);
    }
  };

  if (count <= minWindow) return null;

  return (
    <div className="mt-2 pt-2 border-t border-gray-700/40 select-none">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-gray-500">Drag handles to zoom · drag center to pan</span>
        <button
          type="button"
          className="text-[9px] text-gray-500 hover:text-white"
          onClick={() => {
            const window = Math.min(24, count);
            onRangeChange(Math.max(0, count - window), count);
          }}
        >
          Reset view
        </button>
      </div>

      <div
        ref={trackRef}
        className={`relative rounded-md bg-gray-900/60 border border-gray-700/50 cursor-crosshair ${dragging ? 'ring-1 ring-white/20' : ''}`}
        style={{ height: BRUSH_H }}
        onPointerDown={onTrackPointerDown}
      >
        {/* Mini sparkline — full series */}
        <div className="absolute inset-x-1 bottom-1 top-2 flex items-end gap-px pointer-events-none">
          {points.map((p, i) => {
            const barH = Math.max(Math.round((p.value / maxVal) * (BRUSH_H - 12)), p.value > 0 ? 2 : 0);
            const inRange = i >= rangeStart && i < rangeEnd;
            return (
              <div
                key={i}
                className={`flex-1 min-w-0 rounded-t ${inRange ? 'bg-white/45' : 'bg-white/15'}`}
                style={{ height: barH }}
              />
            );
          })}
        </div>

        {/* Dimmed masks outside selection */}
        <div
          className="absolute inset-y-0 left-0 bg-gray-950/55 pointer-events-none rounded-l-md"
          style={{ width: `${leftPct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-gray-950/55 pointer-events-none rounded-r-md"
          style={{ width: `${100 - leftPct - widthPct}%` }}
        />

        {/* Selection window */}
        <div
          className="absolute inset-y-0 border-y-2 border-white/50 bg-white/5"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        >
          {/* Left handle */}
          <div
            role="slider"
            aria-label="Range start"
            className="absolute left-0 top-0 bottom-0 flex items-center justify-center cursor-ew-resize touch-none"
            style={{ width: HANDLE_W, marginLeft: -HANDLE_W / 2 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              startDrag('left', e.clientX);
            }}
          >
            <div className="h-5 w-1 rounded-full bg-white/90 shadow" />
          </div>

          {/* Move grip (center) */}
          <div
            className="absolute inset-x-2 inset-y-0 cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              startDrag('move', e.clientX);
            }}
          />

          {/* Right handle */}
          <div
            role="slider"
            aria-label="Range end"
            className="absolute right-0 top-0 bottom-0 flex items-center justify-center cursor-ew-resize touch-none"
            style={{ width: HANDLE_W, marginRight: -HANDLE_W / 2 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              startDrag('right', e.clientX);
            }}
          >
            <div className="h-5 w-1 rounded-full bg-white/90 shadow" />
          </div>
        </div>
      </div>

      <div className="flex justify-between text-[8px] text-gray-600 mt-1 px-0.5">
        <span className="truncate max-w-[30%]">{points[0]?.label}</span>
        <span className="truncate max-w-[35%] text-center text-gray-500">
          {points[rangeStart]?.label} – {points[rangeEnd - 1]?.label}
        </span>
        <span className="truncate max-w-[30%] text-right">{points[count - 1]?.label}</span>
      </div>
    </div>
  );
}
