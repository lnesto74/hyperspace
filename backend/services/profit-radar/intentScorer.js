/**
 * IntentScorer — 12 continuous [0,1] intent axes per track.
 * Pure heuristics from observable movement features. No ML.
 */

const AXIS_NAMES = [
  'exploration', 'goal_directedness', 'urgency', 'commitment',
  'hesitation', 'confusion', 'social_groupness', 'avoidance',
  'waiting_queueing', 'engagement_with_POI', 'churn_exit_intent', 'friction'
];

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function dist2D(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.z-b.z)**2); }

function extractFeatures(trail) {
  if (!trail || trail.length < 3) return null;
  const pts = trail.slice(-100);
  const n = pts.length;
  const dt = 0.1;
  const speeds = [], headings = [], curvatures = [];

  for (let i = 1; i < n; i++) {
    speeds.push(dist2D(pts[i], pts[i-1]) / dt);
    headings.push(Math.atan2(pts[i].z - pts[i-1].z, pts[i].x - pts[i-1].x));
  }
  for (let i = 1; i < headings.length; i++) {
    let dh = headings[i] - headings[i-1];
    while (dh > Math.PI) dh -= 2*Math.PI;
    while (dh < -Math.PI) dh += 2*Math.PI;
    curvatures.push(Math.abs(dh));
  }

  const meanSpeed = speeds.length ? speeds.reduce((a,b)=>a+b,0)/speeds.length : 0;
  const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
  const speedVar = speeds.length > 1 ? speeds.reduce((s,v)=>s+(v-meanSpeed)**2,0)/speeds.length : 0;
  const meanCurv = curvatures.length ? curvatures.reduce((a,b)=>a+b,0)/curvatures.length : 0;
  const stopRatio = speeds.length ? speeds.filter(s=>s<0.1).length/speeds.length : 0;
  const disp = dist2D(pts[0], pts[n-1]);
  const pathLen = speeds.reduce((s,v)=>s+v*dt, 0);
  const straight = pathLen > 0.01 ? clamp01(disp/pathLen) : 0;

  let backtrackCount = 0;
  for (let i = 1; i < headings.length; i++) {
    let dh = Math.abs(headings[i]-headings[i-1]);
    if (dh > Math.PI) dh = 2*Math.PI - dh;
    if (dh > 2*Math.PI/3) backtrackCount++;
  }
  const backtrackRatio = headings.length > 1 ? backtrackCount/headings.length : 0;

  const visited = new Set();
  let revisitCount = 0;
  for (const p of pts) {
    const key = `${Math.round(p.x/0.5)},${Math.round(p.z/0.5)}`;
    if (visited.has(key)) revisitCount++;
    visited.add(key);
  }
  const revisitRatio = n > 1 ? revisitCount/n : 0;
  const microRatio = speeds.length ? speeds.filter(s=>s>=0.02&&s<0.15).length/speeds.length : 0;
  const speedChanges = [];
  for (let i = 1; i < speeds.length; i++) speedChanges.push(Math.abs(speeds[i]-speeds[i-1]));
  const jerk = speedChanges.length ? speedChanges.reduce((a,b)=>a+b,0)/speedChanges.length : 0;

  return { meanSpeed, maxSpeed, speedVar, meanCurv, stopRatio, straight, backtrackRatio, revisitRatio, microRatio, jerk, disp, pathLen, n };
}

