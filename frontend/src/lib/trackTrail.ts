/** Max segment length before we reset the trail (avoids straight "spoke" artifacts). */
export const TRAIL_JUMP_RESET_M = 4.0

export type TrailPoint = { x: number; y: number; z: number }

export function isFiniteTrackPos(p?: { x?: number; z?: number } | null): p is { x: number; z: number } {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.z)
}

/**
 * Append a trail point, resetting history when the track teleports or coords are invalid.
 * Raw MQTT positions are fine — bad segments come from stale client state or re-ID jumps.
 */
export function appendTrailPoint(
  oldTrail: TrailPoint[] | undefined,
  point: TrailPoint,
  maxLength: number,
  jumpResetM = TRAIL_JUMP_RESET_M,
): TrailPoint[] {
  if (!isFiniteTrackPos(point)) return oldTrail ?? []
  const last = oldTrail?.[oldTrail.length - 1]
  if (last && isFiniteTrackPos(last)) {
    const d = Math.hypot(point.x - last.x, point.z - last.z)
    if (d > jumpResetM) {
      return [{ x: point.x, y: point.y ?? 0, z: point.z }]
    }
  }
  let trail = [...(oldTrail ?? []), { x: point.x, y: point.y ?? 0, z: point.z }]
  if (trail.length > maxLength) trail = trail.slice(trail.length - maxLength)
  return trail
}
