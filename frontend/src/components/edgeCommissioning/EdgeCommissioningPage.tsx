import { useEffect, useState } from 'react'
import { 
  Server, Radio, Wifi, WifiOff, RefreshCw, Search, Upload, 
  Check, X, AlertCircle, Clock, Link2, Unlink, Download, Wand2, Camera, Pencil
} from 'lucide-react'
import { useEdgeCommissioning, EdgeDevice, EdgeLidar, EdgePlacement, EdgePairing, RoiBounds } from '../../context/EdgeCommissioningContext'
import { useVenue } from '../../context/VenueContext'
import LidarCommissioningWizard from './LidarCommissioningWizard'
import PointCloudViewer from './PointCloudViewer'

export default function EdgeCommissioningPage({ onClose }: { onClose: () => void }) {
  const { venue } = useVenue()
  const {
    edges,
    selectedEdgeId,
    placements,
    pairings,
    edgeStatuses,
    deployHistory,
    roiBounds,
    isScanning,
    isScanningLidars,
    isLoadingInventory,
    isLoadingPlacements,
    isDeploying,
    scanEdges,
    selectEdge,
    scanEdgeLidars,
    fetchEdgeInventory,
    fetchEdgeStatus,
    loadPlacements,
    loadPairings,
    pairPlacement,
    unpairPlacement,
    deployToEdge,
    loadDeployHistory,
    loadCommissionedLidars,
    getPairingForPlacement,
    getMergedLidars,
    updateEdgeName,
  } = useEdgeCommissioning()

  const [draggedLidar, setDraggedLidar] = useState<EdgeLidar | null>(null)
  const [showDeployHistory, setShowDeployHistory] = useState(false)
  const [showCommissioningWizard, setShowCommissioningWizard] = useState(false)
  const [pointCloudLidar, setPointCloudLidar] = useState<{ ip: string; tailscaleIp: string } | null>(null)
  const [editingEdge, setEditingEdge] = useState<EdgeDevice | null>(null)
  const [editName, setEditName] = useState('')

  // Load data when venue changes
  useEffect(() => {
    if (venue?.id) {
      loadPlacements(venue.id)
      loadPairings(venue.id)
      loadDeployHistory(venue.id)
    }
  }, [venue?.id, loadPlacements, loadPairings, loadDeployHistory])

  // Load commissioned LiDARs when venue and edge are selected
  useEffect(() => {
    if (venue?.id && selectedEdgeId) {
      loadCommissionedLidars(venue.id, selectedEdgeId)
    }
  }, [venue?.id, selectedEdgeId, loadCommissionedLidars])

  // Get merged LiDAR list (commissioned + scanned)
  const mergedLidars = getMergedLidars()

  // Fetch inventory when edge is selected
  useEffect(() => {
    if (selectedEdgeId) {
      fetchEdgeInventory(selectedEdgeId)
      fetchEdgeStatus(selectedEdgeId)
    }
  }, [selectedEdgeId, fetchEdgeInventory, fetchEdgeStatus])

  const selectedEdge = edges.find(e => e.edgeId === selectedEdgeId)
  const edgeStatus = selectedEdgeId ? edgeStatuses.get(selectedEdgeId) : null

  // Count pairings for selected edge
  const selectedEdgePairings = pairings.filter(p => p.edgeId === selectedEdgeId)
  const canDeploy = selectedEdge?.online && selectedEdgePairings.length > 0 && !isDeploying

  const handleDragStart = (lidar: EdgeLidar) => {
    setDraggedLidar(lidar)
  }

  const handleDragEnd = () => {
    setDraggedLidar(null)
  }

  const handleDrop = (placement: EdgePlacement) => {
    if (!draggedLidar || !selectedEdge || !venue?.id) return
    
    pairPlacement(
      venue.id,
      selectedEdge.edgeId,
      selectedEdge.tailscaleIp,
      placement.id,
      draggedLidar.lidarId,
      draggedLidar.ip
    )
    setDraggedLidar(null)
  }

  const handleDeploy = async () => {
    if (!selectedEdgeId || !venue?.id) return
    await deployToEdge(selectedEdgeId, venue.id)
    // Refresh edge status after deploy
    await fetchEdgeStatus(selectedEdgeId)
  }

  const handleExportConfig = async () => {
    if (!venue?.id) return
    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
      let url = `${API_BASE}/api/edge-commissioning/export-config?venueId=${venue.id}`
      if (selectedEdgeId) {
        url += `&edgeId=${selectedEdgeId}`
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error('Export failed')
      const data = await res.json()
      
      // Download as JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `edge-config-${venue.id}-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(downloadUrl)
    } catch (err: any) {
      console.error('Export failed:', err)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Commissioning Wizard Modal */}
      {showCommissioningWizard && selectedEdge && venue?.id && (
        <LidarCommissioningWizard
          venueId={venue.id}
          edgeId={selectedEdge.edgeId}
          edgeTailscaleIp={selectedEdge.tailscaleIp}
          edgeHostname={selectedEdge.hostname}
          totalPlacements={placements.length}
          onClose={() => setShowCommissioningWizard(false)}
          onComplete={() => {
            setShowCommissioningWizard(false)
            // Refresh LiDAR inventory after commissioning
            if (selectedEdge) {
              scanEdgeLidars(selectedEdge.edgeId)
            }
          }}
        />
      )}

      {/* Point Cloud Viewer Modal */}
      {pointCloudLidar && (
        <PointCloudViewer
          tailscaleIp={pointCloudLidar.tailscaleIp}
          lidarIp={pointCloudLidar.ip}
          lidarModel="RS16"
          onClose={() => setPointCloudLidar(null)}
        />
      )}

      {/* Header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm"
          >
            ← Back
          </button>
          <span className="text-white font-medium">Edge Commissioning Portal</span>
          {venue && (
            <span className="text-gray-400 text-sm">| {venue.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {venue && pairings.length > 0 && (
            <button
              onClick={handleExportConfig}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors bg-gray-700 hover:bg-gray-600 text-gray-200"
              title="Export config JSON for algorithm provider"
            >
              <Download className="w-4 h-4" />
              Export Config
            </button>
          )}
          {selectedEdge && (
            <button
              onClick={handleDeploy}
              disabled={!canDeploy}
              className={`flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                canDeploy
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Upload className="w-4 h-4" />
              {isDeploying ? 'Deploying...' : `Deploy to ${selectedEdge.hostname}`}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Edge Devices */}
        <div className="w-72 border-r border-gray-700 flex flex-col bg-gray-850">
          <div className="p-3 border-b border-gray-700">
            <button
              onClick={scanEdges}
              disabled={isScanning}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? 'Scanning...' : 'Scan Tailnet for Edges'}
            </button>
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-2">
            {edges.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-sm">
                <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No edge devices found</p>
                <p className="text-xs mt-1">Click "Scan Tailnet" to discover</p>
              </div>
            ) : (
              edges.map(edge => (
                <EdgeDeviceCard
                  key={edge.edgeId}
                  edge={edge}
                  isSelected={edge.edgeId === selectedEdgeId}
                  onClick={() => selectEdge(edge.edgeId)}
                  onEditName={() => {
                    setEditingEdge(edge)
                    setEditName(edge.displayName || edge.hostname)
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* Middle Panel - LiDAR Inventory */}
        <div className="w-80 border-r border-gray-700 flex flex-col bg-gray-850">
          <div className="p-3 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-white">
              {selectedEdge ? `LiDARs on ${selectedEdge.hostname}` : 'Select an Edge'}
            </span>
            {selectedEdge && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowCommissioningWizard(true)}
                  disabled={!selectedEdge.online || placements.length === 0}
                  className="p-1.5 hover:bg-gray-700 rounded disabled:opacity-50"
                  title="Commission LiDARs"
                >
                  <Wand2 className="w-4 h-4 text-amber-400" />
                </button>
                <button
                  onClick={() => scanEdgeLidars(selectedEdge.edgeId)}
                  disabled={isScanningLidars || !selectedEdge.online}
                  className="p-1.5 hover:bg-gray-700 rounded disabled:opacity-50"
                  title="Scan LAN for LiDARs"
                >
                  <Search className={`w-4 h-4 text-gray-400 ${isScanningLidars ? 'animate-pulse' : ''}`} />
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-2">
            {!selectedEdge ? (
              <div className="text-center text-gray-500 py-8 text-sm">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Select an edge device</p>
              </div>
            ) : isLoadingInventory ? (
              <div className="text-center text-gray-500 py-8">
                <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Loading inventory...</p>
              </div>
            ) : mergedLidars.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-sm">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No LiDARs discovered</p>
                <p className="text-xs mt-1">Click search icon to scan LAN</p>
              </div>
            ) : (
              mergedLidars.map(lidar => (
                <LidarCard
                  key={lidar.lidarId}
                  lidar={lidar}
                  isPaired={pairings.some(p => p.lidarId === lidar.lidarId || p.lidarIp === lidar.ip)}
                  onDragStart={() => handleDragStart(lidar)}
                  onDragEnd={handleDragEnd}
                  onViewPointCloud={() => selectedEdge && setPointCloudLidar({ 
                    ip: lidar.ip, 
                    tailscaleIp: selectedEdge.tailscaleIp 
                  })}
                />
              ))
            )}
          </div>

          {/* Edge Status */}
          {selectedEdge && edgeStatus && (
            <div className="p-3 border-t border-gray-700 bg-gray-800">
              <div className="text-xs text-gray-400 mb-2">Edge Status</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Online:</span>
                  <span className={edgeStatus.online ? 'text-green-400' : 'text-red-400'}>
                    {edgeStatus.online ? 'Yes' : 'No'}
                  </span>
                </div>
                {edgeStatus.appliedConfigHash && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Config Hash:</span>
                    <span className="text-blue-400 font-mono">{edgeStatus.appliedConfigHash.substring(0, 8)}</span>
                  </div>
                )}
                {edgeStatus.edgeVersion && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Version:</span>
                    <span className="text-gray-300">{edgeStatus.edgeVersion}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Placements */}
        <div className="flex-1 flex flex-col bg-gray-900">
          <div className="p-3 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-white">
              Venue Placements ({placements.length})
            </span>
            <button
              onClick={() => setShowDeployHistory(!showDeployHistory)}
              className={`text-xs px-2 py-1 rounded ${showDeployHistory ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              <Clock className="w-3 h-3 inline mr-1" />
              History
            </button>
          </div>

          {showDeployHistory ? (
            <DeployHistoryPanel history={deployHistory} onClose={() => setShowDeployHistory(false)} />
          ) : (
            <div className="flex-1 overflow-auto p-3">
              {isLoadingPlacements ? (
                <div className="text-center text-gray-500 py-8">
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  <p className="text-sm">Loading placements...</p>
                </div>
              ) : placements.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No placements in this venue</p>
                  <p className="text-xs mt-1">Add placements in LiDAR Planner first</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* ROI Wireframe Visualization */}
                  {roiBounds && (
                    <RoiWireframe 
                      placements={placements} 
                      roiBounds={roiBounds}
                      pairings={pairings}
                      mergedLidars={mergedLidars}
                    />
                  )}
                  
                  {/* Placement Cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {placements.map(placement => (
                      <PlacementCard
                        key={placement.id}
                        placement={placement}
                        pairing={getPairingForPlacement(placement.id)}
                        isDragOver={draggedLidar !== null}
                        onDrop={() => handleDrop(placement)}
                        onUnpair={() => venue?.id && unpairPlacement(venue.id, placement.id)}
                        roiBounds={roiBounds}
                        mergedLidars={mergedLidars}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Edge Name Modal */}
      {editingEdge && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
            <h3 className="text-lg font-medium text-white mb-4">Edit Edge Name</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Display Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Enter display name"
                  autoFocus
                />
              </div>
              <div className="text-xs text-gray-500">
                Original hostname: <span className="text-gray-400">{editingEdge.hostname}</span>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditingEdge(null)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (editName.trim()) {
                      await updateEdgeName(editingEdge.edgeId, editName.trim())
                      setEditingEdge(null)
                    }
                  }}
                  disabled={!editName.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Edge Device Card Component
function EdgeDeviceCard({ 
  edge, 
  isSelected, 
  onClick,
  onEditName,
}: { 
  edge: EdgeDevice
  isSelected: boolean
  onClick: () => void
  onEditName: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`group p-3 rounded-lg cursor-pointer transition-colors border ${
        isSelected
          ? 'bg-blue-900/40 border-blue-500'
          : 'bg-gray-800 border-gray-700 hover:bg-gray-750 hover:border-gray-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <Server className="w-4 h-4 text-gray-400" />
        <span className="font-medium text-white text-sm truncate flex-1">{edge.displayName || edge.hostname}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEditName()
          }}
          className="p-1 hover:bg-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit name"
        >
          <Pencil className="w-3 h-3 text-gray-400 hover:text-white" />
        </button>
        {edge.online ? (
          <Wifi className="w-3 h-3 text-green-400 ml-auto" />
        ) : (
          <WifiOff className="w-3 h-3 text-red-400 ml-auto" />
        )}
      </div>
      <div className="mt-1 text-xs text-gray-500 flex items-center gap-2">
        <span>{edge.tailscaleIp}</span>
        {edge.displayName && edge.displayName !== edge.hostname && (
          <span className="text-gray-600">({edge.hostname})</span>
        )}
      </div>
      {edge.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {edge.tags.map(tag => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">
              {tag.replace('tag:', '')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// LiDAR Card Component
function LidarCard({
  lidar,
  isPaired,
  onDragStart,
  onDragEnd,
  onViewPointCloud,
}: {
  lidar: EdgeLidar
  isPaired: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onViewPointCloud?: () => void
}) {
  return (
    <div
      draggable={!isPaired}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`p-3 rounded-lg border transition-colors ${
        isPaired
          ? 'bg-green-900/30 border-green-700 opacity-60'
          : lidar.reachable
            ? 'bg-gray-800 border-gray-700 cursor-grab hover:border-blue-500 hover:bg-gray-750'
            : 'bg-gray-800/50 border-gray-700 cursor-grab hover:border-gray-600'
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Online/Offline indicator dot */}
        <div className={`w-2 h-2 rounded-full ${lidar.reachable ? 'bg-green-400' : 'bg-gray-500'}`} />
        <Radio className={`w-4 h-4 ${lidar.reachable ? 'text-blue-400' : 'text-gray-500'}`} />
        <span className={`font-medium text-sm ${lidar.reachable ? 'text-white' : 'text-gray-400'}`}>
          {lidar.ip.split('.').pop()}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {lidar.reachable && onViewPointCloud && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewPointCloud(); }}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-blue-400"
              title="View Point Cloud"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
          )}
          {isPaired && <Check className="w-3 h-3 text-green-400" />}
        </div>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {lidar.ip} • {lidar.vendor || 'RoboSense'}
      </div>
      <div className="mt-1 text-xs">
        {lidar.reachable ? (
          <span className="text-green-400">● Online</span>
        ) : (
          <span className="text-gray-500">○ Offline</span>
        )}
        {isPaired && <span className="text-green-400 ml-2">• Paired</span>}
      </div>
    </div>
  )
}

// Placement Card Component
function PlacementCard({
  placement,
  pairing,
  isDragOver,
  onDrop,
  onUnpair,
  roiBounds,
  mergedLidars,
}: {
  placement: EdgePlacement
  pairing?: EdgePairing
  isDragOver: boolean
  onDrop: () => void
  onUnpair: () => void
  roiBounds: RoiBounds | null
  mergedLidars: EdgeLidar[]
}) {
  const [isOver, setIsOver] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsOver(true)
  }

  const handleDragLeave = () => {
    setIsOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsOver(false)
    onDrop()
  }

  // Calculate ROI-relative coordinates
  const roiX = roiBounds ? placement.position.x - roiBounds.minX : placement.position.x
  const roiZ = roiBounds ? placement.position.z - roiBounds.minZ : placement.position.z

  // Check if paired lidar is online
  const pairedLidar = pairing 
    ? mergedLidars.find(l => l.lidarId === pairing.lidarId || l.ip === pairing.lidarIp)
    : null
  const isOnline = pairedLidar?.reachable ?? false

  // Determine card colors based on state
  let cardClasses = 'p-3 rounded-lg border transition-all '
  if (pairing) {
    if (isOnline) {
      // Paired + Online - green
      cardClasses += 'bg-green-900/20 border-green-600'
    } else {
      // Paired + Offline - amber
      cardClasses += 'bg-amber-900/20 border-amber-600'
    }
  } else if (isOver && isDragOver) {
    cardClasses += 'bg-blue-900/30 border-blue-500 border-dashed'
  } else {
    cardClasses += 'bg-gray-800 border-gray-700'
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cardClasses}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-gray-400">
          {placement.id.substring(0, 8)}
        </span>
        {pairing ? (
          <button
            onClick={onUnpair}
            className="p-1 hover:bg-red-900/50 rounded"
            title="Unpair"
          >
            <Unlink className="w-3 h-3 text-red-400" />
          </button>
        ) : (
          <Link2 className="w-3 h-3 text-gray-500" />
        )}
      </div>

      <div className="text-xs text-gray-400 space-y-1">
        <div>
          <span className="text-gray-500">DWG:</span>{' '}
          ({placement.position.x.toFixed(1)}, {placement.position.z.toFixed(1)})
        </div>
        <div>
          <span className="text-blue-400">ROI:</span>{' '}
          <span className="text-blue-300">({roiX.toFixed(1)}, {roiZ.toFixed(1)})</span>
        </div>
        <div>
          <span className="text-gray-500">Height:</span> {placement.mountHeight.toFixed(1)}m
        </div>
        {placement.modelName && (
          <div>
            <span className="text-gray-500">Model:</span> {placement.modelName}
          </div>
        )}
      </div>

      {pairing ? (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className={`flex items-center gap-1 text-xs ${isOnline ? 'text-green-400' : 'text-amber-400'}`}>
            <Check className="w-3 h-3" />
            <span>Paired: {pairing.lidarId}</span>
            {!isOnline && <span className="text-amber-500 ml-1">(Offline)</span>}
          </div>
          {pairing.lidarIp && (
            <div className="text-xs text-gray-500 mt-0.5">{pairing.lidarIp}</div>
          )}
        </div>
      ) : (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="flex items-center gap-1 text-xs text-amber-400">
            <AlertCircle className="w-3 h-3" />
            <span>Unpaired - drop LiDAR here</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ROI Wireframe Visualization Component
function RoiWireframe({
  placements,
  roiBounds,
  pairings,
  mergedLidars,
}: {
  placements: EdgePlacement[]
  roiBounds: RoiBounds
  pairings: EdgePairing[]
  mergedLidars: EdgeLidar[]
}) {
  const width = roiBounds.maxX - roiBounds.minX
  const height = roiBounds.maxZ - roiBounds.minZ
  
  // SVG dimensions and scaling
  const svgWidth = 280
  const svgHeight = (height / width) * svgWidth
  const padding = 20
  const scale = (svgWidth - padding * 2) / width

  // Transform DWG coordinates to SVG coordinates
  const toSvgX = (x: number) => padding + (x - roiBounds.minX) * scale
  const toSvgY = (z: number) => padding + (z - roiBounds.minZ) * scale

  return (
    <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
      <div className="text-xs text-gray-400 mb-2 flex justify-between">
        <span className="font-medium">ROI Wireframe</span>
        <span>{width.toFixed(1)}m × {height.toFixed(1)}m</span>
      </div>
      
      <svg 
        width={svgWidth} 
        height={svgHeight} 
        className="bg-gray-900 rounded"
      >
        {/* ROI boundary */}
        <rect
          x={padding}
          y={padding}
          width={svgWidth - padding * 2}
          height={svgHeight - padding * 2}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeDasharray="4,2"
        />
        
        {/* Origin marker (SW corner) */}
        <circle cx={padding} cy={svgHeight - padding} r="4" fill="#22c55e" />
        <text x={padding + 6} y={svgHeight - padding + 3} fill="#22c55e" fontSize="8">(0,0)</text>
        
        {/* Grid lines */}
        {Array.from({ length: Math.floor(width / 10) + 1 }, (_, i) => (
          <line
            key={`vgrid-${i}`}
            x1={padding + i * 10 * scale}
            y1={padding}
            x2={padding + i * 10 * scale}
            y2={svgHeight - padding}
            stroke="#374151"
            strokeWidth="0.5"
          />
        ))}
        {Array.from({ length: Math.floor(height / 10) + 1 }, (_, i) => (
          <line
            key={`hgrid-${i}`}
            x1={padding}
            y1={padding + i * 10 * scale}
            x2={svgWidth - padding}
            y2={padding + i * 10 * scale}
            stroke="#374151"
            strokeWidth="0.5"
          />
        ))}
        
        {/* LiDAR positions */}
        {placements.map((p, idx) => {
          const pairing = pairings.find(pair => pair.placementId === p.id)
          const isPaired = !!pairing
          // Check if the paired lidar is online
          const pairedLidar = pairing 
            ? mergedLidars.find(l => l.lidarId === pairing.lidarId || l.ip === pairing.lidarIp)
            : null
          const isOnline = pairedLidar?.reachable ?? false
          
          const cx = toSvgX(p.position.x)
          const cy = toSvgY(p.position.z)
          
          // Color logic: blue=unpaired, translucent green=paired+offline, solid green=paired+online
          let fillColor: string
          let strokeColor: string
          let fillOpacity: number
          let markerFill: string
          
          if (!isPaired) {
            // Unpaired - blue
            fillColor = 'rgba(59, 130, 246, 0.1)'
            strokeColor = '#3b82f6'
            markerFill = '#3b82f6'
            fillOpacity = 1
          } else if (isOnline) {
            // Paired + Online - solid green
            fillColor = 'rgba(34, 197, 94, 0.15)'
            strokeColor = '#22c55e'
            markerFill = '#22c55e'
            fillOpacity = 1
          } else {
            // Paired + Offline - amber/orange tone (visible but distinct)
            fillColor = 'rgba(245, 158, 11, 0.15)'
            strokeColor = '#f59e0b'
            markerFill = '#f59e0b'
            fillOpacity = 1
          }
          
          return (
            <g key={p.id} style={{ opacity: fillOpacity }}>
              {/* Coverage circle */}
              <circle
                cx={cx}
                cy={cy}
                r={p.range * scale * 0.9}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth="1"
                strokeOpacity="0.5"
              />
              {/* LiDAR marker */}
              <circle
                cx={cx}
                cy={cy}
                r="5"
                fill={markerFill}
              />
              {/* Index label */}
              <text
                x={cx}
                y={cy + 3}
                fill="white"
                fontSize="7"
                textAnchor="middle"
              >
                {idx + 1}
              </text>
            </g>
          )
        })}
        
        {/* Dimensions */}
        <text x={svgWidth / 2} y={12} fill="#6b7280" fontSize="9" textAnchor="middle">
          {width.toFixed(1)}m
        </text>
        <text 
          x={8} 
          y={svgHeight / 2} 
          fill="#6b7280" 
          fontSize="9" 
          textAnchor="middle"
          transform={`rotate(-90, 8, ${svgHeight / 2})`}
        >
          {height.toFixed(1)}m
        </text>
      </svg>
      
      <div className="mt-2 text-[10px] text-gray-500 flex gap-3">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span> Unpaired
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span> Paired (Offline)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500"></span> Paired (Online)
        </span>
      </div>
    </div>
  )
}

// Deploy History Panel
function DeployHistoryPanel({ 
  history, 
  onClose 
}: { 
  history: any[]
  onClose: () => void 
}) {
  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-white">Deployment History</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {history.length === 0 ? (
        <div className="text-center text-gray-500 py-8 text-sm">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No deployments yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map(item => (
            <div
              key={item.id}
              className={`p-3 rounded-lg border ${
                item.status === 'applied'
                  ? 'bg-green-900/20 border-green-700'
                  : 'bg-red-900/20 border-red-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-gray-400">
                  {item.configHash.substring(0, 12)}
                </span>
                <span className={`text-xs ${item.status === 'applied' ? 'text-green-400' : 'text-red-400'}`}>
                  {item.status}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {new Date(item.createdAt).toLocaleString()}
              </div>
              {item.edgeTailscaleIp && (
                <div className="text-xs text-gray-500 mt-0.5">
                  → {item.edgeTailscaleIp}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
