import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Cloud,
  CloudOff,
  Copy,
  Eye,
  Loader2,
  MousePointer2,
  Move,
  PenSquare,
  RefreshCw,
  RotateCw,
  Tag,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  getFixtureAtPoint,
  ResizeHandle,
} from './calibrationPreviewUtils'
import {
  extractZoneCalibration,
  computeMapBounds,
  focusBoundsAroundFixture,
  getFixtureFootprintBounds,
  getFixtureOutlinePoints,
} from './checkoutCalibrationUtils'
import {
  createShelfCustomZone,
  getRectHandlePositions,
  rectVerticesFromDrag,
  resizeRectVertices,
  RetailCategoryOption,
  ShelfCustomZone,
  shelfCustomZoneToPreviewRoi,
  translateRectVertices,
} from './shelfCustomZoneUtils'
import {
  FixtureInfo,
  PreviewRoiLike,
  ZoneCalibration,
  sortFixtures,
} from './shelfCalibrationUtils'
import {
  applyZoneCalibrationToRoi,
  isShelfRoiInLayout,
  parseShelfRoiFixtureId,
  parseShelfRoiZoneType,
  resolveFixtureForShelfRoi,
  ShelfRoiSaveStatus,
  zonesForFixture,
} from './shelfZoneEditorUtils'

interface ShelfCalibrationPanelProps {
  fixtures: FixtureInfo[]
  mapFixtures?: FixtureInfo[]
  previewRois: PreviewRoiLike[]
  customZones: ShelfCustomZone[]
  retailCategories: RetailCategoryOption[]
  referenceFixtureId: string
  isEditingExisting?: boolean
  loading: boolean
  deleting?: boolean
  creatingAll?: boolean
  unsavedCount: number
  persistedShelfRoiIds: Set<string>
  roiSaveStatus: Record<string, ShelfRoiSaveStatus>
  onReferenceChange: (fixtureId: string) => void
  onPreviewRoisChange: (rois: PreviewRoiLike[]) => void
  onSaveTemplateRoi: (roiId: string) => void
  onDeleteTemplateRois: (roiIds: string[]) => Promise<void>
  onCopyZoneToAllSimilar: (sourceRoiId: string) => void
  onCreateAllZones: () => Promise<void>
  onCustomZonesChange: (zones: ShelfCustomZone[]) => void
  onResetToAuto: () => void
  onDeleteAll: () => void
}

type ZoneType = 'left' | 'right' | 'front'

function parseTemplateRoiZoneType(roi: PreviewRoiLike): ZoneType {
  if (roi.id.endsWith('::front') || roi.name.includes('(Front)')) return 'front'
  if (roi.id.endsWith('::left') || roi.name.includes('(Left)')) return 'left'
  return 'right'
}

type ViewMode = 'focus' | 'all'
type MapTool = 'select' | 'pan' | 'draw'

function SaveStatusBadge({ status }: { status?: ShelfRoiSaveStatus }) {
  if (!status || status === 'idle') return null
  if (status === 'saving') {
    return (
      <span className="text-[10px] text-amber-300 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className="text-[10px] text-green-400 flex items-center gap-1">
        <Cloud className="w-3 h-3" /> Saved
      </span>
    )
  }
  return (
    <span className="text-[10px] text-red-400 flex items-center gap-1">
      <CloudOff className="w-3 h-3" /> Save failed — retry by nudging the zone
    </span>
  )
}

type FixtureDisplayKind = 'shelf' | 'fridge' | 'banco' | 'other'

function resolveFixtureDisplayKind(fixture: FixtureInfo): FixtureDisplayKind {
  const type = (fixture.type || '').toLowerCase()
  const name = (fixture.name || '').toLowerCase()
  if (type === 'fridge' || name.includes('fridge') || name.includes('frigo') || name.includes('freezer') || name.includes('refriger')) {
    return 'fridge'
  }
  if (type === 'service_counter' || name.includes('banco') || name.includes('bancone') || name.includes('gastronomia')) {
    return 'banco'
  }
  if (type === 'shelf' || name.includes('shelf') || name.includes('gondola') || name.includes('scaffale') || name.includes('regal')) {
    return 'shelf'
  }
  return 'other'
}

const FIXTURE_DISPLAY: Record<FixtureDisplayKind, { fill: string; fillHi: string; stroke: string; strokeHi: string; label: string }> = {
  shelf: { fill: '#1e1b4b', fillHi: '#312e81', stroke: '#c084fc', strokeHi: '#e9d5ff', label: 'Shelf' },
  fridge: { fill: '#083344', fillHi: '#164e63', stroke: '#22d3ee', strokeHi: '#a5f3fc', label: 'Fridge' },
  banco: { fill: '#451a03', fillHi: '#78350f', stroke: '#fbbf24', strokeHi: '#fde68a', label: 'Banco' },
  other: { fill: '#1e293b', fillHi: '#334155', stroke: '#94a3b8', strokeHi: '#e2e8f0', label: 'Fixture' },
}

