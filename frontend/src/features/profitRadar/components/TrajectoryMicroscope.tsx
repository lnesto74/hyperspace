import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, ZoomIn } from 'lucide-react'
import { useTracking } from '../../../context/TrackingContext'
import { useProfitRadar } from '../../../context/ProfitRadarContext'
import {
  boundsToViewBox,
  getDrawableFixtureOutline,
  polygonPath,
  venueObjectsToFixtures,
} from '../../../utils/venueFloorPlanMap'
import { pointInPolygon, trajectoryBounds, useZoneMapData } from '../hooks/useZoneMapData'
import { trackKeyMatchesMoment, type BehaviorShowcaseMoment } from '../behaviorShowcaseCatalog'
import type { IntentAxisName } from '../../../types'

const AXIS_LABELS: Record<IntentAxisName, string> = {
  exploration: 'Exploring',
  goal_directedness: 'Goal-directed',
  urgency: 'Urgent',
  commitment: 'Committed',
  hesitation: 'Hesitating',
  confusion: 'Confused',
  social_groupness: 'Group',
  avoidance: 'Avoiding',
  waiting_queueing: 'Queueing',
  engagement_with_POI: 'Engaged',
  churn_exit_intent: 'Leaving',
  friction: 'Friction',
}

/** ~220ms per point at 1× — matches recorded MQTT cadence in the demo window */
const DEMO_TRAIL_STEP_MS = 220
const DEMO_DT_SEC = DEMO_TRAIL_STEP_MS / 1000

const ARROW_COLOR = '#22d3ee'
const ARROW_GLOW = 'rgba(34,211,238,0.25)'

interface TrailPhysics {
  speedMs: number
  headingDeg: number
  turnRateDegS: number
  accelMs2: number
  curvature: number
  straightness: number
  pathLengthM: number
  netDisplacementM: number
  dwellPct: number
}

function trailVelocity(trail: { x: number; z: number }[]) {
  if (trail.length < 2) return null
  const last = trail[trail.length - 1]
  let prev = trail[trail.length - 2]
  for (let i = trail.length - 2; i >= 0; i--) {
    const p = trail[i]
    if (Math.hypot(last.x - p.x, last.z - p.z) > 0.015) {
      prev = p
      break
    }
  }
  const dx = last.x - prev.x
  const dz = last.z - prev.z
  const speed = Math.hypot(dx, dz)
  if (speed < 0.001) return null
  return { dx, dz, speed, last }
}

function computeTrailPhysics(trail: { x: number; z: number }[], dtSec = DEMO_DT_SEC): TrailPhysics | null {
  if (trail.length < 2) return null

  const segments: { dist: number; speed: number; heading: number }[] = []
  for (let i = 1; i < trail.length; i++) {
    const dx = trail[i].x - trail[i - 1].x
    const dz = trail[i].z - trail[i - 1].z
    const dist = Math.hypot(dx, dz)
    segments.push({
      dist,
      speed: dist / dtSec,
      heading: (Math.atan2(dz, dx) * 180) / Math.PI,
    })
  }

  const last = segments[segments.length - 1]
  const prev = segments.length >= 2 ? segments[segments.length - 2] : last

  let turnRate = 0
  if (segments.length >= 2) {
    let dh = last.heading - prev.heading
    while (dh > 180) dh -= 360
    while (dh < -180) dh += 360
    turnRate = dh / dtSec
  }

  const curvature = last.speed > 0.05
    ? Math.abs((turnRate * Math.PI) / 180) / last.speed
    : 0

  const pathLengthM = segments.reduce((s, seg) => s + seg.dist, 0)
  const netDisplacementM = Math.hypot(
    trail[trail.length - 1].x - trail[0].x,
    trail[trail.length - 1].z - trail[0].z,
  )
  const straightness = pathLengthM > 0.01 ? netDisplacementM / pathLengthM : 1
  const dwellPct = (segments.filter(s => s.speed < 0.08).length / segments.length) * 100

  return {
    speedMs: last.speed,
    headingDeg: ((last.heading % 360) + 360) % 360,
    turnRateDegS: turnRate,
    accelMs2: segments.length >= 2 ? (last.speed - prev.speed) / dtSec : 0,
    curvature,
    straightness,
    pathLengthM,
    netDisplacementM,
    dwellPct,
  }
}

