"use client";

import type { Pin as PinType } from "@/lib/types";
import { pinDisplaySize } from "@/lib/coords";

interface PinProps {
  pin: PinType;
  selected: boolean;
  zoomScale: number;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  readOnly?: boolean;
}

export function Pin({
  pin,
  selected,
  zoomScale,
  onSelect,
  onDragStart,
  readOnly,
}: PinProps) {
  const assigned = pin.categories.length > 0;
  const size = pinDisplaySize(28, zoomScale);
  const fontSize = pinDisplaySize(11, zoomScale);

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 touch-none"
      style={{
        left: `${pin.x * 100}%`,
        top: `${pin.y * 100}%`,
        zIndex: selected ? 20 : 10,
      }}
    >
      <button
        type="button"
        className={`flex items-center justify-center rounded-full border-2 font-bold shadow-md transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          selected ? "scale-125 ring-2 ring-blue-400 ring-offset-1" : ""
        } ${
          assigned
            ? "border-green-700 bg-pin-assigned text-white"
            : "border-pin-unassigned bg-white text-amber-700"
        }`}
        style={{ width: size, height: size, fontSize }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(pin.id);
        }}
        onPointerDown={(e) => {
          if (!readOnly) onDragStart(pin.id, e);
        }}
        aria-label={`Scaffale ${pin.number}`}
        aria-pressed={selected}
      >
        {pin.number}
      </button>
      {assigned && zoomScale >= 0.8 && (
        <div
          className="pointer-events-none absolute left-1/2 mt-0.5 max-w-[80px] -translate-x-1/2 truncate rounded bg-black/70 px-1 text-center text-white"
          style={{ fontSize: pinDisplaySize(9, zoomScale) }}
        >
          {pin.categories[0]}
        </div>
      )}
    </div>
  );
}
