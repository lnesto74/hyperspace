export interface Point {
  x: number;
  y: number;
}

export interface ImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Convert normalised [0,1] coords to pixel position within image rect */
export function normToPx(norm: Point, rect: ImageRect): Point {
  return {
    x: rect.left + norm.x * rect.width,
    y: rect.top + norm.y * rect.height,
  };
}

/** Convert pixel position to normalised [0,1] coords within image rect */
export function pxToNorm(px: Point, rect: ImageRect): Point {
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: clamp((px.x - rect.left) / rect.width, 0, 1),
    y: clamp((px.y - rect.top) / rect.height, 0, 1),
  };
}

/** Compute the displayed image rect inside a container (object-fit: contain) */
export function computeContainRect(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number,
): ImageRect {
  if (containerW === 0 || containerH === 0 || imageW === 0 || imageH === 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const containerAspect = containerW / containerH;
  const imageAspect = imageW / imageH;

  let width: number;
  let height: number;

  if (imageAspect > containerAspect) {
    width = containerW;
    height = containerW / imageAspect;
  } else {
    height = containerH;
    width = containerH * imageAspect;
  }

  return {
    left: (containerW - width) / 2,
    top: (containerH - height) / 2,
    width,
    height,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Pin visual size inversely scales with zoom so pins stay crisp */
export function pinDisplaySize(baseSize: number, zoomScale: number): number {
  return baseSize / Math.max(zoomScale, 0.1);
}
