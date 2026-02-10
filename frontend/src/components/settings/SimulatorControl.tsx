import { useState, useEffect, useCallback } from 'react'
import { Play, Square, RefreshCw, Users, Clock, Gauge, AlertCircle, CheckCircle2, Wifi, WifiOff, MapPin, UserCheck, Coffee, AlertTriangle, ShoppingCart, ToggleLeft, ToggleRight } from 'lucide-react'
import { QueueCircles, QueuedPerson } from './QueueCircles'

interface SimulatorConfig {
  targetPeopleCount: number
  avgStayTime: number
  frequencyHz: number
  simulationMode: string
  queueSpawnInterval: number
  venueId?: string
  // Cashier settings
  enableCashiers: boolean
  cashierShiftMin: number
  cashierBreakProb: number
  laneOpenConfirmSec: number
  enableIdConfusion: boolean
  // Checkout Manager settings
  enableCheckoutManager?: boolean
  queuePressureThreshold?: number
  // Queue Pressure Controls (for KPI-driven simulation)
  checkoutProbMultiplier?: number
  browsingSpeedMultiplier?: number
  arrivalRateMultiplier?: number
  // Wait time thresholds (minutes)
  waitTimeWarningMin?: number
  waitTimeCriticalMin?: number
}

interface LaneStatus {
  laneId: number
  desiredState: 'open' | 'closed'
  status: 'OPEN' | 'CLOSED' | 'OPENING' | 'CLOSING'
  queueCount: number
  queuedPeople?: QueuedPerson[]
}

interface CheckoutStatus {
  connected: boolean
  lanes: LaneStatus[]
  pressure: {
    totalQueueCount: number
    openLaneCount: number
    avgQueuePerLane: number
    shouldOpenMore: boolean
    suggestedLaneToOpen: number | null
  }
  thresholds: {
    queuePressureThreshold: number
  }
}

interface Venue {
  id: string
  name: string
  width: number
  depth: number
}

