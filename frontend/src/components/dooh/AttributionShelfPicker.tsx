import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, ZoomIn, ZoomOut, Move } from 'lucide-react'
import { API_BASE } from '../../config/api'
import {
  computeMapBounds,
  FixtureInfo,
  getFixtureFootprintBounds,
  getFixtureOutlinePoints,
  sortFixtures,
} from '../kpi/checkoutCalibrationUtils'
import { ROI_CATEGORY_COLOR } from '../../utils/roiCategoryUtils'

interface AnalyzeFixture {
  id: string
  name: string
  type?: string
  position: { x: number; y: number; z: number }
  rotation?: { x?: number; y?: number; z?: number }
  scale?: { x: number; y: number; z: number }
  source?: string | null
  footprintPoints?: { x: number; z: number }[] | null
}

interface ShelfOption {
  id: string
  name: string
  categoryLabel?: string | null
  categories?: string[]
}

interface AttributionShelfPickerProps {
  venueId: string
  dwgLayoutId?: string | null
  shelfOptions: ShelfOption[]
  selectedIds: string[]
  onToggle: (shelfId: string) => void
}

function toFixtureInfo(obj: AnalyzeFixture): FixtureInfo {
  return {
    id: obj.id,
    name: obj.name,
    type: obj.type,
    position: obj.position,
    rotation: obj.rotation,
    scale: obj.scale,
    source: obj.source,
    footprintPoints: obj.footprintPoints,
  }
}

function resolveFixtureStyle(type?: string) {
  if (type === 'fridge') {
    return { fill: '#164e63', fillHi: '#0891b2', stroke: '#22d3ee', strokeHi: '#67e8f9' }
  }
  if (type === 'service_counter') {
    return { fill: '#365314', fillHi: '#4d7c0f', stroke: '#84cc16', strokeHi: '#a3e635' }
  }
  return { fill: '#312e81', fillHi: '#4338ca', stroke: '#818cf8', strokeHi: '#a5b4fc' }
}

function SelectableFixture({
  fixture,
  selected,
  categoryLabel,
  onToggle,
}: {
  fixture: FixtureInfo
  selected: boolean
  categoryLabel?: string | null
  onToggle: () => void
}) {
  const outline = getFixtureOutlinePoints(fixture)
  const bounds = getFixtureFootprintBounds(fixture)
  const pointsStr = outline.map(p => `${p.x},${p.z}`).join(' ')
  const labelX = (bounds.minX + bounds.maxX) / 2
  const labelY = bounds.minZ - 0.35
  const style = resolveFixtureStyle(fixture.type)

  return (
    <g
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      style={{ cursor: 'pointer' }}
      opacity={selected ? 1 : 0.85}
    >
      <polygon
        points={pointsStr}
        fill={selected ? style.fillHi : style.fill}
        fillOpacity={selected ? 0.85 : 0.55}
        stroke={selected ? '#fbbf24' : style.stroke}
        strokeWidth={selected ? 0.16 : 0.1}
        strokeLinejoin="round"
      />
      <text x={labelX} y={labelY} textAnchor="middle" fontSize={0.32} fill={selected ? '#fde68a' : '#e2e8f0'} pointerEvents="none">
        {fixture.name}
      </text>
      {categoryLabel && (
        <text x={labelX} y={labelY - 0.42} textAnchor="middle" fontSize={0.28} fill={ROI_CATEGORY_COLOR} pointerEvents="none">
          {categoryLabel}
        </text>
      )}
    </g>
  )
}

