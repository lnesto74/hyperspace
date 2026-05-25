import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Check,
  Eye,
  Loader2,
  Move,
  RefreshCw,
  RotateCw,
  Target,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  CheckoutCalibration,
  FixtureInfo,
  PreviewRoiLike,
  ZoneCalibration,
  computeMapBounds,
  extractCheckoutCalibration,
  findRoiForFixture,
  focusBoundsAroundFixture,
  getFixtureAxes,
  getFixtureFootprintBounds,
  getFixtureOutlinePoints,
  sortFixtures,
} from './checkoutCalibrationUtils'

interface CheckoutCalibrationPanelProps {
  fixtures: FixtureInfo[]
  previewRois: PreviewRoiLike[]
  calibration: CheckoutCalibration
  referenceFixtureId: string
  validated: boolean
  appliedToAll: boolean
  loading: boolean
  onReferenceChange: (fixtureId: string) => void
  onCalibrationChange: (calibration: CheckoutCalibration) => void
  onResetToAuto: () => void
  onValidate: () => void
  onApplyToAll: () => void
}

type ZoneType = 'service' | 'queue'
type ViewMode = 'focus' | 'all'

const ZONE_META: Record<ZoneType, { label: string; color: string }> = {
  service: { label: 'Service', color: '#22c55e' },
  queue: { label: 'Queue', color: '#ef4444' },
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
  onCommit: () => void
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
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  )
}

function FixtureFootprint({
  fixture,
  highlighted,
  dimmed,
}: {
  fixture: FixtureInfo
  highlighted?: boolean
  dimmed?: boolean
}) {
  const outline = getFixtureOutlinePoints(fixture)
  const bounds = getFixtureFootprintBounds(fixture)
  const pointsStr = outline.map(p => `${p.x},${p.z}`).join(' ')
  const labelY = bounds.minZ - 0.35
  const labelX = (bounds.minX + bounds.maxX) / 2
  const hasPolygon = (fixture.footprintPoints?.length ?? 0) >= 3

  return (
    <g opacity={dimmed ? 0.35 : 1}>
      <polygon
        points={pointsStr}
        fill={highlighted ? '#164e63' : '#1e293b'}
        fillOpacity={highlighted ? 0.55 : 0.35}
        stroke={highlighted ? '#22d3ee' : '#06b6d4'}
        strokeWidth={highlighted ? 0.07 : 0.05}
        strokeLinejoin="round"
      />
      {highlighted && (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          fontSize={0.35}
          fill="#a5f3fc"
        >
          {fixture.name}
        </text>
      )}
      {!hasPolygon && highlighted && (
        <text
          x={labelX}
          y={labelY - 0.45}
          textAnchor="middle"
          fontSize={0.28}
          fill="#64748b"
        >
          (no DWG polygon — using box fallback)
        </text>
      )}
    </g>
  )
}