function fixtureHasRoiTarget(fixture: FixtureInfo, roiFixtures: FixtureInfo[]): boolean {
  return roiFixtures.some(f => f.id === fixture.id)
}

function CalibrationSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  accentClass,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  accentClass: string
  onChange: (v: number) => void
  onCommit?: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-gray-400">{label}</label>
        <span className={`text-xs font-mono ${accentClass}`}>
          {value >= 0 && (label.includes('Rotation') ? '' : '+')}{value.toFixed(label === 'Rotation' ? 0 : 1)}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
      />
    </div>
  )
}

function FixtureFootprint({
  fixture,
  highlighted,
  dimmed,
  hasRoiTarget,
  onSelect,
}: {
  fixture: FixtureInfo
  highlighted?: boolean
  dimmed?: boolean
  hasRoiTarget?: boolean
  onSelect?: () => void
}) {
  const outline = getFixtureOutlinePoints(fixture)
  const bounds = getFixtureFootprintBounds(fixture)
  const pointsStr = outline.map(p => `${p.x},${p.z}`).join(' ')
  const labelY = bounds.minZ - 0.35
  const labelX = (bounds.minX + bounds.maxX) / 2
  const hasPolygon = (fixture.footprintPoints?.length ?? 0) >= 3
  const kind = resolveFixtureDisplayKind(fixture)
  const style = FIXTURE_DISPLAY[kind]
  const strokeWidth = highlighted ? 0.14 : 0.1

  return (
    <g opacity={dimmed ? 0.45 : 1} onClick={(e) => { e.stopPropagation(); onSelect?.() }} style={{ cursor: onSelect ? 'pointer' : undefined }}>
      <polygon
        points={pointsStr}
        fill={highlighted ? style.fillHi : style.fill}
        fillOpacity={highlighted ? 0.72 : 0.55}
        stroke={highlighted ? style.strokeHi : style.stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {(highlighted || !dimmed) && (
        <text x={labelX} y={labelY} textAnchor="middle" fontSize={0.34} fill={highlighted ? style.strokeHi : '#cbd5e1'} pointerEvents="none">
          {fixture.name}
        </text>
      )}
      {!hasPolygon && highlighted && (
        <text x={labelX} y={labelY - 0.45} textAnchor="middle" fontSize={0.28} fill="#64748b" pointerEvents="none">
          (no DWG polygon — using box fallback)
        </text>
      )}
      {!hasRoiTarget && !dimmed && (
        <text x={labelX} y={bounds.maxZ + 0.35} textAnchor="middle" fontSize={0.26} fill={style.stroke} pointerEvents="none">
          {style.label} (display only)
        </text>
      )}
    </g>
  )
}

export default function ShelfCalibrationPanel({
  fixtures,
  mapFixtures,
  previewRois,
  customZones,
  retailCategories,
  referenceFixtureId,
  isEditingExisting,
  loading,
  deleting,
  creatingAll,
  unsavedCount,
  persistedShelfRoiIds,
  roiSaveStatus,
  onReferenceChange,
  onPreviewRoisChange,
  onSaveTemplateRoi,
  onDeleteTemplateRois,
  onCopyZoneToAllSimilar,
  onCreateAllZones,
  onCustomZonesChange,
  onResetToAuto,
  onDeleteAll,
}: ShelfCalibrationPanelProps) {
  const [selectedTemplateRoiIds, setSelectedTemplateRoiIds] = useState<Set<string>>(new Set())
  const [selectedCustomZoneId, setSelectedCustomZoneId] = useState<string | null>(null)
  const [drawCategoryId, setDrawCategoryId] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('focus')
  const [mapTool, setMapTool] = useState<MapTool>('select')
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, z: 0 })
  const [drawPreview, setDrawPreview] = useState<{ x: number; z: number }[] | null>(null)
  const pendingSaveRoiIdRef = useRef<string | null>(null)

  const dragRef = useRef<{
    kind: 'pan' | 'direct-move' | 'direct-resize' | 'custom-move' | 'custom-resize' | 'draw'
    templateRoiId?: string
    customZoneId?: string
    resizeHandle?: ResizeHandle
    startX: number
    startY: number
    startPanX: number
    startPanZ: number
    startVertices?: { x: number; z: number }[]
    drawStart?: { x: number; z: number }
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  } | null>(null)

  const sortedFixtures = useMemo(() => sortFixtures(fixtures), [fixtures])
  const displayFixtures = useMemo(() => {
    const source = mapFixtures?.length ? mapFixtures : fixtures
    const byId = new Map<string, FixtureInfo>()
    for (const f of source) byId.set(f.id, f)
    for (const f of fixtures) byId.set(f.id, f)
    return sortFixtures(Array.from(byId.values()))
  }, [mapFixtures, fixtures])
  const referenceFixture = sortedFixtures.find(f => f.id === referenceFixtureId) ?? sortedFixtures[0]
  const selectedCustomZone = customZones.find(z => z.id === selectedCustomZoneId) ?? null
  const liveRois = previewRois

  const selectedTemplateRoi = useMemo(() => {
    if (selectedTemplateRoiIds.size !== 1) return null
    const id = [...selectedTemplateRoiIds][0]
    return liveRois.find(r => r.id === id) ?? null
  }, [selectedTemplateRoiIds, liveRois])

  const selectedZoneCalibration = useMemo(() => {
    if (!selectedTemplateRoi) return null
    const fixture = resolveFixtureForShelfRoi(selectedTemplateRoi, fixtures)
    if (!fixture) return null
    return extractZoneCalibration(selectedTemplateRoi, fixture, fixtures, { shelfMode: true })
  }, [selectedTemplateRoi, fixtures])

  const updateSelectedRoiCalibration = useCallback((field: keyof ZoneCalibration, value: number) => {
    if (!selectedTemplateRoi) return
    const fixture = resolveFixtureForShelfRoi(selectedTemplateRoi, fixtures)
    if (!fixture) return
    const base = selectedZoneCalibration ?? extractZoneCalibration(selectedTemplateRoi, fixture, fixtures, { shelfMode: true })
    const nextCal = { ...base, [field]: value }
    const updated = applyZoneCalibrationToRoi(selectedTemplateRoi, fixtures, nextCal)
    onPreviewRoisChange(liveRois.map(r => (r.id === updated.id ? updated : r)))
    pendingSaveRoiIdRef.current = updated.id
  }, [selectedTemplateRoi, selectedZoneCalibration, fixtures, liveRois, onPreviewRoisChange])

  const commitPendingSave = useCallback(() => {
    if (pendingSaveRoiIdRef.current) {
      onSaveTemplateRoi(pendingSaveRoiIdRef.current)
      pendingSaveRoiIdRef.current = null
    }
  }, [onSaveTemplateRoi])

  const updateTemplateRoiVertices = useCallback((roiId: string, vertices: { x: number; z: number }[]) => {
    onPreviewRoisChange(liveRois.map(r => (r.id === roiId ? { ...r, vertices } : r)))
    pendingSaveRoiIdRef.current = roiId
  }, [liveRois, onPreviewRoisChange])

  const deleteSelectedTemplateRois = useCallback(async () => {
    if (selectedTemplateRoiIds.size === 0) return
    const ids = [...selectedTemplateRoiIds]
    await onDeleteTemplateRois(ids)
    setSelectedTemplateRoiIds(new Set())
  }, [selectedTemplateRoiIds, onDeleteTemplateRois])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (selectedCustomZoneId || selectedTemplateRoiIds.size === 0) return
      e.preventDefault()
      deleteSelectedTemplateRois()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedCustomZoneId, selectedTemplateRoiIds, deleteSelectedTemplateRois])

  const customPreviewRois = useMemo(
    () => customZones.map(shelfCustomZoneToPreviewRoi),
    [customZones],
  )

  const effectiveDrawCategoryId = drawCategoryId || retailCategories[0]?.id || ''

  const displayRois = useMemo(() => {
    if (viewMode === 'all') return liveRois
    if (!referenceFixture) return liveRois
    return zonesForFixture(liveRois, fixtures, referenceFixture.id)
  }, [viewMode, liveRois, referenceFixture, fixtures])

  const bounds = useMemo(() => {
    const footprintPts = displayFixtures.flatMap(f => getFixtureOutlinePoints(f))
    const points = [
      ...liveRois.flatMap(r => r.vertices),
      ...customZones.flatMap(z => z.vertices),
      ...(drawPreview ?? []),
      ...footprintPts,
    ]
    const base = viewMode === 'focus' && referenceFixture && !selectedCustomZoneId
      ? focusBoundsAroundFixture(referenceFixture, 8 / zoom)
      : computeMapBounds(points, 0.08 / zoom)
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
  }, [liveRois, customZones, drawPreview, displayFixtures, viewMode, referenceFixture, selectedCustomZoneId, panOffset, zoom])

  const viewBox = `${bounds.minX} ${bounds.minZ} ${bounds.maxX - bounds.minX} ${bounds.maxZ - bounds.minZ}`

  const updateZone = useCallback((field: keyof ZoneCalibration, value: number) => {
    setSelectedCustomZoneId(null)
    updateSelectedRoiCalibration(field, value)
  }, [updateSelectedRoiCalibration])

  const updateCustomZoneCategory = useCallback((zoneId: string, categoryId: string) => {
    const category = retailCategories.find(c => c.id === categoryId)
    if (!category) return
    onCustomZonesChange(customZones.map(z => (
      z.id === zoneId
        ? {
            ...z,
            name: `${category.name} - Custom Engagement`,
            color: category.color || z.color,
            business_category_id: category.id,
            business_category: category.slug,
            business_category_label: category.name,
          }
        : z
    )))
  }, [customZones, onCustomZonesChange, retailCategories])

  const removeCustomZone = useCallback((zoneId: string) => {
    onCustomZonesChange(customZones.filter(z => z.id !== zoneId))
    if (selectedCustomZoneId === zoneId) setSelectedCustomZoneId(null)
  }, [customZones, onCustomZonesChange, selectedCustomZoneId])

  const screenToWorld = useCallback((clientX: number, clientY: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect()
    const relX = (clientX - rect.left) / rect.width
    const relY = (clientY - rect.top) / rect.height
    const b = dragRef.current?.bounds ?? bounds
    return {
      worldX: b.minX + relX * (b.maxX - b.minX),
      worldZ: b.minZ + relY * (b.maxZ - b.minZ),
    }
  }, [bounds])

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    setZoom(z => Math.min(4, Math.max(0.35, z * (e.deltaY > 0 ? 0.9 : 1.1))))
  }, [])

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget

    if (mapTool === 'pan') {
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPanX: panOffset.x,
        startPanZ: panOffset.z,
        bounds,
      }
      return
    }

    if (mapTool === 'draw') {
      const category = retailCategories.find(c => c.id === effectiveDrawCategoryId)
      if (!category) return
      const world = screenToWorld(e.clientX, e.clientY, svg)
      dragRef.current = {
        kind: 'draw',
        startX: e.clientX,
        startY: e.clientY,
        startPanX: panOffset.x,
        startPanZ: panOffset.z,
        drawStart: { x: world.worldX, z: world.worldZ },
        bounds,
      }
      setDrawPreview(rectVerticesFromDrag(world.worldX, world.worldZ, world.worldX, world.worldZ))
      return
    }

    const handleEl = (e.target as SVGElement).closest('[data-resize-handle]')
    if (handleEl) {
      const handle = handleEl.getAttribute('data-resize-handle') as ResizeHandle
      const customId = handleEl.getAttribute('data-custom-id')
      const templateRoiId = handleEl.getAttribute('data-template-roi-id')

      if (customId) {
        const zone = customZones.find(z => z.id === customId)
        if (!zone) return
        setSelectedCustomZoneId(customId)
        dragRef.current = {
          kind: 'custom-resize',
          customZoneId: customId,
          resizeHandle: handle,
          startX: e.clientX,
          startY: e.clientY,
          startPanX: panOffset.x,
          startPanZ: panOffset.z,
          startVertices: zone.vertices,
          bounds,
        }
        e.stopPropagation()
        return
      }

      if (templateRoiId) {
        const roi = liveRois.find(r => r.id === templateRoiId)
        if (!roi) return
        setSelectedCustomZoneId(null)
        setSelectedTemplateRoiIds(new Set([templateRoiId]))
        dragRef.current = {
          kind: 'direct-resize',
          templateRoiId,
          resizeHandle: handle,
          startX: e.clientX,
          startY: e.clientY,
          startPanX: panOffset.x,
          startPanZ: panOffset.z,
          startVertices: roi.vertices,
          bounds,
        }
        e.stopPropagation()
      }
      return
    }

    const customEl = (e.target as SVGElement).closest('[data-custom-zone-id]')
    if (customEl) {
      const customId = customEl.getAttribute('data-custom-zone-id')
      if (!customId) return
      const zone = customZones.find(z => z.id === customId)
      if (!zone) return
      setSelectedCustomZoneId(customId)
      dragRef.current = {
        kind: 'custom-move',
        customZoneId: customId,
        startX: e.clientX,
        startY: e.clientY,
        startPanX: panOffset.x,
        startPanZ: panOffset.z,
        startVertices: zone.vertices,
        bounds,
      }
      return
    }

    const zoneEl = (e.target as SVGElement).closest('[data-zone-type]')
    if (zoneEl) {
      setSelectedCustomZoneId(null)
      const roiId = zoneEl.getAttribute('data-roi-id')
      if (!roiId) return

      if (e.metaKey || e.ctrlKey) {
        setSelectedTemplateRoiIds(prev => {
          const next = new Set(prev)
          if (next.has(roiId)) next.delete(roiId)
          else next.add(roiId)
          return next
        })
        const fixtureId = parseShelfRoiFixtureId(liveRois.find(r => r.id === roiId) ?? { id: roiId, name: '', vertices: [], color: '' }, fixtures)
        if (fixtureId && fixtureId !== referenceFixtureId) onReferenceChange(fixtureId)
        return
      }

      setSelectedTemplateRoiIds(new Set([roiId]))
      const clickedRoi = liveRois.find(r => r.id === roiId)
      const fixtureId = clickedRoi ? parseShelfRoiFixtureId(clickedRoi, fixtures) : roiId.replace(/::(left|right|front)$/, '')
      if (fixtureId && fixtureId !== referenceFixtureId) onReferenceChange(fixtureId)
      const roi = liveRois.find(r => r.id === roiId)
      if (roi) {
        dragRef.current = {
          kind: 'direct-move',
          templateRoiId: roiId,
          startX: e.clientX,
          startY: e.clientY,
          startPanX: panOffset.x,
          startPanZ: panOffset.z,
          startVertices: roi.vertices,
          bounds,
        }
      }
      return
    }

    const world = screenToWorld(e.clientX, e.clientY, svg)
    const clickedFixture = getFixtureAtPoint(displayFixtures, world.worldX, world.worldZ)
    if (clickedFixture) {
      setSelectedCustomZoneId(null)
      setSelectedTemplateRoiIds(new Set())
      onReferenceChange(clickedFixture.id)
    } else {
      setSelectedCustomZoneId(null)
      setSelectedTemplateRoiIds(new Set())
    }
  }, [
    mapTool, panOffset, bounds, retailCategories, effectiveDrawCategoryId, screenToWorld,
    customZones, liveRois, referenceFixtureId, onReferenceChange, displayFixtures, fixtures,
  ])

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    const svg = e.currentTarget
    const drag = dragRef.current

    if (drag.kind === 'pan') {
      const rect = svg.getBoundingClientRect()
      const b = drag.bounds
      const dx = ((e.clientX - drag.startX) / rect.width) * (b.maxX - b.minX)
      const dz = ((e.clientY - drag.startY) / rect.height) * (b.maxZ - b.minZ)
      setPanOffset({ x: drag.startPanX - dx, z: drag.startPanZ - dz })
      return
    }

    if (drag.kind === 'draw' && drag.drawStart) {
      const world = screenToWorld(e.clientX, e.clientY, svg)
      setDrawPreview(rectVerticesFromDrag(drag.drawStart.x, drag.drawStart.z, world.worldX, world.worldZ))
      return
    }

    const start = screenToWorld(drag.startX, drag.startY, svg)
    const current = screenToWorld(e.clientX, e.clientY, svg)
    const dx = current.worldX - start.worldX
    const dz = current.worldZ - start.worldZ

    if (drag.kind === 'custom-move' && drag.customZoneId && drag.startVertices) {
      onCustomZonesChange(customZones.map(z => (
        z.id === drag.customZoneId
          ? { ...z, vertices: translateRectVertices(drag.startVertices!, dx, dz) }
          : z
      )))
      return
    }

    if (drag.kind === 'custom-resize' && drag.customZoneId && drag.resizeHandle && drag.startVertices) {
      onCustomZonesChange(customZones.map(z => (
        z.id === drag.customZoneId
          ? { ...z, vertices: resizeRectVertices(drag.startVertices!, drag.resizeHandle!, current.worldX, current.worldZ) }
          : z
      )))
      return
    }

    if (drag.kind === 'direct-move' && drag.templateRoiId && drag.startVertices) {
      updateTemplateRoiVertices(
        drag.templateRoiId,
        translateRectVertices(drag.startVertices, dx, dz),
      )
      return
    }

    if (drag.kind === 'direct-resize' && drag.templateRoiId && drag.resizeHandle && drag.startVertices) {
      updateTemplateRoiVertices(
        drag.templateRoiId,
        resizeRectVertices(drag.startVertices, drag.resizeHandle, current.worldX, current.worldZ),
      )
      return
    }
  }, [screenToWorld, customZones, onCustomZonesChange, updateTemplateRoiVertices])

  const handleSvgMouseUp = useCallback(() => {
    if (dragRef.current?.kind === 'draw' && drawPreview && drawPreview.length === 4) {
      const category = retailCategories.find(c => c.id === effectiveDrawCategoryId)
      if (category) {
        onCustomZonesChange([...customZones, createShelfCustomZone(drawPreview, category, customZones.length)])
        setSelectedCustomZoneId(null)
      }
    }
    if (dragRef.current?.kind === 'direct-move' || dragRef.current?.kind === 'direct-resize') {
      commitPendingSave()
    }
    dragRef.current = null
    setDrawPreview(null)
  }, [drawPreview, retailCategories, effectiveDrawCategoryId, customZones, onCustomZonesChange, commitPendingSave])

  const templateHandles = selectedTemplateRoi && mapTool === 'select' && !selectedCustomZoneId
    ? getRectHandlePositions(selectedTemplateRoi.vertices)
    : null
  const customHandles = selectedCustomZone && mapTool === 'select'
    ? getRectHandlePositions(selectedCustomZone.vertices)
    : null

  return (
    <div className="grid grid-cols-5 gap-5">
      <div className="col-span-2 space-y-4 max-h-[640px] overflow-y-auto pr-1">
        {isEditingExisting && (
          <div className="bg-purple-900/20 border border-purple-700/50 rounded-lg px-3 py-2 text-xs text-purple-200">
            Click a zone to select it. Drag to move, edge handles to resize. Each change saves automatically.
          </div>
        )}

        {unsavedCount > 0 && (
          <div className="bg-amber-900/25 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-100 space-y-2">
            <p>{unsavedCount} zone{unsavedCount === 1 ? '' : 's'} not in the layout yet. Edit one to save it individually, or create all at once.</p>
            <button
              onClick={() => void onCreateAllZones()}
              disabled={creatingAll || loading}
              className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded flex items-center gap-1 disabled:opacity-50"
            >
              {creatingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
              Create all {liveRois.length} zones in layout
            </button>
          </div>
        )}

        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
          <label className="text-xs text-gray-400 block mb-1.5">Focus shelf (map navigation)</label>
          <select
            value={referenceFixtureId}
            onChange={(e) => { onReferenceChange(e.target.value); setViewMode('focus'); setSelectedCustomZoneId(null) }}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
          >
            {sortedFixtures.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        <div className="bg-teal-900/20 border border-teal-700/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-sm font-medium text-teal-100">Custom category zones</span>
          </div>
          <label className="text-xs text-gray-400 block">Grocery category (from mapping config)</label>
          <select
            value={effectiveDrawCategoryId}
            onChange={(e) => setDrawCategoryId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
          >
            {retailCategories.length === 0 && <option value="">No categories loaded</option>}
            {retailCategories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={() => setMapTool(mapTool === 'draw' ? 'select' : 'draw')}
            disabled={!effectiveDrawCategoryId}
            className={`w-full text-xs px-3 py-2 rounded flex items-center justify-center gap-1.5 ${
              mapTool === 'draw'
                ? 'bg-teal-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            } disabled:opacity-50`}
          >
            <PenSquare className="w-3.5 h-3.5" />
            {mapTool === 'draw' ? 'Drawing rectangle… drag on map' : 'Draw custom rectangle'}
          </button>
          {customZones.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-teal-800/40">
              {customZones.map((zone) => (
                <div
                  key={zone.id}
                  className={`rounded px-2 py-1.5 text-xs border ${
                    selectedCustomZoneId === zone.id
                      ? 'border-teal-500 bg-teal-900/30'
                      : 'border-gray-700 bg-gray-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="text-left text-gray-200 truncate flex-1"
                      onClick={() => { setSelectedCustomZoneId(zone.id); setMapTool('select') }}
                    >
                      {zone.business_category_label || zone.name}
                    </button>
                    <button
                      onClick={() => removeCustomZone(zone.id)}
                      className="text-red-400 hover:text-red-300 shrink-0"
                      title="Remove zone"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <select
                    value={zone.business_category_id}
                    onChange={(e) => updateCustomZoneCategory(zone.id, e.target.value)}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-white"
                  >
                    {retailCategories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedTemplateRoi && selectedZoneCalibration && !selectedCustomZoneId && (
          <>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-white truncate">{selectedTemplateRoi.name}</span>
                <SaveStatusBadge status={roiSaveStatus[selectedTemplateRoi.id]} />
              </div>
              {!isShelfRoiInLayout(selectedTemplateRoi.id, persistedShelfRoiIds) && (
                <p className="text-[10px] text-amber-300">Not saved yet — finish editing to autosave</p>
              )}
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <RotateCw className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-sm font-medium text-white">Selected zone</span>
              </div>
              <CalibrationSlider label="Width (along shelf)" value={selectedZoneCalibration.width} min={0.5} max={8} step={0.1} unit="m" accentClass="text-purple-400" onChange={(v) => updateZone('width', v)} onCommit={commitPendingSave} />
              <CalibrationSlider label="Depth (into aisle)" value={selectedZoneCalibration.depth} min={0.5} max={12} step={0.1} unit="m" accentClass="text-purple-400" onChange={(v) => updateZone('depth', v)} onCommit={commitPendingSave} />
              <CalibrationSlider label="Along shelf" value={selectedZoneCalibration.alongCounter} min={-6} max={6} step={0.1} unit="m" accentClass="text-green-400" onChange={(v) => updateZone('alongCounter', v)} onCommit={commitPendingSave} />
              <CalibrationSlider label="From shelf" value={selectedZoneCalibration.fromCounter} min={-6} max={12} step={0.1} unit="m" accentClass="text-green-400" onChange={(v) => updateZone('fromCounter', v)} onCommit={commitPendingSave} />
              <CalibrationSlider label="Rotation" value={selectedZoneCalibration.rotationOffset} min={-180} max={180} step={1} unit="°" accentClass="text-amber-400" onChange={(v) => updateZone('rotationOffset', v)} onCommit={commitPendingSave} />
            </div>
            <button
              onClick={() => onCopyZoneToAllSimilar(selectedTemplateRoi.id)}
              className="w-full text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-100 rounded flex items-center justify-center gap-1.5"
            >
              <Copy className="w-3 h-3" />
              Copy this size to all {parseShelfRoiZoneType(selectedTemplateRoi)} zones
            </button>
          </>
        )}

        {!selectedTemplateRoi && !selectedCustomZoneId && (
          <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-3 text-xs text-gray-400">
            Select one zone on the map to adjust size with sliders, or drag handles directly.
          </div>
        )}

        {selectedCustomZone && (
          <div className="bg-teal-900/20 border border-teal-700/50 rounded-lg p-3 text-xs text-teal-100 space-y-1">
            <p className="font-medium">{selectedCustomZone.business_category_label}</p>
            <p className="text-teal-200/70">Drag to move · edge handles to resize · change category above</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={onResetToAuto} disabled={loading} className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded flex items-center gap-1 disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Reset all to auto
          </button>
        </div>

        {(isEditingExisting || liveRois.length > 0 || customZones.length > 0) && (
          <button onClick={onDeleteAll} disabled={deleting || loading} className="w-full text-xs px-3 py-2 bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-300 rounded flex items-center justify-center gap-1.5 disabled:opacity-50">
            {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            Delete all shelf zones (template + custom)
          </button>
        )}

        <div className="text-[10px] text-gray-500 space-y-1">
          <p className="text-green-400/90">Changes autosave per zone when you finish dragging or release a slider</p>
          <p>Teal = custom category · purple/amber = shelf engagement zones</p>
          <p className="text-gray-500">⌘+click multi-select · Delete removes selected zones</p>
        </div>
      </div>

      <div className="col-span-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Eye className="w-4 h-4 text-purple-400" />
            Shelf zone map
            <span className="text-[10px] text-gray-500 font-normal">
              ({liveRois.length} template · {customZones.length} custom · {displayFixtures.length} fixtures)
            </span>
          </h3>
          <div className="flex items-center gap-1">
            <button onClick={() => setMapTool('select')} className={`p-1 rounded ${mapTool === 'select' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`} title="Select"><MousePointer2 className="w-3.5 h-3.5" /></button>
            <button onClick={() => setMapTool('draw')} disabled={!effectiveDrawCategoryId} className={`p-1 rounded ${mapTool === 'draw' ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-400'} disabled:opacity-40`} title="Draw rectangle"><PenSquare className="w-3.5 h-3.5" /></button>
            <button onClick={() => setMapTool('pan')} className={`p-1 rounded ${mapTool === 'pan' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`} title="Pan"><Move className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('focus')} className={`text-[10px] px-2 py-1 rounded ${viewMode === 'focus' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}>Focus</button>
            <button onClick={() => { setViewMode('all'); setPanOffset({ x: 0, z: 0 }); setZoom(1) }} className={`text-[10px] px-2 py-1 rounded ${viewMode === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400'}`}>All</button>
            <button
              onClick={deleteSelectedTemplateRois}
              disabled={selectedTemplateRoiIds.size === 0 || mapTool !== 'select'}
              className="text-[10px] px-2 py-1 rounded bg-red-900/50 hover:bg-red-900/70 border border-red-800 text-red-300 disabled:opacity-40 flex items-center gap-1"
              title="Delete selected template zones (Delete key)"
            >
              <Trash2 className="w-3 h-3" />
              Delete{selectedTemplateRoiIds.size > 0 ? ` (${selectedTemplateRoiIds.size})` : ''}
            </button>
            <button onClick={() => setZoom(z => Math.min(4, z * 1.2))} className="p-1 rounded bg-gray-700 text-gray-400 hover:text-white"><ZoomIn className="w-3.5 h-3.5" /></button>
            <button onClick={() => setZoom(z => Math.max(0.35, z / 1.2))} className="p-1 rounded bg-gray-700 text-gray-400 hover:text-white"><ZoomOut className="w-3.5 h-3.5" /></button>
            <button onClick={() => { setPanOffset({ x: 0, z: 0 }); setZoom(1) }} className="text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-400 hover:text-white">Reset</button>
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden relative" style={{ height: 560 }}>
          <svg
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className={`w-full h-full ${mapTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : mapTool === 'draw' ? 'cursor-crosshair' : 'cursor-default'}`}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
            onWheel={handleWheel}
          >
            <defs>
              <pattern id="shelfCalGrid" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#374151" strokeWidth="0.03" />
              </pattern>
            </defs>
            <rect x={bounds.minX} y={bounds.minZ} width={bounds.maxX - bounds.minX} height={bounds.maxZ - bounds.minZ} fill="url(#shelfCalGrid)" />

            {displayFixtures.map(fixture => (
              <FixtureFootprint
                key={fixture.id}
                fixture={fixture}
                highlighted={fixture.id === referenceFixtureId && !selectedCustomZoneId}
                dimmed={viewMode === 'focus' && fixture.id !== referenceFixtureId && !selectedCustomZoneId}
                hasRoiTarget={fixtureHasRoiTarget(fixture, sortedFixtures)}
                onSelect={() => { onReferenceChange(fixture.id); setSelectedCustomZoneId(null) }}
              />
            ))}

            {displayRois.map(roi => {
              if (roi.vertices.length < 3) return null
              const zoneType = parseTemplateRoiZoneType(roi)
              const isSelected = selectedTemplateRoiIds.has(roi.id)
              const pathD = `M ${roi.vertices.map(v => `${v.x},${v.z}`).join(' L ')} Z`
              return (
                <g key={roi.id} data-zone-type={zoneType} data-roi-id={roi.id}>
                  <path
                    d={pathD}
                    fill={roi.color}
                    fillOpacity={isSelected ? 0.55 : 0.28}
                    stroke={isSelected ? '#ffffff' : roi.color}
                    strokeWidth={isSelected ? 0.11 : 0.04}
                    style={{ cursor: mapTool === 'select' ? 'move' : undefined }}
                  />
                </g>
              )
            })}

            {(viewMode === 'all' ? customPreviewRois : customPreviewRois).map(roi => {
              const zone = customZones.find(z => z.id === roi.id)
              if (!zone) return null
              const isSelected = selectedCustomZoneId === zone.id
              const pathD = `M ${roi.vertices.map(v => `${v.x},${v.z}`).join(' L ')} Z`
              const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
              const cz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
              return (
                <g key={roi.id} data-custom-zone-id={zone.id}>
                  <path
                    d={pathD}
                    fill={roi.color}
                    fillOpacity={isSelected ? 0.62 : 0.4}
                    stroke={isSelected ? '#5eead4' : roi.color}
                    strokeWidth={isSelected ? 0.1 : 0.06}
                    style={{ cursor: mapTool === 'select' ? 'move' : undefined }}
                  />
                  <text x={cx} y={cz} textAnchor="middle" dominantBaseline="middle" fontSize={0.32} fill="#ecfdf5" pointerEvents="none">
                    {zone.business_category_label}
                  </text>
                </g>
              )
            })}

            {drawPreview && (
              <path
                d={`M ${drawPreview.map(v => `${v.x},${v.z}`).join(' L ')} Z`}
                fill="#14b8a6"
                fillOpacity={0.25}
                stroke="#5eead4"
                strokeWidth={0.06}
                strokeDasharray="0.15 0.1"
                pointerEvents="none"
              />
            )}

            {templateHandles && selectedTemplateRoi && mapTool === 'select' && !selectedCustomZoneId && (
              (Object.entries(templateHandles) as [ResizeHandle, { x: number; z: number }][]).map(([handle, pos]) => (
                <rect
                  key={`tpl-${handle}`}
                  data-resize-handle={handle}
                  data-template-roi-id={selectedTemplateRoi.id}
                  x={pos.x - 0.12}
                  y={pos.z - 0.12}
                  width={0.24}
                  height={0.24}
                  fill="#fff"
                  stroke={selectedTemplateRoi.color}
                  strokeWidth={0.04}
                />
              ))
            )}

            {customHandles && selectedCustomZoneId && (
              (Object.entries(customHandles) as [ResizeHandle, { x: number; z: number }][]).map(([handle, pos]) => (
                <rect
                  key={`cst-${handle}`}
                  data-resize-handle={handle}
                  data-custom-id={selectedCustomZoneId}
                  x={pos.x - 0.12}
                  y={pos.z - 0.12}
                  width={0.24}
                  height={0.24}
                  fill="#fff"
                  stroke="#14b8a6"
                  strokeWidth={0.04}
                />
              ))
            )}
          </svg>

          <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 text-[10px] text-gray-400 bg-gray-900/90 px-2 py-1 rounded max-w-[95%]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-900/80 border-2 border-purple-400" /> Shelf</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-950/80 border-2 border-cyan-400" /> Fridge</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-950/80 border-2 border-amber-400" /> Banco</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-purple-500/60 border border-purple-500" /> Left / Front</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500/60 border border-amber-500" /> Right zone</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-teal-500/60 border border-teal-500" /> Custom</span>
            <span className="text-gray-500">Zoom {(zoom * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