export default function AttributionShelfPicker({
  venueId,
  dwgLayoutId,
  shelfOptions,
  selectedIds,
  onToggle,
}: AttributionShelfPickerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapFixtures, setMapFixtures] = useState<FixtureInfo[]>([])
  const [selectableFixtures, setSelectableFixtures] = useState<FixtureInfo[]>([])
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, z: 0 })
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanZ: number } | null>(null)

  const categoryByShelfId = useMemo(() => {
    const map = new Map<string, string>()
    shelfOptions.forEach((s) => {
      const label = s.categoryLabel || s.categories?.[0]
      if (label) map.set(s.id, label)
    })
    return map
  }, [shelfOptions])

  const selectableIds = useMemo(() => new Set(shelfOptions.map(s => s.id)), [shelfOptions])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const url = dwgLayoutId
          ? `${API_BASE}/api/smart-kpi/dwg/${dwgLayoutId}/venues/${venueId}/analyze`
          : `${API_BASE}/api/smart-kpi/venues/${venueId}/analyze`
        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to load store layout')
        const data = await res.json()
        const template = data.availableKpis?.find((k: { id: string }) => k.id === 'shelf-engagement')
        const detected = (template?.detectedObjects ?? []) as AnalyzeFixture[]
        const mapSource = (template?.mapFixtures?.length ? template.mapFixtures : detected) as AnalyzeFixture[]

        const selectable = detected.map(toFixtureInfo).filter(f => selectableIds.has(f.id))
        const mapAll = mapSource.map(toFixtureInfo)
        const byId = new Map<string, FixtureInfo>()
        mapAll.forEach(f => byId.set(f.id, f))
        selectable.forEach(f => byId.set(f.id, f))

        if (!cancelled) {
          setSelectableFixtures(sortFixtures(selectable))
          setMapFixtures(sortFixtures(Array.from(byId.values())))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load layout')
          const fallback = shelfOptions.map(s => ({
            id: s.id,
            name: s.name,
            type: undefined,
            position: { x: 0, y: 0, z: 0 },
          })) as FixtureInfo[]
          setSelectableFixtures(fallback)
          setMapFixtures(fallback)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [venueId, dwgLayoutId, shelfOptions, selectableIds])

  const displayFixtures = mapFixtures.length ? mapFixtures : selectableFixtures

  const bounds = useMemo(() => {
    const footprintPts = displayFixtures.flatMap(f => getFixtureOutlinePoints(f))
    const base = computeMapBounds(footprintPts, 0.12 / zoom)
    const cx = (base.minX + base.maxX) / 2
    const cz = (base.minZ + base.maxZ) / 2
    const halfW = ((base.maxX - base.minX) / 2) / zoom
    const halfD = ((base.maxZ - base.minZ) / 2) / zoom
    return {
      minX: cx - halfW + panOffset.x,
      maxX: cx + halfW + panOffset.x,
      minZ: cz - halfD + panOffset.z,
      maxZ: cz + halfD + panOffset.z,
    }
  }, [displayFixtures, panOffset, zoom])

  const viewBox = `${bounds.minX} ${bounds.minZ} ${bounds.maxX - bounds.minX} ${bounds.maxZ - bounds.minZ}`

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panOffset.x,
      startPanZ: panOffset.z,
    }
  }, [panOffset])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.startX) * 0.01 / zoom
    const dz = (e.clientY - dragRef.current.startY) * 0.01 / zoom
    setPanOffset({
      x: dragRef.current.startPanX - dx,
      z: dragRef.current.startPanZ - dz,
    })
  }, [zoom])

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center bg-gray-900/60 rounded-lg border border-gray-700">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Click fixtures on the floor plan · amber = selected · category shown above shelf name
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom(z => Math.min(z * 1.2, 4))} className="p-1 rounded bg-gray-700 text-gray-300 hover:text-white" title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => setZoom(z => Math.max(z / 1.2, 0.5))} className="p-1 rounded bg-gray-700 text-gray-300 hover:text-white" title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => { setZoom(1); setPanOffset({ x: 0, z: 0 }) }} className="p-1 rounded bg-gray-700 text-gray-300 hover:text-white" title="Reset view">
            <Move className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-amber-400">{error} — using shelf list fallback.</p>
      )}

      <div className="relative h-72 bg-gray-950 rounded-lg border border-gray-700 overflow-hidden">
        <svg
          viewBox={viewBox}
          className="w-full h-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <rect x={bounds.minX} y={bounds.minZ} width={bounds.maxX - bounds.minX} height={bounds.maxZ - bounds.minZ} fill="#0f172a" />
          {displayFixtures.map((fixture) => {
            const isSelectable = selectableIds.has(fixture.id)
            if (!isSelectable) {
              const outline = getFixtureOutlinePoints(fixture)
              const pointsStr = outline.map(p => `${p.x},${p.z}`).join(' ')
              return (
                <polygon
                  key={fixture.id}
                  points={pointsStr}
                  fill="#1e293b"
                  fillOpacity={0.35}
                  stroke="#334155"
                  strokeWidth={0.06}
                />
              )
            }
            return (
              <SelectableFixture
                key={fixture.id}
                fixture={fixture}
                selected={selectedIds.includes(fixture.id)}
                categoryLabel={categoryByShelfId.get(fixture.id)}
                onToggle={() => onToggle(fixture.id)}
              />
            )
          })}
        </svg>
      </div>

      <div className="max-h-28 overflow-y-auto space-y-1">
        {selectableFixtures.map((fixture) => {
          const selected = selectedIds.includes(fixture.id)
          const category = categoryByShelfId.get(fixture.id)
          return (
            <label
              key={fixture.id}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                selected ? 'bg-amber-500/15 border border-amber-500/40' : 'bg-gray-700/50 hover:bg-gray-700 border border-transparent'
              }`}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(fixture.id)}
                className="rounded"
              />
              <span className="text-sm text-white truncate flex-1">{fixture.name}</span>
              {category && (
                <span
                  className="text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0"
                  style={{
                    color: ROI_CATEGORY_COLOR,
                    backgroundColor: `${ROI_CATEGORY_COLOR}18`,
                    border: `1px solid ${ROI_CATEGORY_COLOR}44`,
                  }}
                >
                  {category}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
