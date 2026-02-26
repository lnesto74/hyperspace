import { useMemo, useRef, useState, useCallback } from 'react'
import { FileText, Eye, EyeOff, Crosshair } from 'lucide-react'
import { jsPDF } from 'jspdf'
import 'svg2pdf.js'

interface LidarInstance {
  id: string
  x_m: number
  z_m: number
  mount_y_m?: number
  y_m?: number
  yaw_deg?: number
  model_id?: string
  source?: string
  range_m?: number
}

interface LidarModel {
  id: string
  name: string
  hfov_deg: number
  vfov_deg: number
  range_m: number
}

interface FloorplanData {
  imageUrl: string
  transform: {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    opacity: number
  }
  naturalWidth: number
  naturalHeight: number
  cropRect: { x: number; y: number; w: number; h: number } | null
}

interface InstallerBlueprintPanelProps {
  roiVertices: { x: number; z: number }[]
  unitScaleToM: number
  lidarInstances: LidarInstance[]
  lidarModels: LidarModel[]
  projectName?: string
  layoutVersionId?: string
  floorplan?: FloorplanData | null
}

interface BlueprintOrigin {
  x: number
  z: number
}

interface ChainDimension {
  type: 'x' | 'z'
  from: number  // start position in meters
  to: number    // end position in meters
  value: number // distance in meters
  fixedCoord: number // the Z (for x-dims) or X (for z-dims) position
}

// Dimensioning algorithm constants
const DIM_OFFSET_M = 1.2  // Distance of dimension line from ROI edge