export default function CheckoutCalibrationPanel({
  fixtures,
  previewRois,
  calibration,
  referenceFixtureId,
  validated,
  appliedToAll,
  loading,
  onReferenceChange,
  onCalibrationChange,
  onResetToAuto,
  onValidate,
  onApplyToAll,
}: CheckoutCalibrationPanelProps) {
  const [selectedZone, setSelectedZone] = useState<ZoneType>('service')
  const [viewMode, setViewMode] = useState<ViewMode>('focus')
  const [panning, setPanning] = useState(false)
  const [panOffset, setPanOffset] = useState({ x: 0, z: 0 })
  const dragRef = useRef<{
    mode: 'pan' | 'move'
    startX: number
    startY: number
    startPanX: number
    startPanZ: number
    startAlong: number
    startFrom: number
    svgRect: DOMRect
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  } | null>(null)

  const sortedFixtures = useMemo(() => sortFixtures(fixtures), [fixtures])
  const referenceFixture = sortedFixtures.find(f => f.id === referenceFixtureId) ?? sortedFixtures[0]
  const zoneConfig = calibration[selectedZone]

  const displayRois = useMemo(() => {
    if (viewMode === 'all') return previewRois
    if (!referenceFixture) return previewRois
    return previewRois.filter(roi => {
      const service = findRoiForFixture(previewRois, fixtures, referenceFixture.id, 'service')
      const queue = findRoiForFixture(previewRois, fixtures, referenceFixture.id, 'queue')
      return roi.id === service?.id || roi.id === queue?.id
    })
  }, [viewMode, previewRois, referenceFixture, fixtures])

  const bounds = useMemo(() => {
    const footprintPts = fixtures.flatMap(f => getFixtureOutlinePoints(f))
    const points = [
      ...displayRois.flatMap(r => r.vertices),
      ...footprintPts,
    ]
    const base = viewMode === 'focus' && referenceFixture
      ? focusBoundsAroundFixture(referenceFixture, 7)
      : computeMapBounds(points)
    return {
      minX: base.minX + panOffset.x,
      maxX: base.maxX + panOffset.x,
      minZ: base.minZ + panOffset.z,
      maxZ: base.maxZ + panOffset.z,
    }
  }, [displayRois, fixtures, viewMode, referenceFixture, panOffset])

  const viewBox = `${bounds.minX} ${bounds.minZ} ${bounds.maxX - bounds.minX} ${bounds.maxZ - bounds.minZ}`

  const updateZone = useCallback((field: keyof ZoneCalibration, value: number) => {
    onCalibrationChange({
      ...calibration,
      [selectedZone]: { ...calibration[selectedZone], [field]: value },
    })
  }, [calibration, onCalibrationChange, selectedZone])

  const handleCommit = useCallback(() => {
    onApplyToAll()
  }, [onApplyToAll])

  const screenToWorld = useCallback((clientX: number, clientY: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect()
    const relX = (clientX - rect.left) / rect.width
    const relY = (clientY - rect.top) / rect.height
    const b = dragRef.current?.bounds ?? bounds
    const worldX = b.minX + relX * (b.maxX - b.minX)
    const worldZ = b.minZ + relY * (b.maxZ - b.minZ)
    return { worldX, worldZ }
  }, [bounds])

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    if (panning) {
      dragRef.current = {
        mode: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPanX: panOffset.x,
        startPanZ: panOffset.z,
        startAlong: 0,
        startFrom: 0,
        svgRect: svg.getBoundingClientRect(),
        bounds,
      }
      return
    }

    if (viewMode !== 'focus' || !referenceFixture) return
    const target = (e.target as SVGElement).closest('[data-zone-type]')
    if (!target) return
    const zoneType = target.getAttribute('data-zone-type') as ZoneType
    if (zoneType) setSelectedZone(zoneType)

    dragRef.current = {
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      startPanX: panOffset.x,
      startPanZ: panOffset.z,
      startAlong: calibration[zoneType || selectedZone].alongCounter,
      startFrom: calibration[zoneType || selectedZone].fromCounter,
      svgRect: svg.getBoundingClientRect(),
      bounds,
    }
  }, [panning, panOffset, bounds, viewMode, referenceFixture, calibration, selectedZone])

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current) return
    const svg = e.currentTarget

    if (dragRef.current.mode === 'pan') {
      const rect = svg.getBoundingClientRect()
      const b = dragRef.current.bounds
      const dx = ((e.clientX - dragRef.current.startX) / rect.width) * (b.maxX - b.minX)
      const dz = ((e.clientY - dragRef.current.startY) / rect.height) * (b.maxZ - b.minZ)
      setPanOffset({
        x: dragRef.current.startPanX - dx,
        z: dragRef.current.startPanZ - dz,
      })
      return
    }

    if (!referenceFixture) return
    const start = screenToWorld(dragRef.current.startX, dragRef.current.startY, svg)
    const current = screenToWorld(e.clientX, e.clientY, svg)
    const { alongX, alongZ, fromX, fromZ } = getFixtureAxes(referenceFixture, fixtures)
    const dx = current.worldX - start.worldX
    const dz = current.worldZ - start.worldZ
    const deltaAlong = dx * alongX + dz * alongZ
    const deltaFrom = dx * fromX + dz * fromZ

    onCalibrationChange({
      ...calibration,
      [selectedZone]: {
        ...calibration[selectedZone],
        alongCounter: dragRef.current.startAlong + deltaAlong,
        fromCounter: dragRef.current.startFrom + deltaFrom,
      },
    })
  }, [referenceFixture, screenToWorld, calibration, selectedZone, onCalibrationChange])

  const handleSvgMouseUp = useCallback(() => {
    if (dragRef.current?.mode === 'move') {
      handleCommit()
    }
    dragRef.current = null
  }, [handleCommit])

  const referenceService = referenceFixture
    ? findRoiForFixture(previewRois, fixtures, referenceFixture.id, 'service')
    : undefined
  const referenceQueue = referenceFixture
    ? findRoiForFixture(previewRois, fixtures, referenceFixture.id, 'queue')
    : undefined

  return (
    <div className="grid grid-cols-5 gap-5">
      <div className="col-span-2 space-y-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
          <label className="text-xs text-gray-400 block mb-1.5">Reference checkout</label>
          <select
            value={referenceFixtureId}
            onChange={(e) => onReferenceChange(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
          >
            {sortedFixtures.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-500 mt-1.5">
            Adjust zones on this counter, then apply the template to all checkouts.
          </p>
        </div>

        <div className="flex gap-1 p-1 bg-gray-800/50 border border-gray-700 rounded-lg">
          {(['service', 'queue'] as ZoneType[]).map(type => (
            <button
              key={type}
              onClick={() => setSelectedZone(type)}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5 ${
                selectedZone === type
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ZONE_META[type].color }} />
              {ZONE_META[type].label}
            </button>
          ))}
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <RotateCw className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-sm font-medium text-white">
              {ZONE_META[selectedZone].label} — fixture-local
            </span>
          </div>

          <CalibrationSlider
            label="Width (along counter)"
            value={zoneConfig.width}
            min={0.5}
            max={6}
            step={0.1}
            unit="m"
            accentClass="text-blue-400"
            onChange={(v) => updateZone('width', v)}
            onCommit={handleCommit}
          />
          <CalibrationSlider
            label="Depth (into store)"
            value={zoneConfig.depth}
            min={0.5}
            max={10}
            step={0.1}
            unit="m"
            accentClass="text-blue-400"
            onChange={(v) => updateZone('depth', v)}
            onCommit={handleCommit}
          />
          <CalibrationSlider
            label="Along counter"
            value={zoneConfig.alongCounter}
            min={-5}
            max={5}
            step={0.1}
            unit="m"
            accentClass="text-green-400"
            onChange={(v) => updateZone('alongCounter', v)}
            onCommit={handleCommit}
          />
          <CalibrationSlider
            label="From counter"
            value={zoneConfig.fromCounter}
            min={-3}
            max={10}
            step={0.1}
            unit="m"
            accentClass="text-green-400"
            onChange={(v) => updateZone('fromCounter', v)}
            onCommit={handleCommit}
          />
          <CalibrationSlider
            label="Rotation"
            value={zoneConfig.rotationOffset}
            min={-180}
            max={180}
            step={1}
            unit="°"
            accentClass="text-amber-400"
            onChange={(v) => updateZone('rotationOffset', v)}
            onCommit={handleCommit}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={onResetToAuto}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Reset to auto
          </button>
          <button
            onClick={onValidate}
            className={`text-xs px-3 py-1.5 rounded flex items-center gap-1 ${
              validated
                ? 'bg-green-900/50 text-green-400 border border-green-700'
                : 'bg-amber-700 hover:bg-amber-600 text-white'
            }`}
          >
            <Check className="w-3 h-3" />
            {validated ? 'Template validated' : 'Validate template'}
          </button>
          <button
            onClick={onApplyToAll}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-1 disabled:opacity-50"
          >
            <Target className="w-3 h-3" />
            Apply to all
          </button>
        </div>

        <div className="text-[10px] text-gray-500 space-y-1">
          {validated && appliedToAll && (
            <p className="text-green-400 flex items-center gap-1">
              <Check className="w-3 h-3" />
              Calibrated template applied to {sortedFixtures.length} checkouts
            </p>
          )}
          {validated && !appliedToAll && (
            <p className="text-amber-400">Validated — click Apply to all to refresh every checkout preview</p>
          )}
          {!validated && (
            <p>Drag zones on the map or use sliders, then validate before generating.</p>
          )}
          <p>Focus view: drag zone to move · Pan mode: drag map · Shift not required</p>
        </div>
      </div>

      <div className="col-span-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-400" />
            Checkout zone map
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('focus')}
              className={`text-[10px] px-2 py-1 rounded ${viewMode === 'focus' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
              Focus
            </button>
            <button
              onClick={() => { setViewMode('all'); setPanOffset({ x: 0, z: 0 }) }}
              className={`text-[10px] px-2 py-1 rounded ${viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
            >
              All checkouts
            </button>
            <button
              onClick={() => setPanning(p => !p)}
              className={`p-1 rounded ${panning ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
              title="Pan map"
            >
              <Move className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setPanOffset({ x: 0, z: 0 }); setViewMode('focus') }}
              className="p-1 rounded bg-gray-700 text-gray-400 hover:text-white"
              title="Reset view"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setViewMode('all'); setPanOffset({ x: 0, z: 0 }) }}
              className="p-1 rounded bg-gray-700 text-gray-400 hover:text-white"
              title="Show all"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden relative" style={{ height: 420 }}>
          <svg
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className={`w-full h-full ${panning ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
          >
            <defs>
              <pattern id="calGrid" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#374151" strokeWidth="0.03" />
              </pattern>
            </defs>
            <rect
              x={bounds.minX}
              y={bounds.minZ}
              width={bounds.maxX - bounds.minX}
              height={bounds.maxZ - bounds.minZ}
              fill="url(#calGrid)"
            />

            {fixtures.map(fixture => (
              <FixtureFootprint
                key={fixture.id}
                fixture={fixture}
                highlighted={fixture.id === referenceFixtureId}
                dimmed={viewMode === 'focus' && fixture.id !== referenceFixtureId}
              />
            ))}

            {displayRois.map(roi => {
              if (roi.vertices.length < 3) return null
              const isService = roi.name.toLowerCase().includes('service')
              const zoneType: ZoneType = isService ? 'service' : 'queue'
              const isSelected = viewMode === 'focus' && zoneType === selectedZone
              const isReference = roi.id === referenceService?.id || roi.id === referenceQueue?.id
              const pathD = `M ${roi.vertices.map(v => `${v.x},${v.z}`).join(' L ')} Z`

              return (
                <g key={roi.id} data-zone-type={zoneType}>
                  <path
                    d={pathD}
                    fill={roi.color}
                    fillOpacity={isSelected ? 0.55 : 0.35}
                    stroke={roi.color}
                    strokeWidth={isSelected ? 0.08 : isReference ? 0.06 : 0.04}
                    strokeDasharray={viewMode === 'all' && !isReference ? '0.15 0.1' : undefined}
                    style={{ cursor: viewMode === 'focus' && !panning ? 'move' : undefined }}
                  />
                </g>
              )
            })}
          </svg>

          <div className="absolute bottom-2 left-2 flex gap-3 text-[10px] text-gray-400 bg-gray-900/80 px-2 py-1 rounded">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-green-500/60 border border-green-500" /> Service
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-red-500/60 border border-red-500" /> Queue
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 rounded-sm border border-cyan-400 bg-cyan-900/40" /> Counter (DWG shape)
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
