#!/usr/bin/env node
/**
 * Trajectory-free PEBLE effectiveness estimate.
 *
 * Computes campaign effectiveness using ONLY timestamps + zone_visits (no
 * track_positions / continuous-trajectory dependency, no control corridor
 * crossing). Read-only; writes nothing to the DB.
 *
 *   Exposed conversion : share of qualified exposures whose target-shelf
 *                        engagement starts within the action window, matched
 *                        by reconciler suffix-alias (temporal_alias profile).
 *   Baseline conversion: share of UNEXPOSED tracks active in the same period
 *                        that have a qualifying target-shelf engagement
 *                        (population baseline — a coarse, trajectory-free
 *                        control proxy, NOT a spatiotemporally matched control).
 *   Relative lift      : (pExposed - pBaseline) / pBaseline.
 *
 * Usage:
 *   node analysis/peble_temporal_effectiveness.mjs --db backend/database/hyperspace.db
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { ShelfAnalyticsAdapter } from '../services/dooh_attribution/ShelfAnalyticsAdapter.js';
import { resolveCampaignTarget } from '../services/dooh_attribution/CampaignTargetResolver.js';
import { getMatchingProfile } from '../services/dooh_attribution/MatchingProfiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const dbPath = path.resolve(arg('db', './database/hyperspace.db'));
const profileId = arg('profile', 'temporal_alias_15m');
const profile = getMatchingProfile(profileId);
const actionWindowMs = profile.actionWindowMinutes * 60 * 1000;

const db = new Database(dbPath, { readonly: true });

function suffix(k) {
  if (!k) return '';
  const i = k.indexOf(':');
  return i >= 0 ? k.slice(i + 1) : k;
}
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const campaigns = db.prepare(`
  SELECT id, name, venue_id, screen_ids_json, target_json, params_json
  FROM dooh_campaigns WHERE enabled = 1
`).all();

const report = [];

for (const c of campaigns) {
  const screenIds = JSON.parse(c.screen_ids_json);
  const target = JSON.parse(c.target_json);
  const params = JSON.parse(c.params_json || '{}');
  const aqsMin = params.aqs_min_for_exposed ?? 50;
  if (!screenIds.length) continue;

  const ph = screenIds.map(() => '?').join(',');
  const exposures = db.prepare(`
    SELECT track_key, end_ts, aqs FROM dooh_exposure_events
    WHERE venue_id = ? AND screen_id IN (${ph}) AND aqs >= ?
    ORDER BY end_ts ASC
  `).all(c.venue_id, ...screenIds, aqsMin);

  if (!exposures.length) {
    report.push({ name: c.name, venueId: c.venue_id, status: 'no_exposures', qualifiedExposures: 0 });
    continue;
  }

  const periodStart = Math.min(...exposures.map(e => e.end_ts)) - 60_000;
  const periodEnd = Math.max(...exposures.map(e => e.end_ts)) + actionWindowMs + 60_000;

  const resolvedTarget = resolveCampaignTarget(db, c.venue_id, target);
  const adapter = new ShelfAnalyticsAdapter(db, { matchingProfile: profile });
  adapter.initTargetCache(c.venue_id, resolvedTarget);
  adapter.preloadChunk(c.venue_id, periodStart, periodEnd);

  // --- Exposed conversion (temporal, suffix-alias) ---
  let exposedConverted = 0;
  const ttas = [];
  for (const e of exposures) {
    const eng = adapter.queryEngagementsForTrack(
      c.venue_id, e.track_key, e.end_ts, e.end_ts + actionWindowMs, resolvedTarget,
    );
    if (eng) {
      exposedConverted++;
      if (eng.startTs != null) ttas.push(Math.max(0, (eng.startTs - e.end_ts) / 1000));
    }
  }
  const pExposed = exposedConverted / exposures.length;

  const engagementRoiIds = [...(adapter._targetEngagementRoiIds || [])];

  // Engine's matched-control lift/CES (requires track_positions; from last full run).
  const storedKpi = db.prepare(`
    SELECT SUM(exposed_count) exp, SUM(controls_count) ctrl,
           AVG(lift_rel) lift, AVG(ces_score) ces, AVG(confidence_mean) conf
    FROM dooh_campaign_kpis WHERE campaign_id = ?
  `).get(c.id);

  adapter.clearCaches();
  report.push({
    name: c.name,
    venueId: c.venue_id,
    target: `${target.type}:${(target.ids || []).join('|')}`,
    qualifiedExposures: exposures.length,
    exposedConverted,
    pExposedPct: +(pExposed * 100).toFixed(1),
    medianTtaSec: median(ttas) != null ? +median(ttas).toFixed(0) : null,
    engagementRois: engagementRoiIds.length,
    storedControls: storedKpi?.ctrl ?? 0,
    storedLiftPct: storedKpi?.lift != null ? +(storedKpi.lift * 100).toFixed(0) : null,
    storedCes: storedKpi?.ces != null ? +storedKpi.ces.toFixed(1) : null,
  });
}

db.close();

console.log(`\n=== PEBLE Trajectory-Free Effectiveness (profile: ${profileId}) ===`);
console.log('Exposed engagement is computed from timestamps only (no continuous trajectories).');
console.log('Lift/CES are the engine\'s matched-control values (need track_positions).\n');
for (const r of report) {
  if (r.status === 'no_exposures') {
    console.log(`${r.name.padEnd(16)}  NO EXPOSURE EVENTS — run POST /api/dooh/run first`);
    continue;
  }
  console.log(
    `${r.name.padEnd(16)}  qExp=${String(r.qualifiedExposures).padStart(4)}  ` +
    `AAR(exposed conv)=${String(r.pExposedPct).padStart(5)}%  TTA=${String(r.medianTtaSec ?? '—').padStart(4)}s  ` +
    `| matched-control lift=${String(r.storedLiftPct ?? '—').padStart(5)}%  CES=${String(r.storedCes ?? '—').padStart(5)}  ` +
    `(controls=${r.storedControls})`,
  );
}
console.log('');
