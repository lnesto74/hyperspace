#!/usr/bin/env node
/**
 * 15-minute live audit: reconciler → zone_visits → Esselunga Executive API.
 * Run on prod:
 *   docker cp scripts/audit_live_reconcile_executive_15m.mjs hyperspace-backend-1:/app/scripts/
 *   docker exec hyperspace-backend-1 node /app/scripts/audit_live_reconcile_executive_15m.mjs
 */
import Database from 'better-sqlite3';
import { computeExecutiveJourney } from '../backend/services/executive/ExecutiveJourneyService.js';

const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const MINUTES = Number(process.env.MINUTES || 15);
const POLL_SEC = Number(process.env.POLL_SEC || 180);
const DWELL_SEC = Number(process.env.DWELL_SEC || 20);

const db = new Database(process.env.DB_PATH || '/data/db/hyperspace.db', { readonly: true });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function romeHour(ts) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hour: 'numeric', hour12: false,
  }).format(new Date(ts)));
}

function snapshot(label, windowStart) {
  const now = Date.now();
  const dwellMs = DWELL_SEC * 1000;

  const reconciler = (() => {
    try {
      const row = db.prepare('SELECT dwg_transform_json FROM venues WHERE id = ?').get(VENUE_ID);
      return JSON.parse(row?.dwg_transform_json || '{}').reconciler || null;
    } catch { return null; }
  })();

  const zv = db.prepare(`
    SELECT COUNT(*) visits,
      COUNT(DISTINCT track_key) unique_tracks,
      MAX(start_time) last_start,
      SUM(CASE WHEN track_key LIKE '%:%' AND track_key NOT LIKE 'replay-%' THEN 1 ELSE 0 END) reconciled_fmt,
      SUM(CASE WHEN track_key LIKE 'person-%' OR track_key LIKE '%:person-%' THEN 1 ELSE 0 END) raw_person_fmt
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ?
  `).get(VENUE_ID, windowStart);

  const byCategory = db.prepare(`
    SELECT
      COALESCE(json_extract(r.metadata_json, '$.business_category_label'), r.name) AS cat,
      COUNT(*) visits,
      ROUND(AVG(zv.duration_ms)) avg_ms,
      ROUND(MAX(zv.duration_ms)) max_ms,
      SUM(CASE WHEN zv.duration_ms >= ? THEN 1 ELSE 0 END) dwells,
      COUNT(DISTINCT zv.track_key) tracks
    FROM zone_visits zv
    JOIN regions_of_interest r ON r.id = zv.roi_id
    WHERE zv.venue_id = ? AND zv.start_time >= ?
      AND (r.name LIKE '%Shelf%' OR r.name LIKE '%Engagement%' OR r.name LIKE '%Fresco%'
           OR json_extract(r.metadata_json, '$.business_category_label') IS NOT NULL)
      AND zv.track_key NOT LIKE '%cashier%'
    GROUP BY cat
    HAVING visits >= 3
    ORDER BY dwells DESC
  `).all(dwellMs, VENUE_ID, windowStart);

  const hourlyIngress = db.prepare(`
    SELECT crossed_at FROM ingress_perimeter_crossings
    WHERE venue_id = ? AND crossed_at >= ?
  `).all(VENUE_ID, windowStart);

  const hour = romeHour(now);
  const entThisHour = hourlyIngress.filter(r => romeHour(r.crossed_at) === hour).length;

  let executive = null;
  try {
    executive = computeExecutiveJourney(db, VENUE_ID, windowStart, now, 'live');
  } catch (e) {
    executive = { error: e.message };
  }

  const fresco = executive?.fresco?.departments || [];
  const cats = executive?.aisles?.categoryGroups || [];
  const hourly = executive?.activityTimelines?.hourly;

  const avgMsList = byCategory.map(r => r.avg_ms).filter(Boolean);
  const dwellAvgSpread = avgMsList.length >= 2
    ? Math.max(...avgMsList) - Math.min(...avgMsList)
    : 0;
  const uniqueCatAvgs = new Set(byCategory.map(r => r.avg_ms));

  console.log(`\n${'='.repeat(72)}`);
  console.log(`SNAPSHOT: ${label}  @ ${new Date(now).toISOString()}`);
  console.log(`Window: ${new Date(windowStart).toISOString()} → now (${MINUTES}m rolling)`);
  console.log('='.repeat(72));

  console.log('\n--- RECONCILER CONFIG ---');
  console.log({
    enabled: reconciler?.enabled,
    reid_max_distance_m: reconciler?.reid_max_distance_m,
    reid_churn_active_ms: reconciler?.reid_churn_active_ms,
    smoothing_alpha: reconciler?.smoothing_alpha,
    updated_at: reconciler?.updated_at,
  });

  console.log('\n--- ZONE_VISITS (DB write path) ---');
  console.log({
    visits: zv?.visits,
    unique_tracks: zv?.unique_tracks,
    reconciled_track_key_rows: zv?.reconciled_fmt,
    raw_person_rows: zv?.raw_person_fmt,
    last_visit: zv?.last_start ? new Date(zv.last_start).toISOString() : null,
    reconciler_pct: zv?.visits > 0 ? Math.round((zv.reconciled_fmt / zv.visits) * 100) : 0,
  });

  const recent = db.prepare(`
    SELECT track_key, duration_ms, start_time FROM zone_visits
    WHERE venue_id = ? ORDER BY start_time DESC LIMIT 5
  `).all(VENUE_ID);
  console.log('Recent track_key samples:', recent.map(r => ({
    key: r.track_key?.slice(0, 48),
    dur_s: Math.round((r.duration_ms || 0) / 1000),
    at: new Date(r.start_time).toISOString(),
  })));

  console.log('\n--- CATEGORY DWELL (raw DB, shelf/fresco) ---');
  console.log(`Categories with data: ${byCategory.length}  |  distinct avg_ms values: ${uniqueCatAvgs.size}  |  spread: ${dwellAvgSpread}ms`);
  if (byCategory.length) console.table(byCategory.slice(0, 12));

  const uniformWarning = byCategory.length >= 3 && uniqueCatAvgs.size <= 1;
  if (uniformWarning) {
    console.log('⚠️  UNIFORM DWELL: all categories share same avg_ms — likely fragmentation bug');
  } else if (byCategory.length >= 3 && uniqueCatAvgs.size >= 2) {
    console.log('✓  Category dwell varies (not uniform)');
  }

  console.log('\n--- EXECUTIVE API (computeExecutiveJourney live) ---');
  if (executive?.error) {
    console.log('ERROR:', executive.error);
  } else {
    console.log('Overview:', {
      totalVisitors: executive?.overview?.totalVisitors,
      ingressDirect: executive?.overview?.ingressDirectEstimated,
      ingressRecovered: executive?.overview?.ingressRecovered,
      avgStoreDwellMin: executive?.overview?.avgStoreDwellMin,
      medianStoreDwellMin: executive?.overview?.medianStoreDwellMin,
      dwellSessionCount: executive?.overview?.dwellSessionCount,
      sessionMethod: executive?.overview?.sessionAnalyticsMethod,
      stitchedSessions: executive?.overview?.stitchedEntranceSessions,
    });
    console.log('Fresco departments (top 6):', fresco.slice(0, 6).map(d => ({
      label: d.label,
      visits: d.visits,
      dwells: d.dwells,
      avgDwellMin: d.avgDwellMin,
    })));
    console.log('Aisle categoryGroups (top 6):', cats.slice(0, 6).map(c => ({
      category: c.category,
      visitors: c.visitors,
      dwells: c.dwells,
      avgDwellMin: c.avgDwellMin,
      method: c.analyticsMethod,
    })));
    const curHourLabel = hourly?.visitors?.find(v => v.label?.includes(String(hour).padStart(2, '0')));
    console.log(`Hourly chart (Rome ~${hour}:00):`, {
      entrants_api: curHourLabel?.value,
      entrants_perimeter_db: entThisHour,
    });
  }

  return {
    ts: now,
    visits: zv?.visits || 0,
    unique_tracks: zv?.unique_tracks || 0,
    last_start: zv?.last_start || 0,
    categoryCount: byCategory.length,
    uniqueCatAvgs: uniqueCatAvgs.size,
    avgStoreDwellMin: executive?.overview?.avgStoreDwellMin,
    uniformWarning,
  };
}

