/**
 * True path length from the vendor's raw MQTT feed, before and after reconciliation.
 *
 * The per-zone audit that reads `track_positions` can only ever report a lower
 * bound on distance walked: we store one position every 3 seconds, so the path
 * it reconstructs cuts every corner between samples. That is fine for comparing
 * zones with each other and useless for arguing with the perception vendor,
 * because the vendor is not responsible for our sampling.
 *
 * This script goes back to the archive of what the vendor actually published —
 * one message per tracked object at 10 Hz, kept as gzipped JSONL in
 * /data/hyperspace/raw — and measures the same window three ways.
 *
 *   fragment     a run of frames carrying one vendor object id with no dropout
 *                long enough to break continuity. This is the unit the supplier
 *                actually delivers, and its geometry is measured directly.
 *
 *   person       the fragments the production reconciler assigns to one stable
 *                identity, composed in time order. A person's distance is the
 *                sum of their fragments' distances, so reconciliation cannot
 *                create or destroy metres — it only decides how many identities
 *                those metres are spread across, which is the whole argument.
 *
 *   sampled      the same frames decimated to one position every 3 seconds,
 *                which is what the database keeps. Comparing this with the
 *                truth prices our own storage decision, separately from
 *                anything the vendor does.
 *
 * Two things are deliberately *not* done. The reconciler's emitted position
 * stream is never summed, because one stable identity can hold two
 * simultaneously live vendor ids and its position then alternates between two
 * people at 10 Hz, which inflates distance. And the straight line across a
 * dropout is never counted as walking; it is reported separately as bridged
 * distance, since where someone went while untracked is inferred, not observed.
 */
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import { createRequire } from 'module';
import { TrajectoryReconciler, normalizeReconcilerConfig } from '../backend/services/TrajectoryReconciler.js';
import {
  perceptionToFloor,
  applyTransformToPoint,
  applyTransformToVelocity,
  normalizePerceptionTransform,
} from '../backend/services/PerceptionTransform.js';

// The analysis tree is mounted into the backend container outside /app, so CJS
// dependencies resolve from the server's own module root rather than from here.
const require = createRequire(process.env.HYPERSPACE_REQUIRE_BASE || '/app/server.js');

/** A step faster than this is not a person walking; it is the tracker jumping. */
const TELEPORT_SPEED_M_S = 3.0;
/** Storage cadence we are pricing against the truth. */
const SAMPLE_MS = 3000;
/** An identity silent this long is finished and can be flushed from memory. */
const IDENTITY_IDLE_MS = 60_000;
/** Frames further apart than this are a coverage gap, not a normal step. */
const GAP_MS = 1000;
/**
 * A vendor object id that goes silent longer than this and then returns is
 * treated as a new fragment rather than the same continuous track. Perception
 * software reuses object ids, so keying purely on the id would silently glue
 * two different shoppers together and invent both a long lifetime and a
 * teleport between them.
 */
const RAW_SPLIT_GAP_MS = 2000;
/** A track that never moved this far is sensor clutter, not a shopper. */
const GHOST_PATH_M = 0.5;

function parseArgs(argv) {
  const o = {
    file: null,
    venueId: '55fdd53b-3298-4355-97c0-b4e789b11d06',
    from: null,
    to: null,
    out: null,
    db: process.env.DB_PATH || '/data/db/hyperspace.db',
    progress: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') o.file = argv[++i];
    else if (a === '--venue-id') o.venueId = argv[++i];
    else if (a === '--from') o.from = Number(argv[++i]);
    else if (a === '--to') o.to = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--db') o.db = argv[++i];
    else if (a === '--quiet') o.progress = false;
  }
  if (!o.file) {
    console.error('Required: --file <hyperspace-raw-YYYY-MM-DD.jsonl.gz>');
    process.exit(1);
  }
  return o;
}

