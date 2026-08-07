#!/usr/bin/env node
/**
 * Which dwell threshold actually tells two zones apart?
 *
 * A dwell average is not one number, it is a number plus the rule for which
 * visits are allowed into it. Averaging every episode over 5 seconds mixes the
 * shopper who stopped to read a label with the one who walked past on the way to
 * checkout, and since walking past takes about the same time everywhere, the
 * departments come out looking identical. Raise the bar and the same data
 * separates. That is not the sensor improving; it is the question changing.
 *
 * So rather than argue about a threshold, this measures them. For each candidate
 * it computes, across zones with enough traffic to be worth comparing:
 *
 *   separation   the spread of per-zone means, as a coefficient of variation.
 *                A threshold that discriminates produces a wide spread; one that
 *                is dominated by transit produces a narrow one.
 *   coverage     the share of visits still counted. Separation bought by
 *                discarding 97% of the data is a statistic about nobody.
 *   thin zones   zones left with too few qualifying visits to report at all,
 *                which is the operational cost of a high bar.
 *
 * It also reports the dwell distribution per zone in the bands a merchandiser
 * thinks in — passing, glancing, considering, deciding — because the single mean
 * hides which of those changed.
 *
 * Usage (inside the backend container):
 *   node analysis/dwell_threshold_study.mjs [venueId] [--hours=8] [--json=/path]
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

function requirePkg(name) {
  for (const base of [join(__dirname, '..', 'backend', 'node_modules'), '/app/node_modules']) {
    try {
      return require(join(base, name));
    } catch { /* try next */ }
  }
  throw new Error(`Cannot resolve package: ${name}`);
}

const Database = requirePkg('better-sqlite3');

const argv = process.argv.slice(2);
const VENUE_ID = argv.find((a) => !a.startsWith('--')) || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const arg = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const HOURS = Number(arg('hours', 8));
const JSON_OUT = arg('json', '');
const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';

/** Candidate definitions of "a stop". 0 means every episode counts. */
const THRESHOLDS = [0, 3, 5, 8, 10, 15, 20, 30, 45, 60];

/** The bands a merchandiser reasons in, rather than equal-width buckets. */
const BANDS = [
  { key: 'passing', label: '< 5s', lo: 0, hi: 5000 },
  { key: 'glancing', label: '5–10s', lo: 5000, hi: 10000 },
  { key: 'considering', label: '10–20s', lo: 10000, hi: 20000 },
  { key: 'deciding', label: '20–60s', lo: 20000, hi: 60000 },
  { key: 'dwelling', label: '> 60s', lo: 60000, hi: Infinity },
];

// A zone needs enough visits for its mean to mean anything. Below this the
// spread across zones is measuring sampling noise, not shopper behaviour.
const MIN_VISITS = 60;
const MIN_QUALIFYING = 12;