interface SimulatorStatus {
  connected: boolean
  isRunning: boolean
  activePeopleCount: number
  uptime: number
  tracksSent: number
  simVersion?: string
  config?: SimulatorConfig
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export function SimulatorControl() {
  const [status, setStatus] = useState<SimulatorStatus | null>(null)
  const [config, setConfig] = useState<SimulatorConfig>({
    targetPeopleCount: 20,
    avgStayTime: 5,
    frequencyHz: 14,
    simulationMode: 'mixed',
    queueSpawnInterval: 6,
    // Cashier defaults
    enableCashiers: true,
    cashierShiftMin: 60,
    cashierBreakProb: 15,
    laneOpenConfirmSec: 120,
    enableIdConfusion: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configDirty, setConfigDirty] = useState(false)
  const [venues, setVenues] = useState<Venue[]>([])
  const [selectedVenueId, setSelectedVenueId] = useState<string>('')
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)

  // Fetch available venues
  const fetchVenues = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/venues`)
      const data = await res.json()
      setVenues(data)
    } catch (err) {
      console.error('Failed to fetch venues:', err)
    }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-simulator/status`)
      const data = await res.json()
      setStatus(data)
      if (data.config && !configDirty) {
        setConfig({
          targetPeopleCount: data.config.targetPeopleCount || 20,
          avgStayTime: data.config.avgStayTime || 5,
          frequencyHz: data.config.frequencyHz || 14,
          simulationMode: data.config.simulationMode || 'mixed',
          queueSpawnInterval: data.config.queueSpawnInterval || 6,
          // Cashier settings
          enableCashiers: data.config.enableCashiers ?? true,
          cashierShiftMin: data.config.cashierShiftMin || 60,
          cashierBreakProb: data.config.cashierBreakProb || 15,
          laneOpenConfirmSec: data.config.laneOpenConfirmSec || 120,
          enableIdConfusion: data.config.enableIdConfusion ?? false,
          // Checkout Manager settings
          enableCheckoutManager: data.config.enableCheckoutManager ?? false,
          queuePressureThreshold: data.config.queuePressureThreshold || 5,
          // Queue Pressure Controls
          checkoutProbMultiplier: data.config.checkoutProbMultiplier || 1.0,
          browsingSpeedMultiplier: data.config.browsingSpeedMultiplier || 1.0,
          arrivalRateMultiplier: data.config.arrivalRateMultiplier || 1.0,
          // Wait time thresholds
          waitTimeWarningMin: data.config.waitTimeWarningMin || 2,
          waitTimeCriticalMin: data.config.waitTimeCriticalMin || 5,
        })
        // Set selected venue from edge server config
        if (data.config.venueId && !selectedVenueId) {
          setSelectedVenueId(data.config.venueId)
        }
      }
      setError(null)
    } catch (err) {
      setError('Failed to connect to edge server')
      setStatus({ connected: false, isRunning: false, activePeopleCount: 0, uptime: 0, tracksSent: 0 })
    }
  }, [configDirty, selectedVenueId])

  useEffect(() => {
    fetchVenues()
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchVenues])

  const handleStart = async () => {
    setLoading(true)
    try {
      // Always send config before starting to ensure correct venue and cashier settings
      const selectedVenue = venues.find(v => v.id === selectedVenueId)
      const configToSend = {
        ...config,
        // Only send venueId if user has selected one, otherwise keep edge server's existing config
        ...(selectedVenueId && { venueId: selectedVenueId }),
        ...(selectedVenue && {
          venueWidth: selectedVenue.width,
          venueDepth: selectedVenue.depth,
        }),
      }
      await fetch(`${API_BASE}/api/edge-simulator/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSend),
      })
      setConfigDirty(false)
      
      // Now start the simulation
      await fetch(`${API_BASE}/api/edge-simulator/start`, { method: 'POST' })
      await fetchStatus()
    } catch (err) {
      setError('Failed to start simulator')
    }
    setLoading(false)
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await fetch(`${API_BASE}/api/edge-simulator/stop`, { method: 'POST' })
      await fetchStatus()
    } catch (err) {
      setError('Failed to stop simulator')
    }
    setLoading(false)
  }

  // Checkout Manager functions
  const fetchCheckoutStatus = useCallback(async () => {
    if (!config.enableCheckoutManager) return
    try {
      const res = await fetch(`${API_BASE}/api/edge-simulator/checkout/status`)
      const data = await res.json()
      if (data.connected !== false) {
        setCheckoutStatus(data)
      }
    } catch (err) {
      console.error('Failed to fetch checkout status:', err)
    }
  }, [config.enableCheckoutManager])

  const handleSetLaneState = async (laneId: number, state: 'open' | 'closed') => {
    setCheckoutLoading(true)
    try {
      await fetch(`${API_BASE}/api/edge-simulator/checkout/set_lane_state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laneId, state }),
      })
      await fetchCheckoutStatus()
    } catch (err) {
      console.error('Failed to set lane state:', err)
    }
    setCheckoutLoading(false)
  }

  // Fetch checkout status when simulation is running and checkout manager is enabled
  useEffect(() => {
    if (status?.isRunning && config.enableCheckoutManager) {
      fetchCheckoutStatus()
      const interval = setInterval(fetchCheckoutStatus, 2000)
      return () => clearInterval(interval)
    }
  }, [status?.isRunning, config.enableCheckoutManager, fetchCheckoutStatus])

  const handleConfigChange = (key: keyof SimulatorConfig, value: number | string | boolean) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setConfigDirty(true)
  }

  const handleVenueChange = (venueId: string) => {
    setSelectedVenueId(venueId)
    setConfigDirty(true)
  }

  const handleApplyConfig = async () => {
    setLoading(true)
    try {
      // Find selected venue to get dimensions
      const selectedVenue = venues.find(v => v.id === selectedVenueId)
      const configToSend = {
        ...config,
        // Only send venueId if user has selected one, otherwise keep edge server's existing config
        ...(selectedVenueId && { venueId: selectedVenueId }),
        // Include venue dimensions so edge server can properly initialize
        ...(selectedVenue && {
          venueWidth: selectedVenue.width,
          venueDepth: selectedVenue.depth,
        }),
      }
      await fetch(`${API_BASE}/api/edge-simulator/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSend),
      })
      setConfigDirty(false)
      await fetchStatus()
    } catch (err) {
      setError('Failed to update config')
    }
    setLoading(false)
  }

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h}h ${m}m ${s}s`
  }

  // Check if checkout manager panel should be shown
  const showCheckoutPanel = config.enableCashiers && config.enableCheckoutManager

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Gauge className="w-5 h-5" />
          Edge Simulator Control
        </h3>
        {status?.connected ? (
          <span className="flex items-center gap-1 text-green-400 text-sm">
            <Wifi className="w-4 h-4" /> Connected
          </span>
        ) : (
          <span className="flex items-center gap-1 text-red-400 text-sm">
            <WifiOff className="w-4 h-4" /> Disconnected
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-900/50 text-red-300 px-3 py-2 rounded flex items-center gap-2 text-sm mb-4">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Two-Panel Layout */}
      <div className={`grid gap-4 ${showCheckoutPanel ? 'grid-cols-2' : 'grid-cols-1'}`}>
        
        {/* ========== LEFT PANEL ========== */}
        <div className="space-y-4">
          {/* Status */}
          <div className="grid grid-cols-4 gap-2 text-sm">
            <div className="bg-gray-700 rounded p-2 text-center">
              <div className="text-gray-400 text-xs">Status</div>
              <div className={status?.isRunning ? 'text-green-400' : 'text-gray-500'}>
                {status?.isRunning ? 'Running' : 'Stopped'}
              </div>
            </div>
            <div className="bg-gray-700 rounded p-2 text-center">
              <div className="text-gray-400 text-xs">People</div>
              <div className="text-white font-mono">{status?.activePeopleCount || 0}</div>
            </div>
            <div className="bg-gray-700 rounded p-2 text-center">
              <div className="text-gray-400 text-xs">Uptime</div>
              <div className="text-white font-mono text-xs">{formatUptime(status?.uptime || 0)}</div>
            </div>
            <div className="bg-gray-700 rounded p-2 text-center">
              <div className="text-gray-400 text-xs">Tracks</div>
              <div className="text-white font-mono text-xs">{(status?.tracksSent || 0).toLocaleString()}</div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <button
              onClick={handleStart}
              disabled={loading || status?.isRunning}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white font-medium transition-colors text-sm"
            >
              <Play className="w-4 h-4" /> Start
            </button>
            <button
              onClick={handleStop}
              disabled={loading || !status?.isRunning}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white font-medium transition-colors text-sm"
            >
              <Square className="w-4 h-4" /> Stop
            </button>
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-white transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Simulation Config */}
          <div className="border-t border-gray-700 pt-3 space-y-3">
            <h4 className="text-sm font-medium text-gray-300">Simulation</h4>
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Target People
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={config.targetPeopleCount}
                  onChange={(e) => handleConfigChange('targetPeopleCount', parseInt(e.target.value) || 1)}
                  className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Avg Stay (min)
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={config.avgStayTime}
                  onChange={(e) => handleConfigChange('avgStayTime', parseInt(e.target.value) || 1)}
                  className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Frequency (Hz)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={config.frequencyHz}
                  onChange={(e) => handleConfigChange('frequencyHz', parseInt(e.target.value) || 1)}
                  className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400">Queue Interval (s)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={config.queueSpawnInterval}
                  onChange={(e) => handleConfigChange('queueSpawnInterval', parseInt(e.target.value) || 1)}
                  className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                />
              </div>
            </div>

            {/* Venue Selector */}
            <div>
              <label className="text-xs text-gray-400 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Target Venue
              </label>
              <select
                value={selectedVenueId}
                onChange={(e) => handleVenueChange(e.target.value)}
                className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              >
                <option value="">Select a venue...</option>
                {venues.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.width}m × {v.depth}m)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-400">Simulation Mode</label>
              <select
                value={config.simulationMode}
                onChange={(e) => handleConfigChange('simulationMode', e.target.value)}
                className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              >
                <option value="mixed">Mixed (Queue + Browsing)</option>
                <option value="queue">Queue Only</option>
                <option value="browsing">Browsing Only</option>
              </select>
            </div>
          </div>

          {/* Cashier Agents Section */}
          <div className="border-t border-gray-600 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400 flex items-center gap-1">
                <UserCheck className="w-3 h-3 text-red-400" /> Cashier Agents
              </label>
              <button
                onClick={() => handleConfigChange('enableCashiers', !config.enableCashiers)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  config.enableCashiers
                    ? 'bg-red-600/30 text-red-400 border border-red-500/50'
                    : 'bg-gray-700 text-gray-400 border border-gray-600'
                }`}
              >
                {config.enableCashiers ? 'ON' : 'OFF'}
              </button>
            </div>

            {config.enableCashiers && (
              <div className="space-y-2 pl-2 border-l border-red-500/30">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Shift (min)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={180}
                      value={config.cashierShiftMin}
                      onChange={(e) => handleConfigChange('cashierShiftMin', parseInt(e.target.value) || 60)}
                      className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1">
                      <Coffee className="w-3 h-3" /> Break %/hr
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={config.cashierBreakProb}
                      onChange={(e) => handleConfigChange('cashierBreakProb', parseInt(e.target.value) || 0)}
                      className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Lane Open Confirm (sec)</label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={config.laneOpenConfirmSec}
                    onChange={(e) => handleConfigChange('laneOpenConfirmSec', parseInt(e.target.value) || 120)}
                    className="w-full mt-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                </div>
                <div className="flex items-center justify-between py-1">
                  <label className="text-xs text-gray-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-yellow-500" /> ID Confusion
                  </label>
                  <button
                    onClick={() => handleConfigChange('enableIdConfusion', !config.enableIdConfusion)}
                    className={`w-8 h-4 rounded-full transition-colors ${
                      config.enableIdConfusion ? 'bg-yellow-600' : 'bg-gray-600'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full bg-white transition-transform ${
                      config.enableIdConfusion ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Checkout Manager Toggle */}
          {config.enableCashiers && (
            <div className="border-t border-gray-600 pt-3">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400 flex items-center gap-1">
                  <ShoppingCart className="w-3 h-3 text-green-400" /> Checkout Manager
                </label>
                <button
                  onClick={() => handleConfigChange('enableCheckoutManager', !config.enableCheckoutManager)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    config.enableCheckoutManager
                      ? 'bg-green-600/30 text-green-400 border border-green-500/50'
                      : 'bg-gray-700 text-gray-400 border border-gray-600'
                  }`}
                >
                  {config.enableCheckoutManager ? 'MANUAL' : 'AUTO'}
                </button>
              </div>
            </div>
          )}

          {/* Apply Button */}
          <button
            onClick={handleApplyConfig}
            disabled={loading || !configDirty}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-white font-medium transition-colors text-sm ${
              configDirty 
                ? 'bg-blue-600 hover:bg-blue-700' 
                : 'bg-gray-600 cursor-not-allowed'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {configDirty ? 'Apply Changes' : 'No Changes'}
          </button>
        </div>

        {/* ========== RIGHT PANEL: Checkout Manager ========== */}
        {showCheckoutPanel && (
          <div className="space-y-3 border-l border-gray-700 pl-4">
            <h4 className="text-sm font-medium text-green-400 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" /> Checkout Manager
            </h4>

            {/* Wait Time Thresholds */}
            <div className="bg-gray-700/30 rounded p-2">
              <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Wait Time Thresholds
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center gap-1 text-xs">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-gray-500">→</span>
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-gray-400 ml-1">Warning</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={config.waitTimeWarningMin || 2}
                      onChange={(e) => handleConfigChange('waitTimeWarningMin', parseInt(e.target.value) || 2)}
                      className="w-12 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs text-center"
                    />
                    <span className="text-xs text-gray-500">min</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-gray-500">→</span>
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-gray-400 ml-1">Critical</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={config.waitTimeCriticalMin || 5}
                      onChange={(e) => handleConfigChange('waitTimeCriticalMin', parseInt(e.target.value) || 5)}
                      className="w-12 px-1 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs text-center"
                    />
                    <span className="text-xs text-gray-500">min</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Queue Pressure Controls */}
            <div className="bg-gray-700/30 rounded p-2">
              <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
                <Gauge className="w-3 h-3" /> Queue Pressure
              </div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Checkout Rate</span>
                    <span className="text-blue-400">{((config.checkoutProbMultiplier || 1) * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={10}
                    value={(config.checkoutProbMultiplier || 1) * 100}
                    onChange={(e) => handleConfigChange('checkoutProbMultiplier', parseInt(e.target.value) / 100)}
                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Browsing Speed</span>
                    <span className="text-amber-400">{((config.browsingSpeedMultiplier || 1) * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={300}
                    step={10}
                    value={(config.browsingSpeedMultiplier || 1) * 100}
                    onChange={(e) => handleConfigChange('browsingSpeedMultiplier', parseInt(e.target.value) / 100)}
                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Arrival Rate</span>
                    <span className="text-green-400">{((config.arrivalRateMultiplier || 1) * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={300}
                    step={10}
                    value={(config.arrivalRateMultiplier || 1) * 100}
                    onChange={(e) => handleConfigChange('arrivalRateMultiplier', parseInt(e.target.value) / 100)}
                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
                  />
                </div>
              </div>
            </div>

            {/* Lane Status */}
            {status?.isRunning && checkoutStatus?.lanes && checkoutStatus.lanes.length > 0 && (
              <div className="bg-gray-700/30 rounded p-2">
                <div className="text-xs text-gray-400 mb-2">Lane Status</div>
                
                {/* Queue Pressure Alert */}
                {checkoutStatus.pressure?.shouldOpenMore && (
                  <div className="bg-yellow-500/20 border border-yellow-500/50 rounded p-2 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-yellow-400" />
                    <span className="text-xs text-yellow-400">
                      Open Lane {checkoutStatus.pressure.suggestedLaneToOpen}
                    </span>
                  </div>
                )}

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-1 mb-2 text-center">
                  <div className="bg-gray-800/50 rounded p-1">
                    <div className="text-sm font-medium text-green-400">{checkoutStatus.pressure?.openLaneCount || 0}</div>
                    <div className="text-xs text-gray-500">Open</div>
                  </div>
                  <div className="bg-gray-800/50 rounded p-1">
                    <div className="text-sm font-medium text-blue-400">{checkoutStatus.pressure?.totalQueueCount || 0}</div>
                    <div className="text-xs text-gray-500">Queued</div>
                  </div>
                  <div className="bg-gray-800/50 rounded p-1">
                    <div className="text-sm font-medium text-gray-300">{checkoutStatus.pressure?.avgQueuePerLane?.toFixed(1) || '0'}</div>
                    <div className="text-xs text-gray-500">Avg</div>
                  </div>
                </div>

                {/* Lane List with Visual Circles */}
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {checkoutStatus.lanes.map((lane) => (
                    <div 
                      key={lane.laneId} 
                      className="bg-gray-800/50 rounded px-2 py-1.5"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-300">Lane {lane.laneId}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            lane.status === 'OPEN' ? 'bg-green-500/30 text-green-400' :
                            lane.status === 'OPENING' ? 'bg-yellow-500/30 text-yellow-400' :
                            lane.status === 'CLOSING' ? 'bg-orange-500/30 text-orange-400' :
                            'bg-gray-600 text-gray-400'
                          }`}>
                            {lane.status}
                          </span>
                        </div>
                        <button
                          onClick={() => handleSetLaneState(lane.laneId, lane.desiredState === 'open' ? 'closed' : 'open')}
                          disabled={checkoutLoading}
                          className={`p-0.5 rounded transition-colors ${
                            lane.desiredState === 'open' 
                              ? 'text-green-400 hover:bg-green-500/20' 
                              : 'text-gray-500 hover:bg-gray-600'
                          }`}
                        >
                          {lane.desiredState === 'open' ? (
                            <ToggleRight className="w-4 h-4" />
                          ) : (
                            <ToggleLeft className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      {/* Queue Visualization */}
                      <QueueCircles 
                        count={lane.queueCount} 
                        queuedPeople={lane.queuedPeople}
                        warningMin={config.waitTimeWarningMin || 2}
                        criticalMin={config.waitTimeCriticalMin || 5}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {status?.isRunning && (!checkoutStatus?.lanes || checkoutStatus.lanes.length === 0) && (
              <div className="text-xs text-gray-500 italic">No checkout lanes detected</div>
            )}

            {!status?.isRunning && (
              <div className="bg-gray-700/30 rounded p-3 text-center">
                <div className="text-xs text-gray-500">Start simulation to see lane status</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default SimulatorControl