function VelocityArrow({
  origin,
  velocity,
  strokeScale,
}: {
  origin: { x: number; z: number }
  velocity: { dx: number; dz: number; speed: number }
  strokeScale: number
}) {
  const len = Math.hypot(velocity.dx, velocity.dz) || 1
  const ux = velocity.dx / len
  const uz = velocity.dz / len
  const shaftLen = strokeScale * (3.2 + Math.min(4.2, velocity.speed * 5))
  const tipX = origin.x + ux * shaftLen
  const tipZ = origin.z + uz * shaftLen
  const nx = -uz
  const nz = ux
  const headW = strokeScale * 0.55
  const headL = strokeScale * 0.95
  const baseX = tipX - ux * headL
  const baseZ = tipZ - uz * headL
  const shaftW = strokeScale * 0.28

  return (
    <g>
      <line
        x1={origin.x}
        y1={origin.z}
        x2={baseX}
        y2={baseZ}
        stroke={ARROW_GLOW}
        strokeWidth={shaftW * 2.2}
        strokeLinecap="round"
      />
      <line
        x1={origin.x}
        y1={origin.z}
        x2={baseX}
        y2={baseZ}
        stroke={ARROW_COLOR}
        strokeWidth={shaftW}
        strokeLinecap="round"
      />
      <polygon
        points={[
          `${tipX},${tipZ}`,
          `${baseX + nx * headW},${baseZ + nz * headW}`,
          `${baseX - nx * headW},${baseZ - nz * headW}`,
        ].join(' ')}
        fill={ARROW_COLOR}
      />
    </g>
  )
}

function MotionReadout({ physics, stopped }: { physics: TrailPhysics | null; stopped: boolean }) {
  if (!physics) {
    return (
      <div className="h-full flex flex-col justify-center px-2 py-2 text-[9px] text-gray-600 leading-relaxed">
        <div className="text-[8px] uppercase tracking-widest text-cyan-500/70 mb-1.5">Kinematics</div>
        <span>Waiting for trail…</span>
      </div>
    )
  }

  const rows: { sym: string; label: string; value: string; hint?: string }[] = [
    { sym: 'v', label: 'speed', value: stopped ? '0.00 m/s' : `${physics.speedMs.toFixed(2)} m/s` },
    { sym: 'θ', label: 'heading', value: `${physics.headingDeg.toFixed(0)}°` },
    { sym: 'ω', label: 'turn rate', value: `${physics.turnRateDegS >= 0 ? '+' : ''}${physics.turnRateDegS.toFixed(0)}°/s` },
    { sym: 'a', label: 'accel', value: `${physics.accelMs2 >= 0 ? '+' : ''}${physics.accelMs2.toFixed(2)} m/s²` },
    { sym: 'κ', label: 'curvature', value: `${physics.curvature.toFixed(2)} m⁻¹` },
    { sym: 'S', label: 'straight', value: `${(physics.straightness * 100).toFixed(0)}%` },
    { sym: 'L', label: 'path', value: `${physics.pathLengthM.toFixed(1)} m` },
    { sym: 'τ', label: 'dwell', value: `${physics.dwellPct.toFixed(0)}%` },
  ]

  return (
    <div className="h-full flex flex-col justify-center px-2 py-1.5 border-r border-gray-800/80 bg-gray-950/90 min-w-[92px] max-w-[92px]">
      <div className="text-[8px] uppercase tracking-widest text-cyan-400/80 mb-1.5 font-medium">Kinematics</div>
      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.sym} className="flex items-baseline gap-1">
            <span className="text-cyan-300/90 font-serif w-3 shrink-0 text-[10px]">{r.sym}</span>
            <span className="text-[9px] text-gray-500 flex-1 truncate">{r.label}</span>
            <span className="text-[9px] text-gray-200 tabular-nums font-mono shrink-0">{r.value}</span>
          </div>
        ))}
      </div>
      {stopped && (
        <div className="mt-1.5 text-[8px] text-amber-400/80 leading-tight">stationary · ω→0</div>
      )}
    </div>
  )
}

