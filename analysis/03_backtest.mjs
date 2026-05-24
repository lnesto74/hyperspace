// Stage 3 — replay raw_tracks.jsonl through the production TrajectoryReconciler
// with parameter configurations, score each on (continuity x human-likeness),
// emit top configs as JSON + curl commands.

import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../backend/services/TrajectoryReconciler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'raw_tracks.jsonl');
const OUT_DIR = path.join(__dirname, 'out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function buildIncoming(d) {
  const p = d.position || { x: 0, y: 0, z: 0 };
  const v = d.velocity || { x: 0, y: 0, z: 0 };
  return {
    id: String(d.id),
    deviceId: d.deviceId || 'edge',
    venueId: d.venueId || 'default',
    timestamp: Number(d.timestamp) || Date.now(),
    position: { x: p.x, y: p.z, z: p.y },
    venuePosition: { x: p.x, y: p.z, z: p.y },
    velocity: { x: v.x, y: v.z, z: v.y },
    objectType: d.objectType || 'person',
    boundingBox: d.boundingBox || { width: 0.5, height: 1.7, depth: 0.5 },
  };
}

async function loadAll() {
  console.log('Loading raw_tracks.jsonl ...');
  const rl = readline.createInterface({ input: fs.createReadStream(RAW), crlfDelay: Infinity });
  const out = [];
  for await (const line of rl) {
    const idx = line.indexOf(' ');
    if (idx < 0) continue;
    try {
      const d = JSON.parse(line.slice(idx + 1));
      if (!d.position) continue;
      out.push(buildIncoming(d));
    } catch { }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  console.log('  loaded ' + out.length.toLocaleString() + ' messages');
  return out;
}

function scoreRun(stableTracks, totalRawMessages, totalUniquePerceptionIds, ghostStats) {
  const lifetimes = [];
  const displacements = [];
  const meanSpeeds = [];
  const teleportEvents = [];
  const accelSpikes = [];

  let totalSamples = 0;
  for (const t of stableTracks.values()) {
    const s = t.samples;
    if (s.length < 2) continue;
    totalSamples += s.length;
    const lifetime = (s[s.length - 1].t - s[0].t) / 1000;
    lifetimes.push(lifetime);
    let totalDisp = 0;
    let teleports = 0;
    let spikes = 0;
    let prevSpeed = 0;
    for (let i = 1; i < s.length; i++) {
      const dt = Math.max((s[i].t - s[i - 1].t) / 1000, 0.001);
      const dx = s[i].x - s[i - 1].x;
      const dz = s[i].z - s[i - 1].z;
      const step = Math.hypot(dx, dz);
      totalDisp += step;
      const speed = step / dt;
      if (speed > 3.0) teleports++;
      const accel = Math.abs(speed - prevSpeed) / dt;
      if (accel > 5) spikes++;
      prevSpeed = speed;
    }
    displacements.push(totalDisp);
    if (lifetime > 0) meanSpeeds.push(totalDisp / lifetime);
    teleportEvents.push(teleports);
    accelSpikes.push(spikes);
  }

  const arr = (xs) => xs.length ? xs : [0];
  const pct = (xs, p) => {
    const s = [...arr(xs)].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
  };
  const mean = (xs) => arr(xs).reduce((a, b) => a + b, 0) / arr(xs).length;

  return {
    n_stable_tracks: stableTracks.size,
    n_samples: totalSamples,
    raw_messages: totalRawMessages,
    raw_perception_ids: totalUniquePerceptionIds,
    fragmentation_ratio: totalUniquePerceptionIds / Math.max(stableTracks.size, 1),
    ghost_dropped: ghostStats.ghost_dropped,
    ghost_pct: (ghostStats.ghost_dropped / Math.max(totalRawMessages, 1)) * 100,
    lt_p50: pct(lifetimes, 50),
    lt_p75: pct(lifetimes, 75),
    lt_p95: pct(lifetimes, 95),
    lt_mean: mean(lifetimes),
    disp_p50: pct(displacements, 50),
    disp_mean: mean(displacements),
    speed_mean: mean(meanSpeeds),
    total_teleports: teleportEvents.reduce((a, b) => a + b, 0),
    total_accel_spikes: accelSpikes.reduce((a, b) => a + b, 0),
  };
}

function compositeScore(m) {
  const continuity = Math.log10(m.lt_mean + 1) * 0.5
                   + Math.log10(m.disp_mean + 1) * 0.3
                   + 1 / Math.log10(m.fragmentation_ratio + 1.5);
  const tpRate = m.total_teleports / Math.max(m.n_samples, 1);
  const asRate = m.total_accel_spikes / Math.max(m.n_samples, 1);
  const humanlike = Math.exp(-tpRate * 100)
                  + Math.exp(-asRate * 50)
                  + Math.exp(-Math.abs(m.speed_mean - 0.5) * 2);
  const sanity = m.n_stable_tracks < 50 ? 0.1 : 1.0;
  return continuity * 1.5 + humanlike * 1.0 + (sanity - 1) * 5;
}

function runOne(messages, configOverrides, name) {
  const config = normalizeReconcilerConfig({ ...DEFAULT_CONFIG, ...configOverrides });
  const reconciler = new TrajectoryReconciler(() => config);
  const stable = new Map();
  let lastSweep = 0;
  let totalRaw = 0;
  const totalUniquePerceptionIds = new Set();

  for (const m of messages) {
    totalRaw++;
    totalUniquePerceptionIds.add(m.id);
    if (m.timestamp - lastSweep > 250) {
      lastSweep = m.timestamp;
      reconciler.sweep(m.timestamp);
    }
    const out = reconciler.process(m);
    if (!out) continue;
    const stableId = out.stableId || out.id;
    let rec = stable.get(stableId);
    if (!rec) { rec = { samples: [], perceptionIds: new Set() }; stable.set(stableId, rec); }
    rec.samples.push({ t: out.timestamp, x: out.venuePosition.x, z: out.venuePosition.z });
    rec.perceptionIds.add(m.id);
  }
  reconciler.sweep(messages[messages.length - 1].timestamp + 60000);
  const ghostStats = reconciler.getStats(messages[0].venueId);

  const m = scoreRun(stable, totalRaw, totalUniquePerceptionIds.size, ghostStats || { ghost_dropped: 0 });
  m.name = name;
  m.score = compositeScore(m);
  m.config = config;
  return m;
}

// Smarter sweep: ~30 configs on a focused grid based on Stage 1+2 stats.
// p99 implied speed ~ 2.9 m/s, p99.5 ~ 3.7 m/s, so we test [2.5, 3.0, 3.5] for re-id implied speed.
// 50% dwelling means promotion gates must be lenient (low displacement, short lifetime).
function buildConfigs() {
  const out = [];
  const base = {
    enabled: true,
    ghost_max_speed_m_s: 3.5,
    ghost_min_promotion_lifetime_ms: 200,
    ghost_min_promotion_displacement_m: 0.1,
    ghost_static_timeout_s: 60,
    ghost_static_displacement_m: 0.3,
    reid_max_gap_s: 12,
    reid_max_distance_m: 4.0,
    reid_max_implied_speed_m_s: 2.5,
    reid_velocity_cosine_min: -0.3,
    reid_weight_distance: 1.0,
    reid_weight_velocity: 0.5,
    reid_weight_time: 0.1,
    smoothing_alpha: 0.5,
    active_to_lost_timeout_ms: 1500,
    trail_max_length: 32,
  };

  // 1) Single-axis sweeps around the base
  const axes = [
    ['ghost_max_speed_m_s', [3.0, 3.5, 4.0, 5.0]],
    ['ghost_min_promotion_lifetime_ms', [100, 200, 350, 500]],
    ['ghost_min_promotion_displacement_m', [0.05, 0.1, 0.2, 0.4]],
    ['reid_max_gap_s', [8, 12, 18, 25]],
    ['reid_max_distance_m', [3, 4, 6, 8]],
    ['reid_max_implied_speed_m_s', [1.8, 2.5, 3.2, 4.0]],
    ['smoothing_alpha', [0.3, 0.5, 0.7]],
  ];
  for (const [k, vals] of axes) {
    for (const v of vals) {
      const cfg = { ...base, [k]: v };
      out.push({ name: `${k}=${v}`, config: cfg });
    }
  }

  // 2) Targeted combos that align with Stage 1/2 evidence
  out.push({ name: 'PRESET_loose_reid', config: { ...base, reid_max_gap_s: 18, reid_max_distance_m: 6, reid_max_implied_speed_m_s: 3.0, smoothing_alpha: 0.5 } });
  out.push({ name: 'PRESET_tight_ghost', config: { ...base, ghost_max_speed_m_s: 3.0, ghost_min_promotion_lifetime_ms: 350, ghost_min_promotion_displacement_m: 0.2 } });
  out.push({ name: 'PRESET_grocery_dwell', config: { ...base, ghost_min_promotion_displacement_m: 0.05, ghost_min_promotion_lifetime_ms: 200, reid_max_gap_s: 15, reid_max_distance_m: 5, reid_max_implied_speed_m_s: 2.5, smoothing_alpha: 0.5, ghost_static_timeout_s: 90 } });
  out.push({ name: 'PRESET_aggressive_merge', config: { ...base, reid_max_gap_s: 25, reid_max_distance_m: 8, reid_max_implied_speed_m_s: 3.5, reid_velocity_cosine_min: -0.6 } });
  out.push({ name: 'PRESET_smooth_human', config: { ...base, smoothing_alpha: 0.3, reid_max_implied_speed_m_s: 2.0, ghost_max_speed_m_s: 3.0, ghost_min_promotion_lifetime_ms: 300 } });
  return out;
}

async function main() {
  const messages = await loadAll();
  const venueCount = new Map();
  for (const m of messages) venueCount.set(m.venueId, (venueCount.get(m.venueId) || 0) + 1);
  const venueId = [...venueCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const venueMessages = messages.filter(m => m.venueId === venueId);
  console.log('Using venue ' + venueId + ' (' + venueMessages.length.toLocaleString() + ' messages)');

  console.log('Running BASELINE (current production defaults) ...');
  const baseline = runOne(venueMessages, {}, 'BASELINE_DEFAULT');
  baseline.kind = 'baseline';

  console.log('Running BYPASS (no reconciliation) ...');
  const bypass = runOne(venueMessages, { enabled: false }, 'BYPASS_RAW');
  bypass.kind = 'bypass';

  const configs = buildConfigs();
  console.log('Sweep size: ' + configs.length + ' configs');
  const results = [];
  const t0 = Date.now();
  let i = 0;
  for (const c of configs) {
    i++;
    const r = runOne(venueMessages, c.config, c.name);
    r.kind = 'sweep';
    results.push(r);
    const elapsed = (Date.now() - t0) / 1000;
    const eta = elapsed * (configs.length - i) / i;
    process.stdout.write(`\r[${i}/${configs.length}] elapsed ${elapsed.toFixed(0)}s  eta ${eta.toFixed(0)}s        `);
  }
  console.log();

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 8);
  const out = { venueId, n_messages: venueMessages.length, baseline, bypass, top };
  fs.writeFileSync(path.join(OUT_DIR, '03_backtest.json'), JSON.stringify(out, null, 2));

  const fmt = (r) => `score=${r.score.toFixed(3)}  stable=${r.n_stable_tracks}  lt_mean=${r.lt_mean.toFixed(1)}s  disp_mean=${r.disp_mean.toFixed(1)}m  frag=${r.fragmentation_ratio.toFixed(2)}  ghost=${r.ghost_pct.toFixed(1)}%  teleports=${r.total_teleports}  ${r.name}`;
  console.log('\nBASELINE  ' + fmt(baseline));
  console.log('BYPASS    ' + fmt(bypass));
  console.log('\nTOP 8:');
  top.forEach((r, idx) => console.log(`  #${idx + 1}  ` + fmt(r)));
  console.log('\nWrote ' + path.join(OUT_DIR, '03_backtest.json'));
}

main().catch((e) => { console.error(e); process.exit(1); });
