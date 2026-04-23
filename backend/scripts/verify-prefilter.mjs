#!/usr/bin/env node
// Standalone verification of prefilterFixtures against TREVIGLIO data.
// Reads raw_json from the SQLite DB and applies the prefilter.

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'database', 'hyperspace.db');
const IMPORT_ID = process.argv[2] || '123f665a-511e-4fa0-bd79-9ac91067b705';

// Inline copy of the prefilter so we can run without booting the server.
const PREFILTER_DEFAULTS = {
  maxFixtureSizeM: 15,
  maxPolylineSingletonSizeM: 5,
  madSpreads: [12, 8, 6],
  madMaxDropFraction: 0.5,
  clusterWindowM: 150,
  clusterMarginM: 20,
  clusterMinKeepFraction: 0.25,
  minFixtureSizeM: 0.001,
  layerBlocklist: [
    /^defpoints$/i, /nonplott|non[-_ ]?plott/i, /^viewport(s)?$/i,
    /^title[-_ ]?block$/i, /^cartiglio/i, /^border$/i, /^sheet$/i,
    /muratur/i, /pilastr/i, /tavolat/i, /serrament/i, /^0s-?epdm/i,
    /prospetto/i, /proiezion/i, /contorno[-_ ]?retin/i, /^retini/i,
    /segnaletica/i, /poligoni/i, /pavimentazion/i, /cordoli/i,
    /parapett/i, /struttura[-_ ]?cement/i, /sigillatur/i, /viteri/i,
    /caditoi/i, /confin/i, /riferiment/i, /catastal/i,
  ],
};

