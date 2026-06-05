/**
 * Proof: reconciled stable-id count must never exceed raw perception-id count.
 *
 * Reproduces the field failure (long-lived, gappy, slightly out-of-order
 * perception ids) and checks the invariant with the fix on vs off.
 *
 * Run: node analysis/verify_reconciler_invariant.mjs
 */
import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../backend/services/TrajectoryReconciler.js';

const VENUE = 'v';

/** Build a synthetic stream: N people, each one perception id that walks, then
 *  goes quiet for >reid_max_gap, then reappears (slot reuse). A few samples are
 *  emitted slightly out of order to mimic multi-sensor clock skew. */
function makeStream({ people = 50, segments = 4, gapMs = 30_000, stepMs = 200 }) {
  const msgs = [];
  let t0 = 1_700_000_000_000;
  for (let p = 0; p < people; p++) {
    const id = `pid_${p}`;
    let x = (p % 10) * 2;
    let z = Math.floor(p / 10) * 2;
    let t = t0 + p * 1000;
    for (let s = 0; s < segments; s++) {
      for (let k = 0; k < 30; k++) {
        x += 0.15; z += 0.05;
        msgs.push({ id, venueId: VENUE, timestamp: t, position: { x, y: 0, z }, velocity: { x: 0.75, y: 0, z: 0.25 } });
        t += stepMs;
      }
      t += gapMs; // quiet longer than reid_max_gap -> would expire
    }
  }
  // inject mild out-of-order: swap ~2% of adjacent pairs
  for (let i = 1; i < msgs.length; i += 53) {
    const tmp = msgs[i].timestamp; msgs[i].timestamp = msgs[i - 1].timestamp; msgs[i - 1].timestamp = tmp;
  }
  return msgs;
}

function run(stream, overrides) {
  const cfg = normalizeReconcilerConfig({ ...DEFAULT_CONFIG, ...overrides });
  const rec = new TrajectoryReconciler(() => cfg);
  const stable = new Set();
  const perception = new Set();
  let lastSweep = 0;
  for (const m of stream) {
    perception.add(m.id);
    if (m.timestamp - lastSweep > 250) { lastSweep = m.timestamp; rec.sweep(m.timestamp); }
    const out = rec.process(m);
    if (out) stable.add(out.stableId || out.id);
  }
  rec.sweep(stream[stream.length - 1].timestamp + 60_000);
  return { perception: perception.size, stable: stable.size };
}

const stream = makeStream({});
const base = {
  enabled: true,
  ghost_min_promotion_lifetime_ms: 0,
  ghost_min_promotion_displacement_m: 0.03,
  reid_max_gap_s: 15,
  reid_max_distance_m: 8,
  offline_instant_promote: true,
};

const off = run(stream, { ...base, persist_perception_bindings: false });
const on = run(stream, { ...base, persist_perception_bindings: true });

console.log(`raw perception ids:        ${off.perception}`);
console.log(`stable ids (fix OFF):      ${off.stable}  ${off.stable > off.perception ? 'WORSE than raw ✗' : 'ok'}`);
console.log(`stable ids (fix ON):       ${on.stable}  ${on.stable <= on.perception ? 'BETTER-or-equal vs raw ✓' : 'WORSE than raw ✗'}`);

if (on.stable > on.perception) {
  console.error('\nINVARIANT VIOLATED: reconciled > raw with fix on');
  process.exit(1);
}
console.log('\nINVARIANT HELD: reconciled stable ids <= raw perception ids');