const round = (n, dp = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/** Shoelace area of an {x, z} polygon in metres. */
function polygonArea(verts) {
  if (!Array.isArray(verts) || verts.length < 3) return null;
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    if (![p.x, p.z, q.x, q.z].every(Number.isFinite)) return null;
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

function parseJson(s, fallback) {
  try {
    return JSON.parse(s ?? '');
  } catch {
    return fallback;
  }
}

/**
 * Pull the timestamp out of a raw line without parsing the whole object.
 * A day holds tens of millions of messages and a windowed run would otherwise
 * spend most of its time building objects it is about to discard.
 */
function fastTimestamp(line) {
  const i = line.indexOf('"timestamp":');
  if (i < 0) return null;
  let j = i + 12;
  while (j < line.length && line.charCodeAt(j) === 32) j++;
  let n = 0;
  let digits = 0;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if (c < 48 || c > 57) break;
    n = n * 10 + (c - 48);
    digits++;
    j++;
  }
  return digits ? n : null;
}

/** Percentile of an unsorted numeric array, without mutating it. */
function quantile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

/**
 * Venue geometry and the exact live settings, read from the same places the
 * server reads them so the replay cannot drift from production.
 */
function loadVenueContext(dbPath, venueId) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });

  const venue = db.prepare('SELECT id, name, dwg_transform_json FROM venues WHERE id = ?').get(venueId);
  if (!venue) throw new Error(`Venue not found: ${venueId}`);
  const parsed = parseJson(venue.dwg_transform_json, {}) || {};

  const transform = normalizePerceptionTransform(parsed.perceptionTransform || {});
  const reconcilerConfig = normalizeReconcilerConfig({
    ...(parsed.reconciler || {}),
    enabled: true,
  });

  const objStmt = db.prepare('SELECT metadata_json FROM venue_objects WHERE id = ?');
  const zones = [];
  for (const r of db
    .prepare('SELECT id, name, vertices, metadata_json FROM regions_of_interest WHERE venue_id = ?')
    .all(venueId)) {
    const verts = parseJson(r.vertices, null);
    if (!Array.isArray(verts) || verts.length < 3) continue;
    const meta = parseJson(r.metadata_json, {}) || {};

    let category = meta.business_category_label || meta.business_category || null;
    if (!category && meta.shelfId) {
      const om = parseJson(objStmt.get(meta.shelfId)?.metadata_json, {}) || {};
      category = om.business_category_label || om.business_category || null;
    }

    const area = polygonArea(verts);
    zones.push({
      id: r.id,
      name: r.name,
      category: category || null,
      role: meta.template || null,
      areaM2: round(area, 1),
      // Roughly how far a shopper walks crossing a zone this size in a straight
      // line — the yardstick a measured path is judged against.
      spanM: area != null ? round(Math.sqrt(area), 1) : null,
      verts,
    });
  }

  db.close();
  return { venueName: venue.name, transform, reconcilerConfig, zones };
}

/**
 * Uniform grid over zone bounding boxes. At 10 Hz a busy day is tens of
 * millions of points, and testing every point against every polygon is the
 * difference between minutes and hours.
 */
class ZoneIndex {
  /**
   * A zone needing more cells than this is not indexed. The ROI table can hold
   * polygons in a different coordinate space than the venue floor — a survey
   * frame hundreds of kilometres from the origin, for instance — and paving a
   * grid across that gap costs gigabytes for a zone no shopper can ever be
   * inside. Those are tested directly instead, which is cheap because there are
   * only ever a handful.
   */
  static MAX_CELLS_PER_ZONE = 20_000;

