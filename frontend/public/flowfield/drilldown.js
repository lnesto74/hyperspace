/**
 * Margin drill-down overlay: Why (fingerprint + levers) → Who (hesitating /
 * confused IDs) → one ID (full trajectory microscope + shopper radar).
 * Ports Profit Radar theatre chrome into the vanilla flowfield prototype.
 */
const AXES = [
  ['exploration', 'Explore'],
  ['goal_directedness', 'Goal'],
  ['urgency', 'Urgency'],
  ['commitment', 'Commit'],
  ['hesitation', 'Hesitate'],
  ['confusion', 'Confused'],
  ['social_groupness', 'Group'],
  ['avoidance', 'Avoid'],
  ['waiting_queueing', 'Queue'],
  ['engagement_with_POI', 'Engage'],
  ['churn_exit_intent', 'Exit'],
  ['friction', 'Friction'],
];

const AXIS_LABEL = Object.fromEntries(AXES);
const CAPTURE_CEILING = 0.6;
const MATCH_FLOOR = 0.15;
const DEMO_DT = 0.22;
const ARROW_COLOR = '#22d3ee';

const LEVERS = [
  { id: 'layout', label: 'Reposition / speed-bump', targetAxis: 'avoidance', base: 0.35, blurb: 'Interrupt the flow so shoppers stop' },
  { id: 'pricing', label: 'Price / retail-media promo', targetAxis: '__low_commitment', base: 0.32, blurb: 'Convert shoppers who look but don\u2019t buy' },
  { id: 'wayfinding', label: 'Signage / wayfinding', targetAxis: 'confusion', base: 0.30, blurb: 'Help shoppers find & decide' },
  { id: 'crossmerch', label: 'Cross-merch / bundle', targetAxis: 'hesitation', base: 0.30, blurb: 'Bundle to push hesitating shoppers over the line' },
];

const STORE_AVG = {
  exploration: 0.38, goal_directedness: 0.34, urgency: 0.28, commitment: 0.31,
  hesitation: 0.27, confusion: 0.22, social_groupness: 0.18, avoidance: 0.30,
  waiting_queueing: 0.16, engagement_with_POI: 0.36, churn_exit_intent: 0.20, friction: 0.24,
};

function fullAxes(partial) {
  const out = {};
  for (const [k] of AXES) out[k] = partial[k] ?? 0.1;
  return out;
}

const MOMENTS = [
  {
    id: 'confusion',
    label: 'Confused',
    axis: 'confusion',
    personId: 'person-51813',
    trackKey: 'lidar-edge-001:person-51813',
    center: { x: 22.13, z: -2.2 },
    spanM: 0.36,
    catalogAxes: fullAxes({
      exploration: 0.98, goal_directedness: 0.28, urgency: 0.68, commitment: 0.4,
      hesitation: 0.67, confusion: 1, avoidance: 0.28, engagement_with_POI: 0.11,
    }),
    storyTitle: 'Lost in the aisle',
    storyLine: 'Backtracks and loops \u2014 confusion dominates before they re-orient.',
    demoTrail: [
      { x: 22.97, z: -2.16 }, { x: 22.93, z: -2.17 }, { x: 22.92, z: -2.2 }, { x: 22.31, z: -2.25 },
      { x: 22.04, z: -2.1 }, { x: 21.97, z: -2.05 }, { x: 22.04, z: -2.13 }, { x: 22.02, z: -2.08 },
      { x: 22.01, z: -2.05 }, { x: 22.27, z: -2.22 }, { x: 22.26, z: -2.26 }, { x: 22.19, z: -2.25 },
      { x: 22.31, z: -2.36 }, { x: 22.35, z: -2.28 }, { x: 22.26, z: -2.23 }, { x: 22.25, z: -2.27 },
      { x: 22.29, z: -2.24 }, { x: 22.27, z: -2.19 }, { x: 22.27, z: -2.2 }, { x: 22.31, z: -2.17 },
      { x: 22.31, z: -2.16 }, { x: 22.33, z: -2.22 }, { x: 22.32, z: -2.19 },
    ],
  },
  {
    id: 'hesitation',
    label: 'Hesitating',
    axis: 'hesitation',
    personId: 'person-59538',
    trackKey: 'lidar-edge-001:person-59538',
    center: { x: 15.35, z: -2.16 },
    spanM: 1.1,
    catalogAxes: fullAxes({
      exploration: 0.91, goal_directedness: 0.64, urgency: 0.76, commitment: 0.7,
      hesitation: 0.88, confusion: 0.91, avoidance: 0.47, engagement_with_POI: 0.3,
    }),
    storyTitle: 'Stop\u2013look\u2013leave',
    storyLine: 'Micro-movements and pauses \u2014 engaged with the shelf but unable to commit.',
    demoTrail: [
      { x: 15.28, z: -2.06 }, { x: 15.29, z: -2.04 }, { x: 16.04, z: -1.86 }, { x: 15.63, z: -1.87 },
      { x: 14.79, z: -2.48 }, { x: 13.97, z: -2.51 }, { x: 14.68, z: -2.47 }, { x: 14.86, z: -2.47 },
      { x: 14.83, z: -2.47 }, { x: 14.8, z: -2.47 }, { x: 14.8, z: -2.48 }, { x: 14.8, z: -2.48 },
      { x: 14.8, z: -2.48 }, { x: 14.8, z: -2.48 }, { x: 14.8, z: -2.47 }, { x: 14.8, z: -2.47 },
      { x: 14.8, z: -2.48 }, { x: 14.8, z: -2.48 }, { x: 15.83, z: -1.87 }, { x: 15.7, z: -1.82 },
      { x: 16.07, z: -1.7 }, { x: 15.99, z: -1.74 }, { x: 15.19, z: -2.24 }, { x: 15, z: -2.38 },
      { x: 15.05, z: -2.37 }, { x: 14.98, z: -2.41 },
    ],
  },
];

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function dominantAxis(axes) {
  return AXES.reduce((best, [k]) => ((axes[k] ?? 0) > (axes[best] ?? 0) ? k : best), AXES[0][0]);
}