async function main() {
  const windowMs = MINUTES * 60 * 1000;
  const t0 = Date.now();
  const windowStart = t0 - windowMs;

  console.log('LIVE RECONCILE → EXECUTIVE DASHBOARD AUDIT');
  console.log(`Venue: ${VENUE_ID}`);
  console.log(`Duration: ${MINUTES} minutes (poll every ${POLL_SEC}s)`);
  console.log(`Dwell threshold: ${DWELL_SEC}s`);

  const baseline = snapshot('T0 BASELINE', windowStart);
  const polls = [];

  const endAt = t0 + MINUTES * 60 * 1000;
  let n = 0;
  while (Date.now() < endAt) {
    const wait = Math.min(POLL_SEC * 1000, endAt - Date.now());
    if (wait <= 0) break;
    n++;
    console.log(`\n... waiting ${Math.round(wait / 1000)}s (poll ${n}) ...`);
    await sleep(wait);
    const ws = Date.now() - windowMs;
    polls.push(snapshot(`POLL ${n}`, ws));
  }

  const final = snapshot('T1 FINAL', Date.now() - windowMs);

  console.log(`\n${'='.repeat(72)}`);
  console.log('15-MINUTE DELTA SUMMARY');
  console.log('='.repeat(72));
  console.log({
    visits_growth: final.visits - baseline.visits,
    unique_tracks_growth: final.unique_tracks - baseline.unique_tracks,
    last_visit_advanced: final.last_start > baseline.last_start,
    categories_seen: final.categoryCount,
    category_dwell_not_uniform: !final.uniformWarning && final.uniqueCatAvgs >= 2,
    avg_store_dwell_min: final.avgStoreDwellMin,
  });

  const writing = final.last_start > baseline.last_start && (final.visits > baseline.visits || polls.some(p => p.visits > baseline.visits));
  console.log(writing
    ? '\n✓ PASS: zone_visits still being written during audit window'
    : '\n✗ FAIL: no new zone_visits detected — check live pipeline / reconciler enabled');

  const execOk = final.avgStoreDwellMin != null && final.categoryCount >= 2;
  console.log(execOk
    ? '✓ PASS: Executive journey computes from DB with category breakdown'
    : '⚠️  WARN: thin data or executive API issue — check category rows above');

  db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
