/**
 * FixtureClassifyModal — "Classify by Example" modal
 *
 * Click a fixture → assign a type → all similar fixtures (same DWG group
 * + geometry-matched fixtures across groups) inherit that classification.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { X, ZoomIn, ZoomOut, RotateCcw, Save, Loader2 } from 'lucide-react'
import type { MiniFixture, MiniClassification } from './MiniDwgViewport'
import * as api from './launchpadApi'

// ─── Constants ───────────────────────────────────────────────────

// Color map shared between LaunchPad and DWG Importer for visual consistency
const TYPE_COLOR_MAP: Record<string, string> = {
  shelf: '#60a5fa',
  fridge: '#22d3ee',
  wall: '#9ca3af',
  checkout: '#c084fc',
  entrance: '#34d399',
  pillar: '#94a3b8',
  digital_display: '#a78bfa',
  radio: '#06b6d4',
  custom: '#fbbf24',
}

type FixtureType = string

interface CatalogAssetItem {
  id: string
  name: string
  type: string
  hasCustomModel: boolean
}

const GEOMETRY_TOLERANCE = 0.05 // 5% size tolerance for geometry matching

// ─── Helpers ─────────────────────────────────────────────────────

function calcBounds(fixtures: MiniFixture[]) {
  if (fixtures.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 }

  // Use median + MAD for outlier-resistant bounds
  if (fixtures.length >= 20) {
    const xs = fixtures.map(f => f.x).sort((a, b) => a - b)
    const ys = fixtures.map(f => f.y).sort((a, b) => a - b)
    const n = xs.length
    const medX = xs[Math.floor(n / 2)]
    const medY = ys[Math.floor(n / 2)]
    const devX = fixtures.map(f => Math.abs(f.x - medX)).sort((a, b) => a - b)
    const devY = fixtures.map(f => Math.abs(f.y - medY)).sort((a, b) => a - b)
    const madX = devX[Math.floor(n / 2)]
    const madY = devY[Math.floor(n / 2)]
    const s = 6
    return {
      minX: medX - s * Math.max(madX, 1),
      minY: medY - s * Math.max(madY, 1),
      maxX: medX + s * Math.max(madX, 1),
      maxY: medY + s * Math.max(madY, 1),
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const f of fixtures) {
    const hw = Math.abs(f.w) / 2, hd = Math.abs(f.d) / 2
    minX = Math.min(minX, f.x - hw)
    minY = Math.min(minY, f.y - hd)
    maxX = Math.max(maxX, f.x + hw)
    maxY = Math.max(maxY, f.y + hd)
  }
  return { minX, minY, maxX, maxY }
}

/** Find all fixtures matching by group OR geometry similarity */
function findSimilarFixtures(
  target: MiniFixture,
  allFixtures: MiniFixture[],
): Set<string> {
  const matched = new Set<string>()
  const tw = Math.abs(target.w)
  const td = Math.abs(target.d)

  for (const f of allFixtures) {
    // Group match — same group_id
    if (target.group_id && f.group_id && target.group_id === f.group_id) {
      matched.add(f.id)
      continue
    }
    // Geometry match — same w×d within tolerance (check both orientations)
    const fw = Math.abs(f.w)
    const fd = Math.abs(f.d)
    if (tw > 0 && td > 0 && fw > 0 && fd > 0) {
      const matchNormal = Math.abs(fw - tw) / tw <= GEOMETRY_TOLERANCE && Math.abs(fd - td) / td <= GEOMETRY_TOLERANCE
      const matchRotated = Math.abs(fw - td) / td <= GEOMETRY_TOLERANCE && Math.abs(fd - tw) / tw <= GEOMETRY_TOLERANCE
      if (matchNormal || matchRotated) {
        matched.add(f.id)
      }
    }
  }
  matched.add(target.id)
  return matched
}

// ─── Props ───────────────────────────────────────────────────────

interface FixtureClassifyModalProps {
  fixtures: MiniFixture[]
  importId: string
  existingClassifications?: MiniClassification[]
  onClose: () => void
  onSave: (classifications: MiniClassification[]) => void
}

