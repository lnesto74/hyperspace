#!/usr/bin/env node
/**
 * Scan an MQTT capture and find demo-worthy windows where a single track
 * shows a clear dominant intent axis while staying in a compact area.
 *
 * Usage:
 *   node analysis/find_behavior_moments.mjs --file /path/to/capture.jsonl
 *   node analysis/find_behavior_moments.mjs --file capture.jsonl --maxDurationMin 45
 */
import fs from 'fs'
import readline from 'readline'

const TARGETS = [
  { axis: 'hesitation', label: 'Hesitating', minScore: 0.42 },
  { axis: 'confusion', label: 'Confused', minScore: 0.40 },
  { axis: 'urgency', label: 'Urgent', minScore: 0.45 },
  { axis: 'commitment', label: 'Committed', minScore: 0.45 },
  { axis: 'goal_directedness', label: 'Goal-directed', minScore: 0.48 },
]

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}

const file = arg('--file')
if (!file) {
  console.error('Usage: node find_behavior_moments.mjs --file capture.jsonl [--maxDurationMin 60]')
  process.exit(1)
}
const maxDurationMin = Number(arg('--maxDurationMin', '0')) || 0

function clamp01(v) { return Math.max(0, Math.min(1, v)) }
function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z) }

function extractFeatures(trail) {
  if (!trail || trail.length < 8) return null
  const pts = trail
  const n = pts.length
  const dt = 0.1
  const speeds = [], headings = [], curvatures = []
  for (let i = 1; i < n; i++) {
    speeds.push(dist2D(pts[i], pts[i - 1]) / dt)
    headings.push(Math.atan2(pts[i].z - pts[i - 1].z, pts[i].x - pts[i - 1].x))
  }
  for (let i = 1; i < headings.length; i++) {
    let dh = headings[i] - headings[i - 1]
    while (dh > Math.PI) dh -= 2 * Math.PI
    while (dh < -Math.PI) dh += 2 * Math.PI
    curvatures.push(Math.abs(dh))
  }
  const meanSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
  const maxSpeed = speeds.length ? Math.max(...speeds) : 0
  const speedVar = speeds.length > 1 ? speeds.reduce((s, v) => s + (v - meanSpeed) ** 2, 0) / speeds.length : 0
  const meanCurv = curvatures.length ? curvatures.reduce((a, b) => a + b, 0) / curvatures.length : 0
  const stopRatio = speeds.length ? speeds.filter(s => s < 0.1).length / speeds.length : 0
  const disp = dist2D(pts[0], pts[n - 1])
  const pathLen = speeds.reduce((s, v) => s + v * dt, 0)
  const straight = pathLen > 0.01 ? clamp01(disp / pathLen) : 0
  let backtrackCount = 0
  for (let i = 1; i < headings.length; i++) {
    let dh = Math.abs(headings[i] - headings[i - 1])
    if (dh > Math.PI) dh = 2 * Math.PI - dh
    if (dh > (2 * Math.PI) / 3) backtrackCount++
  }
  const backtrackRatio = headings.length > 1 ? backtrackCount / headings.length : 0
  const visited = new Set()
  let revisitCount = 0
  for (const p of pts) {
    const key = `${Math.round(p.x / 0.5)},${Math.round(p.z / 0.5)}`
    if (visited.has(key)) revisitCount++
    visited.add(key)
  }
  const revisitRatio = n > 1 ? revisitCount / n : 0
  const microRatio = speeds.length ? speeds.filter(s => s >= 0.02 && s < 0.15).length / speeds.length : 0
  const speedChanges = []
  for (let i = 1; i < speeds.length; i++) speedChanges.push(Math.abs(speeds[i] - speeds[i - 1]))
  const jerk = speedChanges.length ? speedChanges.reduce((a, b) => a + b, 0) / speedChanges.length : 0
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
  }
  const span = Math.max(maxX - minX, maxZ - minZ)
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  return { meanSpeed, maxSpeed, speedVar, meanCurv, stopRatio, straight, backtrackRatio, revisitRatio, microRatio, jerk, disp, pathLen, span, cx, cz, n }
}

