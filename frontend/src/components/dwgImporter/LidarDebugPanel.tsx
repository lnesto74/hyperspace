import { useMemo, useState } from 'react'
import { X, Play, RefreshCw, Bug, FileText } from 'lucide-react'
import InstallerBlueprintPanel from './InstallerBlueprintPanel'

// Feature flag for Installer Blueprint
const FEATURE_INSTALLER_BLUEPRINT = true

interface LidarModel {
  id: string
  name: string
  hfov_deg: number
  vfov_deg: number
  range_m: number
  dome_mode?: boolean
}

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

interface LidarDebugPanelProps {
  roiVertices: { x: number; z: number }[]  // in DXF units
  unitScaleToM: number
  lidarModel: {
    id?: string
    name: string
    hfov_deg: number
    vfov_deg: number
    range_m: number
    dome_mode: boolean
  } | null
  settings: {
    overlap_mode: string
    k_required: number
    overlap_target_pct: number
    los_enabled: boolean
    sample_spacing_m: number
    mount_y_m: number
  }
  onClose: () => void
  onApplyPlacements?: (placements: { x: number; z: number; yaw: number }[]) => void
  // New props for Installer Blueprint
  lidarInstances?: LidarInstance[]
  lidarModels?: LidarModel[]
  projectName?: string
  layoutVersionId?: string
}

interface SimulatedLidar {
  x: number
  z: number
  yaw: number
  effectiveRadius: number
}

type TabType = 'debug' | 'blueprint'