export default function InstallerBlueprintPanel({
  roiVertices,
  unitScaleToM,
  lidarInstances,
  lidarModels,
  projectName = 'Untitled Project',
  layoutVersionId = '',
  floorplan = null
}: InstallerBlueprintPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  
  // Display toggles
  const [showFixtures, setShowFixtures] = useState(true)
  const [showCoverage, setShowCoverage] = useState(false)
  const [showLidarIds, setShowLidarIds] = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
  const [showFloorplan, setShowFloorplan] = useState(false)
  const [pageSize, setPageSize] = useState<'A3' | 'A4'>('A3')
  
  // Convert ROI to meters
  const roiInMeters = useMemo(() => {
    return roiVertices.map(v => ({
      x: v.x * unitScaleToM,
      z: v.z * unitScaleToM
    }))
  }, [roiVertices, unitScaleToM])

  // Calculate ROI bounds
  const roiBounds = useMemo(() => {
    if (roiInMeters.length === 0) return null
    const xs = roiInMeters.map(v => v.x)
    const zs = roiInMeters.map(v => v.z)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...zs) - Math.min(...zs)
    }
  }, [roiInMeters])

  // Origin at ROI min corner (default)
  const origin: BlueprintOrigin = useMemo(() => {
    if (!roiBounds) return { x: 0, z: 0 }
    return { x: roiBounds.minX, z: roiBounds.minZ }
  }, [roiBounds])

  // Convert world coords to blueprint coords (relative to origin)
  const toBlueprintCoords = useCallback((x: number, z: number) => {
    return {
      x: x - origin.x,
      z: z - origin.z
    }
  }, [origin])

  // LiDAR instances with blueprint coordinates and labels
  // Sort by Z descending (top first) then X ascending (left first) to match 2D view order
  const lidarData = useMemo(() => {
    const withCoords = lidarInstances.map(inst => {
      const bp = toBlueprintCoords(inst.x_m, inst.z_m)
      const model = lidarModels.find(m => m.id === inst.model_id)
      return {
        ...inst,
        bpX: bp.x,
        bpZ: bp.z,
        mountHeight: inst.mount_y_m ?? inst.y_m ?? 3,
        model
      }
    })
    
    // Sort: Z descending (top to bottom), then X ascending (left to right)
    const sorted = [...withCoords].sort((a, b) => {
      if (Math.abs(a.bpZ - b.bpZ) > 1) return b.bpZ - a.bpZ // Z descending
      return a.bpX - b.bpX // X ascending for same row
    })
    
    // Assign labels after sorting
    return sorted.map((inst, i) => ({
      ...inst,
      label: `L-${String(i + 1).padStart(2, '0')}`
    }))
  }, [lidarInstances, lidarModels, toBlueprintCoords])

  // Generate chain dimension lines (incremental between adjacent points)
  const dimensionLines = useMemo((): ChainDimension[] => {
    if (!showDimensions || lidarData.length === 0 || !roiBounds) return []
    
    const dims: ChainDimension[] = []
    const SNAP = 0.3 // Merge positions closer than this
    
    // Helper: deduplicate sorted positions with snapping
    const dedup = (arr: number[]) => {
      const sorted = [...new Set(arr)].sort((a, b) => a - b)
      const result: number[] = [sorted[0]]
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - result[result.length - 1] > SNAP) result.push(sorted[i])
      }
      return result
    }
    
    // X-axis chain: ROI left edge → unique LiDAR X positions → ROI right edge
    const roiW = roiBounds.width
    const roiH = roiBounds.height
    const uniqueX = dedup([0, ...lidarData.map(l => l.bpX), roiW])
    for (let i = 0; i < uniqueX.length - 1; i++) {
      const from = uniqueX[i]
      const to = uniqueX[i + 1]
      dims.push({
        type: 'x',
        from,
        to,
        value: Math.abs(to - from),
        fixedCoord: -DIM_OFFSET_M // Below ROI bottom edge
      })
    }
    
    // Z-axis chain: ROI bottom edge → unique LiDAR Z positions → ROI top edge
    const uniqueZ = dedup([0, ...lidarData.map(l => l.bpZ), roiH])
    for (let i = 0; i < uniqueZ.length - 1; i++) {
      const from = uniqueZ[i]
      const to = uniqueZ[i + 1]
      dims.push({
        type: 'z',
        from,
        to,
        value: Math.abs(to - from),
        fixedCoord: -DIM_OFFSET_M // Left of ROI left edge
      })
    }
    
    return dims
  }, [lidarData, showDimensions, roiBounds])

  // SVG viewport dimensions — landscape ratio matching technical drawings
  const svgWidth = 800
  const svgHeight = 560
  const margin = { top: 70, right: 30, bottom: 60, left: 70 }
  const plotWidth = svgWidth - margin.left - margin.right
  const plotHeight = svgHeight - margin.top - margin.bottom

  // Scale calculation — fit ROI + padding for dimensions into plot area
  const scale = useMemo(() => {
    if (!roiBounds) return 1
    const padW = roiBounds.width + 4 // 2m padding each side for dimension lines
    const padH = roiBounds.height + 4
    return Math.min(plotWidth / padW, plotHeight / padH)
  }, [roiBounds, plotWidth, plotHeight])

  // Center the drawing in the plot area
  const drawingOffset = useMemo(() => {
    if (!roiBounds) return { x: 0, y: 0 }
    const drawnW = (roiBounds.width + 4) * scale
    const drawnH = (roiBounds.height + 4) * scale
    return {
      x: (plotWidth - drawnW) / 2,
      y: (plotHeight - drawnH) / 2
    }
  }, [roiBounds, scale, plotWidth, plotHeight])

  // Convert blueprint coords to SVG coords (centered in plot area)
  const toSvg = useCallback((bpX: number, bpZ: number) => {
    return {
      x: margin.left + drawingOffset.x + 20 + bpX * scale,
      y: margin.top + plotHeight - drawingOffset.y - 20 - bpZ * scale // Flip Y for SVG
    }
  }, [scale, margin, plotHeight, drawingOffset])

  // Generate proper PDF export using jsPDF + svg2pdf.js
  const exportPdf = useCallback(async () => {
    if (!svgRef.current) return
    
    const orientation = 'landscape'
    const format = pageSize === 'A3' ? 'a3' : 'a4'
    const pdf = new jsPDF({ orientation, format, unit: 'pt' })
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()
    
    // Clone SVG to avoid mutating the displayed one
    const svgClone = svgRef.current.cloneNode(true) as SVGSVGElement
    // Set explicit dimensions for svg2pdf
    svgClone.setAttribute('width', String(svgWidth))
    svgClone.setAttribute('height', String(svgHeight))
    
    // Scale SVG to fill PDF page with margin
    const pdfMargin = 30
    const scaleX = (pdfW - pdfMargin * 2) / svgWidth
    const scaleY = (pdfH - pdfMargin * 2) / svgHeight
    const pdfScale = Math.min(scaleX, scaleY)
    const offsetX = (pdfW - svgWidth * pdfScale) / 2
    const offsetY = (pdfH - svgHeight * pdfScale) / 2
    
    try {
      await pdf.svg(svgClone, {
        x: offsetX,
        y: offsetY,
        width: svgWidth * pdfScale,
        height: svgHeight * pdfScale
      })
      pdf.save(`installer-blueprint-${layoutVersionId || 'export'}-${Date.now()}.pdf`)
    } catch (err) {
      console.error('PDF export failed:', err)
      // Fallback: high-res PNG
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const dpi = 200
      canvas.width = svgWidth * (dpi / 72)
      canvas.height = svgHeight * (dpi / 72)
      const svgData = new XMLSerializer().serializeToString(svgRef.current)
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      const img = new Image()
      img.onload = () => {
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const link = document.createElement('a')
        link.download = `installer-blueprint-${layoutVersionId || 'export'}-${Date.now()}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
        URL.revokeObjectURL(url)
      }
      img.src = url
    }
  }, [pageSize, layoutVersionId, svgWidth, svgHeight])

  const currentDate = new Date().toLocaleString()

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showFixtures}
              onChange={(e) => setShowFixtures(e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-blue-500 w-3.5 h-3.5"
            />
            <span className="flex items-center gap-1">
              {showFixtures ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-gray-500" />}
              ROI Outline
            </span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showCoverage}
              onChange={(e) => setShowCoverage(e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-blue-500 w-3.5 h-3.5"
            />
            <span className="flex items-center gap-1">
              {showCoverage ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-gray-500" />}
              Coverage
            </span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showLidarIds}
              onChange={(e) => setShowLidarIds(e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-blue-500 w-3.5 h-3.5"
            />
            <span className="flex items-center gap-1">
              {showLidarIds ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-gray-500" />}
              LiDAR IDs
            </span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showDimensions}
              onChange={(e) => setShowDimensions(e.target.checked)}
              className="rounded border-gray-600 bg-gray-700 text-blue-500 w-3.5 h-3.5"
            />
            <span className="flex items-center gap-1">
              {showDimensions ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-gray-500" />}
              Dimensions
            </span>
          </label>
        </div>
        {floorplan && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showFloorplan}
                onChange={(e) => setShowFloorplan(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-blue-500 w-3.5 h-3.5"
              />
              <span className="flex items-center gap-1">
                {showFloorplan ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-gray-500" />}
                Floor Plan
              </span>
            </label>
          </div>
        )}
        <div className="flex-1" />
        <select
          value={pageSize}
          onChange={(e) => setPageSize(e.target.value as 'A3' | 'A4')}
          className="text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white"
        >
          <option value="A3">A3 Landscape</option>
          <option value="A4">A4 Landscape</option>
        </select>
        <button
          onClick={exportPdf}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
        >
          <FileText className="w-3.5 h-3.5" />
          Export PDF
        </button>
      </div>

      {/* Blueprint SVG */}
      <div className="bg-white rounded-lg overflow-hidden border border-gray-200">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width={svgWidth}
          height={svgHeight}
          className="w-full"
          style={{ background: 'white', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
        >
          {/* Drawing border — technical drawing frame */}
          <rect x={8} y={8} width={svgWidth - 16} height={svgHeight - 16} fill="none" stroke="#1e3a5f" strokeWidth="1.5" />
          <rect x={12} y={12} width={svgWidth - 24} height={svgHeight - 24} fill="none" stroke="#1e3a5f" strokeWidth="0.5" />

          {/* Title block — bottom-right corner */}
          <g className="title-block">
            <rect x={svgWidth - 280} y={svgHeight - 56} width={264} height={40} fill="#f0f4f8" stroke="#1e3a5f" strokeWidth="0.75" />
            <line x1={svgWidth - 280} y1={svgHeight - 36} x2={svgWidth - 16} y2={svgHeight - 36} stroke="#1e3a5f" strokeWidth="0.5" />
            <line x1={svgWidth - 148} y1={svgHeight - 56} x2={svgWidth - 148} y2={svgHeight - 16} stroke="#1e3a5f" strokeWidth="0.5" />
            <text x={svgWidth - 274} y={svgHeight - 42} fontSize="8" fill="#1e3a5f" fontWeight="bold">
              INSTALLER BLUEPRINT
            </text>
            <text x={svgWidth - 274} y={svgHeight - 22} fontSize="7" fill="#4a6785">
              {currentDate}
            </text>
            <text x={svgWidth - 142} y={svgHeight - 42} fontSize="8" fill="#1e3a5f" fontWeight="bold">
              {projectName}
            </text>
            <text x={svgWidth - 142} y={svgHeight - 22} fontSize="7" fill="#4a6785">
              Scale 1:{(1/scale).toFixed(0)} | Units: meters
            </text>
          </g>

          {/* Header */}
          <text x={20} y={28} fontSize="13" fontWeight="bold" fill="#1e3a5f" letterSpacing="0.5">
            INSTALLER BLUEPRINT — {projectName}
          </text>
          <text x={20} y={42} fontSize="8" fill="#4a6785">
            Layout: {layoutVersionId || 'N/A'} | {currentDate} | Origin at ROI min corner (0,0) | X→ right, Z↑ up
          </text>
          <line x1={12} y1={50} x2={svgWidth - 12} y2={50} stroke="#1e3a5f" strokeWidth="0.5" />

          {/* Reference axes — subtle */}
          <g className="reference-axes" opacity="0.6">
            {roiBounds && (
              <>
                <line x1={toSvg(0, 0).x} y1={toSvg(0, 0).y} x2={toSvg(roiBounds.width + 0.8, 0).x} y2={toSvg(0, 0).y} stroke="#c0392b" strokeWidth="0.75" strokeDasharray="3 2" />
                <text x={toSvg(roiBounds.width + 1, 0).x} y={toSvg(0, 0).y + 3} fontSize="8" fill="#c0392b" fontWeight="bold">X</text>
                <line x1={toSvg(0, 0).x} y1={toSvg(0, 0).y} x2={toSvg(0, roiBounds.height + 0.8).x} y2={toSvg(0, roiBounds.height + 0.8).y} stroke="#27ae60" strokeWidth="0.75" strokeDasharray="3 2" />
                <text x={toSvg(0, roiBounds.height + 1).x - 3} y={toSvg(0, roiBounds.height + 1).y} fontSize="8" fill="#27ae60" fontWeight="bold">Z</text>
              </>
            )}
          </g>

          {/* Origin marker — small crosshair */}
          <g className="origin-marker" opacity="0.7">
            <circle cx={toSvg(0, 0).x} cy={toSvg(0, 0).y} r={6} fill="none" stroke="#1e3a5f" strokeWidth="1" />
            <line x1={toSvg(0, 0).x - 9} y1={toSvg(0, 0).y} x2={toSvg(0, 0).x + 9} y2={toSvg(0, 0).y} stroke="#1e3a5f" strokeWidth="0.75" />
            <line x1={toSvg(0, 0).x} y1={toSvg(0, 0).y - 9} x2={toSvg(0, 0).x} y2={toSvg(0, 0).y + 9} stroke="#1e3a5f" strokeWidth="0.75" />
            <text x={toSvg(0, 0).x + 10} y={toSvg(0, 0).y + 12} fontSize="7" fill="#4a6785">(0,0)</text>
          </g>

          {/* Floor plan overlay — render behind ROI, matching 2D preview transform */}
          {showFloorplan && floorplan && roiBounds && (() => {
            const t = floorplan.transform
            // Floorplan transform is in DXF units; convert to meters → blueprint coords
            const fpLeftM = t.x * unitScaleToM
            const fpBottomM = t.y * unitScaleToM
            const fpWidthM = floorplan.naturalWidth * t.scaleX * unitScaleToM
            const fpHeightM = floorplan.naturalHeight * t.scaleY * unitScaleToM
            
            const bpLeft = fpLeftM - origin.x
            const bpBottom = fpBottomM - origin.z
            const topLeft = toSvg(bpLeft, bpBottom + fpHeightM)
            const bottomRight = toSvg(bpLeft + fpWidthM, bpBottom)
            const imgW = Math.abs(bottomRight.x - topLeft.x)
            const imgH = Math.abs(bottomRight.y - topLeft.y)
            const cx = (topLeft.x + bottomRight.x) / 2
            const cy = (topLeft.y + bottomRight.y) / 2
            
            return (
              <image
                href={floorplan.imageUrl}
                x={topLeft.x}
                y={topLeft.y}
                width={imgW}
                height={imgH}
                opacity={0.25}
                preserveAspectRatio="none"
                transform={t.rotation ? `rotate(${-t.rotation}, ${cx}, ${cy})` : undefined}
              />
            )
          })()}

          {/* ROI Polygon — light fill for readability */}
          {showFixtures && roiInMeters.length >= 3 && (
            <polygon
              points={roiInMeters.map(v => {
                const bp = toBlueprintCoords(v.x, v.z)
                const svg = toSvg(bp.x, bp.z)
                return `${svg.x},${svg.y}`
              }).join(' ')}
              fill="rgba(230, 240, 255, 0.4)"
              stroke="#2563eb"
              strokeWidth="1.5"
            />
          )}

          {/* Coverage circles */}
          {showCoverage && lidarData.map(lidar => {
            const svg = toSvg(lidar.bpX, lidar.bpZ)
            const radiusPx = (lidar.model?.range_m || 10) * scale * 0.9
            return (
              <circle
                key={`coverage-${lidar.id}`}
                cx={svg.x}
                cy={svg.y}
                r={radiusPx}
                fill="rgba(34, 197, 94, 0.1)"
                stroke="rgba(34, 197, 94, 0.4)"
                strokeWidth="1"
                strokeDasharray="4 2"
              />
            )
          })}

          {/* Chain dimension lines */}
          {dimensionLines.map((dim, i) => {
            const isX = dim.type === 'x'
            
            if (isX) {
              // Horizontal chain — along bottom, outside ROI
              const dimY = toSvg(0, dim.fixedCoord).y
              const fromSvg = toSvg(dim.from, 0)
              const toSvg_ = toSvg(dim.to, 0)
              const x1 = fromSvg.x
              const x2 = toSvg_.x
              const textX = (x1 + x2) / 2
              const segLen = Math.abs(x2 - x1)
              
              return (
                <g key={`dim-${i}`} className="dimension-line">
                  {/* Extension lines from ROI bottom to dimension line */}
                  <line x1={x1} y1={toSvg(0, 0).y + 4} x2={x1} y2={dimY + 4} stroke="#6b7280" strokeWidth="0.5" />
                  <line x1={x2} y1={toSvg(0, 0).y + 4} x2={x2} y2={dimY + 4} stroke="#6b7280" strokeWidth="0.5" />
                  {/* Dimension line with arrows */}
                  <line x1={x1 + 3} y1={dimY} x2={x2 - 3} y2={dimY} stroke="#374151" strokeWidth="1" markerEnd="url(#arrowhead)" markerStart="url(#arrowhead-start)" />
                  {/* Dimension text — with background for readability */}
                  <rect x={textX - 16} y={dimY + 3} width={32} height={12} fill="white" rx={1} />
                  <text
                    x={textX}
                    y={dimY + 11}
                    fontSize={segLen < 30 ? '7' : '9'}
                    fill="#1f2937"
                    textAnchor="middle"
                    fontWeight="500"
                  >
                    {dim.value.toFixed(2)}
                  </text>
                </g>
              )
            } else {
              // Vertical chain — along left side, outside ROI
              const dimX = toSvg(dim.fixedCoord, 0).x
              const fromSvg = toSvg(0, dim.from)
              const toSvg_ = toSvg(0, dim.to)
              const y1 = fromSvg.y
              const y2 = toSvg_.y
              const textY = (y1 + y2) / 2
              const segLen = Math.abs(y2 - y1)
              
              return (
                <g key={`dim-${i}`} className="dimension-line">
                  {/* Extension lines from ROI left to dimension line */}
                  <line x1={toSvg(0, 0).x - 4} y1={y1} x2={dimX - 4} y2={y1} stroke="#6b7280" strokeWidth="0.5" />
                  <line x1={toSvg(0, 0).x - 4} y1={y2} x2={dimX - 4} y2={y2} stroke="#6b7280" strokeWidth="0.5" />
                  {/* Dimension line with arrows */}
                  <line x1={dimX} y1={y1 - 3} x2={dimX} y2={y2 + 3} stroke="#374151" strokeWidth="1" markerEnd="url(#arrowhead)" markerStart="url(#arrowhead-start)" />
                  {/* Dimension text — rotated with background */}
                  <rect x={dimX - 18} y={textY - 6} width={32} height={12} fill="white" rx={1} />
                  <text
                    x={dimX - 2}
                    y={textY}
                    fontSize={segLen < 30 ? '7' : '9'}
                    fill="#1f2937"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontWeight="500"
                    transform={`rotate(-90, ${dimX - 2}, ${textY})`}
                  >
                    {dim.value.toFixed(2)}
                  </text>
                </g>
              )
            }
          })}

          {/* LiDAR markers */}
          {lidarData.map(lidar => {
            const svg = toSvg(lidar.bpX, lidar.bpZ)
            return (
              <g key={lidar.id} className="lidar-marker">
                <circle
                  cx={svg.x}
                  cy={svg.y}
                  r={8}
                  fill="#1e40af"
                  stroke="#3b82f6"
                  strokeWidth="2"
                />
                <circle
                  cx={svg.x}
                  cy={svg.y}
                  r={3}
                  fill="white"
                />
                {showLidarIds && (
                  <text
                    x={svg.x}
                    y={svg.y - 14}
                    fontSize="10"
                    fill="#1f2937"
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    {lidar.label}
                  </text>
                )}
              </g>
            )
          })}

          {/* Scale bar — bottom-left */}
          {roiBounds && (
            <g className="scale-bar">
              <text x={20} y={svgHeight - 30} fontSize="10" fontWeight="bold" fill="#1e3a5f">H</text>
              <line x1={20} y1={svgHeight - 25} x2={20 + scale} y2={svgHeight - 25} stroke="#1e3a5f" strokeWidth="1.5" />
              <line x1={20} y1={svgHeight - 29} x2={20} y2={svgHeight - 21} stroke="#1e3a5f" strokeWidth="1.5" />
              <line x1={20 + scale} y1={svgHeight - 29} x2={20 + scale} y2={svgHeight - 21} stroke="#1e3a5f" strokeWidth="1.5" />
              <text x={20 + scale / 2} y={svgHeight - 14} fontSize="8" fill="#4a6785" textAnchor="middle">1m</text>
            </g>
          )}

          {/* Arrow markers definition */}
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="#374151" />
            </marker>
            <marker id="arrowhead-start" markerWidth="6" markerHeight="6" refX="1" refY="3" orient="auto">
              <path d="M6,0 L6,6 L0,3 z" fill="#374151" />
            </marker>
          </defs>
        </svg>
      </div>

      {/* LiDAR Table */}
      <div className="bg-gray-800 rounded-lg p-3">
        <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
          <Crosshair className="w-4 h-4" />
          LiDAR Schedule ({lidarData.length} devices)
        </h3>
        <div className="max-h-48 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-800">
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-1.5 text-left px-2">ID</th>
                <th className="py-1.5 text-right px-2">X (m)</th>
                <th className="py-1.5 text-right px-2">Z (m)</th>
                <th className="py-1.5 text-right px-2">Height (m)</th>
                <th className="py-1.5 text-right px-2">H-FOV</th>
                <th className="py-1.5 text-right px-2">V-FOV</th>
                <th className="py-1.5 text-right px-2">Range</th>
                <th className="py-1.5 text-left px-2">Model</th>
              </tr>
            </thead>
            <tbody>
              {lidarData.map(lidar => (
                <tr key={lidar.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="py-1.5 px-2 font-mono font-medium text-blue-400">{lidar.label}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-white">{lidar.bpX.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-white">{lidar.bpZ.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-white">{lidar.mountHeight.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-gray-300">{lidar.model?.hfov_deg || '-'}°</td>
                  <td className="py-1.5 px-2 text-right font-mono text-gray-300">{lidar.model?.vfov_deg || '-'}°</td>
                  <td className="py-1.5 px-2 text-right font-mono text-gray-300">{lidar.model?.range_m || '-'}m</td>
                  <td className="py-1.5 px-2 text-gray-300">{lidar.model?.name || 'Unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reference Note */}
      <div className="text-xs text-gray-400 bg-gray-800/50 rounded p-2">
        <p><strong>Reference System:</strong> Origin (0,0) at ROI minimum corner. X-axis extends right, Z-axis extends up. Heights measured from Finished Floor Level (FFL).</p>
      </div>
    </div>
  )
}
