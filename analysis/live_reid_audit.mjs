#!/usr/bin/env node
/**
 * Live re-ID audit — subscribe to MQTT, mirror reconciler, report obvious misses.
 *
 * Usage (on prod backend container):
 *   node analysis/live_reid_audit.mjs [venueId] [durationSec] [minTracks]
 *                                     [--json PATH] [--quiet]
 *
 * --json appends one summary object per run to PATH as JSONL, which is what the
 * nightly cron consumes: the interesting quantity is not any single run but
 * which gate is rejecting merges *this week* versus last, since that is how a
 * drifting sensor or a vendor firmware change shows up before the KPIs move.
 * --quiet suppresses the per-miss narration and keeps the summary.
 *
 * Exit code 2 means continuity misses were found. That is the normal state, not
 * a failure — anything automating this must not treat it as one.
 *
 * Env: MQTT_URL, DB_PATH, API_URL
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', 'backend');

function requirePkg(name) {
  for (const base of [join(backendRoot, 'node_modules'), '/app/node_modules']) {
    try {
      return require(join(base, name));
    } catch { /* try next */ }
  }
  throw new Error(`Cannot resolve package: ${name}`);
}

const Database = requirePkg('better-sqlite3');
const mqtt = requirePkg('mqtt');

import {
  TrajectoryReconciler,
  normalizeReconcilerConfig,
} from '../backend/services/TrajectoryReconciler.js';
import { getDefaultLiveReconcilerConfig } from '../backend/config/liveReconcilePresets.js';
import {
  applyTransformToPoint,
  applyTransformToVelocity,
  normalizePerceptionTransform,
  perceptionToFloor,
  IDENTITY_TRANSFORM,
} from '../backend/services/PerceptionTransform.js';

const argv = process.argv.slice(2);
let JSON_OUT = null;
let QUIET = false;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') JSON_OUT = argv[++i];
  else if (argv[i] === '--quiet') QUIET = true;
  else positional.push(argv[i]);
}

const VENUE_ID = positional[0] || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DURATION_SEC = Number(positional[1] || 90);
const MIN_TRACKS = Number(positional[2] || 20);
const MQTT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';

const say = (...a) => { if (!QUIET) console.log(...a); };

function loadVenue(db, venueId) {
  const row = db.prepare('SELECT id, name, dwg_transform_json FROM venues WHERE id = ?').get(venueId);
  if (!row) throw new Error(`Venue not found: ${venueId}`);
  const parsed = JSON.parse(row.dwg_transform_json || '{}');
  // Falling back to bare DEFAULT_CONFIG would audit against factory gates and
  // report misses the live reconciler never had — the luca preset is the truth.
  const reconciler = normalizeReconcilerConfig(parsed.reconciler || getDefaultLiveReconcilerConfig());
  const transform = normalizePerceptionTransform(parsed.perceptionTransform || IDENTITY_TRANSFORM);
  return { ...row, reconciler, transform };
}

function toIncoming(deviceId, venueId, data, transform) {
  const inputFrame = transform.input_frame || 'legacy';
  const percPos = data.position || { x: 0, y: 0, z: 0 };
  const percVel = data.velocity || { x: 0, y: 0, z: 0 };
  const floorPos = perceptionToFloor(inputFrame, percPos);
  const floorVel = perceptionToFloor(inputFrame, percVel);
  const venuePosition = applyTransformToPoint(transform, floorPos);
  const velocity = applyTransformToVelocity(transform, floorVel);
  return {
    id: data.id,
    trackKey: `${data.deviceId || deviceId}:${data.id}`,
    deviceId: data.deviceId || deviceId,
    venueId,
    timestamp: data.timestamp || Date.now(),
    position: floorPos,
    venuePosition,
    velocity,
    objectType: data.objectType || 'person',
  };
}

