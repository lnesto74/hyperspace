import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Settings, Wifi, WifiOff, Radio, Clock, Users, Move, Save, Check, ShoppingCart, Shuffle, Layers } from 'lucide-react'

interface Config {
  mqttBroker: string
  backendUrl: string
  deviceId: string
  venueId: string
  frequencyHz: number
  personCount: number
  targetPeopleCount: number
  avgStayTime: number
  venueWidth: number
  venueDepth: number
  simulationMode: 'random' | 'queue' | 'mixed'
  queueSpawnInterval: number
}

interface Status {
  isRunning: boolean
  mqttConnected: boolean
  tracksSent: number
  uptime: number
  lastError: string | null
  activePeopleCount: number
  config: Config
}

const defaultConfig: Config = {
  mqttBroker: 'mqtt://localhost:1883',
  backendUrl: 'http://localhost:3001',
  deviceId: 'lidar-edge-001',
  venueId: 'default-venue',
  frequencyHz: 10,
  personCount: 5,
  targetPeopleCount: 20,
  avgStayTime: 5,
  venueWidth: 20,
  venueDepth: 15,
  simulationMode: 'random',
  queueSpawnInterval: 5,
}

export default function App() {
  const [config, setConfig] = useState<Config>(defaultConfig)
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUserEditing = useRef(false)
  const initialLoadDone = useRef(false)

  const fetchStatus = async () => {
    // Skip config updates while user is editing
    if (isUserEditing.current) {
      // Still fetch status for display updates, but don't update config
      try {
        const res = await fetch('/api/status')
        const data = await res.json()
        // Only update status fields, not config
        setStatus(prev => prev ? { ...prev, isRunning: data.isRunning, mqttConnected: data.mqttConnected, tracksSent: data.tracksSent, uptime: data.uptime, lastError: data.lastError } : data)
      } catch (err) {
        console.error('Failed to fetch status:', err)
      }
      return
    }
    
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setStatus(data)
      setConfig(data.config)
      initialLoadDone.current = true
    } catch (err) {
      console.error('Failed to fetch status:', err)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000) // Slower interval
    return () => clearInterval(interval)
  }, [])

  const saveConfig = useCallback(async (configToSave: Config) => {
    setSaveStatus('saving')
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToSave),
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setError('Failed to save config')
      setSaveStatus('idle')
    }
  }, [])

  const handleFocus = () => {
    isUserEditing.current = true
  }

  const handleBlur = () => {
    // Delay clearing editing flag to allow final save to complete
    setTimeout(() => {
      isUserEditing.current = false
    }, 2000)
  }

  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    
    // Debounced autosave - wait 500ms after last change
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveConfig(newConfig)
    }, 500)
  }

  const start = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/start', { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        setError(data.error)
      }
    } catch (err) {
      setError('Failed to start simulation')
    }
    setLoading(false)
  }

  const stop = async () => {
    setLoading(true)
    try {
      await fetch('/api/stop', { method: 'POST' })
    } catch (err) {
      setError('Failed to stop simulation')
    }
    setLoading(false)
  }

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="min-h-screen bg-[#0f0f14] p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Radio className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Edge LiDAR Server</h1>
            <p className="text-gray-500 text-sm">Trajectory Simulator</p>
          </div>
        </div>

        {/* Status Card */}
        <div className="bg-[#1a1a24] rounded-xl border border-gray-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Status
            </h2>
            <div className="flex items-center gap-2">
              {status?.mqttConnected ? (
                <span className="flex items-center gap-1 text-green-500 text-sm">
                  <Wifi className="w-4 h-4" /> MQTT Connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-gray-500 text-sm">
                  <WifiOff className="w-4 h-4" /> MQTT Disconnected
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-[#0f0f14] rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{status?.activePeopleCount || 0}</div>
              <div className="text-xs text-gray-500">People in Scene</div>
            </div>
            <div className="bg-[#0f0f14] rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{status?.tracksSent.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-500">Tracks Sent</div>
            </div>
            <div className="bg-[#0f0f14] rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{formatUptime(status?.uptime || 0)}</div>
              <div className="text-xs text-gray-500">Uptime</div>
            </div>
            <div className="bg-[#0f0f14] rounded-lg p-4 text-center">
              <div className={`text-2xl font-bold ${status?.isRunning ? 'text-green-500' : 'text-gray-500'}`}>
                {status?.isRunning ? 'Running' : 'Stopped'}
              </div>
              <div className="text-xs text-gray-500">Status</div>
            </div>
          </div>

          {/* Start/Stop Button */}
          <button
            onClick={status?.isRunning ? stop : start}
            disabled={loading}
            className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${
              status?.isRunning
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {status?.isRunning ? (
              <>
                <Square className="w-5 h-5" /> Stop Simulation
              </>
            ) : (
              <>
                <Play className="w-5 h-5" /> Start Simulation
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {status?.lastError && (
            <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-800 rounded-lg text-yellow-400 text-sm">
              Last Error: {status.lastError}
            </div>
          )}
        </div>

        {/* Configuration Card */}
        <div className="bg-[#1a1a24] rounded-xl border border-gray-800 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Configuration
            </h2>
            <div className="flex items-center gap-2 text-sm">
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1 text-blue-400">
                  <Save className="w-4 h-4 animate-pulse" /> Saving...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-green-400">
                  <Check className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
          </div>

          <div className="space-y-5">
            {/* MQTT Broker */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">MQTT Broker URL</label>
              <input
                type="text"
                value={config.mqttBroker}
                onChange={(e) => updateConfig({ mqttBroker: e.target.value })}
                onFocus={handleFocus}
                onBlur={handleBlur}
                disabled={status?.isRunning}
                className="w-full bg-[#0f0f14] border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                placeholder="mqtt://100.x.x.x:1883"
              />
            </div>

            {/* Device ID */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Device ID</label>
              <input
                type="text"
                value={config.deviceId}
                onChange={(e) => updateConfig({ deviceId: e.target.value })}
                onFocus={handleFocus}
                onBlur={handleBlur}
                disabled={status?.isRunning}
                className="w-full bg-[#0f0f14] border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Backend URL */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Hyperspace Backend URL</label>
              <input
                type="text"
                value={config.backendUrl}
                onChange={(e) => updateConfig({ backendUrl: e.target.value })}
                onFocus={handleFocus}
                onBlur={handleBlur}
                disabled={status?.isRunning}
                className="w-full bg-[#0f0f14] border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
                placeholder="http://100.x.x.x:3001"
              />
              <p className="text-xs text-gray-500 mt-1">Required for queue mode to fetch geometry</p>
            </div>

            {/* Venue ID */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Venue ID</label>
              <input
                type="text"
                value={config.venueId}
                onChange={(e) => updateConfig({ venueId: e.target.value })}
                onFocus={handleFocus}
                onBlur={handleBlur}
                disabled={status?.isRunning}
                className="w-full bg-[#0f0f14] border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Simulation Mode */}
            <div>
              <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Simulation Mode
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => updateConfig({ simulationMode: 'random' })}
                  disabled={status?.isRunning}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-colors disabled:opacity-50 ${
                    config.simulationMode === 'random'
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-[#0f0f14] border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <Shuffle className="w-5 h-5" />
                  <span className="text-xs">Random</span>
                </button>
                <button
                  onClick={() => updateConfig({ simulationMode: 'queue' })}
                  disabled={status?.isRunning}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-colors disabled:opacity-50 ${
                    config.simulationMode === 'queue'
                      ? 'bg-orange-600/20 border-orange-500 text-orange-400'
                      : 'bg-[#0f0f14] border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <ShoppingCart className="w-5 h-5" />
                  <span className="text-xs">Queue</span>
                </button>
                <button
                  onClick={() => updateConfig({ simulationMode: 'mixed' })}
                  disabled={status?.isRunning}
                  className={`p-3 rounded-lg border flex flex-col items-center gap-1 transition-colors disabled:opacity-50 ${
                    config.simulationMode === 'mixed'
                      ? 'bg-purple-600/20 border-purple-500 text-purple-400'
                      : 'bg-[#0f0f14] border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <Layers className="w-5 h-5" />
                  <span className="text-xs">Mixed</span>
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {config.simulationMode === 'random' && 'People walk randomly around the venue'}
                {config.simulationMode === 'queue' && 'Customers approach cashiers, wait in queue, get served'}
                {config.simulationMode === 'mixed' && 'Both random walkers and queue customers'}
              </p>
            </div>

            {/* Queue Spawn Interval - only show for queue/mixed modes */}
            {(config.simulationMode === 'queue' || config.simulationMode === 'mixed') && (
              <div>
                <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" />
                  New Customer Every: {config.queueSpawnInterval}s
                </label>
                <input
                  type="range"
                  min="2"
                  max="30"
                  value={config.queueSpawnInterval}
                  onChange={(e) => updateConfig({ queueSpawnInterval: parseInt(e.target.value) })}
                  disabled={status?.isRunning}
                  className="w-full accent-orange-500 disabled:opacity-50"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>2s (busy)</span>
                  <span>30s (slow)</span>
                </div>
              </div>
            )}

            {/* Frequency */}
            <div>
              <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Update Frequency: {config.frequencyHz} Hz
              </label>
              <input
                type="range"
                min="1"
                max="30"
                value={config.frequencyHz}
                onChange={(e) => updateConfig({ frequencyHz: parseInt(e.target.value) })}
                disabled={status?.isRunning}
                className="w-full accent-blue-500 disabled:opacity-50"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1 Hz</span>
                <span>30 Hz</span>
              </div>
            </div>

            {/* Target People in Scene */}
            <div>
              <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2">
                <Users className="w-4 h-4" />
                People in Scene: {config.targetPeopleCount}
              </label>
              <input
                type="range"
                min="1"
                max="200"
                value={config.targetPeopleCount}
                onChange={(e) => updateConfig({ targetPeopleCount: parseInt(e.target.value) })}
                className="w-full accent-green-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1</span>
                <span>50</span>
                <span>100</span>
                <span>150</span>
                <span>200</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Target number of people active in the scene at any time</p>
            </div>

            {/* Average Stay Time */}
            <div>
              <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Avg Stay Time: {config.avgStayTime} min
              </label>
              <input
                type="range"
                min="1"
                max="30"
                value={config.avgStayTime}
                onChange={(e) => updateConfig({ avgStayTime: parseInt(e.target.value) })}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1 min</span>
                <span>15 min</span>
                <span>30 min</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">How long people stay before exiting</p>
            </div>

            {/* Venue Size */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2">
                  <Move className="w-4 h-4" />
                  Venue Width: {config.venueWidth}m
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={config.venueWidth}
                  onChange={(e) => updateConfig({ venueWidth: parseInt(e.target.value) })}
                  disabled={status?.isRunning}
                  className="w-full accent-blue-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2">
                  <Move className="w-4 h-4" />
                  Venue Depth: {config.venueDepth}m
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={config.venueDepth}
                  onChange={(e) => updateConfig({ venueDepth: parseInt(e.target.value) })}
                  disabled={status?.isRunning}
                  className="w-full accent-blue-500 disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-600 text-xs mt-6">
          Edge LiDAR Server v1.0.0
        </div>
      </div>
    </div>
  )
}
