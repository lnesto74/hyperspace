import { useEffect, useMemo, useState } from 'react'
import { useTracksRef } from '../context/TrackingContext'
import { useRoi } from '../context/RoiContext'

export const isPointInPolygon = (
  x: number,
  z: number,
  vertices: { x: number; z: number }[],
): boolean => {
  if (vertices.length < 3) return false
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x
    const zi = vertices[i].z
    const xj = vertices[j].x
    const zj = vertices[j].z
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

type TrackLike = {
  venuePosition: { x: number; z: number }
}

export function countCurrentOccupancy(
  tracks: Map<string, TrackLike>,
  vertices: { x: number; z: number }[],
): number {
  if (vertices.length < 3) return 0
  let occupancy = 0
  tracks.forEach(track => {
    const pos = track.venuePosition
    if (isPointInPolygon(pos.x, pos.z, vertices)) occupancy++
  })
  return occupancy
}

export interface ZoneLiveMetrics {
  currentOccupancy: number
  totalEntries: number
}

/** Poll live occupancy for a single ROI from in-browser tracks (same source as sidebar cards). */
export function useRoiLiveOccupancy(roiId: string): number {
  const tracksRef = useTracksRef()
  const { regions } = useRoi()
  const [occupancy, setOccupancy] = useState(0)

  const vertices = useMemo(() => {
    return regions.find(r => r.id === roiId)?.vertices ?? []
  }, [regions, roiId])

  useEffect(() => {
    const tick = () => {
      setOccupancy(countCurrentOccupancy(tracksRef.current, vertices))
    }
    const id = setInterval(tick, 500)
    tick()
    return () => clearInterval(id)
  }, [roiId, vertices, tracksRef])

  return occupancy
}
