import { useState, useEffect, useCallback } from 'react'
import { X, ShoppingCart, ToggleLeft, ToggleRight, AlertTriangle, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface LaneStatus {
  laneId: number
  name?: string
  desiredState: 'open' | 'closed'
  status: 'OPEN' | 'CLOSED' | 'OPENING' | 'CLOSING'
  queueCount: number
  cashierAgentId?: string | null
}

interface QueuePressure {
  totalQueueCount: number
  openLaneCount: number
  closedLaneCount: number
  avgQueuePerLane: number
  pressureThreshold: number
  shouldOpenMore: boolean
  suggestedLaneToOpen: number | null
}

interface CheckoutStatus {
  lanes: LaneStatus[]
  pressure: QueuePressure
  thresholds: {
    queuePressureThreshold: number
    inflowRateThreshold: number
  }
  source: 'simulation' | 'live'
}

interface CheckoutManagerModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function CheckoutManagerModal({ isOpen, onClose }: CheckoutManagerModalProps) {
  const { venue } = useVenue()
  const [status, setStatus] = useState<CheckoutStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'auto' | 'simulation' | 'live'>('auto')

  const fetchStatus = useCallback(async () => {
    if (!venue?.id) return
    
    setLoading(true)
    setError(null)
    
    try {
      // Try simulation first if auto or simulation mode
      if (dataSource === 'auto' || dataSource === 'simulation') {
        const simRes = await fetch(`${API_BASE}/api/edge-simulator/checkout/status`)
        if (simRes.ok) {
          const data = await simRes.json()
          setStatus({ ...data, source: 'simulation' })
          setLoading(false)
          return
        }
      }
      
      // Fall back to live data from ROI occupancy
      if (dataSource === 'auto' || dataSource === 'live') {
        const liveRes = await fetch(`${API_BASE}/api/venues/${venue.id}/checkout/live-status`)
        if (liveRes.ok) {
          const data = await liveRes.json()
          setStatus({ ...data, source: 'live' })
          setLoading(false)
          return
        }
      }
      
      setError('No checkout data available')
    } catch (err) {
      setError('Failed to fetch checkout status')
    }
    setLoading(false)
  }, [venue?.id, dataSource])

  useEffect(() => {
    if (!isOpen) return
    
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [isOpen, fetchStatus])

  const handleSetLaneState = async (laneId: number, state: 'open' | 'closed') => {
    try {
      const endpoint = status?.source === 'simulation' 
        ? `${API_BASE}/api/edge-simulator/checkout/set_lane_state`
        : `${API_BASE}/api/venues/${venue?.id}/checkout/set_lane_state`
      
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laneId, state })
      })
      fetchStatus()
    } catch (err) {
      console.error('Failed to set lane state:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Checkout Manager</h2>
              <div className="flex items-center gap-2 text-xs">
                {status?.source === 'simulation' ? (
                  <span className="text-purple-400 flex items-center gap-1">
                    <Wifi className="w-3 h-3" /> Simulation
                  </span>
                ) : status?.source === 'live' ? (
                  <span className="text-green-400 flex items-center gap-1">
                    <Wifi className="w-3 h-3" /> Live Data
                  </span>
                ) : (
                  <span className="text-gray-500 flex items-center gap-1">
                    <WifiOff className="w-3 h-3" /> Disconnected
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {error ? (
            <div className="text-center py-8 text-gray-400">
              <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>{error}</p>
              <p className="text-xs mt-2">Start the simulator or configure live data source</p>
            </div>
          ) : !status ? (
            <div className="text-center py-8 text-gray-400">
              <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
              <p>Loading...</p>
            </div>
          ) : (
            <>
              {/* Queue Pressure Alert */}
              {status.pressure?.shouldOpenMore && (
                <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-3 mb-4 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-yellow-400">High Queue Pressure</div>
                    <div className="text-xs text-yellow-400/80">
                      Consider opening Lane {status.pressure.suggestedLaneToOpen}
                    </div>
                  </div>
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-800 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-400">
                    {status.pressure?.openLaneCount || 0}
                  </div>
                  <div className="text-xs text-gray-500">Open Lanes</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-400">
                    {status.pressure?.totalQueueCount || 0}
                  </div>
                  <div className="text-xs text-gray-500">In Queue</div>
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-gray-300">
                    {status.pressure?.avgQueuePerLane?.toFixed(1) || '0'}
                  </div>
                  <div className="text-xs text-gray-500">Avg/Lane</div>
                </div>
              </div>

              {/* Threshold Info */}
              <div className="bg-gray-800/50 rounded-lg p-2 mb-4 text-xs text-gray-400 text-center">
                Alert threshold: {status.thresholds?.queuePressureThreshold || 5} people/lane
              </div>

              {/* Lane List */}
              <div className="space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Lane Controls</div>
                {(!status.lanes || status.lanes.length === 0) ? (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No checkout lanes detected
                  </div>
                ) : (
                  status.lanes.map((lane) => (
                    <div 
                      key={lane.laneId} 
                      className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          lane.status === 'OPEN' ? 'bg-green-400' :
                          lane.status === 'OPENING' ? 'bg-yellow-400 animate-pulse' :
                          lane.status === 'CLOSING' ? 'bg-orange-400 animate-pulse' :
                          'bg-gray-600'
                        }`} />
                        <div>
                          <div className="text-sm font-medium text-white">
                            {lane.name || `Lane ${lane.laneId}`}
                          </div>
                          <div className="text-xs text-gray-500">
                            {lane.status}
                            {lane.queueCount > 0 && (
                              <span className="text-blue-400 ml-2">
                                {lane.queueCount} queued
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleSetLaneState(lane.laneId, lane.desiredState === 'open' ? 'closed' : 'open')}
                        className={`p-2 rounded-lg transition-colors ${
                          lane.desiredState === 'open' 
                            ? 'text-green-400 hover:bg-green-500/20' 
                            : 'text-gray-500 hover:bg-gray-700'
                        }`}
                        title={lane.desiredState === 'open' ? 'Close lane' : 'Open lane'}
                      >
                        {lane.desiredState === 'open' ? (
                          <ToggleRight className="w-6 h-6" />
                        ) : (
                          <ToggleLeft className="w-6 h-6" />
                        )}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/30">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {status?.lanes?.length || 0} lanes configured
            </span>
            <div className="flex items-center gap-2">
              <span>Data source:</span>
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as 'auto' | 'simulation' | 'live')}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-300 text-xs"
              >
                <option value="auto">Auto</option>
                <option value="simulation">Simulation</option>
                <option value="live">Live</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