function leverMatch(lever, axes, engagement, commitment) {
  if (lever.targetAxis === '__low_commitment') {
    const eng = engagement ?? axes.engagement_with_POI ?? 0;
    const com = commitment ?? axes.commitment ?? 0;
    return clamp01(eng * (1 - com) * 2);
  }
  return clamp01(axes[lever.targetAxis] ?? 0);
}

function recoveryForLever(econ, lever, effort, modeF = 1) {
  const match = leverMatch(lever, econ.axes, econ.engagement, econ.commitment);
  const conv = econ.conversionRate != null
    ? econ.conversionRate
    : econ.engagement * (0.4 + 0.6 * (econ.commitment ?? 0.3));
  const gap = Math.max(0, econ.benchmark - conv);
  const capture = Math.min(CAPTURE_CEILING, lever.base * modeF * effort * (MATCH_FLOOR + (1 - MATCH_FLOOR) * match));
  const perDay = econ.exposedPerDay * gap * capture * econ.winnable * econ.baseAttachRate * econ.marginPerUnit;
  return { match, capture, perDay, perWeek: perDay * (econ.tradingDaysPerWeek || 6) };
}

function trailVelocity(trail) {
  if (trail.length < 2) return null;
  const last = trail[trail.length - 1];
  let prev = trail[trail.length - 2];
  for (let i = trail.length - 2; i >= 0; i--) {
    const p = trail[i];
    if (Math.hypot(last.x - p.x, last.z - p.z) > 0.015) { prev = p; break; }
  }
  const dx = last.x - prev.x, dz = last.z - prev.z;
  const speed = Math.hypot(dx, dz);
  if (speed < 0.001) return null;
  return { dx, dz, speed, last };
}

function computeTrailPhysics(trail, dtSec = DEMO_DT) {
  if (trail.length < 2) return null;
  const segments = [];
  for (let i = 1; i < trail.length; i++) {
    const dx = trail[i].x - trail[i - 1].x;
    const dz = trail[i].z - trail[i - 1].z;
    const dist = Math.hypot(dx, dz);
    let dt = dtSec;
    if (Number.isFinite(trail[i].t) && Number.isFinite(trail[i - 1].t)) {
      dt = Math.max(0.05, (trail[i].t - trail[i - 1].t) / 1000);
    }
    segments.push({ dist, dt, speed: dist / dt, heading: (Math.atan2(dz, dx) * 180) / Math.PI });
  }
  const last = segments[segments.length - 1];
  const prev = segments.length >= 2 ? segments[segments.length - 2] : last;
  let turnRate = 0;
  if (segments.length >= 2) {
    let dh = last.heading - prev.heading;
    while (dh > 180) dh -= 360;
    while (dh < -180) dh += 360;
    turnRate = dh / last.dt;
  }
  const curvature = last.speed > 0.05 ? Math.abs((turnRate * Math.PI) / 180) / last.speed : 0;
  const pathLengthM = segments.reduce((s, seg) => s + seg.dist, 0);
  const net = Math.hypot(trail[trail.length - 1].x - trail[0].x, trail[trail.length - 1].z - trail[0].z);
  const straightness = pathLengthM > 0.01 ? net / pathLengthM : 1;
  const dwellPct = (segments.filter((s) => s.speed < 0.08).length / segments.length) * 100;
  return {
    speedMs: last.speed,
    headingDeg: ((last.heading % 360) + 360) % 360,
    turnRateDegS: turnRate,
    accelMs2: segments.length >= 2 ? (last.speed - prev.speed) / last.dt : 0,
    curvature,
    straightness,
    pathLengthM,
    netDisplacementM: net,
    dwellPct,
  };
}

function viewBoxFor(trail, spanM) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of trail) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const pad = 0.5;
  const minSpan = Math.max(2.0, Math.min(3.2, (spanM || 1.2) + 1.8));
  let w = Math.max(minSpan, maxX - minX + pad * 2);
  let h = Math.max(minSpan, maxZ - minZ + pad * 2);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  return `${cx - w / 2} ${cz - h / 2} ${w} ${h}`;
}

function synthesizeAxes(info) {
  const eng = info.engagement || 0;
  const stopGap = Math.max(0, 0.45 - eng);
  const purity = info.cells ? Math.min(1, info.speed / 1.2) : 0.4;
  return fullAxes({
    exploration: clamp01(0.35 + stopGap),
    goal_directedness: clamp01(eng * 0.7),
    urgency: clamp01(0.2 + (info.speed || 0) * 0.25),
    commitment: clamp01(eng * 0.55),
    hesitation: clamp01(0.2 + stopGap * 1.4),
    confusion: clamp01(0.15 + (1 - purity) * 0.5),
    avoidance: clamp01(0.2 + stopGap),
    engagement_with_POI: clamp01(eng),
    churn_exit_intent: clamp01(0.15 + stopGap * 0.6),
    friction: clamp01(0.18 + stopGap * 0.8),
  });
}