function summarizeFailures(misses) {
  const counts = {};
  for (const m of misses) {
    for (const c of m.preDiag.closest || []) {
      for (const f of c.failures) {
        const key = f.replace(/[\d.]+/g, 'N');
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    if (m.preDiag.nnVerdict && m.preDiag.nnVerdict !== 'would_match') {
      counts[`nn:${m.preDiag.nnVerdict.split('_')[0]}`] = (counts[`nn:${m.preDiag.nnVerdict.split('_')[0]}`] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const venue = loadVenue(db, VENUE_ID);
  const rec = new TrajectoryReconciler(() => venue.reconciler);
  rec.setVenueConfig(VENUE_ID, venue.reconciler);

  const stats = {
    rawMsgs: 0,
    emitted: 0,
    dropped: 0,
    reid: 0,
    reidNn: 0,
    newStable: 0,
    uniquePerceptionIds: new Set(),
    uniqueStableIds: new Set(),
  };
  const misses = [];
  const episodes = new Map(); // stableId -> episode
  const endedEpisodes = [];
  const pendingLost = new Map(); // stableId -> { stableId, primary, lastPos, lostTs, reason }
  const sweepStats = { newly_lost: 0, expired: 0, static_fixture: 0 };
  const postLostResumes = []; // lost then new stable nearby without merge
  let lastSweep = Date.now();

  const client = mqtt.connect(MQTT_URL, { clientId: `reid-audit-${Date.now()}`, clean: true });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('done'), DURATION_SEC * 1000);
    client.on('connect', () => {
      console.log(`[audit] Connected ${MQTT_URL} venue=${venue.name} duration=${DURATION_SEC}s`);
      client.subscribe('hyperspace/trajectories/+');
    });
    client.on('error', reject);
    client.on('message', (topic, buf) => {
      try {
        const data = JSON.parse(buf.toString());
        if (!data.position || data.tracks) return;
        if (data.venueId && data.venueId !== VENUE_ID) return;
        if (data.objectType && data.objectType !== 'person') return;

        const deviceId = topic.split('/').pop();
        const incoming = toIncoming(deviceId, VENUE_ID, data, venue.transform);
        stats.rawMsgs++;
        stats.uniquePerceptionIds.add(incoming.id);

        const now = Date.now();
        const msgTs = incoming.timestamp || now;
        if (now - lastSweep >= 250) {
          const events = rec.sweep(now);
          for (const ev of events) {
            sweepStats[ev.reason] = (sweepStats[ev.reason] || 0) + 1;
            const ep = episodes.get(ev.stableId);
            if (ep) {
              ep.endTs = now;
              ep.endReason = ev.reason;
              ep.endPos = { ...ep.lastPos };
              endedEpisodes.push(ep);
              episodes.delete(ev.stableId);
            }
            if (ev.reason === 'newly_lost') {
              const state = rec.getOrCreateState(VENUE_ID);
              const t = state.lostTracks.get(ev.stableId);
              if (t) {
                pendingLost.set(ev.stableId, {
                  stableId: ev.stableId,
                  primary: t.primaryPerceptionId,
                  lastPos: { x: t.position.x, z: t.position.z },
                  lostTs: now,
                  reason: ev.reason,
                });
              }
            }
            if (ev.reason === 'expired' || ev.reason === 'static_fixture') {
              pendingLost.delete(ev.stableId);
            }
          }
          lastSweep = now;
        }

        const state = rec.getOrCreateState(VENUE_ID);
        const before = {
          reid: state.stats.reid_count,
          nn: state.stats.reid_nn_count || 0,
          newStable: state.stats.new_stable_ids,
        };
        const preDiag = rec.diagnoseReidMiss(VENUE_ID, incoming.venuePosition, incoming.velocity, msgTs);

        const out = rec.process(incoming);
        if (!out) {
          stats.dropped++;
          return;
        }

        stats.emitted++;
        stats.reid += state.stats.reid_count - before.reid;
        stats.reidNn += (state.stats.reid_nn_count || 0) - before.nn;
        if (state.stats.new_stable_ids > before.newStable) {
          stats.newStable++;
          const pos = incoming.venuePosition;
          const dMax = venue.reconciler.reid_nn_max_distance_m ?? 3.0;

          // Match to recently ended episode (interrupt → resume pattern)
          let resumeOf = null;
          for (const ep of endedEpisodes.slice(-60).reverse()) {
            const gapMs = now - (ep.endTs || ep.lastTs);
            const dist = Math.hypot(pos.x - ep.lastPos.x, pos.z - ep.lastPos.z);
            if (gapMs <= venue.reconciler.reid_max_gap_s * 1000 && dist <= dMax * 1.5) {
              resumeOf = {
                gapMs,
                distM: +dist.toFixed(2),
                endReason: ep.endReason,
                priorPrimary: ep.primaryPerceptionId,
                priorStable: ep.stableId?.slice(0, 8),
              };
              break;
            }
          }

          const lostNearby = (preDiag.closest || []).some(
            c => c.pool === 'lost' && c.rawDistM <= dMax && c.gapMs / 1000 <= venue.reconciler.reid_max_gap_s,
          );
          const activeNearbyUnmerged = (preDiag.closest || []).some(
            c => c.pool === 'active' && c.rawDistM <= dMax && c.wouldCostReid,
          );
          const nnWouldMatch = preDiag.nnVerdict === 'would_match'
            && (preDiag.closest || []).some(c => c.rawDistM <= dMax && c.rawDistM > 0.05);

          // Skip first-seen shoppers — only flag real continuity breaks
          const isRealMiss = resumeOf || lostNearby || activeNearbyUnmerged || nnWouldMatch;
          if (!isRealMiss) return;

          misses.push({
            ts: new Date(now).toISOString(),
            perceptionId: incoming.id,
            pos: { x: +pos.x.toFixed(2), z: +pos.z.toFixed(2) },
            newStableId: out.stableId?.slice(0, 8),
            primaryPerceptionId: out.primaryPerceptionId,
            resumeOf,
            preDiag,
            flags: { lostNearby, activeNearbyUnmerged, nnWouldMatch },
          });
        }

        const sid = out.stableId;
        const pos = incoming.venuePosition;
        stats.uniqueStableIds.add(sid);

        // Did this emission resume a recently-lost track under a NEW stable id?
        for (const [lostSid, lost] of [...pendingLost.entries()]) {
          const gapMs = now - lost.lostTs;
          const dist = Math.hypot(pos.x - lost.lastPos.x, pos.z - lost.lastPos.z);
          if (gapMs > venue.reconciler.reid_max_gap_s * 1000) {
            pendingLost.delete(lostSid);
            continue;
          }
          if (dist <= (venue.reconciler.reid_nn_max_distance_m ?? 3) * 1.5) {
            if (sid !== lostSid) {
              postLostResumes.push({
                ts: new Date(now).toISOString(),
                lostStable: lostSid.slice(0, 8),
                newStable: sid.slice(0, 8),
                priorPrimary: lost.primary,
                newPrimary: out.primaryPerceptionId,
                newPerceptionId: incoming.id,
                gapMs,
                distM: +dist.toFixed(2),
                preDiag: rec.diagnoseReidMiss(VENUE_ID, pos, incoming.velocity, now),
              });
            } else {
              pendingLost.delete(lostSid);
            }
          }
        }

        let ep = episodes.get(sid);
        if (!ep) {
          ep = {
            stableId: sid,
            primaryPerceptionId: out.primaryPerceptionId,
            startTs: now,
            lastTs: now,
            lastPos: { ...out.venuePosition },
          };
          episodes.set(sid, ep);
        } else {
          ep.lastTs = now;
          ep.lastPos = { ...out.venuePosition };
        }
      } catch (e) {
        console.error('[audit] parse error', e.message);
      }
    });
    client.on('close', () => clearTimeout(timer));
    timer.unref?.();
  });

  client.end();
  db.close();

  const finalState = rec.getOrCreateState(VENUE_ID);
  const reidRate = stats.newStable + stats.reid > 0
    ? (stats.reid / (stats.newStable + stats.reid) * 100).toFixed(1)
    : '0';

  console.log('\n========== LIVE RE-ID AUDIT ==========');
  console.log(`Venue: ${venue.name}`);
  console.log(`Window: ${DURATION_SEC}s`);
  console.log(`Raw MQTT person frames: ${stats.rawMsgs}`);
  console.log(`Emitted (reconciler): ${stats.emitted}  dropped: ${stats.dropped}`);
  console.log(`Unique perception IDs: ${stats.uniquePerceptionIds.size}`);
  console.log(`Unique stable IDs minted: ${stats.uniqueStableIds.size}`);
  console.log(`Re-ID merges: ${stats.reid} (NN: ${stats.reidNn})  new stable: ${stats.newStable}`);
  console.log(`Re-ID success rate (window): ${reidRate}%`);
  console.log(`Active now: ${finalState.activeTracks.size}  lost: ${finalState.lostTracks.size}`);
  console.log(`Sweep events: newly_lost=${sweepStats.newly_lost} expired=${sweepStats.expired} static_fixture=${sweepStats.static_fixture}`);

  say(`\n--- POST-LOST RESUME WITH NEW STABLE (${postLostResumes.length}) ---`);
  for (const r of postLostResumes.slice(0, 15)) {
    say(`\n  ${r.ts} gap=${r.gapMs}ms dist=${r.distM}m`);
    say(`    lost=${r.lostStable} (${r.priorPrimary}) → new=${r.newStable} (${r.newPrimary}) perc=${r.newPerceptionId}`);
    say(`    nn: ${r.preDiag.nnVerdict}`);
    const c0 = r.preDiag.closest?.find(c => c.pool === 'lost') || r.preDiag.closest?.[0];
    if (c0) say(`    closest ${c0.pool} dist=${c0.rawDistM}m failures=[${c0.failures.join(', ')}]`);
  }

  const obvious = misses.filter(m => m.resumeOf);
  const nnMisses = misses.filter(m => m.flags?.nnWouldMatch);
  const lostMisses = misses.filter(m => m.flags?.lostNearby);
  console.log(`\n--- REAL CONTINUITY MISSES (${misses.length} total) ---`);
  console.log(`  interrupt→resume: ${obvious.length}  lost-nearby: ${lostMisses.length}  nn-would-match: ${nnMisses.length}`);
  for (const m of obvious.slice(0, 15)) {
    say(`\n  ${m.ts} perc=${m.perceptionId} new=${m.newStableId} @(${m.pos.x},${m.pos.z})`);
    say(`    resumed after gap=${m.resumeOf.gapMs}ms dist=${m.resumeOf.distM}m reason=${m.resumeOf.endReason} prior=${m.resumeOf.priorPrimary}`);
    say(`    nn: ${m.preDiag.nnVerdict}`);
    const c0 = m.preDiag.closest?.[0];
    if (c0) say(`    closest ${c0.pool} ${c0.stableId} dist=${c0.rawDistM}m failures=[${c0.failures.join(', ')}]`);
  }

  for (const m of nnMisses.slice(0, 8)) {
    say(`\n  [NN-MISS] perc=${m.perceptionId} new=${m.newStableId} @(${m.pos.x},${m.pos.z})`);
    const c0 = m.preDiag.closest?.[0];
    if (c0) say(`    closest ${c0.pool} dist=${c0.rawDistM}m gap=${c0.gapMs}ms failures=[${c0.failures.join(', ')}]`);
    say(`    nn: ${m.preDiag.nnVerdict}`);
  }

  say(`\n--- SAMPLE ALL MISSES (max 8) ---`);
  for (const m of misses.slice(0, 8)) {
    say(`  perc=${m.perceptionId} @(${m.pos.x},${m.pos.z}) nn=${m.preDiag.nnVerdict} closest=${m.preDiag.closest?.[0]?.rawDistM ?? '?'}m flags=${JSON.stringify(m.flags)}`);
  }

  const failureReasons = summarizeFailures(misses);
  console.log('\n--- FAILURE REASON FREQUENCY ---');
  for (const [k, n] of failureReasons) console.log(`  ${n}x  ${k}`);

  if (JSON_OUT) {
    const summary = {
      ts: new Date().toISOString(),
      venue_id: VENUE_ID,
      window_s: DURATION_SEC,
      raw_frames: stats.rawMsgs,
      emitted: stats.emitted,
      dropped: stats.dropped,
      perception_ids: stats.uniquePerceptionIds.size,
      stable_ids: stats.uniqueStableIds.size,
      reid_merges: stats.reid,
      reid_nn: stats.reidNn,
      new_stable: stats.newStable,
      reid_rate_pct: Number(reidRate),
      sweep: { ...sweepStats },
      misses: {
        total: misses.length,
        interrupt_resume: obvious.length,
        lost_nearby: lostMisses.length,
        nn_would_match: nnMisses.length,
      },
      post_lost_resumes: postLostResumes.length,
      failure_reasons: Object.fromEntries(failureReasons),
      // A run with almost no traffic says nothing about re-ID quality; the
      // consumer needs to be able to drop those rather than average them in.
      thin: stats.emitted < MIN_TRACKS,
    };
    try {
      fs.mkdirSync(dirname(JSON_OUT), { recursive: true });
      fs.appendFileSync(JSON_OUT, JSON.stringify(summary) + '\n');
      console.log(`\n[audit] summary appended to ${JSON_OUT}`);
    } catch (e) {
      console.error(`[audit] could not write ${JSON_OUT}: ${e.message}`);
    }
  }

  if (stats.emitted < MIN_TRACKS) {
    console.log(`\n[WARN] Only ${stats.emitted} emitted tracks (< ${MIN_TRACKS}) — store may be quiet`);
  }

  if (obvious.length > 0) {
    console.log('\n--- RECOMMENDED TUNING ---');
    const top = summarizeFailures(obvious)[0];
    if (top?.[0]?.includes('ambiguous')) {
      console.log('  • Crowded NN ambiguity — tighten isolation or raise reid_nn_min_separation_m only in hot zones');
    }
    if (top?.[0]?.includes('gap_expired')) {
      console.log('  • Raise reid_max_gap_s or active_to_lost_timeout_ms');
    }
    if (top?.[0]?.includes('implied_speed')) {
      console.log('  • Raise reid_max_implied_speed_m_s for interrupt resume');
    }
    if (top?.[0]?.includes('active_not_quiet')) {
      console.log('  • Lower reid_churn_active_ms (NN should catch these — check reid_nn_enabled)');
    }
    if (top?.[0]?.includes('isolation')) {
      console.log('  • Lower reid_isolation_radius_m or disable in aisles');
    }
    if (top?.[0]?.includes('static_fixture')) {
      console.log('  • static_fixture sweep killed track before resume — raise ghost_static_timeout_s / displacement');
    }
  }

  process.exit(obvious.length > 0 || postLostResumes.length > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
