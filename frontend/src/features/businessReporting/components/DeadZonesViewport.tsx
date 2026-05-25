import { API_BASE } from '../../../config/api'
import { useState, useEffect, useMemo } from 'react'
import { MapPin } from 'lucide-react'
import { ROI_CATEGORY_COLOR } from '../../../utils/roiCategoryUtils'

interface DeadZone {
  id: string
  name: string
  utilization: number
  category?: string | null
}

interface ROI {
  id: string
  name: string
  vertices: { x: number; z: number }[]
  color: string
}

interface DeadZonesViewportProps {
  venueId: string
  deadZones: DeadZone[]
}

/** Floor-plan depth axis — ROI vertices use x/z, not x/y (y is height). */
function floorZ(v: { z?: number; y?: number }) {
  return v.z ?? 0
}

export default function DeadZonesViewport({ venueId, deadZones }: DeadZonesViewportProps) {
  const [allRois, setAllRois] = useState<ROI[]>([])
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchRois = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`)
        if (res.ok) {
          const data = await res.json()
          setAllRois(data)
        }
      } catch (err) {
        console.error('Failed to fetch ROIs:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchRois()
  }, [venueId])

  const categoryByRoiId = useMemo(() => {
    const map = new Map<string, string>()
    deadZones.forEach((z) => {
      if (z.category) map.set(z.id, z.category)
    })
    return map
  }, [deadZones])

  const bounds = useMemo(() => {
    if (allRois.length === 0) return { minX: 0, minZ: 0, maxX: 100, maxZ: 100 }

    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    for (const roi of allRois) {
      for (const v of roi.vertices) {
        const z = floorZ(v)
        minX = Math.min(minX, v.x)
        minZ = Math.min(minZ, z)
        maxX = Math.max(maxX, v.x)
        maxZ = Math.max(maxZ, z)
      }
    }
    const padX = (maxX - minX) * 0.08 || 2
    const padZ = (maxZ - minZ) * 0.08 || 2
    return {
      minX: minX - padX,
      minZ: minZ - padZ,
      maxX: maxX + padX,
      maxZ: maxZ + padZ,
    }
  }, [allRois])

  const deadZoneIds = useMemo(() => new Set(deadZones.map(z => z.id)), [deadZones])

  const svgWidth = 400
  const svgHeight = 280

  const toSvg = (x: number, z: number) => {
    const width = bounds.maxX - bounds.minX || 1
    const depth = bounds.maxZ - bounds.minZ || 1
    return {
      x: ((x - bounds.minX) / width) * svgWidth,
      y: ((z - bounds.minZ) / depth) * svgHeight,
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        Loading zones...
      </div>
    )
  }

  if (allRois.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        No zones available
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-medium text-gray-400 mb-3 flex items-center gap-2">
          <MapPin className="w-3 h-3" />
          Store Layout — Dead Zones Highlighted
        </h4>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto rounded-md"
          style={{ maxHeight: '280px', background: '#111827' }}
        >
          <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="#111827" />

          {allRois.map((roi) => {
            const isDead = deadZoneIds.has(roi.id)
            const isHovered = hoveredZoneId === roi.id
            const category = categoryByRoiId.get(roi.id)
            const points = roi.vertices
              .map(v => {
                const { x, y } = toSvg(v.x, floorZ(v))
                return `${x},${y}`
              })
              .join(' ')

            const centerX = roi.vertices.reduce((sum, v) => sum + v.x, 0) / roi.vertices.length
            const centerZ = roi.vertices.reduce((sum, v) => sum + floorZ(v), 0) / roi.vertices.length
            const { x: labelX, y: labelY } = toSvg(centerX, centerZ)

            return (
              <g
                key={roi.id}
                onMouseEnter={() => setHoveredZoneId(roi.id)}
                onMouseLeave={() => setHoveredZoneId(null)}
              >
                <polygon
                  points={points}
                  fill={isDead
                    ? isHovered ? 'rgba(239, 68, 68, 0.55)' : 'rgba(239, 68, 68, 0.28)'
                    : isHovered ? 'rgba(34, 197, 94, 0.25)' : 'rgba(34, 197, 94, 0.12)'}
                  stroke={isDead
                    ? isHovered ? '#f87171' : '#dc2626'
                    : isHovered ? '#4ade80' : '#374151'}
                  strokeWidth={isHovered ? 2 : 1}
                  className="transition-all duration-200"
                />
                {(isHovered || isDead) && (
                  <>
                    {category && (
                      <text
                        x={labelX}
                        y={labelY - 8}
                        textAnchor="middle"
                        fill={ROI_CATEGORY_COLOR}
                        fontSize="9"
                        fontWeight="bold"
                        className="pointer-events-none"
                      >
                        {category.length > 18 ? `${category.slice(0, 16)}…` : category}
                      </text>
                    )}
                    <text
                      x={labelX}
                      y={labelY + (category ? 4 : 0)}
                      textAnchor="middle"
                      fill="#e5e7eb"
                      fontSize="8"
                      className="pointer-events-none"
                    >
                      {roi.name.length > 22 ? `${roi.name.slice(0, 20)}…` : roi.name}
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500/30 border border-red-600 rounded-sm" />
            Dead Zone
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500/15 border border-gray-600 rounded-sm" />
            Active Zone
          </div>
        </div>
      </div>

      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-medium text-gray-400 mb-3">
          Dead Zones ({deadZones.length})
        </h4>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {deadZones.map((zone) => (
            <div
              key={zone.id}
              onMouseEnter={() => setHoveredZoneId(zone.id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              className={`px-3 py-2 rounded-lg cursor-pointer transition-all text-sm ${
                hoveredZoneId === zone.id
                  ? 'bg-red-500/20 border border-red-500/50 text-red-300'
                  : 'bg-gray-700/50 border border-transparent text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{zone.name}</div>
                  {zone.category && (
                    <div className="mt-1">
                      <span
                        className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold truncate max-w-full"
                        style={{
                          color: ROI_CATEGORY_COLOR,
                          backgroundColor: `${ROI_CATEGORY_COLOR}18`,
                          border: `1px solid ${ROI_CATEGORY_COLOR}44`,
                        }}
                      >
                        {zone.category}
                      </span>
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-500 shrink-0">{zone.utilization}%</span>
              </div>
            </div>
          ))}
          {deadZones.length === 0 && (
            <p className="text-gray-500 text-sm">No dead zones detected!</p>
          )}
        </div>
      </div>
    </div>
  )
}