function scoreAxes(f) {
  if (!f) return {}
  const ax = {}
  ax.exploration = clamp01(0.3 * (1 - f.straight) + 0.25 * Math.min(f.meanCurv / 0.5, 1) + 0.25 * f.revisitRatio * 2 + 0.2 * clamp01(f.meanSpeed / 1))
  ax.goal_directedness = clamp01(0.4 * f.straight + 0.3 * (1 - Math.min(f.meanCurv / 0.3, 1)) + 0.3 * clamp01(f.meanSpeed / 1.2))
  ax.urgency = clamp01(0.4 * clamp01(f.meanSpeed / 1.5) + 0.25 * (1 - f.stopRatio) + 0.2 * clamp01(f.jerk / 0.5) + 0.15 * clamp01(f.maxSpeed / 2))
  ax.commitment = clamp01(0.35 * ax.goal_directedness + 0.25 * f.straight + 0.2 * (1 - f.backtrackRatio) + 0.2 * clamp01(f.pathLen / 5))
  ax.hesitation = clamp01(0.25 * f.stopRatio + 0.2 * Math.min(f.meanCurv / 0.4, 1) + 0.2 * f.revisitRatio * 2 + 0.15 * clamp01(Math.sqrt(f.speedVar) / 0.5) + 0.2 * f.microRatio)
  ax.confusion = clamp01(0.3 * f.backtrackRatio * 3 + 0.25 * f.revisitRatio * 3 + 0.25 * Math.min(f.meanCurv / 0.5, 1) + 0.2 * (1 - f.straight))
  ax.avoidance = clamp01(0.4 * clamp01(f.meanSpeed / 1.2) * (1 - f.stopRatio) + 0.3 * (1 - f.revisitRatio) + 0.3 * f.straight * clamp01(f.meanSpeed / 0.8))
  ax.engagement_with_POI = clamp01(0.35 * f.stopRatio + 0.3 * f.microRatio + 0.2 * clamp01(1 - f.meanSpeed / 0.2) + 0.15 * (1 - f.straight))
  return ax
}

function dominantAxis(ax) {
  let best = 'exploration', bestV = -1
  for (const [k, v] of Object.entries(ax)) {
    if (v > bestV) { bestV = v; best = k }
  }
  return { axis: best, score: bestV }
}

const tracks = new Map() // trackKey -> [{x,z,t}]
let firstTs = null
let lastTs = null
let lines = 0

const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
for await (const line of rl) {
  lines++
  const sp = line.indexOf(' ')
  if (sp < 0) continue
  let msg
  try { msg = JSON.parse(line.slice(sp + 1)) } catch { continue }
  const ts = msg.timestamp
  if (typeof ts !== 'number') continue
  if (firstTs == null) firstTs = ts
  lastTs = ts
  if (maxDurationMin > 0 && ts - firstTs > maxDurationMin * 60 * 1000) break

  const deviceId = msg.deviceId || 'unknown'
  const id = msg.id
  if (!id || !msg.position) continue
  const trackKey = `${deviceId}:${id}`
  const x = msg.position.x
  const z = msg.position.z ?? msg.position.y ?? 0

  let arr = tracks.get(trackKey)
  if (!arr) { arr = []; tracks.set(trackKey, arr) }
  const last = arr[arr.length - 1]
  if (!last || Math.hypot(last.x - x, last.z - z) > 0.02 || ts - last.t > 500) {
    arr.push({ x, z, t: ts })
    if (arr.length > 120) arr.shift()
  }
}

const durationMs = (lastTs ?? 0) - (firstTs ?? 0)
const windows = []

for (const [trackKey, trail] of tracks) {
  if (trail.length < 12) continue
  for (let i = 12; i < trail.length; i += 4) {
    const slice = trail.slice(Math.max(0, i - 24), i + 1)
    const f = extractFeatures(slice)
    if (!f || f.span > 6 || f.pathLen < 1.2) continue
    const ax = scoreAxes(f)
    const dom = dominantAxis(ax)
    const mid = slice[Math.floor(slice.length / 2)]
    const progress = durationMs > 0 ? (mid.t - firstTs) / durationMs : 0
    windows.push({
      trackKey,
      personId: trackKey.split(':').pop(),
      deviceId: trackKey.split(':')[0],
      progress: Math.max(0, Math.min(1, progress)),
      timestamp: mid.t,
      dominant: dom.axis,
      dominantScore: dom.score,
      span: f.span,
      pathLen: f.pathLen,
      cx: f.cx,
      cz: f.cz,
      axes: ax,
    })
  }
}

const picks = []
for (const target of TARGETS) {
  const dominantCandidates = windows
    .filter(w => w.dominant === target.axis && w.dominantScore >= target.minScore)
    .sort((a, b) => b.dominantScore - a.dominantScore || a.span - b.span)

  const axisCandidates = windows
    .filter(w => (w.axes[target.axis] ?? 0) >= target.minScore - 0.08 && w.span <= 4)
    .sort((a, b) => (b.axes[target.axis] ?? 0) - (a.axes[target.axis] ?? 0) || a.span - b.span)

  const candidates = dominantCandidates.length ? dominantCandidates : axisCandidates
  const usedTracks = new Set(picks.map(p => p.trackKey))
  const pick = candidates.find(c => !usedTracks.has(c.trackKey)) || candidates[0]
  if (pick) {
    picks.push({
      id: target.axis,
      label: target.label,
      axis: target.axis,
      ...pick,
      axisScore: pick.axes[target.axis] ?? pick.dominantScore,
      seekPct: Math.max(0.02, Math.min(0.98, pick.progress)),
    })
  }
}

const out = {
  sourceFile: file.split('/').pop(),
  linesScanned: lines,
  durationMin: Math.round(durationMs / 60000),
  firstTs,
  lastTs,
  trackCount: tracks.size,
  moments: picks,
}

console.log(JSON.stringify(out, null, 2))
