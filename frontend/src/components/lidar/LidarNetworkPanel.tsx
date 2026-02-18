import { useState, useEffect } from 'react'
import { Wifi, WifiOff, Radio, Server, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { useLidar } from '../../context/LidarContext'
import { useTracking } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import { LidarDevice } from '../../types'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface Pairing {
  id: string
  venueId: string
  placementId: string
  lidarId: string
  lidarIp: string
}

interface LidarNetworkPanelProps {
  onOpenEdgeCommissioning?: () => void
}

export default function LidarNetworkPanel({ onOpenEdgeCommissioning }: LidarNetworkPanelProps) {
  const { devices, placements } = useLidar()
  const { isConnected, tracks } = useTracking()
  const { venue } = useVenue()
  
  const [pairings, setPairings] = useState<Pairing[]>([])
  const [showAllDevices, setShowAllDevices] = useState(false)

  // Fetch pairings from Edge Commissioning API
  useEffect(() => {
    if (!venue?.id) return
    
    const fetchPairings = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/edge-commissioning/pairings?venueId=${venue.id}`)
        if (res.ok) {
          const data = await res.json()
          setPairings(data.pairings || [])
        }
      } catch (err) {
        console.error('Failed to fetch pairings:', err)
      }
    }
    
    fetchPairings()
  }, [venue?.id])

  const onlineDevices = devices.filter(d => d.status === 'online')

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
      {/* Tracking Status */}
      <div className={`p-3 rounded-lg border ${isConnected ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-sm ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {isConnected ? 'Tracking Active' : 'Tracking Offline'}
          </span>
        </div>
        {isConnected && (
          <div className="mt-1 text-[10px] text-gray-400">
            {tracks.size} active track{tracks.size !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card-bg border border-border-dark rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Radio className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-gray-400">Devices</span>
          </div>
          <div className="text-xl font-semibold text-white">{devices.length}</div>
          <div className="text-[10px] text-gray-500">
            {onlineDevices.length} online
          </div>
        </div>
        <div className="bg-card-bg border border-border-dark rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Wifi className="w-4 h-4 text-green-400" />
            <span className="text-xs text-gray-400">Paired</span>
          </div>
          <div className="text-xl font-semibold text-white">{pairings.length}</div>
          <div className="text-[10px] text-gray-500">
            of {placements.length} positions
          </div>
        </div>
      </div>

      {/* Device List (read-only) */}
      {devices.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Connected Devices
          </h3>
          <div className="space-y-1.5">
            {(showAllDevices ? devices : devices.slice(0, 5)).map(device => {
              const StatusIcon = getStatusIcon(device.status)
              return (
                <div
                  key={device.id}
                  className="flex items-center justify-between bg-card-bg/50 border border-border-dark rounded px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className={`p-1 rounded ${getStatusColor(device.status)}`}>
                      <StatusIcon className="w-3 h-3" />
                    </div>
                    <div>
                      <div className="text-xs text-white">{device.hostname}</div>
                      <div className="text-[10px] text-gray-500">{device.tailscaleIp}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${getStatusColor(device.status)}`}>
                    {device.status}
                  </span>
                </div>
              )
            })}
            {devices.length > 5 && (
              <button
                onClick={() => setShowAllDevices(!showAllDevices)}
                className="w-full text-[10px] text-gray-400 hover:text-white text-center py-1.5 flex items-center justify-center gap-1 hover:bg-white/5 rounded transition-colors"
              >
                {showAllDevices ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    +{devices.length - 5} more devices
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Manage Button */}
      {onOpenEdgeCommissioning && (
        <button
          onClick={onOpenEdgeCommissioning}
          className="w-full py-2.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/30 transition-colors flex items-center justify-center gap-2 text-sm"
        >
          <Server className="w-4 h-4" />
          Manage LiDARs
          <ExternalLink className="w-3 h-3" />
        </button>
      )}

      {/* Info */}
      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3">
        <h4 className="text-xs font-medium text-cyan-400 mb-1">Edge Commissioning</h4>
        <p className="text-[10px] text-gray-400">
          Use Edge Commissioning for full LiDAR management: scanning, pairing, point cloud viewing, and deployment.
        </p>
      </div>
    </div>
  )
}
