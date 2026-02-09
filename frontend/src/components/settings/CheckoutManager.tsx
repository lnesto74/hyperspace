import { useState, useEffect, useCallback } from 'react'
import { Store, Users, AlertTriangle, ToggleLeft, ToggleRight, RefreshCw, Settings2, TrendingUp } from 'lucide-react'

interface LaneStatus {
  laneId: number
  desiredState: string
  appliedState: string
  status: string
  cashierPresent: boolean
  cashierTrackId: string | null
  cashierState: string | null
  queueCount: number
  inflowRate: number
  lastChangeTs: number | null
}

interface CheckoutStatus {
  lanes: LaneStatus[]
  aggregate: {
    totalLanes: number
    openLanes: number
    totalQueueCount: number
    totalInflowRate: number
    avgQueuePerLane: number
  }
  thresholds: {
    queuePressure: number
    inflowRate: number
  }
  suggestion: {
    type: string
    message: string
    suggestedLaneId: number
    reason: string
  } | null
}

interface CheckoutManagerProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const STATUS_COLORS = {
  CLOSED: 'bg-gray-600 text-gray-300',
  OPENING: 'bg-yellow-600 text-yellow-100',
  OPEN: 'bg-green-600 text-green-100',
  CLOSING: 'bg-orange-600 text-orange-100',
}