// ─── Component ───────────────────────────────────────────────────

export default function FixtureClassifyModal({
  fixtures,
  importId,
  existingClassifications,
  onClose,
  onSave,
}: FixtureClassifyModalProps) {
  // Load catalog assets from API (same source as DWG Importer MappingPanel)
  const [catalogAssets, setCatalogAssets] = useState<CatalogAssetItem[]>([])
  useEffect(() => {
    api.getCatalogAssets().then(assets => {
      setCatalogAssets(assets)
    }).catch(err => {
      console.warn('[FixtureClassify] Failed to load catalog:', err)
      // Fallback to hardcoded types if API fails
      setCatalogAssets([
        { id: 'shelf', name: 'Shelf', type: 'shelf', hasCustomModel: false },
        { id: 'fridge', name: 'Fridge', type: 'fridge', hasCustomModel: false },
        { id: 'wall', name: 'Wall', type: 'wall', hasCustomModel: false },
        { id: 'checkout', name: 'Checkout', type: 'checkout', hasCustomModel: false },
        { id: 'entrance', name: 'Entrance', type: 'entrance', hasCustomModel: false },
        { id: 'pillar', name: 'Pillar', type: 'pillar', hasCustomModel: false },
        { id: 'digital_display', name: 'Digital Display', type: 'digital_display', hasCustomModel: false },
        { id: 'custom', name: 'Custom', type: 'custom', hasCustomModel: false },
      ])
    })
  }, [])

  // Classification state: fixtureId → type
  const [fixtureTypes, setFixtureTypes] = useState<Map<string, FixtureType>>(() => {
    const map = new Map<string, FixtureType>()
    // Seed from existing classifications
    if (existingClassifications) {
      for (const c of existingClassifications) {
        for (const f of fixtures) {
          if (f.group_id === c.groupId) {
            map.set(f.id, c.suggestedType as FixtureType)
          }
        }
      }
    }
    return map
  })

  // Selected fixture
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Highlighted (preview) fixtures before committing
  const [previewMatches, setPreviewMatches] = useState<Set<string>>(new Set())

  // Saving
  const [saving, setSaving] = useState(false)

  // Zoom & pan
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Bounds
  const bounds = useMemo(() => calcBounds(fixtures), [fixtures])
  const pad = Math.max((bounds.maxX - bounds.minX), (bounds.maxY - bounds.minY)) * 0.06
  const baseVb = {
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    w: (bounds.maxX - bounds.minX) + pad * 2,
    h: (bounds.maxY - bounds.minY) + pad * 2,
  }
  const sw = Math.max(baseVb.w, baseVb.h) * 0.003

  // Zoomed viewBox
  const vb = useMemo(() => {
    const w = baseVb.w / zoom
    const h = baseVb.h / zoom
    const cx = baseVb.x + baseVb.w / 2 + pan.x
    const cy = baseVb.y + baseVb.h / 2 + pan.y
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }, [baseVb, zoom, pan])

  // Unique groups + stats
  const stats = useMemo(() => {
    const groupSet = new Set<string>()
    const classifiedGroups = new Set<string>()
    for (const f of fixtures) {
      if (f.group_id) {
        groupSet.add(f.group_id)
        if (fixtureTypes.has(f.id)) classifiedGroups.add(f.group_id)
      }
    }
    const classifiedCount = fixtureTypes.size
    return {
      totalFixtures: fixtures.length,
      classifiedFixtures: classifiedCount,
      totalGroups: groupSet.size,
      classifiedGroups: classifiedGroups.size,
    }
  }, [fixtures, fixtureTypes])

  // ─── Handlers ──────────────────────────────────────────────────

  const handleFixtureClick = useCallback((f: MiniFixture) => {
    if (dragging) return
    setSelectedId(f.id)
    // Preview matches
    const matches = findSimilarFixtures(f, fixtures)
    setPreviewMatches(matches)
  }, [fixtures, dragging])

  const handleAssignType = useCallback((type: FixtureType) => {
    if (!selectedId) return
    const target = fixtures.find(f => f.id === selectedId)
    if (!target) return

    const matches = findSimilarFixtures(target, fixtures)
    setFixtureTypes(prev => {
      const next = new Map(prev)
      for (const fid of matches) {
        next.set(fid, type)
      }
      return next
    })

    setSelectedId(null)
    setPreviewMatches(new Set())
  }, [selectedId, fixtures])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // Build group_mappings from fixture type assignments
      const groupMappings: Record<string, { type: string; catalog_asset_id: string; anchor: string; scale_multiplier: number; rotation_offset_deg: number }> = {}
      for (const f of fixtures) {
        const type = fixtureTypes.get(f.id)
        if (type && f.group_id && !groupMappings[f.group_id]) {
          groupMappings[f.group_id] = {
            type,
            catalog_asset_id: type, // Use type as asset ID for now
            anchor: 'center',
            scale_multiplier: 1,
            rotation_offset_deg: 0,
          }
        }
      }

      await api.saveMapping(importId, { group_mappings: groupMappings })

      // Build classifications for the parent
      const classifications: MiniClassification[] = Object.entries(groupMappings).map(([gid, m]) => ({
        groupId: gid,
        suggestedType: m.type,
        confidence: 1.0, // Manual = 100% confidence
      }))

      onSave(classifications)
    } catch (err: any) {
      console.error('[FixtureClassify] Save failed:', err)
      alert('Failed to save classifications: ' + (err.message || 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }, [fixtures, fixtureTypes, importId, onSave])

  // Zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setZoom(z => Math.max(0.5, Math.min(50, z * factor)))
  }, [])

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const scaleX = baseVb.w / zoom / rect.width
    const scaleY = baseVb.h / zoom / rect.height
    const dx = (e.clientX - dragStart.current.x) * scaleX
    const dy = (e.clientY - dragStart.current.y) * scaleY
    setPan({ x: dragStart.current.panX - dx, y: dragStart.current.panY - dy })
  }, [dragging, zoom, baseVb])

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  useEffect(() => {
    const up = () => setDragging(false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  // ─── Fixture color based on assigned type ──────────────────────

  const getColor = useCallback((f: MiniFixture) => {
    if (selectedId === f.id) return '#ffffff'
    if (previewMatches.has(f.id)) return '#facc15' // yellow highlight
    const type = fixtureTypes.get(f.id)
    if (type) return TYPE_COLOR_MAP[type] || '#374151'
    return '#374151'
  }, [selectedId, previewMatches, fixtureTypes])

  const getOpacity = useCallback((f: MiniFixture) => {
    if (selectedId === f.id) return 1
    if (previewMatches.has(f.id)) return 0.9
    if (fixtureTypes.has(f.id)) return 0.7
    return 0.35
  }, [selectedId, previewMatches, fixtureTypes])

  // ─── Render ────────────────────────────────────────────────────

  const selectedFixture = selectedId ? fixtures.find(f => f.id === selectedId) : null
  const matchCount = previewMatches.size

  return (
    <div className="fixed inset-0 z-[100] flex bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex flex-1 m-4 bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── Main viewport ─── */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-200 font-medium">Classify by Example</span>
              <span className="text-[10px] text-gray-500">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setZoom(z => Math.min(50, z * 1.5))} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Zoom In">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setZoom(z => Math.max(0.5, z / 1.5))} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Zoom Out">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button onClick={resetView} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Reset View">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-5 bg-gray-800 mx-1" />
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* SVG area */}
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden relative"
            style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <svg
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-full"
              style={{ background: '#0a0a0f' }}
            >
              {fixtures.map(f => {
                const color = getColor(f)
                const opacity = getOpacity(f)
                const isSelected = f.id === selectedId
                const strokeW = isSelected ? sw / zoom * 3 : sw / zoom

                if (f.points && f.points.length >= 3) {
                  const pts = f.points.map(p => `${p.x},${p.y}`).join(' ')
                  return (
                    <polygon
                      key={f.id}
                      points={pts}
                      fill={color}
                      fillOpacity={opacity * 0.6}
                      stroke={color}
                      strokeWidth={strokeW}
                      strokeOpacity={opacity}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); handleFixtureClick(f) }}
                    />
                  )
                }

                const absW = Math.abs(f.w) || 1
                const absD = Math.abs(f.d) || 1
                return (
                  <rect
                    key={f.id}
                    x={-absW / 2}
                    y={-absD / 2}
                    width={absW}
                    height={absD}
                    fill={color}
                    fillOpacity={opacity * 0.6}
                    stroke={color}
                    strokeWidth={strokeW}
                    strokeOpacity={opacity}
                    transform={`translate(${f.x}, ${f.y}) rotate(${f.rot_deg || 0})`}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); handleFixtureClick(f) }}
                  />
                )
              })}
            </svg>

            {/* Hint bar */}
            <div className="absolute bottom-2 left-3 text-[9px] text-gray-600 pointer-events-none">
              Click a fixture to classify · Scroll to zoom · Drag to pan
            </div>
          </div>
        </div>

        {/* ─── Right sidebar ─── */}
        <div className="w-64 border-l border-gray-800 bg-gray-900/50 flex flex-col shrink-0">
          {/* Progress */}
          <div className="p-4 border-b border-gray-800">
            <div className="text-[11px] text-gray-400 font-medium mb-2">Classification Progress</div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-gray-500">
                {stats.classifiedFixtures} / {stats.totalFixtures} fixtures
              </span>
              <span className="text-gray-500">
                {stats.classifiedGroups} / {stats.totalGroups} groups
              </span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${stats.totalFixtures > 0 ? (stats.classifiedFixtures / stats.totalFixtures) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Selected fixture info + type picker */}
          <div className="p-4 border-b border-gray-800 min-h-[200px]">
            {selectedFixture ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Selected Fixture</div>
                  <div className="text-[11px] text-gray-300">
                    {selectedFixture.group_id ? `Group: ${selectedFixture.group_id.slice(0, 12)}…` : 'No group'}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Size: {Math.abs(selectedFixture.w).toFixed(0)} × {Math.abs(selectedFixture.d).toFixed(0)}
                  </div>
                  <div className="text-[10px] text-amber-400 mt-1">
                    {matchCount} similar fixtures found
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Assign Type (3D Asset)</div>
                  <div className="space-y-1">
                    {catalogAssets.map(asset => (
                      <button
                        key={asset.id}
                        onClick={() => handleAssignType(asset.type)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] text-gray-300 hover:bg-gray-800 transition-colors text-left"
                      >
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ background: TYPE_COLOR_MAP[asset.type] || '#fbbf24' }}
                        />
                        {asset.name}
                        {asset.hasCustomModel && <span className="text-[9px] text-indigo-400 ml-auto">(3D)</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-[11px] text-gray-600">
                Click a fixture on the floor plan to classify it
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Legend</div>
            <div className="space-y-1">
              {catalogAssets.map(asset => {
                const count = Array.from(fixtureTypes.values()).filter(v => v === asset.type).length
                if (count === 0) return null
                return (
                  <div key={asset.id} className="flex items-center gap-2 text-[10px]">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: TYPE_COLOR_MAP[asset.type] || '#fbbf24' }} />
                    <span className="text-gray-400 flex-1">{asset.name}</span>
                    <span className="text-gray-600">{count}</span>
                  </div>
                )
              })}
              {(() => {
                const unclassified = fixtures.length - fixtureTypes.size
                if (unclassified <= 0) return null
                return (
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-gray-700" />
                    <span className="text-gray-500 flex-1">Unclassified</span>
                    <span className="text-gray-600">{unclassified}</span>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Save button */}
          <div className="p-4 border-t border-gray-800">
            <button
              onClick={handleSave}
              disabled={saving || fixtureTypes.size === 0}
              className="w-full h-9 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[12px] font-medium rounded-lg transition-colors"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                <><Save className="w-4 h-4" /> Save Classifications</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
