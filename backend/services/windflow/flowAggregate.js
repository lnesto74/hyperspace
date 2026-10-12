// Copy of the pure aggregation part of backend/services/FlowFieldDailyService.js (main), used by the
// Windflow day-pack worker so it does not depend on the server's copy being up to date.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_VENUE_ID = '55fdd53b-3298-4355-97c0-b4e789b11d06';
export const SLICES = [
  { id: 'all', hours: null, dows: null, window: 'day' },
  { id: 'morning', hours: [7, 11], dows: null, window: 'day' },
  { id: 'midday', hours: [11, 15], dows: null, window: 'day' },
  { id: 'afternoon', hours: [15, 19], dows: null, window: 'day' },
  { id: 'evening', hours: [19, 22], dows: null, window: 'day' },
  // Visitor Journey clock (daily_kpi): the 08–20 trading day and its 2-hour slots, so the
  // spatial workspace can move the floor and the KPI numbers with one control.
  { id: 'trading', hours: [8, 20], dows: null, window: 'day' },
  { id: 'h08_10', hours: [8, 10], dows: null, window: 'day' },
  { id: 'h10_12', hours: [10, 12], dows: null, window: 'day' },
  { id: 'h12_14', hours: [12, 14], dows: null, window: 'day' },
  { id: 'h14_16', hours: [14, 16], dows: null, window: 'day' },
  { id: 'h16_18', hours: [16, 18], dows: null, window: 'day' },
  { id: 'h18_20', hours: [18, 20], dows: null, window: 'day' },
  { id: 'weekday', hours: null, dows: [0, 1, 2, 3, 4], window: 'rolling7' },
  { id: 'weekend', hours: null, dows: [5, 6], window: 'rolling7' },
];
export const SLICE_IDS = new Set(SLICES.map((s) => s.id));

const BINS = 8;
const MIN_PRESENCE_SEC = 1.0;
const MIN_STEPS = 0.5;
const TODAY_TTL_MS = 60 * 60 * 1000;

function loadAnchor() {
  const p = process.env.FLOWFIELD_LAYOUT_PATH
    || path.join(__dirname, '../assets/flowfield/layout_anchor.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function localParts(tsMs, tzOffsetH) {
  const d = new Date(tsMs + tzOffsetH * 3600 * 1000);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    dow: d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1, // Mon=0 … Sun=6
  };
}

export function dateStrFromParts(p) {
  return `${p.y}-${pad2(p.m)}-${pad2(p.day)}`;
}

export function localMidnightUtcMs(dateStr, tzOffsetH) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0) - tzOffsetH * 3600 * 1000;
}

function matchesSlice(spec, hour, dow) {
  if (spec.hours && !(spec.hours[0] <= hour && hour < spec.hours[1])) return false;
  if (spec.dows && !spec.dows.includes(dow)) return false;
  return true;
}

function inDayWindow(dateStr, parts) {
  return dateStrFromParts(parts) === dateStr;
}

/**
 * One-pass multi-slice aggregation, same geometry and rules as
 * analysis/flowfield_prod_slices.py — but date-scoped and on a fixed layout grid
 * so day-vs-day cells line up.
 */
