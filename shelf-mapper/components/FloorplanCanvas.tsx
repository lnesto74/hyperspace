"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import type { Pin as PinType } from "@/lib/types";
import { Pin } from "./Pin";
import { pxToNorm } from "@/lib/coords";

interface FloorplanCanvasProps {
  floorplanUrl: string;
  imageW: number;
  imageH: number;
  pins: PinType[];
  selectedId: string | null;
  onAddPin: (x: number, y: number) => void;
  onSelectPin: (id: string) => void;
  onMovePin: (id: string, x: number, y: number) => void;
  readOnly?: boolean;
  centerOnPinId?: string | null;
}

function ZoomControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();

  return (
    <div className="absolute bottom-4 left-4 z-30 flex gap-1">
      <button
        type="button"
        className="rounded-lg bg-white/90 px-3 py-2 text-sm font-medium shadow hover:bg-white"
        onClick={() => zoomIn()}
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        className="rounded-lg bg-white/90 px-3 py-2 text-sm font-medium shadow hover:bg-white"
        onClick={() => zoomOut()}
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="rounded-lg bg-white/90 px-3 py-2 text-sm font-medium shadow hover:bg-white"
        onClick={() => resetTransform()}
        aria-label="Fit"
      >
        ⊡
      </button>
    </div>
  );
}

export function FloorplanCanvas({
  floorplanUrl,
  imageW,
  imageH,
  pins,
  selectedId,
  onAddPin,
  onSelectPin,
  onMovePin,
  readOnly,
  centerOnPinId,
}: FloorplanCanvasProps) {
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const dragRef = useRef<{
    pinId: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const getImageRect = useCallback(() => {
    const el = imageRef.current;
    if (!el) return { left: 0, top: 0, width: 1, height: 1 };
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, []);

  const handleMapClick = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly || dragRef.current?.moved) return;
      if ((e.target as HTMLElement).closest("[data-pin]")) return;

      const rect = getImageRect();
      const norm = pxToNorm({ x: e.clientX, y: e.clientY }, rect);
      onAddPin(norm.x, norm.y);
    },
    [readOnly, getImageRect, onAddPin],
  );

  const handleDragStart = useCallback(
    (pinId: string, e: React.PointerEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      dragRef.current = {
        pinId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [readOnly],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true;
      }

      const rect = getImageRect();
      const norm = pxToNorm({ x: e.clientX, y: e.clientY }, rect);
      onMovePin(drag.pinId, norm.x, norm.y);
    },
    [getImageRect, onMovePin],
  );

  const handlePointerUp = useCallback(() => {
    if (dragRef.current?.moved) {
      setTimeout(() => {
        dragRef.current = null;
      }, 50);
    } else {
      dragRef.current = null;
    }
  }, []);

  // Fly to pin when selected from list
  useEffect(() => {
    if (!centerOnPinId || !transformRef.current) return;
    const pin = pins.find((p) => p.id === centerOnPinId);
    if (!pin || !imageRef.current) return;

    const wrapper = transformRef.current.instance.wrapperComponent;
    if (!wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const imgRect = imageRef.current.getBoundingClientRect();

    const pinPxX = imgRect.left + pin.x * imgRect.width;
    const pinPxY = imgRect.top + pin.y * imgRect.height;

    const offsetX = wrapperRect.width / 2 - (pinPxX - wrapperRect.left);
    const offsetY = wrapperRect.height / 2 - (pinPxY - wrapperRect.top);

    transformRef.current.setTransform(
      transformRef.current.instance.transformState.positionX + offsetX,
      transformRef.current.instance.transformState.positionY + offsetY,
      transformRef.current.instance.transformState.scale,
      200,
    );
  }, [centerOnPinId, pins]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-100">
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.3}
        maxScale={6}
        centerOnInit
        wheel={{ step: 0.1 }}
        pinch={{ step: 5 }}
        doubleClick={{ disabled: true }}
        onTransformed={(_ref, state) => setZoomScale(state.scale)}
      >
        <TransformComponent
          wrapperClass="!h-full !w-full"
          contentClass="!h-full !w-full flex items-center justify-center"
        >
          <div
            ref={imageRef}
            className="relative cursor-crosshair select-none"
            style={{ width: imageW, height: imageH }}
            onClick={handleMapClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={floorplanUrl}
              alt="Planimetria"
              width={imageW}
              height={imageH}
              className="block h-full w-full"
              draggable={false}
              loading="lazy"
            />
            {pins.map((pin) => (
              <div key={pin.id} data-pin>
                <Pin
                  pin={pin}
                  selected={pin.id === selectedId}
                  zoomScale={zoomScale}
                  onSelect={onSelectPin}
                  onDragStart={handleDragStart}
                  readOnly={readOnly}
                />
              </div>
            ))}
          </div>
        </TransformComponent>
        <ZoomControls />
      </TransformWrapper>
    </div>
  );
}