const LEAK_AXES = ['hesitation', 'confusion', 'avoidance', 'friction', 'churn_exit_intent'];
const CLUSTER_STORY = {
  hesitation: { label: 'Hesitating', storyTitle: 'Stop\u2013look\u2013leave', storyLine: 'Micro-movements and pauses \u2014 engaged with the shelf but unable to commit.' },
  confusion: { label: 'Confused', storyTitle: 'Lost in the aisle', storyLine: 'Backtracks and loops \u2014 confusion dominates before they re-orient.' },
  engagement_with_POI: { label: 'Engaged', storyTitle: 'Stopped at the facing', storyLine: 'Dwell on the bay \u2014 the path commits to the shelf.' },
  goal_directedness: { label: 'Passing through', storyTitle: 'Commute, not a stop', storyLine: 'Straight and fast \u2014 they used the aisle, they did not shop it.' },
  avoidance: { label: 'Avoiding', storyTitle: 'Skirted the facing', storyLine: 'The path bends around the bay rather than into it.' },
  churn_exit_intent: { label: 'Leaving', storyTitle: 'On the way out', storyLine: 'Heading away \u2014 this visit is already over.' },
  urgency: { label: 'Urgent', storyTitle: 'In a hurry', storyLine: 'High speed, little dwell \u2014 a mission, not a browse.' },
  friction: { label: 'Friction', storyTitle: 'Stuck in the bay', storyLine: 'Slow, crooked progress \u2014 something is in the way.' },
};

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function roiCenter(sel) {
  const v = sel?.vertices || [];
  if (!v.length) return { x: 0, z: 0 };
  let x = 0, z = 0;
  for (const p of v) {
    x += Number(p[0] ?? p.x) || 0;
    z += Number(p[1] ?? p.z) || 0;
  }
  return { x: x / v.length, z: z / v.length };
}

function classifyPhysics(physics) {
  if (!physics) return 'hesitation';
  const dwell = physics.dwellPct / 100;
  const straight = physics.straightness;
  if (straight < 0.32 && dwell > 0.2) return 'confusion';
  if (dwell > 0.42 && straight < 0.55) return 'hesitation';
  if (dwell > 0.35 && straight >= 0.55) return 'engagement_with_POI';
  if (straight > 0.72 && dwell < 0.18) return 'goal_directedness';
  if (physics.speedMs > 1.15 && dwell < 0.2) return 'urgency';
  if (straight < 0.45 && dwell < 0.25) return 'avoidance';
  if (dwell > 0.5) return 'friction';
  return 'hesitation';
}

function axesFromPhysics(physics, axis) {
  const dwell = clamp01((physics?.dwellPct || 0) / 100);
  const loop = clamp01(1 - (physics?.straightness ?? 0.5));
  return fullAxes({
    exploration: clamp01(0.25 + loop * 0.6),
    goal_directedness: clamp01(physics?.straightness ?? 0.3),
    urgency: clamp01((physics?.speedMs || 0) / 1.6),
    commitment: clamp01(dwell * 0.55),
    hesitation: axis === 'hesitation' ? clamp01(0.55 + dwell * 0.4) : clamp01(0.15 + dwell),
    confusion: axis === 'confusion' ? clamp01(0.6 + loop * 0.4) : clamp01(loop * 0.7),
    avoidance: axis === 'avoidance' ? 0.72 : clamp01(0.15 + loop * 0.3),
    engagement_with_POI: clamp01(dwell),
    churn_exit_intent: axis === 'churn_exit_intent' ? 0.7 : 0.18,
    friction: axis === 'friction' ? clamp01(0.55 + dwell) : clamp01(0.15 + dwell * 0.4),
  });
}

function itemFromTrail(opts) {
  const trail = opts.trail || [];
  const physics = computeTrailPhysics(trail);
  const axis = opts.axis || classifyPhysics(physics);
  const story = CLUSTER_STORY[axis] || CLUSTER_STORY.hesitation;
  const last = trail[trail.length - 1] || { x: 0, z: 0 };
  const first = trail[0] || last;
  return {
    id: opts.id,
    personId: opts.personId,
    trackKey: opts.trackKey || opts.personId,
    axis,
    label: story.label,
    catalogAxes: opts.catalogAxes || axesFromPhysics(physics, axis),
    storyTitle: story.storyTitle,
    storyLine: story.storyLine,
    demoTrail: trail,
    spanM: opts.spanM || Math.max(0.4, physics?.netDisplacementM || 1),
    center: opts.center || { x: (first.x + last.x) / 2, z: (first.z + last.z) / 2 },
    source: opts.source || 'live',
    inRoiS: opts.inRoiS,
    durationS: opts.durationS,
  };
}

function pathTouchesZone(path, sel) {
  if (!path?.length) return false;
  const verts = sel?.vertices;
  const pip = api?.pointInPoly;
  if (verts && pip) {
    return path.some((p) => pip(p.x, p.z, verts));
  }
  return path.some((p) => p.inRoi);
}

function emptyCluster() {
  return { loading: false, source: '', note: '', items: [], filterAxis: '', counts: {}, zoneN: 0 };
}

function clusterCounts(items) {
  const counts = {};
  for (const it of items) counts[it.axis] = (counts[it.axis] || 0) + 1;
  return counts;
}

function pickFilterAxis(items, bayAxis) {
  const counts = clusterCounts(items);
  if (bayAxis && counts[bayAxis]) return bayAxis;
  for (const ax of LEAK_AXES) if (counts[ax]) return ax;
  let best = '', n = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > n) { n = v; best = k; }
  }
  return best;
}

function storyClusterItems() {
  return MOMENTS.map((m) => ({ ...m, source: 'demo', demoTrail: m.demoTrail }));
}

