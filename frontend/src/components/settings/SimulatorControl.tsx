import { useState, useEffect, useCallback } from 'react'
import { Play, Square, RefreshCw, Users, Clock, Gauge, AlertCircle, CheckCircle2, Wifi, WifiOff } from 'lucide-react'

interface SimulatorConfig {
  targetPeopleCount: number
  avgStayTime: number
  frequencyHz: number
  simulationMode: string
  queueSpawnInterval: number
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
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configDirty, setConfigDirty] = useState(false)

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
        })
      }
      setError(null)
    } catch (err) {
      setError('Failed to connect to edge server')
      setStatus({ connected: false, isRunning: false, activePeopleCount: 0, uptime: 0, tracksSent: 0 })
    }
  }, [configDirty])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleStart = async () => {
    setLoading(true)
    try {
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

  const handleConfigChange = (key: keyof SimulatorConfig, value: number | string) => {
    setConfig(prev => ({ ...prev, [key]: value }))
    setConfigDirty(true)
  }

  const handleApplyConfig = async () => {
    setLoading(true)
    try {
      await fetch(`${API_BASE}/api/edge-simulator/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
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

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
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
        <div className="bg-red-900/50 text-red-300 px-3 py-2 rounded flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Status */}
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div className="bg-gray-700 rounded p-2 text-center">
          <div className="text-gray-400">Status</div>
          <div className={status?.isRunning ? 'text-green-400' : 'text-gray-500'}>
            {status?.isRunning ? 'Running' : 'Stopped'}
          </div>
        </div>
        <div className="bg-gray-700 rounded p-2 text-center">
          <div className="text-gray-400">People</div>
          <div className="text-white font-mono">{status?.activePeopleCount || 0}</div>
        </div>
        <div className="bg-gray-700 rounded p-2 text-center">
          <div className="text-gray-400">Uptime</div>
          <div className="text-white font-mono text-xs">{formatUptime(status?.uptime || 0)}</div>
        </div>
        <div className="bg-gray-700 rounded p-2 text-center">
          <div className="text-gray-400">Tracks</div>
          <div className="text-white font-mono text-xs">{(status?.tracksSent || 0).toLocaleString()}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <button
          onClick={handleStart}
          disabled={loading || status?.isRunning}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white font-medium transition-colors"
        >
          <Play className="w-4 h-4" /> Start
        </button>
        <button
          onClick={handleStop}
          disabled={loading || !status?.isRunning}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-white font-medium transition-colors"
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

      {/* Config */}
      <div className="border-t border-gray-700 pt-4 space-y-3">
        <h4 className="text-sm font-medium text-gray-300">Configuration</h4>
        
        <div className="grid grid-cols-2 gap-3">
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

        <button
          onClick={handleApplyConfig}
          disabled={loading || !configDirty}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded text-white font-medium transition-colors ${
            configDirty 
              ? 'bg-blue-600 hover:bg-blue-700' 
              : 'bg-gray-600 cursor-not-allowed'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          {configDirty ? 'Apply Changes' : 'No Changes'}
        </button>
      </div>
    </div>
  )
}

export default SimulatorControl