function prefilterFixtures(fixtures, unitScaleToM, opts = {}) {
  const cfg = { ...PREFILTER_DEFAULTS, ...opts };
  const u = unitScaleToM || 0.001;
  const stats = {
    input: fixtures.length,
    droppedByLayer: 0, droppedByDegenerate: 0, droppedBySize: 0,
    droppedByPolylineSingleton: 0, droppedByCoordinateOutlier: 0, droppedByCluster: 0, kept: 0,
    droppedSamples: { layer: [], size: [], polylineSingleton: [], coordinateOutlier: [] },
  };
  const sample = (b, i) => stats.droppedSamples[b].length < 5 && stats.droppedSamples[b].push(i);
  const sizeM = f => Math.max(Math.abs(f.footprint.w || 0), Math.abs(f.footprint.d || 0)) * u;
  const minDimM = f => Math.min(Math.abs(f.footprint.w || 0), Math.abs(f.footprint.d || 0)) * u;

  let kept = fixtures.filter(f => {
    const layer = f.source?.layer || '';
    if (cfg.layerBlocklist.some(rx => rx.test(layer))) {
      stats.droppedByLayer++;
      sample('layer', { layer, block: f.source?.block || null, w_m: +(sizeM(f)).toFixed(2) });
      return false;
    }
    return true;
  });
  kept = kept.filter(f => {
    if (sizeM(f) < cfg.minFixtureSizeM || minDimM(f) < cfg.minFixtureSizeM) {
      stats.droppedByDegenerate++;
      return false;
    }
    return true;
  });
  kept = kept.filter(f => {
    if (sizeM(f) > cfg.maxFixtureSizeM) {
      stats.droppedBySize++;
      sample('size', {
        layer: f.source?.layer, block: f.source?.block || null,
        w_m: +(f.footprint.w * u).toFixed(2), d_m: +(f.footprint.d * u).toFixed(2),
      });
      return false;
    }
    return true;
  });

  const polyKey = f => {
    const wKey = Math.round((f.footprint.w || 0) / 25) * 25;
    const dKey = Math.round((f.footprint.d || 0) / 25) * 25;
    return `${f.source?.layer}|${wKey}x${dKey}`;
  };
  const polyCount = new Map();
  for (const f of kept) {
    if (f.source?.block) continue;
    polyCount.set(polyKey(f), (polyCount.get(polyKey(f)) || 0) + 1);
  }
  kept = kept.filter(f => {
    if (f.source?.block) return true;
    if (sizeM(f) <= cfg.maxPolylineSingletonSizeM) return true;
    if ((polyCount.get(polyKey(f)) || 0) <= 1) {
      stats.droppedByPolylineSingleton++;
      sample('polylineSingleton', {
        layer: f.source?.layer,
        w_m: +(f.footprint.w * u).toFixed(2), d_m: +(f.footprint.d * u).toFixed(2),
      });
      return false;
    }
    return true;
  });

  const spreads = Array.isArray(cfg.madSpreads) ? cfg.madSpreads : (typeof cfg.madSpread === 'number' ? [cfg.madSpread] : []);
  if (kept.length >= 20 && spreads.length > 0) {
    stats.madPasses = [];
    for (let pass = 0; pass < spreads.length; pass++) {
      if (kept.length < 20) break;
      const spread = spreads[pass];
      const xs = kept.map(f => f.pose2d?.x ?? 0).slice().sort((a, b) => a - b);
      const ys = kept.map(f => f.pose2d?.y ?? 0).slice().sort((a, b) => a - b);
      const mid = arr => arr[Math.floor(arr.length / 2)];
      const mX = mid(xs), mY = mid(ys);
      const devX = kept.map(f => Math.abs((f.pose2d?.x ?? 0) - mX)).sort((a, b) => a - b);
      const devY = kept.map(f => Math.abs((f.pose2d?.y ?? 0) - mY)).sort((a, b) => a - b);
      const madX = Math.max(mid(devX), 1), madY = Math.max(mid(devY), 1);
      const lX = spread * madX, lY = spread * madY;
      const candidate = [], removed = [];
      for (const f of kept) {
        const dx = Math.abs((f.pose2d?.x ?? 0) - mX);
        const dy = Math.abs((f.pose2d?.y ?? 0) - mY);
        if (dx > lX || dy > lY) removed.push(f); else candidate.push(f);
      }
      const dropFrac = removed.length / kept.length;
      if (dropFrac > cfg.madMaxDropFraction) {
        stats.madPasses.push({ pass: pass + 1, spread, skipped: true, wouldDrop: removed.length });
        continue;
      }
      stats.droppedByCoordinateOutlier += removed.length;
      for (const f of removed.slice(0, 5)) {
        sample('coordinateOutlier', {
          layer: f.source?.layer, block: f.source?.block || null,
          x_m: +((f.pose2d?.x ?? 0) * u).toFixed(1),
          y_m: +((f.pose2d?.y ?? 0) * u).toFixed(1),
          pass: pass + 1,
        });
      }
      stats.madPasses.push({
        pass: pass + 1, spread, dropped: removed.length, kept: candidate.length,
        median_m: { x: +(mX * u).toFixed(1), y: +(mY * u).toFixed(1) },
        mad_m: { x: +(madX * u).toFixed(2), y: +(madY * u).toFixed(2) },
      });
      kept = candidate;
    }
  }

  if (cfg.clusterWindowM > 0 && kept.length >= 50) {
    const winSize = cfg.clusterWindowM / u;
    const margin = cfg.clusterMarginM / u;
    const densest = (vals) => {
      const s = vals.slice().sort((a,b)=>a-b);
      let bestStart = s[0], bestCount = 0, j = 0;
      for (let i = 0; i < s.length; i++) {
        if (j < i) j = i;
        while (j < s.length && s[j] - s[i] <= winSize) j++;
        if (j - i > bestCount) { bestCount = j - i; bestStart = s[i]; }
      }
      return { lo: bestStart - margin, hi: bestStart + winSize + margin, count: bestCount };
    };
    const wx = densest(kept.map(f => f.pose2d?.x ?? 0));
    const wy = densest(kept.map(f => f.pose2d?.y ?? 0));
    const inside = kept.filter(f => {
      const x = f.pose2d?.x ?? 0, y = f.pose2d?.y ?? 0;
      return x >= wx.lo && x <= wx.hi && y >= wy.lo && y <= wy.hi;
    });
    const keepFrac = inside.length / kept.length;
    stats.cluster = {
      windowM: cfg.clusterWindowM, marginM: cfg.clusterMarginM,
      window_x_m: { lo: +(wx.lo * u).toFixed(1), hi: +(wx.hi * u).toFixed(1) },
      window_y_m: { lo: +(wy.lo * u).toFixed(1), hi: +(wy.hi * u).toFixed(1) },
      droppedOutside: kept.length - inside.length, kept: inside.length,
      keepFraction: +keepFrac.toFixed(3),
    };
    if (keepFrac >= cfg.clusterMinKeepFraction) {
      stats.droppedByCluster = kept.length - inside.length;
      kept = inside;
    } else {
      stats.cluster.skipped = true;
      stats.droppedByCluster = 0;
    }
  } else {
    stats.droppedByCluster = 0;
  }

  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const f of kept) {
    const x = f.pose2d?.x ?? 0, y = f.pose2d?.y ?? 0;
    const hw = (f.footprint?.w || 0) / 2, hd = (f.footprint?.d || 0) / 2;
    b.minX = Math.min(b.minX, x - hw); b.minY = Math.min(b.minY, y - hd);
    b.maxX = Math.max(b.maxX, x + hw); b.maxY = Math.max(b.maxY, y + hd);
  }
  if (b.minX === Infinity) Object.assign(b, { minX: 0, minY: 0, maxX: 0, maxY: 0 });

  stats.kept = kept.length;
  stats.boundsM = {
    width: +((b.maxX - b.minX) * u).toFixed(2),
    depth: +((b.maxY - b.minY) * u).toFixed(2),
  };
  return { fixtures: kept, bounds: b, stats };
}

const db = new Database(DB_PATH, { readonly: true });
const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(IMPORT_ID);
if (!imp) { console.error('Import not found'); process.exit(1); }

