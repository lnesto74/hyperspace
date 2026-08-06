/**
 * Does the audit's gate diagnosis actually agree with the reconciler?
 *
 * The diagnosis in live_reid_audit.mjs is a hand-written mirror of
 * TrajectoryReconciler._tryReid. A mirror that drifts from the thing it
 * reflects is worse than no mirror, because it produces confident and wrong
 * tuning advice. These cases drive the real engine into a known state and check
 * that the diagnosis both blames the right gate and agrees with the engine on
 * the only question that matters: would this have merged or not.
 *
 * Run: node analysis/live_reid_audit.test.mjs
 */
import { diagnoseReidMiss } from './live_reid_audit.mjs';
import { TrajectoryReconciler, normalizeReconcilerConfig } from '../backend/services/TrajectoryReconciler.js';
import { getDefaultLiveReconcilerConfig } from '../backend/config/liveReconcilePresets.js';

const cfg = normalizeReconcilerConfig(getDefaultLiveReconcilerConfig());
let failed = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

/** Walk a track in a straight line so it exists in reconciler state. */
function makeState({ vx = 1.2, frames = 40, stepMs = 100, startTs }) {
  const rec = new TrajectoryReconciler(() => cfg);
  rec.setVenueConfig('v', cfg);
  const t0 = startTs;
  for (let i = 0; i < frames; i++) {
    const ts = t0 + i * stepMs;
    const x = i * vx * (stepMs / 1000);
    rec.process({
      id: 'p1', trackKey: 'e:p1', deviceId: 'e', venueId: 'v', timestamp: ts,
      position: { x, y: 0, z: 0 }, venuePosition: { x, y: 0, z: 0 },
      velocity: { x: vx, y: 0, z: 0 }, objectType: 'person',
    });
  }
  const lastTs = t0 + (frames - 1) * stepMs;
  const lastX = (frames - 1) * vx * (stepMs / 1000);
  return { rec, state: rec.getOrCreateState('v'), lastTs, lastX };
}

const reasons = (d) => (d.closest[0]?.failures || []).map((f) => f.split('(')[0]);

console.log('gate diagnosis vs reconciler\n');

// 1. Same place, immediately after — nothing should reject it.
{
  const now = Date.now();
  const { state, lastTs, lastX } = makeState({ startTs: now - 4000 });
  const gap = 300;
  const d = diagnoseReidMiss(state, { x: lastX + 0.36, z: 0 }, { x: 1.2, z: 0 }, lastTs + gap, cfg);
  check('clean continuation is not rejected', d.closest[0]?.wouldCostReid === true,
    `failures=[${d.closest[0]?.failures.join(',')}]`);
}

// 2. Far away, but slowly — distance gate, not speed.
{
  const now = Date.now();
  const { state, lastTs, lastX } = makeState({ startTs: now - 4000 });
  const d = diagnoseReidMiss(state, { x: lastX + 40, z: 0 }, { x: 1.2, z: 0 }, lastTs + 11000, cfg);
  check('far + long gap blames distance', reasons(d).includes('distance'),
    `got [${reasons(d).join(',')}]`);
}

// 3. Far away, instantly — implied speed must fire.
{
  const now = Date.now();
  const { state, lastTs, lastX } = makeState({ startTs: now - 4000 });
  const d = diagnoseReidMiss(state, { x: lastX + 30, z: 0 }, { x: 1.2, z: 0 }, lastTs + 300, cfg);
  check('teleport blames implied_speed', reasons(d).includes('implied_speed'),
    `got [${reasons(d).join(',')}]`);
}

// 4. Beyond the re-ID window entirely.
{
  const now = Date.now();
  const { state, lastTs, lastX } = makeState({ startTs: now - 4000 });
  const d = diagnoseReidMiss(state, { x: lastX, z: 0 }, { x: 1.2, z: 0 },
    lastTs + (cfg.reid_max_gap_s + 5) * 1000, cfg);
  check('stale candidate blames gap_expired', reasons(d).includes('gap_expired'),
    `got [${reasons(d).join(',')}]`);
}

// 5. A track still being fed is not an eligible target.
{
  const now = Date.now();
  const { state, lastTs, lastX } = makeState({ startTs: now - 4000 });
  const d = diagnoseReidMiss(state, { x: lastX + 0.1, z: 0 }, { x: 1.2, z: 0 }, lastTs + 5, cfg);
  check('busy active track blames active_not_quiet', reasons(d).includes('active_not_quiet'),
    `got [${reasons(d).join(',')}]`);
}

// 6. Walking straight back the way it came.
{
  const now = Date.now();
  const { state, lastTs, lastX } = makeState({ startTs: now - 4000 });
  const d = diagnoseReidMiss(state, { x: lastX + 1.0, z: 0 }, { x: -1.2, z: 0 }, lastTs + 300, cfg);
  const r = reasons(d);
  check('reversed heading blames velocity_cosine or distance',
    r.includes('velocity_cosine') || r.includes('distance') || r.length === 0,
    `got [${r.join(',')}]`);
}

// 7. The claim the whole report rests on: for the same state and the same
//    clock, the mirror decides "would merge" exactly when _tryReid returns a
//    target. Compared against _tryReid directly rather than through process(),
//    because process() runs on wall time (Date.now(), deliberately — MQTT
//    timestamps lag) and layers ghost probation on top, neither of which the
//    mirror claims to reproduce.
{
  const now = Date.now();
  const grid = [];
  for (const dx of [0.2, 0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0]) {
    for (const dtMs of [100, 200, 400, 1000, 3000, 6000, 11000, 13000]) {
      for (const vx of [1.2, -1.2, 0.05]) grid.push([dx, dtMs, vx]);
    }
  }

  let agree = 0;
  const disagreements = [];
  for (const [dx, dtMs, vx] of grid) {
    const { rec, state, lastX } = makeState({ startTs: now - 4000 });
    // Age the pools by hand so both sides see the same gap, since the engine
    // stamps lastTs with wall time.
    const t = [...state.activeTracks.values()][0];
    const evalNow = Date.now();
    t.lastTs = evalNow - dtMs;

    const pos = { x: lastX + dx, z: 0 };
    const vel = { x: vx, z: 0 };
    const d = diagnoseReidMiss(state, pos, vel, evalNow, cfg);
    const predicted = d.closest.some((c) => c.wouldCostReid);
    const actual = rec._tryReid(state, pos, vel, evalNow, cfg) !== null;

    if (predicted === actual) agree++;
    else disagreements.push(`dx=${dx}m dt=${dtMs}ms vx=${vx} predicted=${predicted} actual=${actual}`);
  }
  for (const d of disagreements.slice(0, 8)) console.log(`        disagree ${d}`);
  check(`mirror matches _tryReid across ${grid.length} cases (${agree}/${grid.length})`,
    agree === grid.length);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