function scoreAxes(f, neighbor) {
  if (!f) return AXIS_NAMES.reduce((a,k)=>{a[k]=0;return a;},{});
  const ax = {};
  ax.exploration = clamp01(0.3*(1-f.straight)+0.25*Math.min(f.meanCurv/0.5,1)+0.25*f.revisitRatio*2+0.2*clamp01(f.meanSpeed/1));
  ax.goal_directedness = clamp01(0.4*f.straight+0.3*(1-Math.min(f.meanCurv/0.3,1))+0.3*clamp01(f.meanSpeed/1.2));
  ax.urgency = clamp01(0.4*clamp01(f.meanSpeed/1.5)+0.25*(1-f.stopRatio)+0.2*clamp01(f.jerk/0.5)+0.15*clamp01(f.maxSpeed/2));
  ax.commitment = clamp01(0.35*ax.goal_directedness+0.25*f.straight+0.2*(1-f.backtrackRatio)+0.2*clamp01(f.pathLen/5));
  ax.hesitation = clamp01(0.25*f.stopRatio+0.2*Math.min(f.meanCurv/0.4,1)+0.2*f.revisitRatio*2+0.15*clamp01(Math.sqrt(f.speedVar)/0.5)+0.2*f.microRatio);
  ax.confusion = clamp01(0.3*f.backtrackRatio*3+0.25*f.revisitRatio*3+0.25*Math.min(f.meanCurv/0.5,1)+0.2*(1-f.straight));
  // Social: needs neighbor data
  if (neighbor && neighbor.dist !== undefined) {
    ax.social_groupness = clamp01(0.5*(1-neighbor.dist/3)+0.3*clamp01(neighbor.headingAlign||0)+0.2*clamp01(neighbor.speedAlign||0));
  } else {
    ax.social_groupness = 0;
  }
  ax.avoidance = clamp01(0.4*clamp01(f.meanSpeed/1.2)*(1-f.stopRatio)+0.3*(1-f.revisitRatio)+0.3*f.straight*clamp01(f.meanSpeed/0.8));
  ax.waiting_queueing = clamp01(0.4*f.stopRatio+0.3*clamp01(1-f.meanSpeed/0.15)+0.3*f.microRatio);
  ax.engagement_with_POI = clamp01(0.35*f.stopRatio+0.3*f.microRatio+0.2*clamp01(1-f.meanSpeed/0.2)+0.15*(1-f.straight));
  ax.churn_exit_intent = clamp01(0.3*clamp01(f.meanSpeed/1)+0.3*f.straight+0.2*(1-f.stopRatio)+0.2*(1-ax.engagement_with_POI));
  ax.friction = clamp01(0.3*f.backtrackRatio*3+0.25*clamp01(Math.sqrt(f.speedVar)/0.4)+0.25*(1-f.straight)+0.2*f.revisitRatio*2);
  return ax;
}

export class IntentScorer {
  constructor(trackAggregator) {
    this.trackAggregator = trackAggregator;
    this.trackAxes = new Map(); // trackKey -> { axes, timestamp }
    this.interval = null;
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 1000); // 1Hz
    console.log('📡 IntentScorer started (1Hz)');
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.trackAxes.clear();
  }

  tick() {
    const tracks = this.trackAggregator.tracks;
    if (!tracks || tracks.size === 0) return;

    const allEntries = [...tracks.values()];
    const now = Date.now();

    for (const entry of allEntries) {
      const { track, trail } = entry;
      const features = extractFeatures(trail);
      const neighbor = this._findNearest(track.trackKey, track.venuePosition, allEntries);
      const axes = scoreAxes(features, neighbor);
      this.trackAxes.set(track.trackKey, { axes, position: track.venuePosition, trail, timestamp: now });
    }

    // Prune stale
    for (const [key, val] of this.trackAxes) {
      if (now - val.timestamp > 8000) this.trackAxes.delete(key);
    }
  }

  _findNearest(selfKey, pos, allEntries) {
    let minDist = Infinity;
    let best = null;
    for (const e of allEntries) {
      if (e.track.trackKey === selfKey) continue;
      const d = dist2D(pos, e.track.venuePosition);
      if (d < minDist) { minDist = d; best = e; }
    }
    if (!best || minDist > 5) return { dist: 999 };
    return { dist: minDist, headingAlign: 0.5, speedAlign: 0.5 };
  }

  getTrackAxes() { return this.trackAxes; }
  getAxesArray() {
    const result = [];
    for (const [trackKey, data] of this.trackAxes) {
      result.push({ trackKey, axes: data.axes, position: data.position });
    }
    return result;
  }
}

export { AXIS_NAMES, extractFeatures, scoreAxes };
