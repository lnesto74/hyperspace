import { useId, useMemo } from 'react'
import type { VenueObject } from '../../types'
import {
  boundsToViewBox,
  computeFloorPlanBounds,
  getDrawableFixtureOutline,
  normalizeMapRegions,
  polygonPath,
  venueObjectsToFixtures,
  type MapRegion,
} from '../../utils/venueFloorPlanMap'

interface FloorPlanMiniMapProps {
  objects: VenueObject[]
  regions: MapRegion[]
  venueSize?: { width: number; depth: number }
  height?: number
  mode: 'alert' | 'deadZones'
  highlightIds?: Set<string>
  deadZoneIds?: Set<string>
  hoveredZoneId?: string | null
  pulse?: number
}

/**
 * SVG floor plan — same viewBox approach as Smart KPI shelf/checkout calibration maps.
 */
export default function FloorPlanMiniMap({
  objects,
  regions,
  venueSize,
  height = 320,
  mode,
  highlightIds = new Set(),
  deadZoneIds = new Set(),
  hoveredZoneId = null,
  pulse = 0,
}: FloorPlanMiniMapProps) {
  const bounds = useMemo(
    () => computeFloorPlanBounds(objects, regions, venueSize),
    [objects, regions, venueSize],
  )
  const viewBox = useMemo(() => boundsToViewBox(bounds), [bounds])
  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])
  const mapRegions = useMemo(() => normalizeMapRegions(regions), [regions])
  const pulseWave = 0.5 + 0.5 * Math.sin(pulse * Math.PI * 2)
  const gridPatternId = useId().replace(/:/g, '')

  const sceneW = bounds.maxX - bounds.minX || 1
  const gridStep = sceneW > 120 ? 5 : sceneW > 60 ? 2 : 1

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="w-full block"
      style={{ height, background: '#050810' }}
    >
      <defs>
        <pattern
          id={gridPatternId}
          width={gridStep}
          height={gridStep}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={gridStep * 0.02}
          />
        </pattern>
      </defs>

      <rect
        x={bounds.minX}
        y={bounds.minZ}
        width={bounds.maxX - bounds.minX}
        height={bounds.maxZ - bounds.minZ}
        fill={`url(#${gridPatternId})`}
      />

      {fixtures.map(fixture => {
        const outline = getDrawableFixtureOutline(fixture)
        if (outline.length < 3) return null
        return (
          <path
            key={fixture.id}
            d={polygonPath(outline)}
            fill="rgba(0, 210, 255, 0.06)"
            stroke="rgba(0, 210, 255, 0.5)"
            strokeWidth={0.05}
            strokeLinejoin="round"
          />
        )
      })}

      {mode === 'alert' && mapRegions.map(r => {
        if (highlightIds.has(r.id)) return null
        return (
          <path
            key={r.id}
            d={polygonPath(r.vertices)}
            fill="rgba(139, 92, 246, 0.06)"
            stroke="rgba(139, 92, 246, 0.25)"
            strokeWidth={0.04}
          />
        )
      })}

      {mode === 'alert' && mapRegions.map(r => {
        if (!highlightIds.has(r.id)) return null
        return (
          <path
            key={`hl-${r.id}`}
            d={polygonPath(r.vertices)}
            fill={`rgba(255, 40, 40, ${0.18 + pulseWave * 0.22})`}
            stroke={`rgba(255, 50, 50, ${0.7 + pulseWave * 0.3})`}
            strokeWidth={0.07 + pulseWave * 0.05}
          />
        )
      })}

      {mode === 'deadZones' && mapRegions.map(r => {
        if (deadZoneIds.has(r.id)) return null
        const hovered = hoveredZoneId === r.id
        return (
          <path
            key={r.id}
            d={polygonPath(r.vertices)}
            fill={hovered ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.08)'}
            stroke={hovered ? 'rgba(74, 222, 128, 0.7)' : 'rgba(55, 65, 81, 0.6)'}
            strokeWidth={hovered ? 0.08 : 0.04}
          />
        )
      })}

      {mode === 'deadZones' && mapRegions.map(r => {
        if (!deadZoneIds.has(r.id)) return null
        const hovered = hoveredZoneId === r.id
        return (
          <path
            key={`dead-${r.id}`}
            d={polygonPath(r.vertices)}
            fill={
              hovered
                ? 'rgba(239, 68, 68, 0.45)'
                : `rgba(255, 40, 40, ${0.15 + pulseWave * 0.25})`
            }
            stroke={
              hovered
                ? 'rgba(248, 113, 113, 0.95)'
                : `rgba(255, 50, 50, ${0.65 + pulseWave * 0.35})`
            }
            strokeWidth={hovered ? 0.12 : 0.07 + pulseWave * 0.05}
          />
        )
      })}
    </svg>
  )
}