  constructor(zones, cellM = 2) {
    this.zones = zones;
    this.cell = cellM;
    this.grid = new Map();
    this.unindexed = [];

    zones.forEach((z, idx) => {
      const xs = z.verts.map((p) => p.x);
      const zs = z.verts.map((p) => p.z);
      z._bbox = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };

      const cx0 = Math.floor(z._bbox.x0 / cellM);
      const cx1 = Math.floor(z._bbox.x1 / cellM);
      const cz0 = Math.floor(z._bbox.z0 / cellM);
      const cz1 = Math.floor(z._bbox.z1 / cellM);
      if (!Number.isFinite(cx0) || !Number.isFinite(cz0)) return;

      if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > ZoneIndex.MAX_CELLS_PER_ZONE) {
        this.unindexed.push(idx);
        return;
      }

      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const key = `${cx},${cz}`;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(idx);
        }
      }
    });
  }

  /** Index of the first zone containing the point, or -1. */
  find(x, z) {
    const cands = this.grid.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    if (cands) {
      for (const idx of cands) {
        const zone = this.zones[idx];
        const b = zone._bbox;
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        if (pointInPolygon(x, z, zone.verts)) return idx;
      }
    }
    for (const idx of this.unindexed) {
      const zone = this.zones[idx];
      const b = zone._bbox;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (pointInPolygon(x, z, zone.verts)) return idx;
    }
    return -1;
  }
}

