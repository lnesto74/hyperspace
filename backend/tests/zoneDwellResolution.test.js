/**
 * Does zone dwell actually measure the time spent in the zone?
 *
 * Until 2026-08-06 it did not. Zone entry and exit were evaluated inside
 * recordTrackPosition, which is called from the KPI batch, which throttles
 * itself by track×ROI cost — 10 s at Treviglio's 86 zones. Duration is
 * lastSeen minus startTime with both taken at those calls, so a visit shorter
 * than one tick recorded 0 ms and everything longer was rounded to a multiple
 * of the tick. Roughly a third of all stored visits were exactly zero, and a
 * checkout queue and a shelf browse became indistinguishable.
 *
 * These tests drive the service at a realistic 10 Hz and assert that the
 * recorded duration matches the wall-clock time the track was inside, which is
 * the whole point of the metric.
 *
 * Run: node backend/tests/zoneDwellResolution.test.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { TrajectoryStorageService } from '../services/TrajectoryStorageService.js';

const VENUE = 'venue-test';
const ROI = 'roi-shelf';

// A 4x4 m square centred on the origin.
const SQUARE = JSON.stringify([
  { x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 },
]);

function makeService() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE venues (id TEXT PRIMARY KEY, footfall_roi_id TEXT);
    CREATE TABLE regions_of_interest (
      id TEXT PRIMARY KEY, venue_id TEXT, name TEXT, vertices TEXT, metadata_json TEXT
    );
  `);
  db.prepare('INSERT INTO venues (id, footfall_roi_id) VALUES (?, NULL)').run(VENUE);
  db.prepare(`INSERT INTO regions_of_interest (id, venue_id, name, vertices, metadata_json)
              VALUES (?, ?, ?, ?, NULL)`).run(ROI, VENUE, 'Shelf 1 - Engagement (Front)', SQUARE);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-dwell-'));
  const svc = new TrajectoryStorageService(db, { dataDir, quiet: true });

  const rois = [{
    id: ROI,
    name: 'Shelf 1 - Engagement (Front)',
    vertices: JSON.parse(SQUARE),
    bbox: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    metadata: null,
  }];

  const visits = [];
  svc.on('visit_ended', (v) => visits.push(v));
  return { svc, rois, visits, dataDir };
}

const track = (x, z) => ({
  trackKey: 't1',
  stableId: 't1',
  venuePosition: { x, z },
  velocity: { x: 0, z: 0 },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drive the service at 10 Hz for `ms`, holding the track at (x, z). */
async function hold(svc, rois, x, z, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    svc.updateZonePresenceBatch(VENUE, [track(x, z)], rois);
    await sleep(100);
  }
}

let failures = 0;
const check = (name, fn) => fn()
  .then(() => console.log(`  ok    ${name}`))
  .catch((e) => { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); });