interface TrajectoryMicroscopeProps {
  venueId: string
  roiId: string | null
  zoneName: string
  focusTrackKey: string | null
  showcaseMoment?: BehaviorShowcaseMoment | null
}

export default function TrajectoryMicroscope({
  venueId,
  roiId,
  zoneName,
  focusTrackKey,
  showcaseMoment = null,
}: TrajectoryMicroscopeProps) {
  const { tracks } = useTracking()
  const { trackAxes } = useProfitRadar()
  const { objects, zoneVerts } = useZoneMapData(venueId, roiId)

  const showcaseStartedRef = useRef(Date.now())
  const [animTick, setAnimTick] = useState(0)

  useEffect(() => {
    showcaseStartedRef.current = Date.now()
    setAnimTick(0)
  }, [showcaseMoment?.id])

  useEffect(() => {
    if (!showcaseMoment?.demoTrail?.length) return
    let raf = 0
    const tick = () => {
      setAnimTick(t => t + 1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [showcaseMoment?.id, showcaseMoment?.demoTrail?.length])

  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])

  const inZoneTracks = useMemo(() => {
    if (zoneVerts.length < 3) return [] as { key: string; x: number; z: number }[]
    const out: { key: string; x: number; z: number }[] = []
    tracks.forEach(t => {
      const p = t.venuePosition ?? t.position
      if (!p || !pointInPolygon({ x: p.x, z: p.z }, zoneVerts)) return
      out.push({ key: t.trackKey, x: p.x, z: p.z })
    })
    return out
  }, [tracks, zoneVerts])

  const resolvedFocusKey = useMemo(() => {
    if (showcaseMoment) {
      if (focusTrackKey && trackKeyMatchesMoment(focusTrackKey, showcaseMoment)) return focusTrackKey
      for (const t of tracks.values()) {
        if (trackKeyMatchesMoment(t.trackKey, showcaseMoment)) return t.trackKey
      }
      return null
    }
    return focusTrackKey ?? inZoneTracks[0]?.key ?? null
  }, [showcaseMoment, focusTrackKey, tracks, inZoneTracks])

  const liveTrail = useMemo(() => {
    if (!resolvedFocusKey) return [] as { x: number; z: number }[]
    const t = tracks.get(resolvedFocusKey)
    if (!t?.trail?.length) return []
    return t.trail.map(p => ({ x: p.x, z: p.z }))
  }, [resolvedFocusKey, tracks])

  const demoTrail = showcaseMoment?.demoTrail ?? []
  const usingLiveTrail = liveTrail.length >= 2

  const animatedDemoIdx = useMemo(() => {
    if (!showcaseMoment || demoTrail.length < 2) return 0
    void animTick
    const elapsed = Date.now() - showcaseStartedRef.current
    return Math.min(demoTrail.length - 1, Math.floor(elapsed / DEMO_TRAIL_STEP_MS))
  }, [showcaseMoment, demoTrail.length, animTick])

  const animatedDemoTrail = demoTrail.slice(0, animatedDemoIdx + 1)
  const displayTrail = usingLiveTrail ? liveTrail : animatedDemoTrail

  const focusAxes = resolvedFocusKey ? trackAxes.find(t => t.trackKey === resolvedFocusKey)?.axes : null
  const displayAxes = focusAxes ?? (showcaseMoment ? showcaseMoment.catalogAxes : null)

  const viewBox = useMemo(() => {
    const base = demoTrail.length >= 2 ? demoTrail : displayTrail
    const trailPts = base.length >= 1
      ? base
      : showcaseMoment
        ? [showcaseMoment.center]
        : []
    if (trailPts.length === 0) return boundsToViewBox(trajectoryBounds([], 0.5, 2.4))
    const minSpan = showcaseMoment ? Math.max(2.0, Math.min(3.2, showcaseMoment.spanM + 1.8)) : 2.4
    return boundsToViewBox(trajectoryBounds(trailPts, 0.5, minSpan))
  }, [demoTrail, displayTrail, showcaseMoment])

  const annotation = useMemo(() => {
    if (showcaseMoment && !usingLiveTrail) {
      const pct = demoTrail.length > 1
        ? Math.round((animatedDemoIdx / (demoTrail.length - 1)) * 100)
        : 0
      return `${showcaseMoment.storyLine} (${showcaseMoment.label} · replay ${pct}%)`
    }
    if (showcaseMoment && !focusAxes) {
      return `${showcaseMoment.storyLine} (${showcaseMoment.label} · live)`
    }
    if (!focusAxes) {
      if (displayTrail.length >= 2) return 'Shopper moving — fingerprint building as trajectory evolves…'
      return 'Select a shopper on the map or wait for movement in zone'
    }
    const engage = focusAxes.engagement_with_POI ?? 0
    const avoid = focusAxes.avoidance ?? 0
    const commit = focusAxes.commitment ?? 0
    const hesitate = focusAxes.hesitation ?? 0
    const confused = focusAxes.confusion ?? 0
    const urgent = focusAxes.urgency ?? 0
    const goal = focusAxes.goal_directedness ?? 0

    if (confused > 0.55) return `Confused — backtracking / looping (${(confused * 100).toFixed(0)}%)`
    if (urgent > 0.55 && hesitate < 0.35) return `Urgent pass-through (${(urgent * 100).toFixed(0)}%) — minimal shelf dwell`
    if (hesitate > 0.5 && commit < 0.35) return `Hesitating at shelf (${(hesitate * 100).toFixed(0)}%) — stops without commitment`
    if (goal > 0.55 && commit > 0.4) return `Goal-directed & committed (${(goal * 100).toFixed(0)}% / ${(commit * 100).toFixed(0)}%)`
    if (avoid > 0.55 && engage < 0.25) return `Pass-through — high avoidance (${(avoid * 100).toFixed(0)}%)`
    if (engage > 0.5 && commit < 0.35) return `Engaged but no commitment (${(engage * 100).toFixed(0)}%) — potential lost sale`
    const dominant = (Object.entries(focusAxes) as [IntentAxisName, number][])
      .sort((a, b) => b[1] - a[1])[0]
    return `Dominant: ${AXIS_LABELS[dominant[0]]} (${(dominant[1] * 100).toFixed(0)}%)`
  }, [focusAxes, displayTrail.length, showcaseMoment, usingLiveTrail, demoTrail.length, animatedDemoIdx])

  const strokeScale = useMemo(() => {
    const parts = viewBox.split(/\s+/).map(Number)
    const w = parts[2] || 3
    return Math.max(0.04, Math.min(0.12, w * 0.025))
  }, [viewBox])

  const headPoint = displayTrail[displayTrail.length - 1]
    ?? demoTrail[demoTrail.length - 1]
    ?? showcaseMoment?.center

  const velocity = useMemo(() => trailVelocity(displayTrail), [displayTrail])
  const physics = useMemo(() => computeTrailPhysics(displayTrail), [displayTrail])
  const isStopped = displayTrail.length >= 2 && !velocity

  const renderTrail = (pts: { x: number; z: number }[], stroke: string, width: number, opacity = 1) => {
    if (pts.length < 2) return null
    return (
      <polyline
        points={pts.map(p => `${p.x},${p.z}`).join(' ')}
        fill="none"
        stroke={stroke}
        strokeOpacity={opacity}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }

  return (
    <div className="shrink-0 border-t border-gray-700/60 bg-gray-950/80">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/80">
        <Crosshair className="w-3.5 h-3.5 text-red-400" />
        <span className="text-[11px] font-medium text-gray-200">Trajectory microscope</span>
        <ZoomIn className="w-3 h-3 text-gray-500" />
        <span className="text-[10px] text-gray-500 truncate">{zoneName}</span>
        {showcaseMoment && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {showcaseMoment.label}
          </span>
        )}
        {resolvedFocusKey && (
          <span className="ml-auto text-[9px] text-red-300/80 font-mono truncate max-w-[120px]">
            {usingLiveTrail ? 'live' : 'demo'} · {resolvedFocusKey.slice(-8)}
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-0" style={{ height: 188 }}>
        <MotionReadout physics={physics} stopped={isStopped} />

        <div className="flex-1 min-w-0 relative">
          <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full h-full block" style={{ background: '#030508' }}>
            {fixtures.map(f => {
              const outline = getDrawableFixtureOutline(f)
              if (outline.length < 3) return null
              const cx = outline.reduce((s, p) => s + p.x, 0) / outline.length
              const cz = outline.reduce((s, p) => s + p.z, 0) / outline.length
              const parts = viewBox.split(/\s+/).map(Number)
              const vx = parts[0] ?? 0
              const vz = parts[1] ?? 0
              const vw = parts[2] ?? 10
              const vh = parts[3] ?? 10
              if (cx < vx - 1 || cx > vx + vw + 1 || cz < vz - 1 || cz > vz + vh + 1) return null
              return (
                <path
                  key={f.id}
                  d={polygonPath(outline)}
                  fill="rgba(0,210,255,0.05)"
                  stroke="rgba(0,210,255,0.2)"
                  strokeWidth={strokeScale * 0.5}
                />
              )
            })}

            {!usingLiveTrail && demoTrail.length >= 2 && (
              renderTrail(demoTrail, 'rgba(248,113,113,0.22)', strokeScale * 0.9, 1)
            )}

            {usingLiveTrail
              ? renderTrail(liveTrail, '#f87171', strokeScale * 1.2)
              : renderTrail(animatedDemoTrail, '#f87171', strokeScale * 1.2)}

            {displayTrail.length >= 2 && displayTrail.filter((_, i) => i > 0 && i % 3 === 0).map((p, i) => (
              <circle
                key={`dw-${i}`}
                cx={p.x}
                cy={p.z}
                r={strokeScale * 1.4}
                fill="rgba(251,191,36,0.35)"
                stroke="#fbbf24"
                strokeWidth={strokeScale * 0.25}
              />
            ))}

            {headPoint && (
              <>
                <circle
                  cx={headPoint.x}
                  cy={headPoint.z}
                  r={strokeScale * 2}
                  fill="rgba(248,113,113,0.35)"
                  stroke="#f87171"
                  strokeWidth={strokeScale * 0.5}
                />
                <circle
                  cx={headPoint.x}
                  cy={headPoint.z}
                  r={strokeScale * 1.4}
                  fill="#f87171"
                  stroke="#fff"
                  strokeWidth={strokeScale * 0.35}
                />
                {velocity && (
                  <VelocityArrow origin={headPoint} velocity={velocity} strokeScale={strokeScale} />
                )}
                {!velocity && displayTrail.length >= 2 && (
                  <circle
                    cx={headPoint.x}
                    cy={headPoint.z}
                    r={strokeScale * 2.8}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={strokeScale * 0.35}
                    strokeDasharray={`${strokeScale * 0.6} ${strokeScale * 0.4}`}
                  />
                )}
              </>
            )}
          </svg>
        </div>

        <div className="w-[248px] shrink-0 border-l border-gray-800/80 px-3 py-2 flex flex-col justify-center overflow-y-auto">
          {showcaseMoment && (
            <p className="text-[10px] font-medium text-indigo-300 mb-1">{showcaseMoment.storyTitle}</p>
          )}
          <p className="text-[11px] text-gray-300 leading-relaxed">{annotation}</p>
          {displayAxes && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                ['Hesitate', displayAxes.hesitation, '#f59e0b'],
                ['Confused', displayAxes.confusion, '#f97316'],
                ['Urgent', displayAxes.urgency, '#ef4444'],
                ['Commit', displayAxes.commitment, '#10b981'],
                ['Goal', displayAxes.goal_directedness, '#22c55e'],
              ].map(([label, val, c]) => (
                <span
                  key={label as string}
                  className="text-[9px] px-1.5 py-0.5 rounded tabular-nums"
                  style={{ color: c as string, backgroundColor: `${c}18`, border: `1px solid ${c}44` }}
                >
                  {label as string} {(Number(val) * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
          <p className="text-[9px] text-gray-600 mt-2">
            1× replay · {usingLiveTrail ? 'live trail' : 'recorded demo path'}
          </p>
        </div>
      </div>
    </div>
  )
}
