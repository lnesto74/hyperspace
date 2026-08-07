#!/usr/bin/env node
/**
 * End-to-end: run the real computeExecutiveJourney and print the Piazza del
 * Fresco cards exactly as the viewport will render them, for the windows a
 * reader actually picks. The point is to confirm that a window straddling the
 * 6 Aug 2026 duration change refuses to print a dwell rather than printing the
 * same 15s on every counter.
 *
 * Usage (on the droplet):
 *   docker exec -w /app hyperspace-backend-1 node scripts/15_fresco_card_render_check.mjs
 *
 * Read-only.
 */
import Database from 'better-sqlite3';
import { computeExecutiveJourney } from '/app/services/executive/ExecutiveJourneyService.js';

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const db = new Database(DB_PATH);
const now = Date.now();

const fmt = (sec) => (sec >= 60 ? `${Math.round((sec / 60) * 10) / 10}m` : `${sec}s`);

for (const [hours, name] of [[24, '24h'], [24 * 7, '7d']]) {
  const startTs = now - hours * 3600_000;
  // Warm the page cache first so the reported time is the query cost, not disk.
  computeExecutiveJourney(db, VENUE_ID, startTs, now, 'live', { skipComparison: true });
  const t0 = Date.now();
  const payload = computeExecutiveJourney(db, VENUE_ID, startTs, now, 'live', {
    skipComparison: true,
  });
  const ms = Date.now() - t0;

  const model = payload.fresco.episodeModel || {};
  console.log(`\n${'='.repeat(96)}`);
  console.log(`WINDOW ${name}   journey built in ${ms} ms`);
  console.log(`episode model: available=${model.available} `
    + `re-id gap ${model.reidGapSec}s / ${model.reidMaxDistanceM}m  `
    + `durationsQuantised=${model.durationsQuantised} (onTick ${model.onTickPct}%)`);
  console.log('='.repeat(96));

  console.table(payload.fresco.departments.map(d => ({
    dept: d.label,
    crossings: d.visits,
    visits: d.episodes,
    fragPerVisit: d.fragmentsPerEpisode,
    stops: d.reportable ? d.dwellVisits : '—',
    stopping: d.stoppingPct == null ? '—' : `${d.stoppingPct}%`,
    passThrough: d.passThroughPct == null ? '—' : `${d.passThroughPct}%`,
    typicalDwell: d.dwellReliable && d.medianDwellSec != null
      ? (d.p75DwellSec > d.medianDwellSec
        ? `${fmt(d.medianDwellSec)}-${fmt(d.p75DwellSec)}`
        : fmt(d.medianDwellSec))
      : '—',
    why: d.dwellUnavailableReason || '',
  })));
}
