"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

const CLICK_THRESHOLD_PX = 8;
const FIT_PADDING_PX = 32;

function ZoomControls({ onFit }: { onFit: () => void }) {
  const { zoomIn, zoomOut } = useControls();

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
        onClick={onFit}
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [ready, setReady] = useState(false);

  const pinDragRef = useRef<{
    pinId: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const tapRef = useRef<{ x: number; y: number } | null>(null);

  const fitToView = useCallback(
    (animate = true) => {
      const api = transformRef.current;
      const wrapper = api?.instance?.wrapperComponent;
      if (!api || !wrapper) return;

      const ww = wrapper.clientWidth;
      const wh = wrapper.clientHeight;
      if (ww === 0 || wh === 0) return;

      const scale = Math.min(
        (ww - FIT_PADDING_PX * 2) / imageW,
        (wh - FIT_PADDING_PX * 2) / imageH,
      );
      const x = (ww - imageW * scale) / 2;
      const y = (wh - imageH * scale) / 2;
      api.setTransform(x, y, scale, animate ? 250 : 0);
      setZoomScale(scale);
    },
    [imageW, imageH],
  );

  useLayoutEffect(() => {
    fitToView(false);
    setReady(true);
  }, [fitToView]);

  const getImageRect = useCallback(() => {
    const el = imageRef.current;
    if (!el) return { left: 0, top: 0, width: 1, height: 1 };
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, []);

  const handleMapPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-pin]")) return;
    if (e.button !== 0) return;
    tapRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMapPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-pin]")) return;
      if (readOnly || pinDragRef.current?.moved) return;

      const tap = tapRef.current;
      tapRef.current = null;
      if (!tap) return;

      const dx = e.clientX - tap.x;
      const dy = e.clientY - tap.y;
      if (Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) return;

      const rect = getImageRect();
      const norm = pxToNorm({ x: e.clientX, y: e.clientY }, rect);
      onAddPin(norm.x, norm.y);
    },
    [readOnly, getImageRect, onAddPin],
  );

  const handlePinDragStart = useCallback(
    (pinId: string, e: React.PointerEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      tapRef.current = null;
      pinDragRef.current = {
        pinId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [readOnly],
  );

  const handlePinDragMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = pinDragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) drag.moved = true;

      const rect = getImageRect();
      const norm = pxToNorm({ x: e.clientX, y: e.clientY }, rect);
      onMovePin(drag.pinId, norm.x, norm.y);
    },
    [getImageRect, onMovePin],
  );

  const handlePinDragEnd = useCallback(() => {
    if (pinDragRef.current?.moved) {
      setTimeout(() => {
        pinDragRef.current = null;
      }, 50);
    } else {
      pinDragRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!centerOnPinId || !transformRef.current) return;
    const pin = pins.find((p) => p.id === centerOnPinId);
    const wrapper = transformRef.current.instance.wrapperComponent;
    if (!pin || !wrapper || !imageRef.current) return;

    const state = transformRef.current.instance.transformState;
    const wrapperRect = wrapper.getBoundingClientRect();
    const imgRect = imageRef.current.getBoundingClientRect();

    const pinPxX = imgRect.left + pin.x * imgRect.width;
    const pinPxY = imgRect.top + pin.y * imgRect.height;

    const offsetX = wrapperRect.width / 2 - (pinPxX - wrapperRect.left);
    const offsetY = wrapperRect.height / 2 - (pinPxY - wrapperRect.top);

    transformRef.current.setTransform(
      state.positionX + offsetX,
      state.positionY + offsetY,
      state.scale,
      200,
    );
  }, [centerOnPinId, pins]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-gray-200"
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.15}
        maxScale={8}
        centerOnInit={false}
        limitToBounds={false}
        panning={{
          disabled: false,
          velocityDisabled: true,
        }}
        wheel={{ step: 0.12, smoothStep: 0.004 }}
        pinch={{ step: 5 }}
        doubleClick={{ disabled: true }}
        onTransformed={(_ref, state) => setZoomScale(state.scale)}
      >
        <TransformComponent
          wrapperClass="!h-full !w-full cursor-grab active:cursor-grabbing"
          contentClass="!w-full !h-full"
          wrapperStyle={{ touchAction: "none" }}
        >
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ visibility: ready ? "visible" : "hidden" }}
          >
            <div
              ref={imageRef}
              className="relative shrink-0 select-none"
              style={{ width: imageW, height: imageH }}
              onPointerDown={handleMapPointerDown}
              onPointerUp={handleMapPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={floorplanUrl}
                alt="Planimetria"
                width={imageW}
                height={imageH}
                className="pointer-events-none block h-full w-full"
                draggable={false}
                loading="lazy"
              />
              {pins.map((pin) => (
                <div
                  key={pin.id}
                  data-pin
                  onPointerMove={handlePinDragMove}
                  onPointerUp={handlePinDragEnd}
                  onPointerCancel={handlePinDragEnd}
                >
                  <Pin
                    pin={pin}
                    selected={pin.id === selectedId}
                    zoomScale={zoomScale}
                    onSelect={onSelectPin}
                    onDragStart={handlePinDragStart}
                    readOnly={readOnly}
                  />
                </div>
              ))}
            </div>
          </div>
        </TransformComponent>
        <ZoomControls onFit={() => fitToView(true)} />
      </TransformWrapper>
    </div>
  );
}
