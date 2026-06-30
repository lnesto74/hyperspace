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
import { useIsTouch } from "@/lib/useMedia";

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
const CLICK_THRESHOLD_TOUCH_PX = 14;
const FIT_PADDING_PX = 32;

function ZoomControls({ onFit }: { onFit: () => void }) {
  const { zoomIn, zoomOut } = useControls();

  const btn =
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white/95 text-lg font-medium shadow-md active:bg-white md:min-h-0 md:min-w-0 md:rounded-lg md:px-3 md:py-2 md:text-sm";

  return (
    <div
      className="absolute bottom-4 left-4 z-30 flex gap-2 md:gap-1"
      style={{ marginBottom: "max(0px, env(safe-area-inset-bottom))" }}
    >
      <button type="button" className={btn} onClick={() => zoomIn()} aria-label="Zoom in">
        +
      </button>
      <button type="button" className={btn} onClick={() => zoomOut()} aria-label="Zoom out">
        −
      </button>
      <button type="button" className={btn} onClick={onFit} aria-label="Fit">
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
  const [ready, setReady] = useState(false);
  const [naturalW, setNaturalW] = useState(imageW);
  const [naturalH, setNaturalH] = useState(imageH);
  const isTouch = useIsTouch();
  const clickThreshold = isTouch ? CLICK_THRESHOLD_TOUCH_PX : CLICK_THRESHOLD_PX;

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
        (ww - FIT_PADDING_PX * 2) / naturalW,
        (wh - FIT_PADDING_PX * 2) / naturalH,
      );
      const x = (ww - naturalW * scale) / 2;
      const y = (wh - naturalH * scale) / 2;
      api.setTransform(x, y, scale, animate ? 250 : 0);
      setZoomScale(scale);
    },
    [naturalW, naturalH],
  );

  useLayoutEffect(() => {
    if (naturalW > 0 && naturalH > 0) {
      fitToView(false);
      setReady(true);
    }
  }, [fitToView, naturalW, naturalH]);

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
      if (Math.hypot(dx, dy) > clickThreshold) return;

      const rect = getImageRect();
      const norm = pxToNorm({ x: e.clientX, y: e.clientY }, rect);
      onAddPin(norm.x, norm.y);
    },
    [readOnly, getImageRect, onAddPin, clickThreshold],
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
      if (Math.hypot(dx, dy) > clickThreshold) drag.moved = true;

      const rect = getImageRect();
      const norm = pxToNorm({ x: e.clientX, y: e.clientY }, rect);
      onMovePin(drag.pinId, norm.x, norm.y);
    },
    [getImageRect, onMovePin, clickThreshold],
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

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const w = img.naturalWidth || imageW;
      const h = img.naturalHeight || imageH;
      if (w > 0 && h > 0) {
        setNaturalW(w);
        setNaturalH(h);
      }
    },
    [imageW, imageH],
  );

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
    <div className="relative h-full w-full overflow-hidden bg-gray-200">
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
          contentClass="!inline-block !w-auto !h-auto"
          wrapperStyle={{ touchAction: "none" }}
        >
          <div
            ref={imageRef}
            className="relative inline-block select-none"
            style={{
              width: naturalW,
              height: naturalH,
              visibility: ready ? "visible" : "hidden",
            }}
            onPointerDown={handleMapPointerDown}
            onPointerUp={handleMapPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={floorplanUrl}
              alt="Planimetria"
              width={naturalW}
              height={naturalH}
              onLoad={handleImageLoad}
              className="pointer-events-none block"
              style={{
                width: naturalW,
                height: naturalH,
                maxWidth: "none",
              }}
              draggable={false}
              loading="eager"
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
        </TransformComponent>
        <ZoomControls onFit={() => fitToView(true)} />
      </TransformWrapper>
    </div>
  );
}