function synthesizeCluster(sel, info, axes) {
  const bayAxis = dominantAxis(axes);
  const n = Math.max(8, Math.min(28, Math.round(Math.max(24, info.footfall || 40) * 0.06 * (0.35 + (1 - (info.engagement || 0.3))))));
  const seed = hash32(sel?.id || sel?.name || 'bay');
  const center = roiCenter(sel);
  const templates = MOMENTS;
  const leak = LEAK_AXES.includes(bayAxis) ? bayAxis : 'hesitation';
  const items = [];
  for (let i = 0; i < n; i++) {
    const h = hash32(`${seed}:${i}`);
    const axis = (h % 10) < 7 ? leak : (leak === 'hesitation' ? 'confusion' : 'hesitation');
    const tmpl = templates[axis === 'confusion' ? 0 : 1] || templates[0];
    const jx = ((h % 17) - 8) * 0.04;
    const jz = (((h >> 4) % 17) - 8) * 0.04;
    const dx = center.x - tmpl.center.x + jx;
    const dz = center.z - tmpl.center.z + jz;
    const trail = tmpl.demoTrail.map((p) => ({ x: p.x + dx, z: p.z + dz }));
    const pid = `person-${(h % 900000 + 100000).toString(16)}`;
    items.push(itemFromTrail({
      id: pid,
      personId: pid,
      trackKey: `modelled:${pid}`,
      trail,
      axis,
      catalogAxes: tmpl.catalogAxes,
      source: 'modelled',
      spanM: tmpl.spanM,
      center: { x: center.x + jx, z: center.z + jz },
      durationS: 18 + (h % 40),
      inRoiS: 6 + (h % 14),
    }));
  }
  return items;
}

function itemsFromSamples(samples, sel) {
  const inZone = samples.filter((s) => pathTouchesZone(s.reconciledPath || [], sel));
  const pool = inZone.length ? inZone : samples;
  return pool.map((s) => {
    const path = s.reconciledPath || [];
    const trail = path.map((p) => ({ x: p.x, z: p.z, t: p.t }));
    const pid = String(s.rawId || s.trackKey || 'person');
    return itemFromTrail({
      id: pid,
      personId: pid,
      trackKey: s.trackKey || pid,
      trail,
      source: 'live',
      spanM: s.spanM,
      inRoiS: s.inRoiDurationS,
      durationS: s.durationS,
    });
  }).filter((it) => it.demoTrail.length >= 3);
}

let clusterGen = 0;

async function loadCluster() {
  const gen = ++clusterGen;
  const sel = state.sel;
  const story = document.documentElement.classList.contains('story-on');
  if (story) {
    const items = storyClusterItems();
    state.cluster = {
      loading: false, source: 'demo', note: 'Story capture IDs.',
      items, filterAxis: pickFilterAxis(items, dominantAxis(state.econ.axes)),
      counts: clusterCounts(items), zoneN: items.length,
    };
    if (state.step === 'who' || state.step === 'id') paint();
    return;
  }
  state.cluster = { ...emptyCluster(), loading: true, filterAxis: dominantAxis(state.econ.axes) };
  const ctx = api.getClusterContext?.() || {};
  const category = sel?.category;
  let items = [];
  let source = 'modelled';
  let note = '';
  if (category && ctx.venueId && Number.isFinite(ctx.start) && Number.isFinite(ctx.end) && ctx.end > ctx.start) {
    try {
      const u = new URL('/api/benchmark/live-samples', location.origin);
      u.searchParams.set('venueId', ctx.venueId);
      u.searchParams.set('category', category);
      u.searchParams.set('start', String(Math.round(ctx.start)));
      u.searchParams.set('end', String(Math.round(ctx.end)));
      u.searchParams.set('limit', '40');
      u.searchParams.set('mode', 'raw');
      u.searchParams.set('sort', 'longest');
      const res = await fetch(u.pathname + u.search, { credentials: 'include', cache: 'no-store' });
      if (res.ok) {
        const payload = await res.json();
        const samples = payload.samples || [];
        items = itemsFromSamples(samples, sel);
        if (items.length) {
          source = 'live';
          const clipped = samples.length && items.length < samples.length;
          note = clipped
            ? `${items.length} of ${samples.length} category tracks entered this facing.`
            : `${items.length} tracks that touched this zone.`;
        }
      } else {
        note = `Live tracks unavailable (${res.status}). Showing a modelled cluster.`;
      }
    } catch {
      note = 'Live tracks unavailable. Showing a modelled cluster from this bay\u2019s fingerprint.';
    }
  } else {
    note = 'No category on this zone \u2014 modelled cluster from the fingerprint.';
  }
  if (gen !== clusterGen || !state.open) return;
  if (!items.length) {
    items = synthesizeCluster(sel, state.info, state.econ.axes);
    source = 'modelled';
    if (!note) note = 'Modelled cluster from this bay\u2019s fingerprint \u00b7 live IDs when the track store answers.';
  }
  const bayAxis = dominantAxis(state.econ.axes);
  state.cluster = {
    loading: false,
    source,
    note,
    items,
    filterAxis: pickFilterAxis(items, bayAxis),
    counts: clusterCounts(items),
    zoneN: items.length,
  };
  if (state.step === 'who') paint();
}

function econFrom(info, insight) {
  const axes = insight?.economics?.axes || synthesizeAxes(info);
  const engagement = insight?.economics?.engagement ?? insight?.dataBasis?.engagement ?? info.engagement ?? 0;
  const euro = info.euroDay || 0;
  return {
    axes,
    engagement,
    commitment: insight?.economics?.commitment ?? axes.commitment ?? 0.3,
    conversionRate: insight?.economics?.conversionRate,
    benchmark: insight?.economics?.benchmark ?? 0.45,
    exposedPerDay: insight?.economics?.exposedPerDay ?? Math.max(20, (info.footfall || 0) * 0.35),
    winnable: insight?.economics?.winnable ?? 0.45,
    baseAttachRate: insight?.economics?.baseAttachRate ?? 1,
    marginPerUnit: insight?.economics?.marginPerUnit ?? 1.8,
    tradingDaysPerWeek: insight?.economics?.tradingDaysPerWeek ?? 6,
    recommendedLeverId: insight?.economics?.recommendedLeverId || 'layout',
    currency: 'EUR',
    live: !!(insight?.economics),
    impactMin: insight?.impact?.min ?? euro * 0.6,
    impactMax: insight?.impact?.max ?? euro * 1.4,
    confidence: insight?.confidence ?? (insight?.economics ? 0.62 : 0.38),
  };
}

