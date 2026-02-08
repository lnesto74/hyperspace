import { useMemo, useRef, useState, useCallback } from 'react'
import { FileText, Eye, EyeOff, Crosshair } from 'lucide-react'

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

interface InstallerBlueprintPanelProps {
  roiVertices: { x: number; z: number }[]
  unitScaleToM: number
  lidarInstances: LidarInstance[]
  lidarModels: LidarModel[]
  projectName?: string
  layoutVersionId?: string
}

interface BlueprintOrigin {
  x: number
  z: number
}

interface DimensionLine {
  type: 'x' | 'z'
  lidarId: string
  lidarLabel: string
  from: { x: number; z: number }
  to: { x: number; z: number }
  value: number
  offset: number
}

// Dimensioning algorithm constants
const BASE_OFFSET_M = 0.6
const DELTA_OFFSET_M = 0.25
const SIMILAR_THRESHOLD_M = 0.4
const EXTENSION_GAP_M = 0.10

export default function InstallerBlueprintPanel({
  roiVertices,
  unitScaleToM,
  lidarInstances,
  lidarModels,
  projectName = 'Untitled Project',
  layoutVersionId = ''
}: InstallerBlueprintPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  
  // Display toggles
  const [showFixtures, setShowFixtures] = useState(true)
  const [showCoverage, setShowCoverage] = useState(false)
  const [showLidarIds, setShowLidarIds] = useState(true)
  const [showDimensions, setShowDimensions] = useState(true)
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

  // Generate dimension lines with offset grouping to avoid overlap
  const dimensionLines = useMemo((): DimensionLine[] => {
    if (!showDimensions || lidarData.length === 0) return []
    
    const dims: DimensionLine[] = []
    
    // Group LiDARs by similar Z for X-dimensions
    const sortedByZ = [...lidarData].sort((a, b) => a.bpZ - b.bpZ)
    let currentZGroup: typeof lidarData = []
    let lastZ = -Infinity
    
    sortedByZ.forEach(lidar => {
      if (lidar.bpZ - lastZ > SIMILAR_THRESHOLD_M) {
        // New group - process previous group
        currentZGroup.forEach((l, idx) => {
          dims.push({
            type: 'x',
            lidarId: l.id,
            lidarLabel: l.label,
            from: { x: 0, z: l.bpZ },
            to: { x: l.bpX, z: l.bpZ },
            value: l.bpX,
            offset: BASE_OFFSET_M + idx * DELTA_OFFSET_M
          })
        })
        currentZGroup = [lidar]
      } else {
        currentZGroup.push(lidar)
      }
      lastZ = lidar.bpZ
    })
    // Process last group
    currentZGroup.forEach((l, idx) => {
      dims.push({
        type: 'x',
        lidarId: l.id,
        lidarLabel: l.label,
        from: { x: 0, z: l.bpZ },
        to: { x: l.bpX, z: l.bpZ },
        value: l.bpX,
        offset: BASE_OFFSET_M + idx * DELTA_OFFSET_M
      })
    })
    
    // Group LiDARs by similar X for Z-dimensions
    const sortedByX = [...lidarData].sort((a, b) => a.bpX - b.bpX)
    let currentXGroup: typeof lidarData = []
    let lastX = -Infinity
    
    sortedByX.forEach(lidar => {
      if (lidar.bpX - lastX > SIMILAR_THRESHOLD_M) {
        // New group
        currentXGroup.forEach((l, idx) => {
          dims.push({
            type: 'z',
            lidarId: l.id,
            lidarLabel: l.label,
            from: { x: l.bpX, z: 0 },
            to: { x: l.bpX, z: l.bpZ },
            value: l.bpZ,
            offset: BASE_OFFSET_M + idx * DELTA_OFFSET_M
          })
        })
        currentXGroup = [lidar]
      } else {
        currentXGroup.push(lidar)
      }
      lastX = lidar.bpX
    })
    // Process last group
    currentXGroup.forEach((l, idx) => {
      dims.push({
        type: 'z',
        lidarId: l.id,
        lidarLabel: l.label,
        from: { x: l.bpX, z: 0 },
        to: { x: l.bpX, z: l.bpZ },
        value: l.bpZ,
        offset: BASE_OFFSET_M + idx * DELTA_OFFSET_M
      })
    })
    
    return dims
  }, [lidarData, showDimensions])

  // SVG viewport dimensions
  const svgWidth = 600
  const svgHeight = 500
  const margin = { top: 60, right: 40, bottom: 80, left: 60 }
  const plotWidth = svgWidth - margin.left - margin.right
  const plotHeight = svgHeight - margin.top - margin.bottom

  // Scale calculation
  const scale = useMemo(() => {
    if (!roiBounds) return 1
    const maxDim = Math.max(roiBounds.width, roiBounds.height)
    // Add padding for dimensions
    const paddedMax = maxDim + 4 // 2m padding on each side for dimension lines
    return Math.min(plotWidth, plotHeight) / paddedMax
  }, [roiBounds, plotWidth, plotHeight])

  // Convert blueprint coords to SVG coords
  const toSvg = useCallback((bpX: number, bpZ: number) => {
    return {
      x: margin.left + 20 + bpX * scale,
      y: margin.top + plotHeight - 20 - bpZ * scale // Flip Y for SVG
    }
  }, [scale, margin, plotHeight])

  // Generate PDF export
  const exportPdf = useCallback(async () => {
    if (!svgRef.current) return
    
    const svgElement = svgRef.current
    const svgData = new XMLSerializer().serializeToString(svgElement)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    
    // Create canvas for PDF
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    // A3 landscape at 150 DPI: 16.5 × 11.7 inches
    const dpi = 150
    const a3Width = pageSize === 'A3' ? 16.5 * dpi : 11.7 * dpi
    const a3Height = pageSize === 'A3' ? 11.7 * dpi : 8.3 * dpi
    canvas.width = a3Width
    canvas.height = a3Height
    
    const img = new Image()
    const url = URL.createObjectURL(svgBlob)
    
    img.onload = () => {
      // White background
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      
      // Scale and center SVG
      const scaleX = (canvas.width - 100) / svgElement.clientWidth
      const scaleY = (canvas.height - 100) / svgElement.clientHeight
      const imgScale = Math.min(scaleX, scaleY)
      const offsetX = (canvas.width - svgElement.clientWidth * imgScale) / 2
      const offsetY = 50
      
      ctx.drawImage(img, offsetX, offsetY, svgElement.clientWidth * imgScale, svgElement.clientHeight * imgScale)
      
      // Convert to PDF using canvas
      const link = document.createElement('a')
      link.download = `installer-blueprint-${layoutVersionId || 'export'}-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      
      URL.revokeObjectURL(url)
    }
    
    img.src = url
  }, [pageSize, layoutVersionId])

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
      <div className="bg-white rounded-lg overflow-hidden">
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          className="w-full"
          style={{ background: 'white' }}
        >
          {/* Title Block */}
          <g className="title-block">
            <text x={margin.left} y={25} fontSize="16" fontWeight="bold" fill="#1f2937">
              INSTALLER BLUEPRINT - {projectName}
            </text>
            <text x={margin.left} y={42} fontSize="10" fill="#6b7280">
              Layout: {layoutVersionId || 'N/A'} | Date: {currentDate} | Scale: 1:{(1/scale).toFixed(0)} | Units: meters
            </text>
            <text x={svgWidth - margin.right} y={25} fontSize="10" fill="#6b7280" textAnchor="end">
              Origin: ROI min corner (0,0)
            </text>
            <text x={svgWidth - margin.right} y={38} fontSize="9" fill="#9ca3af" textAnchor="end">
              X→ right, Z↑ up, Heights from FFL
            </text>
          </g>

          {/* Reference axes */}
          <g className="reference-axes">
            {/* X axis line (Z=0) */}
            {roiBounds && (
              <>
                <line
                  x1={toSvg(0, 0).x}
                  y1={toSvg(0, 0).y}
                  x2={toSvg(roiBounds.width + 1, 0).x}
                  y2={toSvg(0, 0).y}
                  stroke="#dc2626"
                  strokeWidth="1"
                  strokeDasharray="4 2"
                />
                <text x={toSvg(roiBounds.width + 1.2, 0).x} y={toSvg(0, 0).y + 4} fontSize="10" fill="#dc2626">X</text>
              </>
            )}
            {/* Z axis line (X=0) */}
            {roiBounds && (
              <>
                <line
                  x1={toSvg(0, 0).x}
                  y1={toSvg(0, 0).y}
                  x2={toSvg(0, roiBounds.height + 1).x}
                  y2={toSvg(0, roiBounds.height + 1).y}
                  stroke="#16a34a"
                  strokeWidth="1"
                  strokeDasharray="4 2"
                />
                <text x={toSvg(0, roiBounds.height + 1.2).x - 4} y={toSvg(0, roiBounds.height + 1.2).y} fontSize="10" fill="#16a34a">Z</text>
              </>
            )}
          </g>

          {/* Origin marker */}
          <g className="origin-marker">
            <circle cx={toSvg(0, 0).x} cy={toSvg(0, 0).y} r={8} fill="none" stroke="#1f2937" strokeWidth="2" />
            <line x1={toSvg(0, 0).x - 12} y1={toSvg(0, 0).y} x2={toSvg(0, 0).x + 12} y2={toSvg(0, 0).y} stroke="#1f2937" strokeWidth="1.5" />
            <line x1={toSvg(0, 0).x} y1={toSvg(0, 0).y - 12} x2={toSvg(0, 0).x} y2={toSvg(0, 0).y + 12} stroke="#1f2937" strokeWidth="1.5" />
            <text x={toSvg(0, 0).x + 15} y={toSvg(0, 0).y + 15} fontSize="9" fill="#1f2937" fontWeight="bold">(0,0)</text>
          </g>

          {/* ROI Polygon */}
          {showFixtures && roiInMeters.length >= 3 && (
            <polygon
              points={roiInMeters.map(v => {
                const bp = toBlueprintCoords(v.x, v.z)
                const svg = toSvg(bp.x, bp.z)
                return `${svg.x},${svg.y}`
              }).join(' ')}
              fill="rgba(59, 130, 246, 0.05)"
              stroke="#3b82f6"
              strokeWidth="2"
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

          {/* Dimension lines */}
          {dimensionLines.map((dim, i) => {
            const isX = dim.type === 'x'
            const fromSvg = toSvg(dim.from.x, dim.from.z)
            const toSvg_ = toSvg(dim.to.x, dim.to.z)
            const offsetPx = dim.offset * scale
            
            // Calculate dimension line position with offset
            let x1, y1, x2, y2, textX, textY
            if (isX) {
              // X dimension - horizontal, offset below the point
              y1 = y2 = fromSvg.y + offsetPx
              x1 = fromSvg.x
              x2 = toSvg_.x
              textX = (x1 + x2) / 2
              textY = y1 + 12
            } else {
              // Z dimension - vertical, offset to the left of the point
              x1 = x2 = fromSvg.x - offsetPx
              y1 = fromSvg.y
              y2 = toSvg_.y
              textX = x1 - 8
              textY = (y1 + y2) / 2
            }
            
            return (
              <g key={`dim-${i}`} className="dimension-line">
                {/* Extension lines */}
                {isX ? (
                  <>
                    <line x1={fromSvg.x} y1={fromSvg.y + EXTENSION_GAP_M * scale} x2={fromSvg.x} y2={y1 + 4} stroke="#374151" strokeWidth="0.5" />
                    <line x1={toSvg_.x} y1={toSvg_.y + EXTENSION_GAP_M * scale} x2={toSvg_.x} y2={y1 + 4} stroke="#374151" strokeWidth="0.5" />
                  </>
                ) : (
                  <>
                    <line x1={fromSvg.x - EXTENSION_GAP_M * scale} y1={fromSvg.y} x2={x1 - 4} y2={fromSvg.y} stroke="#374151" strokeWidth="0.5" />
                    <line x1={toSvg_.x - EXTENSION_GAP_M * scale} y1={toSvg_.y} x2={x1 - 4} y2={toSvg_.y} stroke="#374151" strokeWidth="0.5" />
                  </>
                )}
                {/* Dimension line */}
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#374151" strokeWidth="1" markerEnd="url(#arrowhead)" markerStart="url(#arrowhead-start)" />
                {/* Dimension text */}
                <text
                  x={textX}
                  y={textY}
                  fontSize="9"
                  fill="#1f2937"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={isX ? '' : `rotate(-90, ${textX}, ${textY})`}
                >
                  {dim.value.toFixed(2)}
                </text>
              </g>
            )
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

          {/* Scale bar */}
          {roiBounds && (
            <g className="scale-bar">
              <line
                x1={margin.left}
                y1={svgHeight - 25}
                x2={margin.left + scale}
                y2={svgHeight - 25}
                stroke="#1f2937"
                strokeWidth="2"
              />
              <line x1={margin.left} y1={svgHeight - 30} x2={margin.left} y2={svgHeight - 20} stroke="#1f2937" strokeWidth="2" />
              <line x1={margin.left + scale} y1={svgHeight - 30} x2={margin.left + scale} y2={svgHeight - 20} stroke="#1f2937" strokeWidth="2" />
              <text
                x={margin.left + scale / 2}
                y={svgHeight - 12}
                fontSize="10"
                fill="#1f2937"
                textAnchor="middle"
              >
                1m
              </text>
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