const round = (v, dp = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function stats(values) {
  if (!values.length) return { n: 0, mean: null, cv: null, min: null, max: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const varr = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return {
    n: values.length,
    mean,
    cv: mean > 0 ? Math.sqrt(varr) / mean : null,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function roleOf(name, meta) {
  const zt = String(meta.zoneType || '').toLowerCase();
  const n = String(name || '');
  if (zt.includes('entrance') || /traffic/i.test(n)) return 'entrance';
  if (/queue/i.test(n)) return 'checkout_queue';
  if (/service/i.test(n) || zt.includes('cashier')) return 'checkout_service';
  if (/lidar coverage/i.test(n)) return 'excluded';
  return 'shelf';
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const endTs = Date.now();
  const startTs = endTs - HOURS * 3600_000;

  const rois = db.prepare(`
    SELECT id, name, metadata_json FROM regions_of_interest WHERE venue_id = ?
  `).all(VENUE_ID).map((r) => {
    let meta = {};
    try { meta = JSON.parse(r.metadata_json || '{}'); } catch { /* unlabelled */ }
    return {
      id: r.id,
      name: r.name,
      category: meta.business_category_label || null,
      role: roleOf(r.name, meta),
    };
  });
  const roiById = new Map(rois.map((r) => [r.id, r]));

  // Durations are read raw rather than pre-aggregated: every question below is
  // about where the distribution sits, which a stored average cannot answer.
  const visits = db.prepare(`
    SELECT roi_id, duration_ms
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
      AND end_time IS NOT NULL AND duration_ms IS NOT NULL AND duration_ms > 0
      AND track_key NOT LIKE '%cashier%'
  `).all(VENUE_ID, startTs, endTs);

  const byZone = new Map();
  for (const v of visits) {
    const roi = roiById.get(v.roi_id);
    if (!roi || roi.role === 'excluded') continue;
    let z = byZone.get(v.roi_id);
    if (!z) {
      z = { ...roi, durations: [] };
      byZone.set(v.roi_id, z);
    }
    z.durations.push(v.duration_ms);
  }

  const zones = [...byZone.values()].map((z) => {
    const sorted = [...z.durations].sort((a, b) => a - b);
    const bands = {};
    for (const b of BANDS) {
      const n = sorted.filter((d) => d >= b.lo && d < b.hi).length;
      bands[b.key] = { n, pct: round((n / sorted.length) * 100) };
    }
    const perThreshold = {};
    for (const t of THRESHOLDS) {
      const kept = sorted.filter((d) => d >= t * 1000);
      perThreshold[t] = {
        n: kept.length,
        meanSec: kept.length ? round(kept.reduce((a, b) => a + b, 0) / kept.length / 1000) : null,
        sharePct: round((kept.length / sorted.length) * 100),
      };
    }
    return {
      id: z.id,
      name: z.name,
      role: z.role,
      category: z.category,
      visits: sorted.length,
      meanSec: round(sorted.reduce((a, b) => a + b, 0) / sorted.length / 1000),
      p50Sec: round(percentile(sorted, 0.5) / 1000),
      p75Sec: round(percentile(sorted, 0.75) / 1000),
      p90Sec: round(percentile(sorted, 0.9) / 1000),
      bands,
      perThreshold,
    };
  }).sort((a, b) => b.visits - a.visits);

  /**
   * Separation is measured within a role, never across them. A threshold looks
   * brilliant if it is allowed to distinguish a shelf from the front door, and
   * that tells a category manager nothing: the comparison they actually make is
   * one aisle against another.
   */
  const roles = ['shelf', 'checkout_queue', 'entrance', 'checkout_service'];
  const sweep = THRESHOLDS.map((t) => {
    const byRole = {};
    for (const role of roles) {
      const pool = zones.filter((z) => z.role === role && z.visits >= MIN_VISITS);
      const usable = pool.filter((z) => z.perThreshold[t].n >= MIN_QUALIFYING);
      const means = usable.map((z) => z.perThreshold[t].meanSec).filter((v) => v != null);
      const s = stats(means);
      const totalVisits = pool.reduce((a, z) => a + z.visits, 0);
      const keptVisits = pool.reduce((a, z) => a + z.perThreshold[t].n, 0);
      byRole[role] = {
        zonesConsidered: pool.length,
        zonesReportable: usable.length,
        zonesTooThin: pool.length - usable.length,
        coveragePct: totalVisits ? round((keptVisits / totalVisits) * 100) : null,
        meanOfMeansSec: round(s.mean),
        spreadCv: round(s.cv, 3),
        minSec: round(s.min),
        maxSec: round(s.max),
        maxOverMin: s.min > 0 ? round(s.max / s.min, 2) : null,
      };
    }

    // The stop-rate reading of the same threshold: not how long people stayed,
    // but what share stopped at all. It is the more robust of the two, because
    // a share is not dragged around by one shopper who parked a trolley.
    const shelfPool = zones.filter((z) => z.role === 'shelf' && z.visits >= MIN_VISITS);
    const rateStats = stats(shelfPool.map((z) => z.perThreshold[t].sharePct));

    return {
      thresholdSec: t,
      byRole,
      stopRate: {
        meanPct: round(rateStats.mean),
        spreadCv: round(rateStats.cv, 3),
        minPct: round(rateStats.min),
        maxPct: round(rateStats.max),
      },
    };
  });

  const roleTotals = {};
  for (const role of roles) {
    const pool = zones.filter((z) => z.role === role);
    const all = pool.flatMap((z) => z.durations || []);
    roleTotals[role] = {
      zones: pool.length,
      visits: pool.reduce((a, z) => a + z.visits, 0),
      meanSec: round(pool.reduce((a, z) => a + z.meanSec * z.visits, 0)
        / Math.max(1, pool.reduce((a, z) => a + z.visits, 0))),
      bands: BANDS.reduce((acc, b) => {
        const n = pool.reduce((a, z) => a + z.bands[b.key].n, 0);
        const tot = pool.reduce((a, z) => a + z.visits, 0);
        acc[b.key] = { n, pct: tot ? round((n / tot) * 100) : null };
        return acc;
      }, {}),
      _unused: all.length,
    };
    delete roleTotals[role]._unused;
  }

  const result = {
    venueId: VENUE_ID,
    window: { startTs, endTs, hours: HOURS, label: `${new Date(startTs).toISOString()} → ${new Date(endTs).toISOString()}` },
    generatedAt: new Date().toISOString(),
    criteria: { minVisitsPerZone: MIN_VISITS, minQualifyingVisits: MIN_QUALIFYING },
    bands: BANDS.map(({ key, label }) => ({ key, label })),
    totals: { visits: visits.length, zonesWithTraffic: zones.length },
    roleTotals,
    sweep,
    zones,
  };

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));
    console.log(`written: ${JSON_OUT}`);
  }

  // Readable summary, so the run is useful without the JSON.
  console.log(`\n${result.totals.visits.toLocaleString()} visits · ${zones.length} zones · last ${HOURS}h\n`);
  console.log('role            zones  visits   mean   <5s   5-10  10-20  20-60   >60');
  for (const [role, r] of Object.entries(roleTotals)) {
    if (!r.visits) continue;
    console.log(
      `${role.padEnd(16)}${String(r.zones).padStart(3)}${String(r.visits).padStart(8)}`
      + `${String(r.meanSec).padStart(7)}s`
      + BANDS.map((b) => `${String(r.bands[b.key].pct).padStart(6)}%`).join(''),
    );
  }

  console.log('\nthreshold sweep — shelves only (the comparison a category manager makes)');
  console.log('  thr  reportable  thin  coverage  mean   range        spread(cv)  stop-rate spread');
  for (const s of sweep) {
    const r = s.byRole.shelf;
    console.log(
      `  ${String(s.thresholdSec).padStart(3)}s`
      + `${String(r.zonesReportable).padStart(11)}${String(r.zonesTooThin).padStart(6)}`
      + `${String(r.coveragePct).padStart(9)}%`
      + `${String(r.meanOfMeansSec).padStart(7)}s`
      + `${`${r.minSec}–${r.maxSec}s`.padStart(13)}`
      + `${String(r.spreadCv).padStart(12)}`
      + `${String(s.stopRate.spreadCv).padStart(18)}`,
    );
  }
  console.log('\nspread is the coefficient of variation of per-zone means: higher separates zones better.');
}

main();
