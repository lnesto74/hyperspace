import { useState } from 'react'
import { RefreshCw, Wifi, WifiOff, Radio, Plus, Link, Unlink, Trash2, GripVertical, LinkIcon, ChevronDown, ChevronRight } from 'lucide-react'
import { useLidar } from '../../context/LidarContext'
import { useVenue } from '../../context/VenueContext'
import { useTracking } from '../../context/TrackingContext'
import { LidarDevice, LidarPlacement, Vector3 } from '../../types'

export default function LidarNetworkPanel() {
  const { venue } = useVenue()
  const { 
    devices, 
    placements,
    selectedPlacementId,
    isScanning, 
    scanDevices, 
    connectDevice, 
    disconnectDevice,
    addPlacement,
    pairPlacement,
    updatePlacement,
    removePlacement,
    selectPlacement,
    getPlacementByDeviceId,
  } = useLidar()
  const { isConnected, tracks } = useTracking()
  
  const [draggedDeviceId, setDraggedDeviceId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [pairedDevicesExpanded, setPairedDevicesExpanded] = useState(false)

  const handleAddToScene = (device: LidarDevice) => {
    if (!venue) return
    const position: Vector3 = {
      x: venue.width / 2,
      y: 0,
      z: venue.depth / 2,
    }
    addPlacement(device.id, position)
  }
  
  const handleDragStart = (e: React.DragEvent, deviceId: string) => {
    setDraggedDeviceId(deviceId)
    e.dataTransfer.setData('deviceId', deviceId)
    e.dataTransfer.effectAllowed = 'link'
  }
  
  const handleDragEnd = () => {
    setDraggedDeviceId(null)
    setDropTargetId(null)
  }
  
  const handleDragOver = (e: React.DragEvent, placementId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'link'
    setDropTargetId(placementId)
  }
  
  const handleDragLeave = () => {
    setDropTargetId(null)
  }
  
  const handleDrop = (e: React.DragEvent, placementId: string) => {
    e.preventDefault()
    const deviceId = e.dataTransfer.getData('deviceId')
    if (deviceId) {
      pairPlacement(placementId, deviceId)
    }
    setDraggedDeviceId(null)
    setDropTargetId(null)
  }
  
  const handleUnpair = (placementId: string) => {
    pairPlacement(placementId, undefined)
  }
  
  // Split placements into paired and unassigned
  const pairedPlacements = placements.filter(p => p.deviceId)
  const unassignedPlacements = placements.filter(p => !p.deviceId)
  
  // Get devices that are already paired
  const pairedDeviceIds = new Set(pairedPlacements.map(p => p.deviceId).filter(Boolean))
  const availableDevices = devices.filter(d => !pairedDeviceIds.has(d.id))

  const getStatusColor = (status: LidarDevice['status']) => {
    switch (status) {
      case 'online': return 'text-green-400 bg-green-400/20'
      case 'connecting': return 'text-amber-400 bg-amber-400/20'
      case 'error': return 'text-red-400 bg-red-400/20'
      default: return 'text-gray-400 bg-gray-400/20'
    }
  }

  const getStatusIcon = (status: LidarDevice['status']) => {
    switch (status) {
      case 'online': return Wifi
      case 'connecting': return Radio
      default: return WifiOff
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Connection Status */}
      <div className={`p-3 rounded-lg border ${isConnected ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-sm ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {isConnected ? 'Tracking Connected' : 'Tracking Disconnected'}
          </span>
        </div>
        {isConnected && (
          <div className="mt-1 text-[10px] text-gray-400">
            {tracks.size} active track{tracks.size !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Scan Button */}
      <button
        onClick={scanDevices}
        disabled={isScanning}
        className="w-full py-2.5 bg-highlight text-white rounded-lg hover:bg-highlight-hover transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
        {isScanning ? 'Scanning...' : 'Scan Network'}
      </button>

      {/* Discovered Devices - Draggable */}
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          Discovered Devices ({devices.length})
        </h3>

        {devices.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No devices found.<br />
            Click "Scan Network" to discover LiDARs.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Available (unpaired) devices - always visible */}
            {availableDevices.map(device => {
              const StatusIcon = getStatusIcon(device.status)
              const isDragging = draggedDeviceId === device.id
              
              return (
                <div
                  key={device.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, device.id)}
                  onDragEnd={handleDragEnd}
                  className={`bg-card-bg border rounded-lg p-3 transition-all ${
                    isDragging 
                      ? 'border-highlight opacity-50 cursor-grabbing' 
                      : 'border-border-dark cursor-grab hover:border-gray-500'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-3 h-3 text-gray-500" />
                      <div className={`p-1.5 rounded ${getStatusColor(device.status)}`}>
                        <StatusIcon className="w-3 h-3" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{device.hostname}</div>
                        <div className="text-[10px] text-gray-500">{device.tailscaleIp}</div>
                      </div>
                    </div>
                    
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${getStatusColor(device.status)}`}>
                      {device.status}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {device.status === 'online' ? (
                      <button
                        onClick={() => disconnectDevice(device.id)}
                        className="flex-1 py-1.5 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30 transition-colors flex items-center justify-center gap-1"
                      >
                        <Unlink className="w-3 h-3" />
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => connectDevice(device.id)}
                        disabled={device.status === 'connecting'}
                        className="flex-1 py-1.5 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/30 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        <Link className="w-3 h-3" />
                        Connect
                      </button>
                    )}
                  </div>
                  
                  {/* Drag hint */}
                  {unassignedPlacements.length > 0 && (
                    <div className="mt-2 text-[10px] text-gray-500 text-center">
                      Drag to pair with a position below
                    </div>
                  )}
                </div>
              )
            })}
            
            {/* Paired devices - collapsible accordion */}
            {pairedDeviceIds.size > 0 && (
              <div className="border border-green-500/30 rounded-lg overflow-hidden">
                <button
                  onClick={() => setPairedDevicesExpanded(!pairedDevicesExpanded)}
                  className="w-full flex items-center justify-between p-2 bg-green-500/10 hover:bg-green-500/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {pairedDevicesExpanded ? (
                      <ChevronDown className="w-3 h-3 text-green-400" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-green-400" />
                    )}
                    <span className="text-xs text-green-400 font-medium">
                      Paired Devices ({pairedDeviceIds.size})
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-500">
                    {pairedDevicesExpanded ? 'collapse' : 'expand'}
                  </span>
                </button>
                
                {pairedDevicesExpanded && (
                  <div className="p-2 space-y-2 bg-card-bg/50">
                    {devices.filter(d => pairedDeviceIds.has(d.id)).map(device => {
                      const StatusIcon = getStatusIcon(device.status)
                      return (
                        <div
                          key={device.id}
                          className="bg-card-bg border border-green-500/30 rounded-lg p-2 opacity-70"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`p-1 rounded ${getStatusColor(device.status)}`}>
                                <StatusIcon className="w-2.5 h-2.5" />
                              </div>
                              <div>
                                <div className="text-xs font-medium text-white">{device.hostname}</div>
                                <div className="text-[9px] text-gray-500">{device.tailscaleIp}</div>
                              </div>
                            </div>
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full text-green-400 bg-green-400/20">
                              paired
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unassigned Positions - Drop Targets */}
      {unassignedPlacements.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-amber-400 uppercase tracking-wide mb-3">
            Unassigned Positions ({unassignedPlacements.length})
          </h3>
          <div className="space-y-2">
            {unassignedPlacements.map((placement, index) => {
              const isSelected = placement.id === selectedPlacementId
              const isDropTarget = dropTargetId === placement.id
              
              return (
                <div
                  key={placement.id}
                  onClick={() => selectPlacement(placement.id)}
                  onDragOver={(e) => handleDragOver(e, placement.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, placement.id)}
                  className={`bg-card-bg border-2 border-dashed rounded-lg p-3 cursor-pointer transition-all ${
                    isDropTarget 
                      ? 'border-highlight bg-highlight/10' 
                      : isSelected 
                        ? 'border-amber-400' 
                        : 'border-amber-400/30 hover:border-amber-400/60'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400" />
                      <span className="text-sm text-amber-400 font-medium">Position {index + 1}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removePlacement(placement.id) }}
                      className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      title="Remove position"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Position info */}
                  <div className="text-[10px] text-gray-500 mb-2">
                    Position: ({placement.position.x.toFixed(1)}, {placement.position.z.toFixed(1)})
                  </div>
                  
                  {/* Drop hint */}
                  {isDropTarget ? (
                    <div className="text-[10px] text-highlight text-center py-1 bg-highlight/20 rounded">
                      Drop to pair device here
                    </div>
                  ) : (
                    <div className="text-[10px] text-amber-400/60 text-center py-1">
                      Drag a device here to pair
                    </div>
                  )}

                  {/* Editable fields */}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">Mount Height (m)</label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        step="0.5"
                        value={placement.mountHeight}
                        onChange={(e) => updatePlacement(placement.id, { mountHeight: parseFloat(e.target.value) || 4 })}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1 text-xs text-white focus:border-highlight focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">Coverage (m)</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={placement.range}
                        onChange={(e) => updatePlacement(placement.id, { range: parseFloat(e.target.value) || 15 })}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1 text-xs text-white focus:border-highlight focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      
      {/* Paired LiDARs */}
      {pairedPlacements.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-green-400 uppercase tracking-wide mb-3">
            Paired LiDARs ({pairedPlacements.length})
          </h3>
          <div className="space-y-2">
            {pairedPlacements.map(placement => {
              const device = devices.find(d => d.id === placement.deviceId)
              const isSelected = placement.id === selectedPlacementId
              return (
                <div
                  key={placement.id}
                  onClick={() => selectPlacement(placement.id)}
                  className={`bg-card-bg border rounded-lg p-3 cursor-pointer transition-colors ${
                    isSelected ? 'border-green-400' : 'border-green-500/30 hover:border-green-500/60'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${device?.status === 'online' ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                      <span className="text-sm text-white font-medium">{device?.hostname || 'Unknown Device'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleUnpair(placement.id) }}
                        className="p-1 text-amber-500 hover:text-amber-400 hover:bg-amber-400/10 rounded transition-colors"
                        title="Unpair device"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removePlacement(placement.id) }}
                        className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        title="Remove from scene"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Position info */}
                  <div className="text-[10px] text-gray-500 mb-2">
                    Position: ({placement.position.x.toFixed(1)}, {placement.position.z.toFixed(1)}) • {device?.tailscaleIp}
                  </div>

                  {/* Editable fields */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">Mount Height (m)</label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        step="0.5"
                        value={placement.mountHeight}
                        onChange={(e) => updatePlacement(placement.id, { mountHeight: parseFloat(e.target.value) || 4 })}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1 text-xs text-white focus:border-highlight focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">Coverage (m)</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={placement.range}
                        onChange={(e) => updatePlacement(placement.id, { range: parseFloat(e.target.value) || 15 })}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1 text-xs text-white focus:border-highlight focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
        <h4 className="text-xs font-medium text-purple-400 mb-1">Network Discovery</h4>
        <p className="text-[10px] text-gray-400">
          Scans your Tailscale network for LiDAR concentrators. 
          Devices must be online and have Tailscale installed.
        </p>
      </div>
    </div>
  )
}
