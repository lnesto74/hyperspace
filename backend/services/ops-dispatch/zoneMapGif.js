/**
 * zoneMapGif
 *
 * Renders an animated GIF of the venue's DWG wireframe with the target ROI
 * (shelf or checkout counter) pulsing red — the same map the mobile task page
 * shows interactively. Used to make Telegram task DMs instantly readable.
 *
 * Pipeline: build a per-frame SVG (grey wireframe + pulsing red zone) → rasterize
 * with sharp → encode frames into a looping GIF with gifenc. Pure JS + the
 * already-installed sharp; no headless browser or native canvas needed.
 */

import sharp from 'sharp';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const W = 640;
const H = 420;
const PAD = 30;
const FRAMES = 14;
const DELAY = 80; // ms per frame
const MAX_ABS = 500;
const DRIFT = 25;

function normVertex(v) {
  return { x: v.x, z: v.z ?? v.y ?? 0 };
}

function sane(p, anchor) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  if (Math.abs(p.x) > MAX_ABS || Math.abs(p.z) > MAX_ABS) return false;
  if (anchor && Math.hypot(p.x - anchor.x, p.z - anchor.z) > DRIFT) return false;
  return true;
}

/** Fixture outline: prefer the DWG footprint, else a box from scale + rotation.y. */
function fixtureOutline(obj) {
  const pos = obj.position || { x: 0, z: 0 };
  const fp = obj.metadata?.dwg_footprint_points;
  if (Array.isArray(fp) && fp.length >= 3) {
    const pts = fp.map(normVertex).filter((p) => sane(p, { x: pos.x, z: pos.z }));
    if (pts.length >= 3) {
      const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const mz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      if (Math.hypot(mx - pos.x, mz - pos.z) < DRIFT) return pts;
    }
  }
  const hw = (obj.scale?.x ?? 2) / 2;
  const hd = (obj.scale?.z ?? 0.5) / 2;
  const rotY = obj.rotation?.y ?? 0;
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  return [
    { x: -hw, z: -hd }, { x: hw, z: -hd }, { x: hw, z: hd }, { x: -hw, z: hd },
  ].map((c) => ({ x: pos.x + c.x * cos - c.z * sin, z: pos.z + c.x * sin + c.z * cos }));
}

function computeBounds(points) {
  if (points.length === 0) return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const padX = (maxX - minX) * 0.08 || 1;
  const padZ = (maxZ - minZ) * 0.08 || 1;
  return { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ };
}

function makeTransform(bounds) {
  const sceneW = bounds.maxX - bounds.minX || 1;
  const sceneH = bounds.maxZ - bounds.minZ || 1;
  const scale = Math.min((W - PAD * 2) / sceneW, (H - PAD * 2) / sceneH);
  const offX = (W - sceneW * scale) / 2;
  const offZ = (H - sceneH * scale) / 2;
  return {
    tx: (x) => offX + (x - bounds.minX) * scale,
    tz: (z) => offZ + (z - bounds.minZ) * scale,
  };
}

function buildSvg({ fixtures, regions, targetSet, wave, t }) {
  const pt = (p) => `${t.tx(p.x).toFixed(1)},${t.tz(p.z).toFixed(1)}`;
  const poly = (pts) => pts.map(pt).join(' ');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<rect width="${W}" height="${H}" fill="#05070d"/>`;
  // faint grid
  for (let x = 0; x <= W; x += 48) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>`;
  for (let y = 0; y <= H; y += 48) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>`;
  // DWG wireframe (grey, store "off")
  for (const f of fixtures) s += `<polygon points="${poly(f)}" fill="#7d8aa0" fill-opacity="0.05" stroke="#96a5be" stroke-opacity="0.45" stroke-width="1" stroke-linejoin="round"/>`;
  // non-target ROIs (dim violet)
  for (const r of regions) {
    if (targetSet.has(r.id)) continue;
    s += `<polygon points="${poly(r.verts)}" fill="#8b5cf6" fill-opacity="0.04" stroke="#8b5cf6" stroke-opacity="0.16" stroke-width="1" stroke-linejoin="round"/>`;
  }
  // target ROI — pulsing red with glow halo
  const sw = 2 + wave * 4;
  for (const r of regions) {
    if (!targetSet.has(r.id)) continue;
    s += `<polygon points="${poly(r.verts)}" fill="none" stroke="#ff2d2d" stroke-opacity="${(0.08 + wave * 0.12).toFixed(3)}" stroke-width="${(sw + 12).toFixed(1)}" stroke-linejoin="round"/>`;
    s += `<polygon points="${poly(r.verts)}" fill="none" stroke="#ff3b3b" stroke-opacity="${(0.12 + wave * 0.18).toFixed(3)}" stroke-width="${(sw + 5).toFixed(1)}" stroke-linejoin="round"/>`;
    s += `<polygon points="${poly(r.verts)}" fill="#ff2d2d" fill-opacity="${(0.18 + wave * 0.3).toFixed(3)}" stroke="#ff5a5a" stroke-opacity="${(0.7 + wave * 0.3).toFixed(3)}" stroke-width="${sw.toFixed(1)}" stroke-linejoin="round"/>`;
  }
  s += `</svg>`;
  return s;
}

/**
 * @returns {Promise<Buffer|null>} animated GIF buffer, or null if nothing to draw.
 */
export async function renderZoneGif({ objects = [], regions = [], targetRoiId = null } = {}) {
  const fixtures = (objects || []).map(fixtureOutline).filter((o) => o.length >= 3);
  const norm = (regions || [])
    .map((r) => ({ id: r.id, verts: (r.vertices || []).map(normVertex).filter((p) => sane(p)) }))
    .filter((r) => r.verts.length >= 3);
  if (fixtures.length === 0 && norm.length === 0) return null;

  const pts = [];
  for (const f of fixtures) for (const p of f) pts.push(p);
  for (const r of norm) for (const p of r.verts) pts.push(p);
  const t = makeTransform(computeBounds(pts));
  const targetSet = new Set(targetRoiId ? [targetRoiId] : []);

  const gif = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    const wave = 0.5 + 0.5 * Math.sin((i / FRAMES) * Math.PI * 2);
    const svg = buildSvg({ fixtures, regions: norm, targetSet, wave, t });
    const { data } = await sharp(Buffer.from(svg)).resize(W, H).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.length);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, W, H, { palette, delay: DELAY });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

export default renderZoneGif;
