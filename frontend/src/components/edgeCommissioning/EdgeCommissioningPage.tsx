import { useEffect, useState, useRef } from 'react'
import { 
  Server, Radio, Wifi, WifiOff, RefreshCw, Search, Upload, 
  Check, X, AlertCircle, Clock, Link2, Unlink, Download, Wand2, Camera, Pencil, Package, Maximize2, StopCircle, Terminal, ChevronDown, ChevronUp
} from 'lucide-react'
import { useEdgeCommissioning, EdgeDevice, EdgeLidar, EdgePlacement, EdgePairing, RoiBounds, DwgLayout, DwgFixture } from '../../context/EdgeCommissioningContext'
import { useVenue } from '../../context/VenueContext'
import LidarCommissioningWizard from './LidarCommissioningWizard'
import PointCloudViewer from './PointCloudViewer'
import ProviderSelectionPanel from './ProviderSelectionPanel'

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
    dwgLayout,
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
    // HER
    herEnabled,
    setHerEnabled,
    selectedProviderId,
    selectProvider,
    deployHer,
    stopHer,
    loadProviders,
    getSelectedProvider,
  } = useEdgeCommissioning()

  const [draggedLidar, setDraggedLidar] = useState<EdgeLidar | null>(null)
  const [showDeployHistory, setShowDeployHistory] = useState(false)
  const [showCommissioningWizard, setShowCommissioningWizard] = useState(false)
  const [pointCloudLidar, setPointCloudLidar] = useState<{ ip: string; tailscaleIp: string } | null>(null)
  const [editingEdge, setEditingEdge] = useState<EdgeDevice | null>(null)
  const [editName, setEditName] = useState('')
  const [hoveredPlacementIndex, setHoveredPlacementIndex] = useState<number | null>(null)
  const [showWireframeModal, setShowWireframeModal] = useState(false)
  const [middlePanelTab, setMiddlePanelTab] = useState<'lidar' | 'algorithm'>('lidar')
  const [herDeployLogs, setHerDeployLogs] = useState<string[]>([])
  const [showDeployDebug, setShowDeployDebug] = useState(false)
  const debugLogRef = useRef<HTMLDivElement>(null)
  const [mqttBrokerUrl, setMqttBrokerUrl] = useState(() => {
    // Try to load from localStorage, default to empty
    return localStorage.getItem('herMqttBrokerUrl') || ''
  })

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

  // Fetch inventory when edge is selected + auto-refresh every 30 seconds
  useEffect(() => {
    if (selectedEdgeId) {
      fetchEdgeInventory(selectedEdgeId)
      fetchEdgeStatus(selectedEdgeId)
      
      // Auto-refresh inventory every 30 seconds to keep LiDAR status current
      const pollInterval = setInterval(() => {
        fetchEdgeInventory(selectedEdgeId)
        fetchEdgeStatus(selectedEdgeId)
      }, 30000)
      
      return () => clearInterval(pollInterval)
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

  // Load providers on mount
  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // Deploy simulator config (existing behavior)
  const handleDeploySimulator = async () => {
    if (!selectedEdgeId || !venue?.id) return
    await deployToEdge(selectedEdgeId, venue.id)
    // Refresh edge status after deploy
    await fetchEdgeStatus(selectedEdgeId)
  }

  // Deploy HER with provider
  const handleDeployHer = async () => {
    if (!selectedEdgeId || !venue?.id || !selectedProviderId) return
    
    // Clear previous logs and show debug panel
    setHerDeployLogs([])
    setShowDeployDebug(true)
    
    const addLog = (msg: string) => {
      const timestamp = new Date().toLocaleTimeString()
      setHerDeployLogs(prev => [...prev, `[${timestamp}] ${msg}`])
    }
    
    addLog('Starting HER deployment...')
    addLog(`Provider: ${selectedProvider?.name} v${selectedProvider?.version}`)
    addLog(`Edge: ${selectedEdge?.hostname}`)
    addLog(`Docker Image: ${selectedProvider?.dockerImage}`)
    addLog(`MQTT Broker: ${mqttBrokerUrl || '(default localhost)'}`)
    addLog('Sending deploy request to backend...')
    
    const result = await deployHer(selectedEdgeId, venue.id, selectedProviderId, mqttBrokerUrl || undefined)
    
    if (result) {
      addLog('✅ Deploy request sent successfully')
      addLog(`Deployment ID: ${result.deploymentId}`)
      if (result.herResponse) {
        addLog(`Container ID: ${result.herResponse.moduleStatus?.containerId?.substring(0, 12) || 'N/A'}`)
        addLog(`Image Pulled: ${result.herResponse.moduleStatus?.imagePulled ? 'Yes' : 'No'}`)
        addLog(`Container Running: ${result.herResponse.moduleStatus?.containerRunning ? 'Yes' : 'No'}`)
      }
      addLog('✅ HER deployment complete!')
    } else {
      addLog('❌ Deploy failed - check error above')
    }
    
    // Refresh edge status after deploy
    await fetchEdgeStatus(selectedEdgeId)
  }

  // Stop HER and return to simulator
  const handleStopHer = async () => {
    if (!selectedEdgeId) return
    await stopHer(selectedEdgeId)
    // Refresh edge status after stop
    await fetchEdgeStatus(selectedEdgeId)
  }

  const selectedProvider = getSelectedProvider()
  const canDeployHer = canDeploy && herEnabled && selectedProviderId

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
            <div className="flex items-center gap-2">
              {/* Simulator Deploy */}
              <button
                onClick={handleDeploySimulator}
                disabled={!canDeploy || isDeploying}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  canDeploy && !herEnabled
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Deploy simulator configuration"
              >
                <Upload className="w-4 h-4" />
                {isDeploying && !herEnabled ? 'Deploying...' : 'Deploy Simulator'}
              </button>
              
              {/* HER Deploy */}
              {herEnabled && selectedProviderId && (
                <button
                  onClick={handleDeployHer}
                  disabled={!canDeployHer || isDeploying}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    canDeployHer
                      ? 'bg-purple-600 hover:bg-purple-700 text-white'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                  title={`Deploy HER with ${selectedProvider?.name || 'provider'}`}
                >
                  <Package className="w-4 h-4" />
                  {isDeploying && herEnabled ? 'Deploying...' : `Deploy HER`}
                </button>
              )}
              
              {/* Stop HER - Return to Simulator */}
              {herEnabled && (
                <button
                  onClick={handleStopHer}
                  disabled={!selectedEdgeId || isDeploying}
                  className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors bg-red-600 hover:bg-red-700 text-white disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
                  title="Stop HER and return to simulator mode"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop HER
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* HER Deploy Debug Panel */}
      {showDeployDebug && (
        <div className="border-b border-gray-700 bg-gray-950">
          <button
            onClick={() => setShowDeployDebug(!showDeployDebug)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm hover:bg-gray-800"
          >
            <div className="flex items-center gap-2 text-purple-400">
              <Terminal className="w-4 h-4" />
              <span className="font-medium">HER Deploy Log</span>
              {isDeploying && <RefreshCw className="w-3 h-3 animate-spin text-yellow-400" />}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{herDeployLogs.length} entries</span>
              {showDeployDebug ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>
          <div 
            ref={debugLogRef}
            className="max-h-48 overflow-y-auto px-4 pb-3 font-mono text-xs"
          >
            {herDeployLogs.length === 0 ? (
              <div className="text-gray-500 py-2">Waiting for deployment...</div>
            ) : (
              herDeployLogs.map((log, i) => (
                <div 
                  key={i} 
                  className={`py-0.5 ${
                    log.includes('✅') ? 'text-green-400' : 
                    log.includes('❌') ? 'text-red-400' : 
                    log.includes('Docker Image:') ? 'text-cyan-400' :
                    'text-gray-300'
                  }`}
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      )}

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

        {/* Middle Panel - LiDAR Inventory / Algorithm Provider (Tabbed) */}
        <div className="w-80 border-r border-gray-700 flex flex-col bg-gray-850">
          {/* Tabs */}
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setMiddlePanelTab('lidar')}
              className={`flex-1 py-2.5 px-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                middlePanelTab === 'lidar'
                  ? 'text-white border-b-2 border-blue-500 bg-gray-800'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <Radio className="w-4 h-4" />
              LiDARs
              {mergedLidars.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  middlePanelTab === 'lidar' ? 'bg-blue-600' : 'bg-gray-600'
                }`}>
                  {mergedLidars.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setMiddlePanelTab('algorithm')}
              className={`flex-1 py-2.5 px-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                middlePanelTab === 'algorithm'
                  ? 'text-white border-b-2 border-purple-500 bg-gray-800'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <Package className="w-4 h-4" />
              Algorithm
              {herEnabled && (
                <span className="w-2 h-2 bg-purple-500 rounded-full" />
              )}
            </button>
          </div>

          {/* Tab Content */}
          {middlePanelTab === 'lidar' ? (
            <>
              {/* LiDAR Actions Bar */}
              {selectedEdge && (
                <div className="p-2 border-b border-gray-700 flex items-center justify-between bg-gray-800/50">
                  <span className="text-xs text-gray-400">
                    {selectedEdge.hostname}
                  </span>
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
                </div>
              )}

              {/* LiDAR List */}
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
            </>
          ) : (
            /* Algorithm Tab Content - Just the HER toggle */
            <div className="flex-1 overflow-auto p-3">
              {!selectedEdge ? (
                <div className="text-center text-gray-500 py-8 text-sm">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Select an edge device first</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-xs text-gray-400 mb-3">
                    Enable HER mode for production deployment with real LiDAR data
                  </div>
                  
                  {/* HER Enable Toggle */}
                  <label className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    herEnabled 
                      ? 'bg-purple-900/30 border-purple-500/50' 
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}>
                    <input
                      type="checkbox"
                      checked={herEnabled}
                      onChange={(e) => {
                        setHerEnabled(e.target.checked)
                        if (!e.target.checked) {
                          selectProvider(null)
                        }
                      }}
                      disabled={!canDeploy}
                      className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-purple-400" />
                        <span className="font-medium text-white">HER Mode</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Production deployment with algorithm provider
                      </p>
                    </div>
                  </label>
                  
                  {herEnabled && (
                    <div className="text-xs text-green-400 flex items-center gap-2 p-2 bg-green-900/20 rounded">
                      <Check className="w-4 h-4" />
                      <span>Select provider in right panel →</span>
                    </div>
                  )}
                  
                  {!herEnabled && (
                    <div className="text-xs text-gray-500 p-2">
                      When disabled, deploy will use the built-in simulator for testing.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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

        {/* Right Panel - Content based on middle panel tab */}
        <div className="flex-1 flex flex-col bg-gray-900">
          {middlePanelTab === 'lidar' ? (
            <>
              {/* LiDAR Tab -> Show Placements */}
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
                    <div className="flex flex-col h-full">
                      {/* ROI Wireframe Visualization - Compact with expand button */}
                      {roiBounds && (
                        <div className="bg-gray-800 rounded mb-3 p-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400">ROI Wireframe</span>
                            <button
                              onClick={() => setShowWireframeModal(true)}
                              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                              title="Expand wireframe view"
                            >
                              <Maximize2 className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="h-[240px] overflow-hidden">
                            <RoiWireframe 
                              placements={placements} 
                              roiBounds={roiBounds}
                              pairings={pairings}
                              mergedLidars={mergedLidars}
                              hoveredIndex={hoveredPlacementIndex}
                              dwgLayout={dwgLayout}
                              compact={true}
                            />
                          </div>
                        </div>
                      )}
                      
                      {/* Placement Cards - Scrollable */}
                      <div className="flex-1 overflow-y-auto pr-1">
                        <div className="grid grid-cols-2 gap-3">
                          {placements.map((placement, index) => (
                            <PlacementCard
                              key={placement.id}
                              placement={placement}
                              pairing={getPairingForPlacement(placement.id)}
                              isDragOver={draggedLidar !== null}
                              onDrop={() => handleDrop(placement)}
                              onUnpair={() => venue?.id && unpairPlacement(venue.id, placement.id)}
                              roiBounds={roiBounds}
                              mergedLidars={mergedLidars}
                              index={index + 1}
                              onHover={(hovering) => setHoveredPlacementIndex(hovering ? index + 1 : null)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Algorithm Tab -> Show Provider Selection */}
              <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium text-white">Algorithm Provider Configuration</span>
                </div>
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
                <div className="flex-1 overflow-auto p-4">
                  {!selectedEdge ? (
                    <div className="text-center text-gray-500 py-8">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Select an edge device first</p>
                    </div>
                  ) : !herEnabled ? (
                    <div className="text-center text-gray-500 py-8">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Enable HER Mode in the Algorithm tab</p>
                      <p className="text-xs mt-1">← Click the checkbox to enable</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-green-400 text-sm bg-green-900/20 rounded-lg p-3">
                        <Check className="w-4 h-4" />
                        <span>HER Mode Enabled - Select a provider below</span>
                      </div>
                      <ProviderSelectionPanel 
                        disabled={!canDeploy} 
                        mqttBrokerUrl={mqttBrokerUrl}
                        onMqttBrokerUrlChange={(url) => {
                          setMqttBrokerUrl(url)
                          localStorage.setItem('herMqttBrokerUrl', url)
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ROI Wireframe Modal - Expanded View */}
      {showWireframeModal && roiBounds && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-[800px] max-w-[90vw] border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white">ROI Wireframe - Full View</h3>
              <button
                onClick={() => setShowWireframeModal(false)}
                className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-[500px]">
              <RoiWireframe 
                placements={placements} 
                roiBounds={roiBounds}
                pairings={pairings}
                mergedLidars={mergedLidars}
                hoveredIndex={hoveredPlacementIndex}
                dwgLayout={dwgLayout}
              />
            </div>
          </div>
        </div>
      )}

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
  index,
  onHover,
}: {
  placement: EdgePlacement
  pairing?: EdgePairing
  isDragOver: boolean
  onDrop: () => void
  onUnpair: () => void
  roiBounds: RoiBounds | null
  mergedLidars: EdgeLidar[]
  index: number
  onHover: (hovering: boolean) => void
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
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`${cardClasses} relative`}
    >
      {/* Index number in bottom right */}
      <span className="absolute bottom-2 right-2 text-2xl font-bold text-gray-600/50">
        {index}
      </span>
      
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
  hoveredIndex,
  dwgLayout,
  compact = false,
}: {
  placements: EdgePlacement[]
  roiBounds: RoiBounds
  pairings: EdgePairing[]
  mergedLidars: EdgeLidar[]
  hoveredIndex: number | null
  dwgLayout: DwgLayout | null
  compact?: boolean
}) {
  const width = roiBounds.maxX - roiBounds.minX
  const height = roiBounds.maxZ - roiBounds.minZ
  
  // Calculate max lidar range to determine extra padding needed for circles
  const maxRange = placements.length > 0 ? Math.max(...placements.map(p => p.range)) : 0
  
  // SVG dimensions and scaling - add extra padding for lidar coverage circles
  const baseWidth = compact ? 200 : 330
  const scale = baseWidth / width
  const circleOverhang = maxRange * scale * 0.9 // How much circles extend beyond ROI
  const padding = compact ? Math.max(30, circleOverhang + 5) : Math.max(60, circleOverhang + 10)
  const svgWidth = baseWidth + padding * 2
  const svgHeight = (height * scale) + padding * 2

  // Transform DWG coordinates to SVG coordinates
  const toSvgX = (x: number) => padding + (x - roiBounds.minX) * scale
  const toSvgY = (z: number) => padding + (z - roiBounds.minZ) * scale

  // In compact mode, render without wrapper div
  if (compact) {
    return (
      <svg 
        width="100%" 
        height="100%" 
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="bg-gray-900 rounded"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* ROI boundary */}
        <rect
          x={padding}
          y={padding}
          width={baseWidth}
          height={height * scale}
          fill="none"
          stroke="#374151"
          strokeWidth="1"
          strokeDasharray="4,4"
        />
        
        {/* Placements */}
        {placements.map((p, i) => {
          const cx = toSvgX(p.position.x)
          const cy = toSvgY(p.position.z)
          const pairing = pairings.find(pr => pr.placementId === p.id)
          const isPaired = !!pairing
          const isHovered = hoveredIndex === i + 1
          
          // Find the paired LiDAR to check online status
          const pairedLidar = pairing 
            ? mergedLidars.find(l => l.lidarId === pairing.lidarId || l.ip === pairing.lidarIp)
            : null
          const isOnline = pairedLidar?.reachable ?? false
          
          // Color scheme: green=paired+online, amber=paired+offline, blue=unpaired
          let strokeColor = '#3b82f6' // blue - unpaired
          let fillColor = 'rgba(59, 130, 246, 0.1)'
          let textColor = '#9ca3af' // gray
          
          if (isPaired && isOnline) {
            strokeColor = '#22c55e' // green
            fillColor = 'rgba(34, 197, 94, 0.1)'
            textColor = '#22c55e'
          } else if (isPaired && !isOnline) {
            strokeColor = '#f59e0b' // amber
            fillColor = 'rgba(245, 158, 11, 0.1)'
            textColor = '#f59e0b'
          }
          
          return (
            <g key={p.id}>
              <circle
                cx={cx}
                cy={cy}
                r={p.range * scale * 0.8}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={isHovered ? 2 : 1}
                opacity={0.6}
              />
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill={strokeColor}
              />
              <text
                x={cx}
                y={cy - 8}
                textAnchor="middle"
                fill={textColor}
                fontSize="8"
              >
                {i + 1}
              </text>
            </g>
          )
        })}
      </svg>
    )
  }

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
        {/* Animation keyframes */}
        <defs>
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.6; }
            }
            @keyframes ping {
              0% { transform: scale(1); opacity: 0.8; }
              75%, 100% { transform: scale(1.3); opacity: 0; }
            }
          `}</style>
        </defs>
        
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
        
        {/* DWG Floor Plan Fixtures */}
        {dwgLayout && dwgLayout.fixtures.map((fixture) => {
          // Convert DWG coordinates to SVG coordinates
          // DWG uses Y-up, we need to flip and scale
          const unitScale = dwgLayout.unitScaleToM || 0.001
          
          if (fixture.footprint.kind === 'poly' && fixture.footprint.points.length > 2) {
            // Render polygon fixtures
            const points = fixture.footprint.points.map(pt => {
              const xM = pt.x * unitScale
              const yM = pt.y * unitScale // DWG Y maps to our Z
              const svgX = toSvgX(xM)
              const svgY = toSvgY(yM)
              return `${svgX},${svgY}`
            }).join(' ')
            
            return (
              <polygon
                key={fixture.id}
                points={points}
                fill="#1e293b"
                stroke="#475569"
                strokeWidth="0.5"
                opacity="0.8"
              />
            )
          } else {
            // Render rectangular fixtures
            const xM = fixture.pose2d.x * unitScale
            const yM = fixture.pose2d.y * unitScale
            const wM = fixture.footprint.w * unitScale
            const dM = fixture.footprint.d * unitScale
            
            const cx = toSvgX(xM)
            const cy = toSvgY(yM)
            const w = wM * scale
            const h = dM * scale
            const rotation = -fixture.pose2d.rot_deg
            
            return (
              <g key={fixture.id} transform={`translate(${cx}, ${cy}) rotate(${rotation})`}>
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  fill="#1e293b"
                  stroke="#475569"
                  strokeWidth="0.5"
                  opacity="0.8"
                />
              </g>
            )
          }
        })}
        
        {/* LiDAR positions */}
        {placements.map((p, idx) => {
          const pairing = pairings.find(pair => pair.placementId === p.id)
          const isPaired = !!pairing
          // Check if the paired lidar is online
          const pairedLidar = pairing 
            ? mergedLidars.find(l => l.lidarId === pairing.lidarId || l.ip === pairing.lidarIp)
            : null
          const isOnline = pairedLidar?.reachable ?? false
          const isHovered = hoveredIndex === idx + 1
          
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
                strokeWidth={isHovered ? "3" : "1"}
                strokeOpacity={isHovered ? "1" : "0.5"}
                style={isHovered ? {
                  animation: 'pulse 1s ease-in-out infinite',
                } : undefined}
              />
              {/* Pulse ring when hovered */}
              {isHovered && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={p.range * scale * 0.9}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2"
                  style={{
                    animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
                    transformOrigin: `${cx}px ${cy}px`,
                  }}
                />
              )}
              {/* LiDAR marker */}
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? "7" : "5"}
                fill={markerFill}
                style={isHovered ? {
                  filter: 'drop-shadow(0 0 4px ' + markerFill + ')',
                } : undefined}
              />
              {/* Index label */}
              <text
                x={cx}
                y={cy + 3}
                fill="white"
                fontSize={isHovered ? "9" : "7"}
                fontWeight={isHovered ? "bold" : "normal"}
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
