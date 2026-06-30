/**
 * Smoke test: slow/static occlusion re-ID vs steady-walk re-ID.
 * Run: node analysis/occlusion_reid_smoke.mjs
 */
import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../backend/services/TrajectoryReconciler.js';

const V = 'v';
const cfg = normalizeReconcilerConfig({
  ...DEFAULT_CONFIG,
  enabled: true,
  ghost_min_promotion_lifetime_ms: 0,
  ghost_min_promotion_displacement_m: 0,
  reid_max_gap_s: 12,
  reid_max_distance_m: 12.7,
  reid_max_implied_speed_m_s: 2.6,
  reid_velocity_cosine_min: 0.2,
  reid_slow_speed_m_s: 0.35,
  reid_static_max_distance_m: 3.0,
  reid_isolation_radius_m: 2.5,
  active_to_lost_timeout_ms: 500,
});

function runCase(name, fn) {
  const rec = new TrajectoryReconciler(() => cfg);
  rec.setVenueConfig(V, cfg);
  const result = fn(rec);
  console.log(`${result.ok ? '✓' : '✗'} ${name}${result.detail ? ` — ${result.detail}` : ''}`);
  return result.ok;
}

const steadyOk = runCase('steady walk re-ID', (rec) => {
  let t = 1e12;
  const emit = (id, x, z, vx) => {
    const out = rec.process({ id, venueId: V, timestamp: t, position: { x, y: 0, z }, velocity: { x: vx, y: 0, z: 0 } });
    t += 200;
    return out;
  };
  for (let i = 0; i < 25; i++) emit('p1', i * 0.2, 0, 1.0);
  const sid = emit('p1', 5.0, 0, 1.0)?.stableId;
  t += 3000;
  rec.sweep(t);
  emit('p1b', 4.0, 0, 1.0);
  const o2 = emit('p1b', 4.2, 0, 1.0);
  const got = o2?.stableId;
  return { ok: got === sid, detail: `want ${sid?.slice(0, 8)} got ${got?.slice(0, 8)}` };
});

const decelOk = runCase('decel before gap re-ID', (rec) => {
  let t = 1e12;
  const emit = (id, x, z, vx) => {
    const out = rec.process({ id, venueId: V, timestamp: t, position: { x, y: 0, z }, velocity: { x: vx, y: 0, z: 0 } });
    t += 200;
    return out;
  };
  emit('p2', 0, 10, 1.0);
  for (let i = 1; i <= 20; i++) {
    const spd = Math.max(0.12, 1.0 - i * 0.05);
    emit('p2', i * 0.25, 10, spd);
  }
  const sid = emit('p2', 5.0, 10, 0.15)?.stableId;
  t += 4000;
  rec.sweep(t);
  emit('p2b', 5.2, 10, 0.1);
  const o2 = emit('p2b', 5.2, 10, 0.1);
  return { ok: o2?.stableId === sid, detail: `want ${sid?.slice(0, 8)} got ${o2?.stableId?.slice(0, 8)}` };
});

const staticOk = runCase('static occlusion re-ID', (rec) => {
  let t = 1e12;
  const emit = (id, x, z) => {
    const out = rec.process({ id, venueId: V, timestamp: t, position: { x, y: 0, z }, velocity: { x: 0, y: 0, z: 0 } });
    t += 200;
    return out;
  };
  for (let i = 0; i < 15; i++) emit('p3', 0, 20);
  const sid = emit('p3', 0, 20)?.stableId;
  t += 5000;
  rec.sweep(t);
  emit('p3b', 2.0, 20);
  const o2 = emit('p3b', 2.0, 20);
  return { ok: o2?.stableId === sid, detail: `want ${sid?.slice(0, 8)} got ${o2?.stableId?.slice(0, 8)}` };
});

const staleActiveOk = runCase('stale-active re-ID (2.5s gap, before 6s lost)', (rec) => {
  let t = 1e12;
  const emit = (id, x, z, vx) => {
    const out = rec.process({ id, venueId: V, timestamp: t, position: { x, y: 0, z }, velocity: { x: vx, y: 0, z: 0 } });
    t += 200;
    return out;
  };
  for (let i = 0; i < 20; i++) emit('p4', i * 0.25, 30, 1.0);
  const lastP4 = emit('p4', 5.0, 30, 1.0);
  const sid = lastP4?.stableId;
  const sn = lastP4?.shopperNumber;
  t += 2500;
  rec.sweep(t);
  emit('p4b', 5.5, 30, 1.0);
  const o2 = emit('p4b', 5.75, 30, 1.0);
  return { ok: o2?.stableId === sid && o2?.shopperNumber === sn, detail: `want #${sn} got #${o2?.shopperNumber}` };
});

if (!steadyOk || !decelOk || !staticOk || !staleActiveOk) process.exit(1);
console.log('\nAll occlusion re-ID smoke tests passed');