export default function LidarDebugPanel({
  roiVertices,
  unitScaleToM,
  lidarModel,
  settings,
  onClose,
  onApplyPlacements,
  lidarInstances = [],
  lidarModels = [],
  projectName = 'Untitled Project',
  layoutVersionId = ''
}: LidarDebugPanelProps) {
  const [simulatedLidars, setSimulatedLidars] = useState<SimulatedLidar[]>([])
  const [isSimulating, setIsSimulating] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('debug')

  // Convert ROI to meters
  const roiInMeters = useMemo(() => {
    return roiVertices.map(v => ({
      x: v.x * unitScaleToM,
      z: v.z * unitScaleToM
    }))
  }, [roiVertices, unitScaleToM])

  // Calculate ROI bounds and dimensions in meters
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
      height: Math.max(...zs) - Math.min(...zs),
      area: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
    }
  }, [roiInMeters])

  // Calculate effective radius from VFOV and mount height
  // For dome LiDARs (360° HFOV), use range directly since they scan horizontally
  // For downward-facing LiDARs, VFOV limits floor coverage
  const effectiveRadius = useMemo(() => {
    if (!lidarModel) return 0
    
    if (lidarModel.dome_mode || lidarModel.hfov_deg >= 360) {
      // Dome LiDARs scan horizontally - use 90% of range for floor coverage
      return lidarModel.range_m * 0.9
    } else {
      // Downward-facing - VFOV limits floor coverage
      const alpha = (lidarModel.vfov_deg / 2) * Math.PI / 180
      const r_vfov = settings.mount_y_m * Math.tan(alpha)
      return Math.min(lidarModel.range_m, r_vfov)
    }
  }, [lidarModel, settings.mount_y_m])

  // Calculate coverage area per LiDAR
  const coveragePerLidar = useMemo(() => {
    return Math.PI * effectiveRadius * effectiveRadius
  }, [effectiveRadius])

  // Estimate number of LiDARs needed using grid-based calculation
  const estimatedLidars = useMemo(() => {
    if (!roiBounds || effectiveRadius <= 0) return 0
    // Use grid spacing for k=2 coverage (r_eff * 1.4 gives ~70% overlap)
    const spacing = effectiveRadius * 1.4
    const cols = Math.ceil(roiBounds.width / spacing)
    const rows = Math.ceil(roiBounds.height / spacing)
    return cols * rows
  }, [roiBounds, effectiveRadius])

  // Run local simulation
  const runSimulation = () => {
    if (!roiBounds || effectiveRadius <= 0) return
    setIsSimulating(true)

    // Simple grid-based placement simulation
    const placements: SimulatedLidar[] = []
    const spacing = effectiveRadius * 1.4  // ~70% overlap for k=2

    // Calculate grid
    const startX = roiBounds.minX + spacing / 2
    const startZ = roiBounds.minZ + spacing / 2

    for (let x = startX; x < roiBounds.maxX; x += spacing) {
      for (let z = startZ; z < roiBounds.maxZ; z += spacing) {
        // Check if point is inside ROI polygon (simple bounding box for now)
        if (x >= roiBounds.minX && x <= roiBounds.maxX &&
            z >= roiBounds.minZ && z <= roiBounds.maxZ) {
          placements.push({
            x,
            z,
            yaw: 0,
            effectiveRadius
          })
        }
      }
    }

    setSimulatedLidars(placements)
    setIsSimulating(false)
  }

  // Wireframe visualization dimensions
  const wireframeSize = 400  // pixels
  const padding = 40

  // Scale for wireframe
  const wireframeScale = useMemo(() => {
    if (!roiBounds) return 1
    const maxDim = Math.max(roiBounds.width, roiBounds.height)
    return (wireframeSize - padding * 2) / maxDim
  }, [roiBounds])

  // Convert meters to wireframe pixels
  const toWireframe = (x: number, z: number) => {
    if (!roiBounds) return { x: 0, y: 0 }
    return {
      x: padding + (x - roiBounds.minX) * wireframeScale,
      y: padding + (z - roiBounds.minZ) * wireframeScale
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-2xl border border-gray-700 max-w-4xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">LiDAR Placement Tools</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        {FEATURE_INSTALLER_BLUEPRINT && (
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setActiveTab('debug')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === 'debug'
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
              }`}
            >
              <Bug className="w-4 h-4" />
              Debug
            </button>
            <button
              onClick={() => setActiveTab('blueprint')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === 'blueprint'
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
              }`}
            >
              <FileText className="w-4 h-4" />
              Installer Blueprint
            </button>
          </div>
        )}

        {/* Blueprint Tab Content */}
        {activeTab === 'blueprint' && FEATURE_INSTALLER_BLUEPRINT && (
          <div className="p-4">
            <InstallerBlueprintPanel
              roiVertices={roiVertices}
              unitScaleToM={unitScaleToM}
              lidarInstances={lidarInstances}
              lidarModels={lidarModels}
              projectName={projectName}
              layoutVersionId={layoutVersionId}
            />
          </div>
        )}

        {/* Debug Tab Content */}
        {activeTab === 'debug' && (
        <div className="p-4 grid grid-cols-2 gap-6">
          {/* Left: Data Tables */}
          <div className="space-y-4">
            {/* Unit Scale Info */}
            <div className="bg-gray-800 rounded-lg p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Unit Conversion</h3>
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-b border-gray-700">
                    <td className="py-1 text-gray-400">DXF → Meters Scale</td>
                    <td className="py-1 text-white text-right font-mono">{unitScaleToM.toFixed(6)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-gray-400">1 DXF unit =</td>
                    <td className="py-1 text-white text-right font-mono">{(unitScaleToM * 1000).toFixed(2)} mm</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ROI Dimensions */}
            <div className="bg-gray-800 rounded-lg p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">ROI Dimensions (meters)</h3>
              {roiBounds ? (
                <table className="w-full text-xs">
                  <tbody>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Width</td>
                      <td className="py-1 text-white text-right font-mono">{roiBounds.width.toFixed(2)} m</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Height</td>
                      <td className="py-1 text-white text-right font-mono">{roiBounds.height.toFixed(2)} m</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Area</td>
                      <td className="py-1 text-white text-right font-mono">{roiBounds.area.toFixed(2)} m²</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Min X</td>
                      <td className="py-1 text-white text-right font-mono">{roiBounds.minX.toFixed(2)} m</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Max X</td>
                      <td className="py-1 text-white text-right font-mono">{roiBounds.maxX.toFixed(2)} m</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Min Z</td>
                      <td className="py-1 text-white text-right font-mono">{roiBounds.minZ.toFixed(2)} m</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-gray-400">Max Z</td>
                      <td className="py-1 text-white text-right font-mono">{roiBounds.maxZ.toFixed(2)} m</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500 text-xs">No ROI defined</p>
              )}
            </div>

            {/* LiDAR Model */}
            <div className="bg-gray-800 rounded-lg p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">LiDAR Model</h3>
              {lidarModel ? (
                <table className="w-full text-xs">
                  <tbody>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Name</td>
                      <td className="py-1 text-white text-right">{lidarModel.name}</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">H-FOV</td>
                      <td className="py-1 text-white text-right font-mono">{lidarModel.hfov_deg}°</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">V-FOV</td>
                      <td className="py-1 text-white text-right font-mono">{lidarModel.vfov_deg}°</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Max Range</td>
                      <td className="py-1 text-white text-right font-mono">{lidarModel.range_m} m</td>
                    </tr>
                    <tr className="border-b border-gray-700">
                      <td className="py-1 text-gray-400">Mount Height</td>
                      <td className="py-1 text-white text-right font-mono">{settings.mount_y_m} m</td>
                    </tr>
                    <tr className="border-b border-gray-700 bg-blue-900/30">
                      <td className="py-1 text-blue-300 font-medium">Effective Radius</td>
                      <td className="py-1 text-blue-300 text-right font-mono font-medium">{effectiveRadius.toFixed(2)} m</td>
                    </tr>
                    <tr className="bg-blue-900/30">
                      <td className="py-1 text-blue-300">Coverage Area</td>
                      <td className="py-1 text-blue-300 text-right font-mono">{coveragePerLidar.toFixed(2)} m²</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500 text-xs">No model selected</p>
              )}
            </div>

            {/* Placement Settings */}
            <div className="bg-gray-800 rounded-lg p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Placement Settings</h3>
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-b border-gray-700">
                    <td className="py-1 text-gray-400">Overlap Mode</td>
                    <td className="py-1 text-white text-right">{settings.overlap_mode}</td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="py-1 text-gray-400">K-Coverage</td>
                    <td className="py-1 text-white text-right font-mono">{settings.k_required}</td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="py-1 text-gray-400">Sample Spacing</td>
                    <td className="py-1 text-white text-right font-mono">{settings.sample_spacing_m} m</td>
                  </tr>
                  <tr className="border-b border-gray-700">
                    <td className="py-1 text-gray-400">LOS Occlusion</td>
                    <td className="py-1 text-white text-right">{settings.los_enabled ? 'Yes' : 'No'}</td>
                  </tr>
                  <tr className="bg-green-900/30">
                    <td className="py-1 text-green-300 font-medium">Estimated LiDARs</td>
                    <td className="py-1 text-green-300 text-right font-mono font-medium">{estimatedLidars}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Wireframe Visualization */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-300">Wireframe (to scale)</h3>
                <button
                  onClick={runSimulation}
                  disabled={isSimulating || !roiBounds}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-xs rounded flex items-center gap-1"
                >
                  {isSimulating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Simulate
                </button>
              </div>

              {/* SVG Wireframe */}
              <svg
                width={wireframeSize}
                height={wireframeSize}
                className="bg-gray-950 rounded border border-gray-700"
              >
                {/* Grid lines (1m spacing) */}
                {roiBounds && Array.from({ length: Math.ceil(roiBounds.width) + 1 }, (_, i) => {
                  const x = padding + i * wireframeScale
                  return (
                    <line
                      key={`vgrid-${i}`}
                      x1={x}
                      y1={padding}
                      x2={x}
                      y2={wireframeSize - padding}
                      stroke="#333"
                      strokeWidth="0.5"
                    />
                  )
                })}
                {roiBounds && Array.from({ length: Math.ceil(roiBounds.height) + 1 }, (_, i) => {
                  const y = padding + i * wireframeScale
                  return (
                    <line
                      key={`hgrid-${i}`}
                      x1={padding}
                      y1={y}
                      x2={wireframeSize - padding}
                      y2={y}
                      stroke="#333"
                      strokeWidth="0.5"
                    />
                  )
                })}

                {/* ROI Polygon */}
                {roiInMeters.length >= 3 && (
                  <polygon
                    points={roiInMeters.map(v => {
                      const p = toWireframe(v.x, v.z)
                      return `${p.x},${p.y}`
                    }).join(' ')}
                    fill="rgba(245, 158, 11, 0.2)"
                    stroke="#f59e0b"
                    strokeWidth="2"
                  />
                )}

                {/* Simulated LiDARs */}
                {simulatedLidars.map((lidar, i) => {
                  const pos = toWireframe(lidar.x, lidar.z)
                  const radiusPx = lidar.effectiveRadius * wireframeScale
                  return (
                    <g key={i}>
                      {/* Coverage circle */}
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={radiusPx}
                        fill="rgba(34, 197, 94, 0.15)"
                        stroke="rgba(34, 197, 94, 0.5)"
                        strokeWidth="1"
                        strokeDasharray="4 2"
                      />
                      {/* LiDAR marker */}
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={6}
                        fill="#22c55e"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <text
                        x={pos.x}
                        y={pos.y - 10}
                        textAnchor="middle"
                        fill="#22c55e"
                        fontSize="10"
                      >
                        {i + 1}
                      </text>
                    </g>
                  )
                })}

                {/* Scale indicator */}
                {roiBounds && (
                  <g>
                    <line
                      x1={padding}
                      y1={wireframeSize - 15}
                      x2={padding + wireframeScale}
                      y2={wireframeSize - 15}
                      stroke="white"
                      strokeWidth="2"
                    />
                    <text
                      x={padding + wireframeScale / 2}
                      y={wireframeSize - 5}
                      textAnchor="middle"
                      fill="white"
                      fontSize="10"
                    >
                      1m
                    </text>
                  </g>
                )}

                {/* Dimensions labels */}
                {roiBounds && (
                  <>
                    <text
                      x={wireframeSize / 2}
                      y={15}
                      textAnchor="middle"
                      fill="#9ca3af"
                      fontSize="11"
                    >
                      {roiBounds.width.toFixed(1)}m
                    </text>
                    <text
                      x={15}
                      y={wireframeSize / 2}
                      textAnchor="middle"
                      fill="#9ca3af"
                      fontSize="11"
                      transform={`rotate(-90, 15, ${wireframeSize / 2})`}
                    >
                      {roiBounds.height.toFixed(1)}m
                    </text>
                  </>
                )}
              </svg>

              {/* Simulation results */}
              {simulatedLidars.length > 0 && (
                <div className="mt-3 p-2 bg-green-900/30 rounded text-xs">
                  <div className="flex justify-between text-green-300">
                    <span>Simulated LiDARs:</span>
                    <span className="font-mono font-medium">{simulatedLidars.length}</span>
                  </div>
                  <div className="flex justify-between text-green-300 mt-1">
                    <span>Grid spacing:</span>
                    <span className="font-mono">{(effectiveRadius * 1.4).toFixed(2)}m</span>
                  </div>
                </div>
              )}
            </div>

            {/* ROI Vertices Table */}
            <div className="bg-gray-800 rounded-lg p-3">
              <h3 className="text-sm font-medium text-gray-300 mb-2">ROI Vertices</h3>
              <div className="max-h-40 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-800">
                    <tr className="border-b border-gray-700">
                      <th className="py-1 text-left text-gray-400">#</th>
                      <th className="py-1 text-right text-gray-400">DXF X</th>
                      <th className="py-1 text-right text-gray-400">DXF Z</th>
                      <th className="py-1 text-right text-gray-400">X (m)</th>
                      <th className="py-1 text-right text-gray-400">Z (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roiVertices.map((v, i) => (
                      <tr key={i} className="border-b border-gray-700/50">
                        <td className="py-1 text-gray-500">{i + 1}</td>
                        <td className="py-1 text-right font-mono text-gray-300">{v.x.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono text-gray-300">{v.z.toFixed(2)}</td>
                        <td className="py-1 text-right font-mono text-white">{(v.x * unitScaleToM).toFixed(2)}</td>
                        <td className="py-1 text-right font-mono text-white">{(v.z * unitScaleToM).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex justify-between items-center">
          <p className="text-xs text-gray-500">
            {lidarModel?.dome_mode || (lidarModel?.hfov_deg ?? 0) >= 360 ? (
              <>Effective radius = range × 0.9 = {lidarModel?.range_m} × 0.9 = {effectiveRadius.toFixed(2)}m (dome LiDAR)</>
            ) : (
              <>Effective radius = min(range, mount_height × tan(VFOV/2)) = min({lidarModel?.range_m}, {settings.mount_y_m} × tan({lidarModel ? lidarModel.vfov_deg/2 : 0}°)) = {effectiveRadius.toFixed(2)}m</>
            )}
          </p>
          {simulatedLidars.length > 0 && onApplyPlacements && (
            <button
              onClick={() => onApplyPlacements(simulatedLidars)}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded"
            >
              Apply {simulatedLidars.length} Placements
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