function radarSvg(means, avg, dominant, color = '#f59e0b', size = 220) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 30, n = AXES.length;
  const angleFor = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, val) => {
    const a = angleFor(i);
    const r = R * clamp01(val);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poly = (vals) => AXES.map((ax, i) => pt(i, vals[ax[0]] ?? 0).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map((r) =>
    `<circle cx="${cx}" cy="${cy}" r="${R * r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`).join('');
  const spokes = AXES.map((ax, i) => {
    const [ex, ey] = pt(i, 1);
    const [lx, ly] = pt(i, 1.18);
    const isDom = ax[0] === dominant;
    const anchor = Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end';
    return `<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" font-size="9"
        fill="${isDom ? color : 'rgba(148,163,184,0.85)'}" font-weight="${isDom ? 700 : 500}"
        font-family="IBM Plex Mono, ui-monospace, monospace">${ax[1]}</text>`;
  }).join('');
  const avgPoly = avg
    ? `<polygon points="${poly(avg)}" fill="rgba(148,163,184,0.10)" stroke="rgba(148,163,184,0.5)" stroke-width="1" stroke-dasharray="3 3"/>`
    : '';
  const di = AXES.findIndex((a) => a[0] === dominant);
  const [px, py] = di >= 0 ? pt(di, means[dominant] ?? 0) : [cx, cy];
  return `<svg viewBox="0 0 ${size} ${size}" class="drill-radar">${rings}${spokes}${avgPoly}
    <polygon points="${poly(means)}" fill="${color}33" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${px}" cy="${py}" r="3.5" fill="${color}" stroke="#0b0f17" stroke-width="1.5"/></svg>`;
}

function velocityArrowSvg(origin, velocity, strokeScale) {
  const len = Math.hypot(velocity.dx, velocity.dz) || 1;
  const ux = velocity.dx / len, uz = velocity.dz / len;
  const shaftLen = strokeScale * (3.2 + Math.min(4.2, velocity.speed * 5));
  const tipX = origin.x + ux * shaftLen, tipZ = origin.z + uz * shaftLen;
  const nx = -uz, nz = ux;
  const headW = strokeScale * 0.55, headL = strokeScale * 0.95;
  const baseX = tipX - ux * headL, baseZ = tipZ - uz * headL;
  const shaftW = strokeScale * 0.28;
  return `<g>
    <line x1="${origin.x}" y1="${origin.z}" x2="${baseX}" y2="${baseZ}" stroke="rgba(34,211,238,0.25)" stroke-width="${shaftW * 2.2}" stroke-linecap="round"/>
    <line x1="${origin.x}" y1="${origin.z}" x2="${baseX}" y2="${baseZ}" stroke="${ARROW_COLOR}" stroke-width="${shaftW}" stroke-linecap="round"/>
    <polygon points="${tipX},${tipZ} ${baseX + nx * headW},${baseZ + nz * headW} ${baseX - nx * headW},${baseZ - nz * headW}" fill="${ARROW_COLOR}"/>
  </g>`;
}

function fixtureSvg(boxes, vb, strokeScale) {
  const [vx, vz, vw, vh] = vb.split(/\s+/).map(Number);
  return boxes.map((b) => {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    if (cx < vx - 1 || cx > vx + vw + 1 || cz < vz - 1 || cz > vz + vh + 1) return '';
    const d = `M ${b.minX} ${b.minZ} L ${b.maxX} ${b.minZ} L ${b.maxX} ${b.maxZ} L ${b.minX} ${b.maxZ} Z`;
    return `<path d="${d}" fill="rgba(0,210,255,0.05)" stroke="rgba(0,210,255,0.2)" stroke-width="${strokeScale * 0.5}"/>`;
  }).join('');
}

function polyLine(pts, stroke, width, opacity = 1) {
  if (pts.length < 2) return '';
  return `<polyline points="${pts.map((p) => `${p.x},${p.z}`).join(' ')}" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

let api = null;
let state = {
  open: false,
  step: 'why',
  sel: null,
  info: null,
  insight: null,
  econ: null,
  leverId: 'layout',
  effort: 0.6,
  moment: null,
  cluster: emptyCluster(),
  anim: 0,
  started: 0,
  raf: 0,
};

function el(id) { return document.getElementById(id); }

function findInsight(sel) {
  const list = api.liveInsights() || [];
  return list.find((ins) => ins.dataBasis?.roiId === sel?.id) || null;
}

export function initDrilldown(opts) {
  api = opts;
  el('drillClose')?.addEventListener('click', () => {
    if (document.documentElement.classList.contains('story-on')) return;
    close();
  });
  el('drill')?.addEventListener('click', (e) => {
    if (e.target.id !== 'drill') return;
    if (document.documentElement.classList.contains('story-on')) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !state.open) return;
    if (document.documentElement.classList.contains('story-on')) return;
    close();
  });
  window.__ffDrill = { open, close, goto, isOpen: () => state.open };
}

function resolveMoment(idOrObj) {
  if (!idOrObj) return null;
  if (typeof idOrObj === 'string') {
    return state.cluster.items.find((m) => m.id === idOrObj)
      || MOMENTS.find((m) => m.id === idOrObj)
      || null;
  }
  return idOrObj;
}

export function open(sel, opts = {}) {
  if (!api || !sel) return;
  cancelAnim();
  state.open = true;
  state.sel = sel;
  state.info = api.inspect(sel);
  state.insight = findInsight(sel);
  state.econ = econFrom(state.info, state.insight);
  state.leverId = state.econ.recommendedLeverId || 'layout';
  state.effort = 0.6;
  state.cluster = { ...emptyCluster(), loading: true, filterAxis: dominantAxis(state.econ.axes) };
  document.documentElement.classList.add('drill-on');
  el('drill').hidden = false;
  api.onOpen?.();
  const step = opts.step || 'why';
  let moment = resolveMoment(opts.moment);
  if (step === 'id' && !moment) moment = MOMENTS.find((m) => m.id === 'hesitation') || MOMENTS[0];
  goto(step, moment);
  void loadCluster();
}

export function close() {
  cancelAnim();
  state.open = false;
  state.moment = null;
  document.documentElement.classList.remove('drill-on');
  const root = el('drill');
  if (root) root.hidden = true;
  api?.onClose?.();
}

function cancelAnim() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}

function goto(step, moment = null) {
  state.step = step;
  state.moment = resolveMoment(moment) || moment;
  if (step === 'id' && moment) {
    state.started = Date.now();
    state.anim = 0;
    const tick = () => {
      if (!state.open || state.step !== 'id') return;
      state.anim++;
      paintMicroscope();
      state.raf = requestAnimationFrame(tick);
    };
    cancelAnim();
    state.raf = requestAnimationFrame(tick);
  } else {
    cancelAnim();
  }
  paint();
}

function ladderHtml() {
  const steps = [
    ['why', 'Why'],
    ['who', 'Who'],
    ['id', 'One ID'],
  ];
  return `<div class="drill-ladder">${steps.map(([id, lab], i) => {
    const on = state.step === id ? 'on' : '';
    const done = ['why', 'who', 'id'].indexOf(state.step) > i ? 'done' : '';
    return `<button type="button" class="drill-rung ${on} ${done}" data-step="${id}">${lab}</button>`;
  }).join('<span class="drill-gap"></span>')}</div>`;
}

function paint() {
  const body = el('drillBody');
  const meta = el('drillMeta');
  if (!body) return;
  const name = state.sel?.name || state.info?.name || 'Bay';
  if (meta) meta.textContent = `${(state.sel?.category || '').toUpperCase()} \u00b7 ${name}`;
  el('drillLadderWrap').innerHTML = ladderHtml();
  el('drillLadderWrap').querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.__ffStoryGotoDrill?.(btn.dataset.step, state.moment?.id)) return;
      if (btn.dataset.step === 'id' && !state.moment) goto('who');
      else goto(btn.dataset.step, state.moment);
    });
  });
  if (state.step === 'why') body.innerHTML = whyHtml();
  else if (state.step === 'who') body.innerHTML = whoHtml();
  else body.innerHTML = idShellHtml();
  bindWhy();
  bindWho();
  el('drillBackWhy')?.addEventListener('click', () => {
    if (window.__ffStoryGotoDrill?.('why')) return;
    goto('why');
  });
  if (state.step === 'id') paintMicroscope();
}

function whyHtml() {
  const e = state.econ;
  const info = state.info;
  const color = '#f59e0b';
  const means = e.axes;
  const dom = dominantAxis(means);
  const live = e.live ? 'live' : 'estimated';
  const euroDay = info.euroDay || 0;
  const leverRows = LEVERS.map((lev) => {
    const on = lev.id === state.leverId ? 'on' : '';
    const rec = recoveryForLever(e, lev, state.effort, 1);
    return `<button type="button" class="drill-lever ${on}" data-lever="${lev.id}">
      <span class="k">${lev.label}</span>
      <span class="m">${Math.round(rec.match * 100)}% match</span>
    </button>`;
  }).join('');
  const selected = LEVERS.find((l) => l.id === state.leverId) || LEVERS[0];
  const rec = recoveryForLever(e, selected, state.effort, 1);
  const conf = Math.round((e.confidence || 0) * 100);
  const liveEuro = info.profitBasis === 'LIVE';
  const euroFig = liveEuro
    ? `${api.fmtEuro(e.impactMin)} \u2013 ${api.fmtEuro(e.impactMax)}<span class="kpi-unit"> / day</span>`
    : euroDay > 0.5
      ? `${api.fmtEuro(euroDay)}<span class="kpi-unit"> / day \u00b7 modelled</span>`
      : `\u2014`;
  const euroSub = liveEuro
    ? `${conf}% confidence \u00b7 bay ${api.fmtEuro(euroDay)} / day \u00b7 stop ${Math.round((info.engagement || 0) * 100)}%`
    : `${conf}% confidence \u00b7 modelled leakage \u00b7 stop ${Math.round((info.engagement || 0) * 100)}%`;
  const recFig = `${api.fmtEuro(rec.perWeek)}<span class="kpi-unit"> / week${liveEuro ? '' : ' \u00b7 modelled'}</span>`;
  const recSub = liveEuro
    ? `${api.fmtEuro(rec.perDay)} / day \u00b7 expected mode`
    : `${api.fmtEuro(rec.perDay)} / day \u00b7 modelled until Profit Radar is LIVE`;
  return `
    <div class="drill-split">
      <div class="drill-col">
        <div class="drill-k">Behavioral fingerprint</div>
        <p class="drill-sub">Dominant: ${AXIS_LABEL[dom]} \u00b7 ${live} vs store avg</p>
        ${radarSvg(means, STORE_AVG, dom, color, 240)}
      </div>
      <div class="drill-col">
        <div class="drill-k">Hidden value</div>
        <div class="kpi-fig">${euroFig}</div>
        <p class="drill-sub">${euroSub}</p>
        <div class="drill-k" style="margin-top:22px">Action levers</div>
        <div class="drill-levers">${leverRows}</div>
        <p class="drill-blurb">${selected.blurb}</p>
        <div class="drill-k">Effort</div>
        <input type="range" id="drillEffort" min="0" max="100" value="${Math.round(state.effort * 100)}" />
        <div class="drill-effort-row">
          <span>fingerprint match \u2192 capture ${(rec.capture * 100).toFixed(1)}%</span>
          <span>${Math.round(state.effort * 100)}%</span>
        </div>
        <div class="drill-k" style="margin-top:18px">Projected recovery</div>
        <div class="kpi-fig">${recFig}</div>
        <p class="drill-sub">${recSub}</p>
        <button type="button" class="drill-next" id="drillToWho">Who is leaking this</button>
      </div>
    </div>`;
}

function bindWhy() {
  el('drillToWho')?.addEventListener('click', () => {
    if (window.__ffStoryGotoDrill?.('who')) return;
    goto('who');
  });
  el('drillEffort')?.addEventListener('input', (e) => {
    state.effort = (+e.target.value) / 100;
    paint();
  });
  document.querySelectorAll('.drill-lever').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.leverId = btn.dataset.lever;
      paint();
    });
  });
}

function whoHtml() {
  const c = state.cluster;
  const bayAxis = dominantAxis(state.econ.axes);
  const bayLab = AXIS_LABEL[bayAxis] || bayAxis;
  if (c.loading) {
    return `
      <div class="drill-k">Who in this zone</div>
      <p class="drill-sub">Matching tracks to the ${bayLab.toLowerCase()} fingerprint\u2026</p>`;
  }
  const filter = c.filterAxis;
  const shown = filter ? c.items.filter((it) => it.axis === filter) : c.items;
  const chips = [
    ['', `All in zone ${c.zoneN}`],
    ...Object.keys(c.counts)
      .sort((a, b) => (LEAK_AXES.includes(a) === LEAK_AXES.includes(b)
        ? c.counts[b] - c.counts[a]
        : (LEAK_AXES.includes(a) ? -1 : 1)))
      .map((ax) => [ax, `${CLUSTER_STORY[ax]?.label || AXIS_LABEL[ax]} ${c.counts[ax]}`]),
  ].map(([ax, lab]) => {
    const on = (ax || '') === (filter || '') ? 'on' : '';
    return `<button type="button" class="drill-cluster ${on}" data-axis="${ax}">${lab}</button>`;
  }).join('');
  const rows = shown.map((m) => {
    const on = state.moment?.id === m.id ? 'on' : '';
    const extra = Number.isFinite(m.inRoiS)
      ? `${Math.round(m.inRoiS)}s in bay`
      : (AXIS_LABEL[m.axis] || '');
    return `<button type="button" class="drill-id ${on}" data-id="${m.id}">
      <span class="id">${m.personId}</span>
      <span class="st">${m.label}</span>
      <span class="ax">${extra}</span>
    </button>`;
  }).join('');
  const src = c.source === 'live' ? 'live tracks' : c.source === 'demo' ? 'story capture' : 'modelled cluster';
  const head = filter
    ? `${shown.length} ${CLUSTER_STORY[filter]?.label || AXIS_LABEL[filter] || 'IDs'} in this zone`
    : `${shown.length} IDs that entered this zone`;
  const empty = shown.length
    ? `<div class="drill-ids">${rows}</div>`
    : `<p class="drill-sub">No IDs in this cluster \u2014 pick another status or All in zone.</p>`;
  return `
    <div class="drill-k">${head}</div>
    <p class="drill-sub">Bay fingerprint is ${bayLab.toLowerCase()}. Default list is that cluster, not two demo statuses. Click an ID for the microscope.</p>
    <div class="drill-clusters">${chips}</div>
    ${empty}
    <p class="drill-sub" style="margin-top:16px">${src}${c.note ? ` \u00b7 ${c.note}` : ''} \u00b7 recovery stays zone-level</p>`;
}

function bindWho() {
  document.querySelectorAll('.drill-cluster').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.cluster.filterAxis = btn.dataset.axis || '';
      paint();
    });
  });
  document.querySelectorAll('.drill-id').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = state.cluster.items.find((x) => x.id === btn.dataset.id)
        || MOMENTS.find((x) => x.id === btn.dataset.id);
      if (window.__ffStoryGotoDrill?.('id', m?.id)) return;
      goto('id', m);
    });
  });
}

function idShellHtml() {
  const m = state.moment || state.cluster.items[0] || MOMENTS[0];
  const zone = state.sel?.name || 'Zone';
  const src = m.source === 'live' ? 'live' : m.source === 'modelled' ? 'modelled' : 'demo';
  return `
    <div class="micro-head">
      <span class="micro-title">Trajectory microscope</span>
      <span class="micro-zone">${zone}</span>
      <span class="micro-badge">${m.label}</span>
      <span class="micro-id">${src} \u00b7 ${String(m.trackKey || m.personId).slice(-10)}</span>
    </div>
    <div class="micro-body">
      <div id="microKin" class="micro-kin"></div>
      <div id="microCanvas" class="micro-canvas"></div>
      <div id="microInsight" class="micro-insight"></div>
    </div>
    <div class="drill-split" style="margin-top:18px">
      <div class="drill-col">
        <div class="drill-k">Shopper radar</div>
        <p class="drill-sub">This shopper \u00b7 ${m.source === 'live' ? 'live trail' : m.source === 'modelled' ? 'modelled pattern' : 'demo pattern'}</p>
        <div id="microRadar"></div>
      </div>
      <div class="drill-col">
        <div class="drill-k">Bay levers stay here</div>
        <p class="drill-sub">Recovery is zone-level, not per ID.</p>
        <button type="button" class="drill-next" id="drillBackWhy">Back to Why</button>
      </div>
    </div>`;
}

function paintMicroscope() {
  const m = state.moment;
  if (!m || state.step !== 'id') return;
  const kinEl = el('microKin');
  const canvasEl = el('microCanvas');
  const insightEl = el('microInsight');
  const radarEl = el('microRadar');
  if (!kinEl || !canvasEl) return;

  const trail = m.demoTrail;
  if (!trail?.length) return;
  const elapsed = Date.now() - state.started;
  const playMs = Math.min(12000, Math.max(4000, trail.length * 40));
  const idx = Math.min(trail.length - 1, Math.floor((elapsed / playMs) * (trail.length - 1)));
  const prefix = trail.slice(0, idx + 1);
  const physics = computeTrailPhysics(prefix);
  const velocity = trailVelocity(prefix);
  const stopped = prefix.length >= 2 && !velocity;
  const vb = viewBoxFor(trail, m.spanM);
  const parts = vb.split(/\s+/).map(Number);
  const strokeScale = Math.max(0.04, Math.min(0.12, (parts[2] || 3) * 0.025));
  const head = prefix[prefix.length - 1] || m.center;
  const boxes = api.getFixtureBoxes?.() || [];
  const dwellDots = prefix.filter((_, i) => i > 0 && i % 3 === 0).map((p, i) =>
    `<circle cx="${p.x}" cy="${p.z}" r="${strokeScale * 1.4}" fill="rgba(251,191,36,0.35)" stroke="#fbbf24" stroke-width="${strokeScale * 0.25}"/>`).join('');
  const arrow = velocity ? velocityArrowSvg(head, velocity, strokeScale) : '';
  const dash = (!velocity && prefix.length >= 2)
    ? `<circle cx="${head.x}" cy="${head.z}" r="${strokeScale * 2.8}" fill="none" stroke="#fbbf24" stroke-width="${strokeScale * 0.35}" stroke-dasharray="${strokeScale * 0.6} ${strokeScale * 0.4}"/>`
    : '';
  const pct = trail.length > 1 ? Math.round((idx / (trail.length - 1)) * 100) : 0;
  const axes = m.catalogAxes;
  const annotation = `${m.storyLine} (${m.label} \u00b7 replay ${pct}%)`;

  const rows = physics ? [
    ['v', 'speed', stopped ? '0.00 m/s' : `${physics.speedMs.toFixed(2)} m/s`],
    ['\u03b8', 'heading', `${physics.headingDeg.toFixed(0)}\u00b0`],
    ['\u03c9', 'turn rate', `${physics.turnRateDegS >= 0 ? '+' : ''}${physics.turnRateDegS.toFixed(0)}\u00b0/s`],
    ['a', 'accel', `${physics.accelMs2 >= 0 ? '+' : ''}${physics.accelMs2.toFixed(2)} m/s\u00b2`],
    ['\u03ba', 'curvature', `${physics.curvature.toFixed(2)} m\u207b\u00b9`],
    ['S', 'straight', `${(physics.straightness * 100).toFixed(0)}%`],
    ['L', 'path', `${physics.pathLengthM.toFixed(1)} m`],
    ['\u03c4', 'dwell', `${physics.dwellPct.toFixed(0)}%`],
  ] : [];

  kinEl.innerHTML = physics
    ? `<div class="kin-k">Kinematics</div>${rows.map((r) =>
      `<div class="kin-row"><span class="sym">${r[0]}</span><span class="lab">${r[1]}</span><span class="val">${r[2]}</span></div>`).join('')}
      ${stopped ? '<div class="kin-note">stationary \u00b7 \u03c9\u21920</div>' : ''}`
    : `<div class="kin-k">Kinematics</div><span class="drill-sub">Waiting for trail\u2026</span>`;

  canvasEl.innerHTML = `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet">
    ${fixtureSvg(boxes, vb, strokeScale)}
    ${polyLine(trail, 'rgba(248,113,113,0.22)', strokeScale * 0.9)}
    ${polyLine(prefix, '#f87171', strokeScale * 1.2)}
    ${dwellDots}
    <circle cx="${head.x}" cy="${head.z}" r="${strokeScale * 2}" fill="rgba(248,113,113,0.35)" stroke="#f87171" stroke-width="${strokeScale * 0.5}"/>
    <circle cx="${head.x}" cy="${head.z}" r="${strokeScale * 1.4}" fill="#f87171" stroke="#fff" stroke-width="${strokeScale * 0.35}"/>
    ${arrow}${dash}
  </svg>`;

  const pills = [
    ['Hesitate', axes.hesitation, '#f59e0b'],
    ['Confused', axes.confusion, '#f97316'],
    ['Urgent', axes.urgency, '#ef4444'],
    ['Commit', axes.commitment, '#10b981'],
    ['Goal', axes.goal_directedness, '#22c55e'],
  ].map(([lab, val, c]) =>
    `<span class="micro-pill" style="color:${c};border-color:${c}44;background:${c}18">${lab} ${(Number(val) * 100).toFixed(0)}%</span>`).join('');

  insightEl.innerHTML = `
    <p class="micro-story">${m.storyTitle}</p>
    <p class="micro-ann">${annotation}</p>
    <div class="micro-pills">${pills}</div>
    <p class="micro-foot">1\u00d7 replay \u00b7 ${m.source === 'live' ? 'live trail' : m.source === 'modelled' ? 'modelled trail' : 'demo'}</p>`;

  if (radarEl) {
    radarEl.innerHTML = radarSvg(axes, STORE_AVG, m.axis, '#f59e0b', 220);
  }
}