const raw = JSON.parse(imp.raw_json || '{}');
const fixtures = raw.fixtures || [];
console.log(`\n=== Verifying prefilter on: ${imp.filename} ===`);
console.log(`Units: ${imp.units} (scale ${imp.unit_scale_to_m})`);
console.log(`Input: ${fixtures.length} fixtures`);

const beforeBounds = JSON.parse(imp.bounds_json);
const beforeW = ((beforeBounds.maxX - beforeBounds.minX) * imp.unit_scale_to_m).toFixed(1);
const beforeD = ((beforeBounds.maxY - beforeBounds.minY) * imp.unit_scale_to_m).toFixed(1);
console.log(`Before bounds: ${beforeW} m × ${beforeD} m`);

const result = prefilterFixtures(fixtures, imp.unit_scale_to_m);

console.log(`\n--- Drop counts ---`);
console.log(`  by layer blocklist:    ${result.stats.droppedByLayer}`);
console.log(`  by degenerate (~0):    ${result.stats.droppedByDegenerate}`);
console.log(`  by size cap (>15m):    ${result.stats.droppedBySize}`);
console.log(`  by poly singleton:     ${result.stats.droppedByPolylineSingleton}`);
console.log(`  by coord MAD outlier:  ${result.stats.droppedByCoordinateOutlier}`);
if (result.stats.madPasses) {
  for (const p of result.stats.madPasses) {
    if (p.skipped) console.log(`    pass ${p.pass} (×${p.spread}): SKIPPED (would drop ${p.wouldDrop}, exceeds safety)`);
    else console.log(`    pass ${p.pass} (×${p.spread}): dropped=${p.dropped} kept=${p.kept}, median=(${p.median_m.x}, ${p.median_m.y}) MAD=(${p.mad_m.x}, ${p.mad_m.y})`);
  }
}
console.log(`  by primary cluster:    ${result.stats.droppedByCluster}`);
if (result.stats.cluster) {
  const c = result.stats.cluster;
  console.log(`    window X: [${c.window_x_m.lo}, ${c.window_x_m.hi}] m  Y: [${c.window_y_m.lo}, ${c.window_y_m.hi}] m`);
  console.log(`    keep fraction: ${(c.keepFraction*100).toFixed(1)}%${c.skipped ? ' (SKIPPED — below minKeepFraction)' : ''}`);
}
console.log(`  TOTAL kept:            ${result.stats.kept} / ${result.stats.input}`);
console.log(`After bounds: ${result.stats.boundsM.width} m × ${result.stats.boundsM.depth} m`);

const sumArea = result.fixtures.reduce((s, f) => {
  const wm = (f.footprint?.w || 0) * imp.unit_scale_to_m;
  const dm = (f.footprint?.d || 0) * imp.unit_scale_to_m;
  return s + wm * dm;
}, 0);
console.log(`Sum of fixture areas (kept): ${sumArea.toFixed(1)} m²`);

// Distribution of kept fixture centroids in metres
const xsKept = result.fixtures.map(f => (f.pose2d?.x ?? 0) * imp.unit_scale_to_m).sort((a,b)=>a-b);
const ysKept = result.fixtures.map(f => (f.pose2d?.y ?? 0) * imp.unit_scale_to_m).sort((a,b)=>a-b);
const pct = (arr, p) => arr[Math.floor(arr.length * p)];
console.log(`\n--- Centroid distribution (m) of kept fixtures ---`);
console.log(`X: min=${xsKept[0].toFixed(1)} p05=${pct(xsKept,0.05).toFixed(1)} p25=${pct(xsKept,0.25).toFixed(1)} median=${pct(xsKept,0.5).toFixed(1)} p75=${pct(xsKept,0.75).toFixed(1)} p95=${pct(xsKept,0.95).toFixed(1)} max=${xsKept[xsKept.length-1].toFixed(1)}`);
console.log(`Y: min=${ysKept[0].toFixed(1)} p05=${pct(ysKept,0.05).toFixed(1)} p25=${pct(ysKept,0.25).toFixed(1)} median=${pct(ysKept,0.5).toFixed(1)} p75=${pct(ysKept,0.75).toFixed(1)} p95=${pct(ysKept,0.95).toFixed(1)} max=${ysKept[ysKept.length-1].toFixed(1)}`);

console.log(`\n--- Sample drops by category ---`);
for (const [k, arr] of Object.entries(result.stats.droppedSamples)) {
  if (arr.length === 0) continue;
  console.log(`\n[${k}]`);
  for (const x of arr) console.log('  ', JSON.stringify(x));
}

// Group simulation
const groupKeyMap = new Map();
for (const f of result.fixtures) {
  const k = f.source?.block ? `block:${f.source.block}`
    : `layer:${f.source?.layer}:${Math.round((f.footprint.w||0)/25)*25}x${Math.round((f.footprint.d||0)/25)*25}`;
  groupKeyMap.set(k, (groupKeyMap.get(k) || 0) + 1);
}
console.log(`\nResulting groups: ${groupKeyMap.size}`);
db.close();