export function aggregatePositions(rows, opts) {
  const {
    cell = 1.5,
    slow = 0.25,
    ds = 0.4,
    maxGapMs = 15000,
    maxSpeed = 3.0,
    tzOffsetH = 2,
    openHour = 7,
    closeHour = 22,
    dateStr,
    bbox,
    venueId,
  } = opts;

  const C = cell;
  const gx0 = Math.floor((bbox.minX - 2) / C) * C;
  const gy0 = Math.floor((bbox.minZ - 2) / C) * C;

  const stores = {};
  for (const s of SLICES) stores[s.id] = new Map();

  const cellAt = (store, x, y) => {
    const ix = Math.floor((x - gx0) / C);
    const iy = Math.floor((y - gy0) / C);
    const k = `${ix},${iy}`;
    let c = store.get(k);
    if (!c) {
      c = { ix, iy, presence: 0, dwell: 0, steps: 0, speedSum: 0, rose: new Array(BINS).fill(0), ids: new Set() };
      store.set(k, c);
    }
    return c;
  };

  const along = (store, x0, y0, x1, y1, fn) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(dist / (C * 0.5)));
    const w = 1 / n;
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      fn(cellAt(store, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t), w);
    }
  };

  const sliceRows = Object.fromEntries(SLICES.map((s) => [s.id, 0]));
  let firstTs = Infinity;
  let lastTs = 0;
  let rowsInHours = 0;
  const live = new Map();
  let curKey = null;

  for (const row of rows) {
    const { track_key: key, timestamp: ts, position_x: x, position_z: z } = row;
    if (x == null || z == null || ts == null) continue;
    const parts = localParts(ts, tzOffsetH);
    if (parts.hour < openHour || parts.hour >= closeHour) continue;
    rowsInHours += 1;
    if (ts < firstTs) firstTs = ts;
    if (ts > lastTs) lastTs = ts;

    if (key !== curKey) {
      curKey = key;
      const st = {};
      live.set(key, st);
      for (const spec of SLICES) {
        if (!matchesSlice(spec, parts.hour, parts.dow)) continue;
        if (spec.window === 'day' && !inDayWindow(dateStr, parts)) continue;
        st[spec.id] = { lx: x, ly: z, lts: ts, ex: x, ey: z, ets: ts };
        cellAt(stores[spec.id], x, z).ids.add(key);
        sliceRows[spec.id] += 1;
      }
      continue;
    }

    const st = live.get(key) || {};
    live.set(key, st);
    for (const spec of SLICES) {
      const inSlice = matchesSlice(spec, parts.hour, parts.dow)
        && (spec.window !== 'day' || inDayWindow(dateStr, parts));
      if (!inSlice) {
        delete st[spec.id];
        continue;
      }
      sliceRows[spec.id] += 1;
      let prev = st[spec.id];
      if (!prev) {
        st[spec.id] = { lx: x, ly: z, lts: ts, ex: x, ey: z, ets: ts };
        cellAt(stores[spec.id], x, z).ids.add(key);
        continue;
      }
      const store = stores[spec.id];
      const dt = ts - prev.lts;
      if (dt > 0 && dt <= maxGapMs) {
        const dSec = dt / 1000;
        const standing = Math.hypot(x - prev.lx, z - prev.ly) / dSec < slow;
        along(store, prev.lx, prev.ly, x, z, (c, w) => {
          c.presence += dSec * w;
          c.ids.add(key);
          if (standing) c.dwell += dSec * w;
        });
      }
      prev.lx = x;
      prev.ly = z;
      prev.lts = ts;

      const dist = Math.hypot(x - prev.ex, z - prev.ey);
      if (dist >= ds) {
        const segSec = Math.max(0.1, (ts - prev.ets) / 1000);
        const implied = dist / segSec;
        if (implied <= maxSpeed) {
          const ang = Math.atan2(z - prev.ey, x - prev.ex);
          const b = ((Math.round((ang / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
          along(store, prev.ex, prev.ey, x, z, (c, w) => {
            c.rose[b] += w;
            c.steps += w;
            c.speedSum += implied * w;
          });
        }
        prev.ex = x;
        prev.ey = z;
        prev.ets = ts;
      }
    }
  }

  const packs = {};
  for (const spec of SLICES) {
    const keep = [...stores[spec.id].values()]
      .filter((c) => c.presence >= MIN_PRESENCE_SEC || c.steps >= MIN_STEPS);
    let maxTraffic = 0;
    let maxDwell = 0;
    let maxSteps = 0;
    const cells = [];
    for (const c of keep) {
      const traffic = c.ids.size;
      maxTraffic = Math.max(maxTraffic, traffic);
      maxDwell = Math.max(maxDwell, c.dwell);
      maxSteps = Math.max(maxSteps, c.steps);
      const rsum = c.rose.reduce((a, b) => a + b, 0);
      const roseOut = rsum > 0
        ? c.rose.map((v) => Math.round((v / rsum) * 99))
        : new Array(BINS).fill(0);
      let sx = 0;
      let sy = 0;
      for (let b = 0; b < BINS; b++) {
        const a = (b / BINS) * 2 * Math.PI;
        sx += Math.cos(a) * c.rose[b];
        sy += Math.sin(a) * c.rose[b];
      }
      cells.push({
        i: c.ix,
        j: c.iy,
        t: traffic,
        k: Math.round(c.steps * 100) / 100,
        p: rsum > 0 ? Math.round((Math.hypot(sx, sy) / rsum) * 1000) / 1000 : 0,
        s: c.steps > 0 ? Math.round((c.speedSum / c.steps) * 100) / 100 : 0,
        d: Math.round(c.dwell * 10) / 10,
        e: Math.round(c.presence * 10) / 10,
        r: roseOut,
      });
    }
    const hours = spec.hours || [openHour, closeHour];
    packs[spec.id] = {
      meta: {
        source: 'track_positions (daily)',
        pack: 'live',
        slice: spec.id,
        slice_hours: hours,
        slice_dows: spec.dows,
        window: spec.window,
        local_date: dateStr,
        first_ts: Number.isFinite(firstTs) ? firstTs : null,
        last_ts: lastTs || null,
        span_hours: firstTs < lastTs ? Math.round(((lastTs - firstTs) / 3600000) * 10) / 10 : 0,
        venue_id: venueId,
        cell_m: C,
        bins: BINS,
        nx: keep.length ? (Math.max(...keep.map((c) => c.ix)) - Math.min(...keep.map((c) => c.ix)) + 1) : 0,
        ny: keep.length ? (Math.max(...keep.map((c) => c.iy)) - Math.min(...keep.map((c) => c.iy)) + 1) : 0,
        frame: 'venue',
        origin_m: { x: Math.round(gx0 * 1000) / 1000, y: Math.round(gy0 * 1000) / 1000 },
        rows_in_hours: sliceRows[spec.id],
        rows_total: rows.length,
        rows_open_hours: rowsInHours,
        window_local_hours: [openHour, closeHour],
        cells_emitted: cells.length,
        max_traffic: maxTraffic,
        max_steps: Math.round(maxSteps * 100) / 100,
        max_dwell_sec: Math.round(maxDwell * 10) / 10,
        steps_total: Math.round(cells.reduce((a, c) => a + c.k, 0)),
        tz_offset_h: tzOffsetH,
        built_at: Date.now(),
      },
      cells,
    };
  }
  return packs;
}