export function CheckoutManager({ enabled, onToggle }: CheckoutManagerProps) {
  const [status, setStatus] = useState<CheckoutStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [thresholds, setThresholds] = useState({ queuePressure: 5, inflowRate: 10 })
  const [pendingActions, setPendingActions] = useState<Set<number>>(new Set())

  const fetchStatus = useCallback(async () => {
    if (!enabled) return
    
    try {
      const res = await fetch(`${API_BASE}/api/edge-sim/checkout/status`)
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
        if (data.thresholds) {
          setThresholds({
            queuePressure: data.thresholds.queuePressure,
            inflowRate: data.thresholds.inflowRate,
          })
        }
        setError(null)
      } else {
        const errData = await res.json()
        setError(errData.error || 'Failed to fetch status')
      }
    } catch (err) {
      setError('Failed to connect to checkout manager')
    }
  }, [enabled])

  useEffect(() => {
    if (enabled) {
      fetchStatus()
      const interval = setInterval(fetchStatus, 2000)
      return () => clearInterval(interval)
    }
  }, [enabled, fetchStatus])

  const handleToggleLane = async (laneId: number, currentState: string) => {
    const newState = currentState === 'open' ? 'closed' : 'open'
    
    // Show confirmation for closing with queue
    const lane = status?.lanes.find(l => l.laneId === laneId)
    if (newState === 'closed' && lane && lane.queueCount > 0) {
      if (!confirm(`Lane ${laneId} has ${lane.queueCount} customers in queue. Close anyway?`)) {
        return
      }
    }
    
    setPendingActions(prev => new Set(prev).add(laneId))
    
    try {
      const res = await fetch(`${API_BASE}/api/edge-sim/checkout/set_lane_state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laneId, desiredState: newState, reason: 'manual' }),
      })
      
      if (!res.ok) {
        const errData = await res.json()
        setError(errData.error || 'Failed to update lane')
      } else {
        await fetchStatus()
      }
    } catch (err) {
      setError('Failed to update lane state')
    } finally {
      setPendingActions(prev => {
        const next = new Set(prev)
        next.delete(laneId)
        return next
      })
    }
  }

  const handleUpdateThresholds = async () => {
    setLoading(true)
    try {
      await fetch(`${API_BASE}/api/edge-sim/checkout/thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds),
      })
      setShowSettings(false)
      await fetchStatus()
    } catch (err) {
      setError('Failed to update thresholds')
    }
    setLoading(false)
  }

  const handleOpenSuggested = async () => {
    if (!status?.suggestion) return
    
    const laneId = status.suggestion.suggestedLaneId
    setPendingActions(prev => new Set(prev).add(laneId))
    
    try {
      await fetch(`${API_BASE}/api/edge-sim/checkout/set_lane_state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laneId, desiredState: 'open', reason: 'suggestion' }),
      })
      await fetchStatus()
    } catch (err) {
      setError('Failed to open suggested lane')
    } finally {
      setPendingActions(prev => {
        const next = new Set(prev)
        next.delete(laneId)
        return next
      })
    }
  }

  return (
    <div className="border-t border-gray-600 pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-gray-400 flex items-center gap-1">
          <Store className="w-3 h-3 text-blue-400" /> Checkout Manager
        </label>
        <div className="flex items-center gap-2">
          {enabled && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
              title="Settings"
            >
              <Settings2 className="w-3 h-3 text-gray-400" />
            </button>
          )}
          <button
            onClick={() => onToggle(!enabled)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              enabled
                ? 'bg-blue-600/30 text-blue-400 border border-blue-500/50'
                : 'bg-gray-700 text-gray-400 border border-gray-600'
            }`}
          >
            {enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {enabled && (
        <div className="space-y-2 pl-2 border-l border-blue-500/30">
          {error && (
            <div className="bg-red-900/50 text-red-300 px-2 py-1 rounded text-xs flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {error}
            </div>
          )}

          {/* Settings Panel */}
          {showSettings && (
            <div className="bg-gray-700/50 rounded p-2 space-y-2">
              <div className="text-xs text-gray-400 font-medium">Queue Pressure Thresholds</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Avg Queue/Lane</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={thresholds.queuePressure}
                    onChange={(e) => setThresholds(prev => ({ ...prev, queuePressure: parseInt(e.target.value) || 5 }))}
                    className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Inflow Rate/min</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={thresholds.inflowRate}
                    onChange={(e) => setThresholds(prev => ({ ...prev, inflowRate: parseInt(e.target.value) || 10 }))}
                    className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                  />
                </div>
              </div>
              <button
                onClick={handleUpdateThresholds}
                disabled={loading}
                className="w-full px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-xs text-white"
              >
                Save Thresholds
              </button>
            </div>
          )}

          {/* Aggregate Stats */}
          {status && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-gray-700/50 rounded p-1.5 text-center">
                <div className="text-gray-400">Open</div>
                <div className="text-white font-mono">
                  {status.aggregate.openLanes}/{status.aggregate.totalLanes}
                </div>
              </div>
              <div className="bg-gray-700/50 rounded p-1.5 text-center">
                <div className="text-gray-400">Queue</div>
                <div className="text-white font-mono">{status.aggregate.totalQueueCount}</div>
              </div>
              <div className="bg-gray-700/50 rounded p-1.5 text-center">
                <div className="text-gray-400 flex items-center justify-center gap-0.5">
                  <TrendingUp className="w-2.5 h-2.5" /> /min
                </div>
                <div className="text-white font-mono">{status.aggregate.totalInflowRate}</div>
              </div>
            </div>
          )}

          {/* Suggestion Banner */}
          {status?.suggestion && (
            <div className="bg-yellow-900/50 border border-yellow-600/50 rounded p-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs text-yellow-300">{status.suggestion.message}</div>
                <button
                  onClick={handleOpenSuggested}
                  disabled={pendingActions.has(status.suggestion.suggestedLaneId)}
                  className="mt-1 px-2 py-0.5 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 rounded text-xs text-white"
                >
                  Open Lane {status.suggestion.suggestedLaneId}
                </button>
              </div>
            </div>
          )}

          {/* Lane List */}
          {status && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {status.lanes.map((lane) => (
                <div
                  key={lane.laneId}
                  className="flex items-center justify-between bg-gray-700/30 rounded px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-8">L-{lane.laneId}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[lane.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.CLOSED}`}>
                      {lane.status}
                    </span>
                    {lane.cashierPresent && (
                      <span className="text-xs text-gray-500">
                        <Users className="w-3 h-3 inline" />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{lane.queueCount} in queue</span>
                    <button
                      onClick={() => handleToggleLane(lane.laneId, lane.appliedState)}
                      disabled={pendingActions.has(lane.laneId)}
                      className={`p-1 rounded transition-colors ${
                        pendingActions.has(lane.laneId)
                          ? 'bg-gray-600 cursor-wait'
                          : lane.appliedState === 'open'
                          ? 'bg-green-600/30 hover:bg-green-600/50'
                          : 'bg-gray-600/30 hover:bg-gray-600/50'
                      }`}
                      title={lane.appliedState === 'open' ? 'Close lane' : 'Open lane'}
                    >
                      {pendingActions.has(lane.laneId) ? (
                        <RefreshCw className="w-3 h-3 text-gray-400 animate-spin" />
                      ) : lane.appliedState === 'open' ? (
                        <ToggleRight className="w-4 h-4 text-green-400" />
                      ) : (
                        <ToggleLeft className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!status && !error && (
            <div className="text-xs text-gray-500 text-center py-2">
              <RefreshCw className="w-3 h-3 inline animate-spin mr-1" />
              Loading checkout status...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default CheckoutManager