(async () => {
  console.log('zone dwell resolution\n');

  await check('a 4.5 s visit is recorded as ~4.5 s, not 0 and not a 10 s multiple', async () => {
    const { svc, rois, visits } = makeService();
    await hold(svc, rois, 0, 0, 4500);          // inside
    await hold(svc, rois, 50, 50, 1500);        // outside, past the 1 s grace
    assert.strictEqual(visits.length, 1, `expected 1 visit, got ${visits.length}`);
    const d = visits[0].durationMs;
    assert.ok(d >= 4200 && d <= 5000, `duration ${d} ms is not ~4500 ms`);
  });

  await check('a visit shorter than the old 10 s tick is no longer lost as 0 ms', async () => {
    const { svc, rois, visits } = makeService();
    await hold(svc, rois, 0, 0, 1200);
    await hold(svc, rois, 50, 50, 1500);
    assert.strictEqual(visits.length, 1, `expected 1 visit, got ${visits.length}`);
    const d = visits[0].durationMs;
    assert.ok(d >= 900 && d <= 1600, `duration ${d} ms is not ~1200 ms`);
  });

  await check('exit position is the real exit, available with no sampled positions', async () => {
    const { svc, rois, visits } = makeService();
    svc.updateZonePresenceBatch(VENUE, [track(-1.5, -1.5)], rois);
    await sleep(400);
    svc.updateZonePresenceBatch(VENUE, [track(1.5, 1.5)], rois);
    await hold(svc, rois, 50, 50, 1500);
    assert.strictEqual(visits.length, 1);
    const v = visits[0];
    assert.strictEqual(v.positions, undefined);
    assert.ok(Math.abs(v.exitPosition.x - 1.5) < 0.01, `exit x was ${v.exitPosition.x}`);
    assert.ok(Math.abs(v.entryPosition.x + 1.5) < 0.01, `entry x was ${v.entryPosition.x}`);
  });

  await check('a boundary flicker inside the grace window stays one visit', async () => {
    const { svc, rois, visits } = makeService();
    await hold(svc, rois, 0, 0, 1000);
    svc.updateZonePresenceBatch(VENUE, [track(50, 50)], rois);  // one frame outside
    await sleep(200);
    await hold(svc, rois, 0, 0, 1000);
    await hold(svc, rois, 50, 50, 1500);
    assert.strictEqual(visits.length, 1, `flicker split the visit into ${visits.length}`);
    assert.ok(visits[0].durationMs >= 1900, `duration ${visits[0].durationMs} ms lost the flicker gap`);
  });

  await check('sessions and their index are released after the visit ends', async () => {
    const { svc, rois } = makeService();
    await hold(svc, rois, 0, 0, 800);
    assert.strictEqual(svc.visitSessions.size, 1);
    assert.strictEqual(svc.sessionKeysByTrack.get('t1')?.size, 1);
    await hold(svc, rois, 50, 50, 1500);
    assert.strictEqual(svc.visitSessions.size, 0, 'session leaked');
    assert.strictEqual(svc.sessionKeysByTrack.size, 0, 'index leaked');
  });

  await check('endTrackSessions finalises and clears through the index', async () => {
    const { svc, rois, visits } = makeService();
    await hold(svc, rois, 0, 0, 800);
    svc.endTrackSessions('t1');
    assert.strictEqual(visits.length, 1, 'visit was not finalised');
    assert.strictEqual(svc.visitSessions.size, 0, 'session leaked');
    assert.strictEqual(svc.sessionKeysByTrack.size, 0, 'index leaked');
  });

  await check('full-rate presence costs well under one frame budget', async () => {
    const { svc } = makeService();
    // 86 zones and 80 tracks is the live Treviglio shape. One frame of this
    // must fit comfortably inside the 100 ms between aggregator emissions.
    const many = [];
    for (let i = 0; i < 86; i++) {
      const cx = (i % 10) * 6, cz = Math.floor(i / 10) * 6;
      many.push({
        id: `roi-${i}`,
        name: `Shelf ${i} - Engagement (Front)`,
        vertices: [
          { x: cx - 2, z: cz - 2 }, { x: cx + 2, z: cz - 2 },
          { x: cx + 2, z: cz + 2 }, { x: cx - 2, z: cz + 2 },
        ],
        bbox: { minX: cx - 2, maxX: cx + 2, minZ: cz - 2, maxZ: cz + 2 },
        metadata: null,
      });
    }
    const tracks = [];
    for (let i = 0; i < 80; i++) {
      tracks.push({
        trackKey: `t${i}`, stableId: `t${i}`,
        venuePosition: { x: (i % 10) * 6 + 0.5, z: Math.floor(i / 10) * 6 + 0.5 },
        velocity: { x: 0, z: 0 },
      });
    }
    const t0 = process.hrtime.bigint();
    const FRAMES = 100;
    for (let f = 0; f < FRAMES; f++) svc.updateZonePresenceBatch(VENUE, tracks, many);
    const perFrameMs = Number(process.hrtime.bigint() - t0) / 1e6 / FRAMES;
    console.log(`        ${perFrameMs.toFixed(2)} ms per frame (80 tracks x 86 zones, budget 100 ms)`);
    assert.ok(perFrameMs < 10, `${perFrameMs.toFixed(2)} ms per frame is too slow`);
  });

  console.log(`\n${failures === 0 ? 'all passed' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