function pointInPolygon(x, z, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x;
    const zi = verts[i].z;
    const xj = verts[j].x;
    const zj = verts[j].z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Measures the geometry the supplier delivered, one vendor object id at a time,
 * and hands each finished fragment on for composition into a person.
 *
 * Everything here is observed: distance is only accumulated between frames that
 * actually arrived close enough together to be a step.
 */
class FragmentTracker {
  constructor(zoneIndex, onFragment) {
    this.zoneIndex = zoneIndex;
    this.onFragment = onFragment;
    this.live = new Map();
    this.totals = {
      fragments: 0, pathTotal: 0, sampledPathTotal: 0, durationTotal: 0,
      steps: 0, teleports: 0, gaps: 0, gapMsTotal: 0, ghosts: 0,
    };
    this.durations = [];
    this.paths = [];
    this.zones = new Map();
  }

  zoneAgg(idx) {
    if (!this.zones.has(idx)) {
      this.zones.set(idx, { visits: 0, pathTotal: 0, sampledPathTotal: 0, dwellMsTotal: 0, samples: 0, singleSample: 0 });
    }
    return this.zones.get(idx);
  }

  add(identity, t, x, z, stableId) {
    let s = this.live.get(identity);
    if (s && t - s.lastT > RAW_SPLIT_GAP_MS) {
      // Same id, but the tracker lost it long enough that continuity cannot be
      // assumed. Close the fragment and begin a new one.
      this._retire(identity, s);
      s = null;
    }

    if (!s) {
      s = {
        firstT: t, lastT: t, firstX: x, firstZ: z, lastX: x, lastZ: z,
        path: 0, steps: 0, teleports: 0, gaps: 0, gapMs: 0,
        sampT: t, sampX: x, sampZ: z, sampPath: 0,
        roi: this.zoneIndex.find(x, z), runPath: 0, runSampPath: 0,
        runStartT: t, runLastT: t, runSamples: 1,
        runs: [], stableId: stableId || null,
      };
      this.live.set(identity, s);
      return;
    }

    if (stableId && !s.stableId) s.stableId = stableId;

    const dt = t - s.lastT;
    const step = Math.hypot(x - s.lastX, z - s.lastZ);
    let gapped = false;
    if (dt > 0) {
      if (dt > GAP_MS) {
        gapped = true;
        s.gaps += 1;
        s.gapMs += dt;
        // The decimated path has to skip the dropout too, or it would cross a
        // distance the full-rate path refused to cross and come out longer than
        // the truth it is meant to approximate.
        s.sampT = t;
        s.sampX = x;
        s.sampZ = z;
      } else {
        s.path += step;
        s.steps += 1;
        if (step / (dt / 1000) > TELEPORT_SPEED_M_S) s.teleports += 1;
      }
    }

    const roi = this.zoneIndex.find(x, z);
    if (roi !== s.roi) {
      this._closeRun(s);
      s.roi = roi;
      s.runStartT = t;
      s.runPath = 0;
      s.runSampPath = 0;
      s.runSamples = 1;
      s.runLastT = t;
    } else {
      if (!gapped && dt > 0) s.runPath += step;
      s.runSamples += 1;
      s.runLastT = t;
    }

    if (!gapped && t - s.sampT >= SAMPLE_MS) {
      const sampStep = Math.hypot(x - s.sampX, z - s.sampZ);
      s.sampPath += sampStep;
      if (roi >= 0) s.runSampPath += sampStep;
      s.sampT = t;
      s.sampX = x;
      s.sampZ = z;
    }

    s.lastT = t;
    s.lastX = x;
    s.lastZ = z;
  }

  _closeRun(s) {
    if (s.roi < 0 || s.runSamples === 0) return;
    const z = this.zoneAgg(s.roi);
    z.visits += 1;
    z.pathTotal += s.runPath;
    z.sampledPathTotal += s.runSampPath;
    z.dwellMsTotal += Math.max(0, s.runLastT - s.runStartT);
    z.samples += s.runSamples;
    if (s.runSamples === 1) z.singleSample += 1;
    s.runs.push({
      roi: s.roi,
      startT: s.runStartT,
      endT: s.runLastT,
      path: s.runPath,
      sampPath: s.runSampPath,
      samples: s.runSamples,
    });
  }

  _retire(identity, s) {
    this._closeRun(s);
    this.totals.fragments += 1;
    this.totals.pathTotal += s.path;
    this.totals.sampledPathTotal += s.sampPath;
    this.totals.durationTotal += s.lastT - s.firstT;
    this.totals.steps += s.steps;
    this.totals.teleports += s.teleports;
    this.totals.gaps += s.gaps;
    this.totals.gapMsTotal += s.gapMs;
    if (s.path < GHOST_PATH_M) this.totals.ghosts += 1;
    this.durations.push(s.lastT - s.firstT);
    this.paths.push(s.path);
    this.live.delete(identity);
    this.onFragment(s);
  }

  sweep(now) {
    for (const [identity, s] of this.live) {
      if (now - s.lastT > IDENTITY_IDLE_MS) this._retire(identity, s);
    }
  }

  finish() {
    for (const [identity, s] of [...this.live]) this._retire(identity, s);
  }

  summary() {
    const n = this.totals.fragments || 1;
    return {
      tracks: this.totals.fragments,
      meanPathM: round(this.totals.pathTotal / n, 2),
      medianPathM: round(quantile(this.paths, 0.5), 2),
      p90PathM: round(quantile(this.paths, 0.9), 2),
      meanSampledPathM: round(this.totals.sampledPathTotal / n, 2),
      totalPathM: round(this.totals.pathTotal, 1),
      totalSampledPathM: round(this.totals.sampledPathTotal, 1),
      meanDurationSec: round(this.totals.durationTotal / n / 1000, 1),
      medianDurationSec: round(quantile(this.durations, 0.5) / 1000, 1),
      p90DurationSec: round(quantile(this.durations, 0.9) / 1000, 1),
      // Tracks that never went anywhere. A high share means the supplier is
      // emitting clutter that every downstream count has to throw away.
      ghostPct: pct(this.totals.ghosts, this.totals.fragments),
      teleports: this.totals.teleports,
      teleportPctOfSteps: pct(this.totals.teleports, this.totals.steps),
      coverageGaps: this.totals.gaps,
      gapSecTotal: round(this.totals.gapMsTotal / 1000, 1),
      gapShareOfLifetimePct: pct(this.totals.gapMsTotal, this.totals.durationTotal),
    };
  }
}

/**
 * Assembles fragments into people, in time order, using the stable identity the
 * production reconciler assigned.
 *
 * A person's distance is the sum of their fragments' distances and nothing
 * else, which makes conservation an identity rather than a hope: reconciliation
 * cannot add a metre, it can only stop attributing one shopper's metres to
 * several strangers. What it does have to invent is the route across each
 * dropout, and that is kept apart as bridged distance so nobody mistakes an
 * inference for a measurement.
 */
class PersonComposer {
  constructor(zoneVisitMergeMs) {
    this.mergeMs = zoneVisitMergeMs;
    this.open = new Map();
    this.totals = {
      people: 0, pathTotal: 0, sampledPathTotal: 0, durationTotal: 0,
      fragments: 0, multiFragment: 0, ghosts: 0,
      bridges: 0, bridgeDistTotal: 0, bridgeMsTotal: 0,
    };
    this.durations = [];
    this.paths = [];
    this.zones = new Map();
  }

  zoneAgg(idx) {
    if (!this.zones.has(idx)) {
      this.zones.set(idx, { visits: 0, pathTotal: 0, sampledPathTotal: 0, dwellMsTotal: 0, people: 0 });
    }
    return this.zones.get(idx);
  }

  addFragment(stableId, frag) {
    let p = this.open.get(stableId);
    if (!p) {
      p = {
        firstT: frag.firstT, lastT: frag.lastT, path: 0, sampPath: 0, fragments: 0,
        bridges: 0, bridgeDist: 0, bridgeMs: 0,
        lastEndT: null, lastEndX: null, lastEndZ: null,
        zones: new Map(),
      };
      this.open.set(stableId, p);
    }

    if (p.lastEndT != null && frag.firstT >= p.lastEndT) {
      // The supplier stopped reporting this shopper between the two fragments.
      // Straight line and elapsed time are the most that can honestly be said
      // about what happened in between.
      p.bridges += 1;
      p.bridgeDist += Math.hypot(frag.firstX - p.lastEndX, frag.firstZ - p.lastEndZ);
      p.bridgeMs += frag.firstT - p.lastEndT;
    }

    p.path += frag.path;
    p.sampPath += frag.sampPath;
    p.fragments += 1;
    p.firstT = Math.min(p.firstT, frag.firstT);
    p.lastT = Math.max(p.lastT, frag.lastT);
    p.lastEndT = frag.lastT;
    p.lastEndX = frag.lastX;
    p.lastEndZ = frag.lastZ;

    for (const run of frag.runs) {
      let groups = p.zones.get(run.roi);
      if (!groups) {
        groups = [];
        p.zones.set(run.roi, groups);
      }
      const last = groups.length ? groups[groups.length - 1] : null;
      // Two runs in the same zone separated only by a dropout the reconciler
      // was willing to bridge are one visit, not two. This is what stops
      // fragmentation from inflating visit counts.
      if (last && run.startT - last.endT <= this.mergeMs) {
        last.endT = Math.max(last.endT, run.endT);
        last.path += run.path;
        last.sampPath += run.sampPath;
      } else {
        groups.push({ startT: run.startT, endT: run.endT, path: run.path, sampPath: run.sampPath });
      }
    }
  }

  _retire(stableId, p) {
    this.totals.people += 1;
    this.totals.pathTotal += p.path;
    this.totals.sampledPathTotal += p.sampPath;
    this.totals.durationTotal += p.lastT - p.firstT;
    this.totals.fragments += p.fragments;
    if (p.fragments > 1) this.totals.multiFragment += 1;
    if (p.path < GHOST_PATH_M) this.totals.ghosts += 1;
    this.totals.bridges += p.bridges;
    this.totals.bridgeDistTotal += p.bridgeDist;
    this.totals.bridgeMsTotal += p.bridgeMs;
    this.durations.push(p.lastT - p.firstT);
    this.paths.push(p.path);

    for (const [roi, groups] of p.zones) {
      const z = this.zoneAgg(roi);
      z.people += 1;
      for (const g of groups) {
        z.visits += 1;
        z.pathTotal += g.path;
        z.sampledPathTotal += g.sampPath;
        z.dwellMsTotal += Math.max(0, g.endT - g.startT);
      }
    }
    this.open.delete(stableId);
  }

  sweep(now) {
    for (const [stableId, p] of this.open) {
      if (now - p.lastT > IDENTITY_IDLE_MS) this._retire(stableId, p);
    }
  }

  finish() {
    for (const [stableId, p] of [...this.open]) this._retire(stableId, p);
  }

  summary() {
    const n = this.totals.people || 1;
    return {
      tracks: this.totals.people,
      meanPathM: round(this.totals.pathTotal / n, 2),
      medianPathM: round(quantile(this.paths, 0.5), 2),
      p90PathM: round(quantile(this.paths, 0.9), 2),
      meanSampledPathM: round(this.totals.sampledPathTotal / n, 2),
      totalPathM: round(this.totals.pathTotal, 1),
      totalSampledPathM: round(this.totals.sampledPathTotal, 1),
      meanDurationSec: round(this.totals.durationTotal / n / 1000, 1),
      medianDurationSec: round(quantile(this.durations, 0.5) / 1000, 1),
      p90DurationSec: round(quantile(this.durations, 0.9) / 1000, 1),
      ghostPct: pct(this.totals.ghosts, this.totals.people),
    };
  }
}

async function* readLines(file) {
  const stream = file.endsWith('.gz')
    ? fs.createReadStream(file).pipe(zlib.createGunzip())
    : fs.createReadStream(file);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

async function main() {
  const args = parseArgs(process.argv);
  const ctx = loadVenueContext(args.db, args.venueId);
  const zoneIndex = new ZoneIndex(ctx.zones);

  // The reconciler ages tracks by its own clock. Driving that clock from the
  // archive rather than the wall means a gap the shopper actually left is the
  // gap the re-identifier sees. On wall time a replay compresses a trading day
  // into minutes, so every gap looks instantaneous and nothing is ever retired.
  let streamNow = 0;
  const reconciler = new TrajectoryReconciler(() => ctx.reconcilerConfig, { now: () => streamNow });

  const people = new PersonComposer((ctx.reconcilerConfig.reid_max_gap_s || 18) * 1000);
  let orphanFragments = 0;
  let orphanPath = 0;

  const fragments = new FragmentTracker(zoneIndex, (frag) => {
    if (frag.stableId) {
      people.addFragment(frag.stableId, frag);
    } else {
      // Every frame of this fragment was filtered as a ghost, so it belongs to
      // no person. Counted, not silently dropped.
      orphanFragments += 1;
      orphanPath += frag.path;
    }
  });

  const distinctVendorIds = new Set();
  let lines = 0;
  let used = 0;
  let dropped = 0;
  let firstTs = null;
  let lastTs = null;
  let lastSweep = 0;
  const frameDeltas = [];
  let prevTsForFrame = null;

  const t0 = Date.now();
  for await (const line of readLines(args.file)) {
    lines += 1;
    if (args.progress && lines % 500_000 === 0) {
      process.stderr.write(
        `  … ${(lines / 1e6).toFixed(1)}M lines · ${used.toLocaleString()} used · `
        + `${new Date(lastTs || 0).toISOString().slice(11, 16)} archive · `
        + `live frag ${fragments.live.size} / people ${people.open.size} · `
        + `${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
      );
    }
    if (!line || line[0] !== '{') continue;

    const ts = fastTimestamp(line);
    if (ts == null) continue;
    if (args.from != null && ts < args.from) continue;
    if (args.to != null && ts > args.to) break;

    const d = parseJson(line, null);
    if (!d || !d.position) continue;
    if (d.venueId && d.venueId !== args.venueId) continue;

    const t = Number(d.timestamp);
    if (!Number.isFinite(t) || t <= 0) continue;

    const floorPos = perceptionToFloor(ctx.transform.input_frame, d.position);
    const floorVel = perceptionToFloor(ctx.transform.input_frame, d.velocity || { x: 0, y: 0, z: 0 });
    const venuePosition = applyTransformToPoint(ctx.transform, floorPos);
    const velocity = applyTransformToVelocity(ctx.transform, floorVel);
    if (!Number.isFinite(venuePosition.x) || !Number.isFinite(venuePosition.z)) {
      dropped += 1;
      continue;
    }

    used += 1;
    if (firstTs == null) firstTs = t;
    lastTs = t;
    if (prevTsForFrame != null && t > prevTsForFrame && frameDeltas.length < 200_000) {
      frameDeltas.push(t - prevTsForFrame);
    }
    prevTsForFrame = t;
    streamNow = t;

    if (t - lastSweep > 250) {
      lastSweep = t;
      reconciler.sweep(t);
      fragments.sweep(t);
      people.sweep(t);
    }

    // The reconciler decides identity; the geometry stays the vendor's own, so
    // both sides of the comparison are measured on identical coordinates.
    const out = reconciler.process({
      id: String(d.id),
      deviceId: d.deviceId || 'edge',
      venueId: args.venueId,
      timestamp: t,
      position: venuePosition,
      venuePosition,
      velocity,
    });

    const rawId = `${d.deviceId || 'edge'}:${d.id}`;
    distinctVendorIds.add(rawId);
    fragments.add(rawId, t, venuePosition.x, venuePosition.z, out ? out.stableId || out.id : null);
  }

  if (lastTs != null) {
    streamNow = lastTs + 60_000;
    reconciler.sweep(streamNow);
  }
  fragments.finish();
  people.finish();

  frameDeltas.sort((a, b) => a - b);
  const medianFrameMs = frameDeltas.length ? frameDeltas[Math.floor(frameDeltas.length / 2)] : null;

  const rawSummary = fragments.summary();
  const recSummary = people.summary();

  const zones = ctx.zones
    .map((z, idx) => {
      const r = fragments.zones.get(idx);
      const c = people.zones.get(idx);
      if (!r && !c) return null;
      const rawMeanPath = r && r.visits ? r.pathTotal / r.visits : null;
      const recMeanPath = c && c.visits ? c.pathTotal / c.visits : null;
      const recMeanSampled = c && c.visits ? c.sampledPathTotal / c.visits : null;
      return {
        id: z.id,
        name: z.name,
        category: z.category,
        role: z.role,
        areaM2: z.areaM2,
        spanM: z.spanM,
        raw: {
          visits: r?.visits ?? 0,
          meanPathM: round(rawMeanPath, 2),
          meanDwellSec: r && r.visits ? round(r.dwellMsTotal / r.visits / 1000, 1) : null,
          meanSamplesPerVisit: r && r.visits ? round(r.samples / r.visits, 1) : null,
        },
        reconciled: {
          visits: c?.visits ?? 0,
          people: c?.people ?? 0,
          meanPathM: round(recMeanPath, 2),
          meanDwellSec: c && c.visits ? round(c.dwellMsTotal / c.visits / 1000, 1) : null,
        },
        // What the database keeps for the same visits, so the loss from storing
        // one position every three seconds is visible next to the truth.
        sampled: {
          meanPathM: round(recMeanSampled, 2),
          pathRetainedPct: recMeanPath > 0 ? pct(recMeanSampled, recMeanPath) : null,
        },
        pathVsSpan: recMeanPath != null && z.spanM ? round(recMeanPath / z.spanM, 2) : null,
        // How many separate visits the supplier reported for each real one.
        fragmentsPerVisit: c && c.visits ? round((r?.visits ?? 0) / c.visits, 2) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.reconciled.visits - a.reconciled.visits);

  const conservationErrorPct = rawSummary.totalPathM > 0
    ? Math.abs(rawSummary.totalPathM - (recSummary.totalPathM + orphanPath))
      / rawSummary.totalPathM * 100
    : 0;

  const result = {
    venueId: args.venueId,
    venueName: ctx.venueName,
    source: args.file,
    window: {
      requestedFrom: args.from,
      requestedTo: args.to,
      firstTs,
      lastTs,
      durationSec: firstTs && lastTs ? round((lastTs - firstTs) / 1000, 0) : null,
    },
    generatedAt: new Date().toISOString(),
    method: {
      source: 'Vendor MQTT archive: one message per tracked object, published at 10 Hz and stored verbatim.',
      rawIdentity: 'deviceId:objectId exactly as the perception software emitted it.',
      rawFragmentRule: `A vendor id silent for more than ${RAW_SPLIT_GAP_MS} ms and then returning is counted as a new fragment, because perception software reuses object ids and gluing them would invent both lifetime and movement.`,
      reconciledIdentity: 'Fragments grouped by the stable id the production TrajectoryReconciler assigned, replayed with the venue live config on the archive clock so gaps are the gaps the shopper actually left.',
      pathRule: `Distance is summed between consecutive frames. Steps across a frame gap longer than ${GAP_MS} ms are excluded, because a line drawn across a tracking dropout is not walking. A person's distance is the sum of their fragments' distances, never the reconciler's emitted position stream, which can alternate between two simultaneously live vendor ids.`,
      bridgeRule: 'Distance and time across a dropout are reported separately as bridged, because where someone went while untracked is inferred rather than observed.',
      teleportRule: `A step implying more than ${TELEPORT_SPEED_M_S} m/s is counted as a teleport rather than treated as an error.`,
      samplingRule: `The sampled figures decimate the same frames to one position every ${SAMPLE_MS} ms, which is what track_positions stores.`,
      zoneRule: 'Each frame is attributed to the first zone whose polygon contains it; a point inside two overlapping zones counts once.',
      reconcilerConfig: ctx.reconcilerConfig,
    },
    ingest: {
      linesRead: lines,
      messagesUsed: used,
      messagesDropped: dropped,
      medianFrameIntervalMs: medianFrameMs,
      elapsedSec: round((Date.now() - t0) / 1000, 1),
      zonesIndexed: ctx.zones.length - zoneIndex.unindexed.length,
      zonesTestedDirectly: zoneIndex.unindexed.map((i) => ctx.zones[i].name),
    },
    totals: {
      raw: rawSummary,
      reconciled: recSummary,
      distinctVendorIds: distinctVendorIds.size,
      // How many separate identities the supplier spent on one shopper.
      vendorFragmentsPerPerson: recSummary.tracks > 0
        ? round(people.totals.fragments / recSummary.tracks, 2)
        : null,
      peopleAffectedByFragmentationPct: pct(people.totals.multiFragment, people.totals.people),
      // A single supplier identity holds this share of one shopper's journey.
      journeyHeldByVendorIdentityPct:
        recSummary.meanPathM > 0 ? pct(rawSummary.meanPathM, recSummary.meanPathM) : null,
      journeyHeldByVendorIdentitySec:
        recSummary.meanDurationSec > 0 ? pct(rawSummary.meanDurationSec, recSummary.meanDurationSec) : null,
      // What reconciliation had to infer because the supplier stopped reporting.
      bridgesPerPerson: recSummary.tracks > 0 ? round(people.totals.bridges / recSummary.tracks, 2) : null,
      meanBridgedDistanceM: recSummary.tracks > 0
        ? round(people.totals.bridgeDistTotal / recSummary.tracks, 2)
        : null,
      meanBridgedSec: recSummary.tracks > 0
        ? round(people.totals.bridgeMsTotal / recSummary.tracks / 1000, 1)
        : null,
      // Fragments the reconciler filtered entirely, so they belong to nobody.
      fragmentsDroppedAsGhosts: orphanFragments,
      droppedGhostPathM: round(orphanPath, 1),
      // Distance is conserved by construction; this is the arithmetic check.
      conservationErrorPct: round(conservationErrorPct, 3),
      // Cost of our own storage decision, priced against the same frames.
      pathRetainedBySamplingPct:
        recSummary.meanPathM > 0 ? pct(recSummary.meanSampledPathM, recSummary.meanPathM) : null,
    },
    zones,
  };

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    fs.mkdirSync(args.out.replace(/\/[^/]+$/, ''), { recursive: true });
    fs.writeFileSync(args.out, json);
    process.stderr.write(`\nWrote ${args.out}\n`);
  }
  process.stdout.write(json);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
