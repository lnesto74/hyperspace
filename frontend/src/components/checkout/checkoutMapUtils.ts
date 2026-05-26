import { computeMapBounds } from '../kpi/checkoutCalibrationUtils'
import type { MapBounds } from '../../utils/venueFloorPlanMap'

export type LaneHealth = 'ok' | 'warning' | 'critical' | 'closed'

export interface CheckoutRoiRegion {
  id: string
  name: string
  vertices: { x: number; z: number }[]
  kind: 'queue' | 'service'
  laneNumber: number
}

export interface QueuePersonDot {
  x: number
  z: number
  color: 'green' | 'amber' | 'red'
}

export interface ThresholdLike {
  waitTimeWarningMin: number
  waitTimeCriticalMin: number
  queueLengthWarning: number
  queueLengthCritical: number
}

export interface LaneLike {
  laneId: number
  name?: string
  queueZoneId?: string
  status: string
  queueCount: number
  avgWaitTimeSec?: number
  queuedPeople?: { waitTimeSec: number }[]
}

const CHECKOUT_ROI_RE = /^Checkout (\d+) - (Queue|Service)$/

export function parseCheckoutRegions(
  rois: { id: string; name: string; vertices: { x: number; z?: number; y?: number }[] }[],
): CheckoutRoiRegion[] {
  const out: CheckoutRoiRegion[] = []
  for (const roi of rois) {
    const m = roi.name?.match(CHECKOUT_ROI_RE)
    if (!m) continue
    const laneNumber = parseInt(m[1], 10)
    const kind = m[2].toLowerCase() as 'queue' | 'service'
    const vertices = (roi.vertices || []).map(v => ({
      x: v.x,
      z: v.z ?? v.y ?? 0,
    }))
    if (vertices.length < 3) continue
    out.push({ id: roi.id, name: roi.name, vertices, kind, laneNumber })
  }
  return out
}

export function regionCentroid(vertices: { x: number; z: number }[]): { x: number; z: number } {
  if (vertices.length === 0) return { x: 0, z: 0 }
  const x = vertices.reduce((s, v) => s + v.x, 0) / vertices.length
  const z = vertices.reduce((s, v) => s + v.z, 0) / vertices.length
  return { x, z }
}

export function computeCheckoutFocusBounds(
  checkoutRegions: CheckoutRoiRegion[],
  paddingRatio = 0.25,
): MapBounds | null {
  const pts = checkoutRegions.flatMap(r => r.vertices)
  if (pts.length === 0) return null
  return computeMapBounds(pts, paddingRatio)
}

export function getLaneHealth(lane: LaneLike, thresholds: ThresholdLike): LaneHealth {
  if (lane.status !== 'OPEN') return 'closed'
  const waitMin = (lane.avgWaitTimeSec ?? 0) / 60
  if (waitMin >= thresholds.waitTimeCriticalMin) return 'critical'
  if (lane.queueCount >= thresholds.queueLengthCritical) return 'critical'
  if (waitMin >= thresholds.waitTimeWarningMin) return 'warning'
  if (lane.queueCount >= thresholds.queueLengthWarning) return 'warning'
  return 'ok'
}

export function waitColorFromSec(
  waitTimeSec: number,
  thresholds: ThresholdLike,
): 'green' | 'amber' | 'red' {
  const waitMin = waitTimeSec / 60
  if (waitMin >= thresholds.waitTimeCriticalMin) return 'red'
  if (waitMin >= thresholds.waitTimeWarningMin) return 'amber'
  return 'green'
}

const DOT_COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
}

export function dotFill(color: 'green' | 'amber' | 'red') {
  return DOT_COLORS[color]
}

/** Place queue person dots along the queue polygon toward the service zone. */
export function layoutQueuePersonDots(
  queueVertices: { x: number; z: number }[],
  serviceCenter: { x: number; z: number } | null,
  queuedPeople: { waitTimeSec: number }[],
  thresholds: ThresholdLike,
): QueuePersonDot[] {
  if (queuedPeople.length === 0 || queueVertices.length < 3) return []

  const queueCenter = regionCentroid(queueVertices)
  let dirX = 0
  let dirZ = 1
  if (serviceCenter) {
    dirX = serviceCenter.x - queueCenter.x
    dirZ = serviceCenter.z - queueCenter.z
    const len = Math.hypot(dirX, dirZ) || 1
    dirX /= len
    dirZ /= len
  }

  const projections = queueVertices.map(v => ({
    v,
    t: (v.x - queueCenter.x) * dirX + (v.z - queueCenter.z) * dirZ,
  }))
  const minT = Math.min(...projections.map(p => p.t))
  const maxT = Math.max(...projections.map(p => p.t))
  const span = maxT - minT || 1

  const count = queuedPeople.length
  return queuedPeople.map((person, i) => {
    const t = count === 1
      ? minT + span * 0.35
      : minT + (span * 0.15) + ((span * 0.7) * i) / (count - 1)
    return {
      x: queueCenter.x + dirX * t,
      z: queueCenter.z + dirZ * t,
      color: waitColorFromSec(person.waitTimeSec, thresholds),
    }
  })
}

export const LANE_HEALTH_COLORS: Record<LaneHealth, { fill: string; stroke: string; pulse?: boolean }> = {
  ok: { fill: 'rgba(34, 197, 94, 0.22)', stroke: 'rgba(74, 222, 128, 0.75)' },
  warning: { fill: 'rgba(245, 158, 11, 0.28)', stroke: 'rgba(251, 191, 36, 0.85)', pulse: true },
  critical: { fill: 'rgba(239, 68, 68, 0.32)', stroke: 'rgba(248, 113, 113, 0.95)', pulse: true },
  closed: { fill: 'rgba(75, 85, 99, 0.35)', stroke: 'rgba(107, 114, 128, 0.7)' },
}
