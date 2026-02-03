import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Settings, Wifi, WifiOff, Radio, Clock, Users, Move, Save, Check } from 'lucide-react'

interface Config {
  mqttBroker: string
  deviceId: string
  venueId: string
  frequencyHz: number
  personCount: number
  venueWidth: number
  venueDepth: number
}

interface Status {
  isRunning: boolean
  mqttConnected: boolean
  tracksSent: number
  uptime: number
  lastError: string | null
  config: Config
}

const defaultConfig: Config = {
  mqttBroker: 'mqtt://localhost:1883',
  deviceId: 'lidar-edge-001',
  venueId: 'default-venue',
  frequencyHz: 10,
  personCount: 5,
  venueWidth: 20,
  venueDepth: 15,
}

export default function App() {
  const [config, setConfig] = useState<Config>(defaultConfig)
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isUserEditing = useRef(false)

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setStatus(data)
      // Only update config from server if user is not actively editing
      if (!isUserEditing.current) {
        setConfig(data.config)
      }
    } catch (err) {
      console.error('Failed to fetch status:', err)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 1000)
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

  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates }
    setConfig(newConfig)
    
    // Mark as editing to prevent fetch from overwriting
    isUserEditing.current = true
    
    // Debounced autosave - wait 500ms after last change
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveConfig(newConfig)
      // Allow fetch to update config again after save completes
      setTimeout(() => { isUserEditing.current = false }, 1000)
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

          <div className="grid grid-cols-3 gap-4 mb-6">
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
                disabled={status?.isRunning}
                className="w-full bg-[#0f0f14] border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Venue ID */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Venue ID</label>
              <input
                type="text"
                value={config.venueId}
                onChange={(e) => updateConfig({ venueId: e.target.value })}
                disabled={status?.isRunning}
                className="w-full bg-[#0f0f14] border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>

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

            {/* Person Count */}
            <div>
              <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2">
                <Users className="w-4 h-4" />
                Person Count: {config.personCount}
              </label>
              <input
                type="range"
                min="1"
                max="20"
                value={config.personCount}
                onChange={(e) => updateConfig({ personCount: parseInt(e.target.value) })}
                disabled={status?.isRunning}
                className="w-full accent-blue-500 disabled:opacity-50"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1</span>
                <span>20</span>
              </div>
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
