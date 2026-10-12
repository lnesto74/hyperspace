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

export class FlowFieldDailyService {
  constructor(db, options = {}) {
    this.db = db;
    this.anchor = options.anchor || loadAnchor();
    this.cacheDir = options.cacheDir || path.join(__dirname, '../data/flowfield');
    this.tzOffsetH = Number(this.anchor.tz_offset_h ?? 2);
    this.openHour = this.anchor.open_hour ?? 7;
    this.closeHour = this.anchor.close_hour ?? 22;
    this.cell = this.anchor.cell_m ?? 1.5;
    this.defaultVenueId = this.anchor.venue?.id || DEFAULT_VENUE_ID;
    this.inflight = new Map();
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  packDir(venueId, dateStr) {
    return path.join(this.cacheDir, venueId, dateStr);
  }

  fieldPath(venueId, dateStr, slice) {
    return path.join(this.packDir(venueId, dateStr), `field_${slice}.json`);
  }

  localToday() {
    return dateStrFromParts(localParts(Date.now(), this.tzOffsetH));
  }

  listDates(venueId = this.defaultVenueId) {
    const off = this.tzOffsetH >= 0 ? `+${this.tzOffsetH} hours` : `${this.tzOffsetH} hours`;
    const rows = this.db.prepare(`
      SELECT date(timestamp / 1000, 'unixepoch', ?) AS d, COUNT(*) AS n
      FROM track_positions
      WHERE venue_id = ?
      GROUP BY d
      ORDER BY d DESC
    `).all(off, venueId);
    return rows.filter((r) => r.d).map((r) => ({ date: r.d, rows: r.n }));
  }

  latestDate(venueId = this.defaultVenueId) {
    const days = this.listDates(venueId);
    return days[0]?.date || null;
  }

  cacheFresh(venueId, dateStr, slice) {
    const p = this.fieldPath(venueId, dateStr, slice);
    if (!fs.existsSync(p)) return false;
    if (dateStr === this.localToday()) {
      const age = Date.now() - fs.statSync(p).mtimeMs;
      return age < TODAY_TTL_MS;
    }
    return true;
  }

  readField(venueId, dateStr, slice) {
    const p = this.fieldPath(venueId, dateStr, slice);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  async getField({ venueId, dateStr, slice, force = false } = {}) {
    const venue = venueId || this.defaultVenueId;
    if (!SLICE_IDS.has(slice)) throw Object.assign(new Error('unknown slice'), { status: 400 });
    const date = dateStr || this.latestDate(venue);
    if (!date) throw Object.assign(new Error('no track_positions for venue'), { status: 404 });
    if (!force && this.cacheFresh(venue, date, slice)) {
      return this.readField(venue, date, slice);
    }
    await this.rebuild(venue, date);
    const field = this.readField(venue, date, slice);
    if (!field) throw Object.assign(new Error('slice empty after rebuild'), { status: 404 });
    return field;
  }

  async rebuild(venueId, dateStr) {
    const key = `${venueId}:${dateStr}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this._rebuild(venueId, dateStr).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async _rebuild(venueId, dateStr) {
    const end = localMidnightUtcMs(dateStr, this.tzOffsetH) + 24 * 3600 * 1000;
    const start = end - 7 * 24 * 3600 * 1000;
    const rows = this.db.prepare(`
      SELECT track_key, timestamp, position_x, position_z
      FROM track_positions
      WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY track_key, timestamp
    `).all(venueId, start, end);

    const packs = aggregatePositions(rows, {
      cell: this.cell,
      tzOffsetH: this.tzOffsetH,
      openHour: this.openHour,
      closeHour: this.closeHour,
      dateStr,
      bbox: this.anchor.bbox,
      venueId,
    });

    const dir = this.packDir(venueId, dateStr);
    fs.mkdirSync(dir, { recursive: true });
    const index = {
      venue_id: venueId,
      local_date: dateStr,
      tz_offset_h: this.tzOffsetH,
      built_at: Date.now(),
      pack: 'live',
      slices: [],
    };
    for (const spec of SLICES) {
      const payload = packs[spec.id];
      fs.writeFileSync(this.fieldPath(venueId, dateStr, spec.id), JSON.stringify(payload));
      index.slices.push({
        id: spec.id,
        file: `field_${spec.id}.json`,
        cells: payload.meta.cells_emitted,
        rows: payload.meta.rows_in_hours,
        hours: payload.meta.slice_hours,
        dows: payload.meta.slice_dows,
        window: spec.window,
      });
    }
    fs.writeFileSync(path.join(dir, 'slices.json'), JSON.stringify(index, null, 2));
    console.log(`[flowfield] rebuilt ${venueId} ${dateStr} (${rows.length} rows, 7 slices)`);
    return index;
  }

  startNightly() {
    const tick = () => {
      const today = this.localToday();
      const yParts = localParts(localMidnightUtcMs(today, this.tzOffsetH) - 1, this.tzOffsetH);
      const yesterday = dateStrFromParts(yParts);
      this.rebuild(this.defaultVenueId, yesterday).catch((err) => {
        console.warn('[flowfield] nightly yesterday failed:', err.message);
      });
      this.rebuild(this.defaultVenueId, today).catch((err) => {
        console.warn('[flowfield] nightly today failed:', err.message);
      });
    };
    const schedule = () => {
      const now = Date.now();
      const parts = localParts(now, this.tzOffsetH);
      // 22:45 local, after close.
      let target = localMidnightUtcMs(dateStrFromParts(parts), this.tzOffsetH)
        + (22 * 60 + 45) * 60 * 1000;
      if (now >= target) target += 24 * 3600 * 1000;
      const wait = Math.max(15_000, target - now);
      this._nightlyTimer = setTimeout(() => {
        tick();
        schedule();
      }, wait);
      this._nightlyTimer.unref?.();
    };
    schedule();
    // Warm latest pack shortly after boot so the first visitor is not the extract.
    setTimeout(() => {
      const latest = this.latestDate();
      if (latest) {
        this.rebuild(this.defaultVenueId, latest).catch((err) => {
          console.warn('[flowfield] warmup failed:', err.message);
        });
      }
    }, 20_000).unref?.();
  }

  stopNightly() {
    if (this._nightlyTimer) clearTimeout(this._nightlyTimer);
  }
}
