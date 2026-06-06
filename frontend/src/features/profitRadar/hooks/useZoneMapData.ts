import { useEffect, useMemo, useState } from 'react'
import { useVenue } from '../../../context/VenueContext'
import { API_BASE } from '../../../config/api'
import {
  boundsToViewBox,
  computeFloorPlanBounds,
  normalizeFloorVertex,
  type MapRegion,
} from '../../../utils/venueFloorPlanMap'
import type { VenueObject } from '../../../types'

interface RoiShape {
  id: string
  name: string
  vertices: { x: number; z?: number; y?: number }[]
}

export function pointInPolygon(p: { x: number; z: number }, verts: { x: number; z: number }[]): boolean {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i]
    const b = verts[j]
    if (((a.z > p.z) !== (b.z > p.z)) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function zoneBounds(verts: { x: number; z: number }[], pad = 0.6) {
  if (verts.length === 0) return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const v of verts) {
    minX = Math.min(minX, v.x)
    maxX = Math.max(maxX, v.x)
    minZ = Math.min(minZ, v.z)
    maxZ = Math.max(maxZ, v.z)
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad }
}

/** Tight crop around a moving trajectory — used by the microscope (not full zone). */
export function trajectoryBounds(
  pts: { x: number; z: number }[],
  pad = 0.55,
  minSpan = 2.4,
) {
  if (pts.length === 0) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  let spanX = maxX - minX
  let spanZ = maxZ - minZ
  if (spanX < minSpan) {
    minX = cx - minSpan / 2
    maxX = cx + minSpan / 2
  }
  if (spanZ < minSpan) {
    minZ = cz - minSpan / 2
    maxZ = cz + minSpan / 2
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad }
}

export function useZoneMapData(venueId: string, roiId: string | null) {
  const { objects: ctxObjects, venue: ctxVenue } = useVenue()
  const [rois, setRois] = useState<RoiShape[]>([])
  const [objects, setObjects] = useState<VenueObject[]>([])
  const [venueSize, setVenueSize] = useState<{ width: number; depth: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (ctxVenue?.id === venueId && ctxObjects.length > 0) {
        setObjects(ctxObjects)
        setVenueSize({ width: ctxVenue.width, depth: ctxVenue.depth })
      } else {
        try {
          const res = await fetch(`${API_BASE}/api/venues/${venueId}`)
          if (res.ok) {
            const data = await res.json()
            if (cancelled) return
            setObjects(data.objects || [])
            if (data.venue) setVenueSize({ width: data.venue.width, depth: data.venue.depth })
          }
        } catch { /* ignore */ }
      }
      try {
        const roiRes = await fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`)
        if (roiRes.ok) {
          const data = await roiRes.json()
          if (!cancelled) setRois(data || [])
        }
      } catch { /* ignore */ }
    }
    load()
    return () => { cancelled = true }
  }, [venueId, ctxVenue?.id, ctxVenue?.width, ctxVenue?.depth, ctxObjects.length])

  const regions: MapRegion[] = useMemo(
    () => rois.map(r => ({ id: r.id, vertices: r.vertices.map(normalizeFloorVertex) })),
    [rois],
  )

  const zoneVerts = useMemo(() => {
    const z = rois.find(r => r.id === roiId)
    return z ? z.vertices.map(normalizeFloorVertex) : []
  }, [rois, roiId])

  const bounds = useMemo(
    () => computeFloorPlanBounds(objects, regions, venueSize ?? undefined),
    [objects, regions, venueSize],
  )

  const viewBox = useMemo(() => boundsToViewBox(bounds), [bounds])
  const zoneViewBox = useMemo(() => boundsToViewBox(zoneBounds(zoneVerts)), [zoneVerts])

  return { objects, regions, zoneVerts, bounds, viewBox, zoneViewBox, rois }
}
