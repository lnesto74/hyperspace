import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Play, Square, X, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react'
import { API_BASE } from '../../config/api'

interface ReplayFile {
  name: string
  size: number
  path: string
}

interface ReplayStatus {
  running: boolean
  file: string | null
  startedAt: number | null
  speed: number
  messagesPublished: number
  progress: number       // 0..1
  currentTs: number
  lastError: string | null
  totalBytes?: number
  bytesRead?: number
}

interface ReplayPanelProps {
  onClose: () => void
}

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Replay panel — pick a recorded MQTT capture, set the speed, play it back
 * through the live pipeline. Replayed tracks are tagged with a `replay-`
 * deviceId prefix so they never collide with concurrent live perception.
 */
export default function ReplayPanel({ onClose }: ReplayPanelProps) {
  const [files, setFiles] = useState<ReplayFile[]>([])
  const [selected, setSelected] = useState<string>('')
  const [speed, setSpeed] = useState<number>(4)
  const [status, setStatus] = useState<ReplayStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [replayDir, setReplayDir] = useState<string>('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/files`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFiles(data.files || [])
      setReplayDir(data.replayDir || '')
      if (!selected && data.files?.[0]?.name) setSelected(data.files[0].name)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selected])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/replay/status`)
      if (!res.ok) return
      const data = await res.json()
      setStatus(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    refreshFiles()
    refreshStatus()
    pollRef.current = setInterval(refreshStatus, 1000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refreshFiles, refreshStatus])

  const start = useCallback(async () => {
    if (!selected) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: selected, speed, rewriteTimestamps: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      await refreshStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [selected, speed, refreshStatus])

  const stop = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' })
      await refreshStatus()
    } catch (err) {
      console.error(err)
    }
  }, [refreshStatus])

  const running = !!status?.running

  return (
    <div className="absolute top-4 left-16 z-30 w-[26rem] bg-gray-900/95 backdrop-blur border border-amber-700/60 rounded-xl shadow-2xl text-gray-200 text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/80">
        <History className="w-4 h-4 text-amber-400" />
        <span className="font-semibold text-white">MQTT Replay</span>
        {running && (
          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400 animate-pulse">live</span>
        )}
        <div className="flex-1" />
        <button onClick={refreshFiles} disabled={loading} className="p-1 rounded hover:bg-gray-700/60 disabled:opacity-50" title="Refresh">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
        <button onClick={() => setCollapsed(c => !c)} className="p-1 rounded hover:bg-gray-700/60">
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-700/60">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-3">
          <div>
            <div className="text-gray-400 mb-1">Recorded capture</div>
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              disabled={running}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
            >
              {files.length === 0 && <option value="">(no files in {replayDir || '/data/replay'})</option>}
              {files.map(f => (
                <option key={f.name} value={f.name}>{f.name}  ({formatBytes(f.size)})</option>
              ))}
            </select>
            <div className="text-[10px] text-gray-500 mt-1">
              Drop .jsonl files into <code className="text-gray-300">{replayDir || '/opt/hyperspace/replay/'}</code> on the droplet, then refresh.
            </div>
          </div>

          <div>
            <div className="text-gray-400 mb-1">Playback speed</div>
            <div className="grid grid-cols-5 gap-1">
              {[0.5, 1, 2, 4, 10].map(s => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  disabled={running}
                  className={`py-1 rounded text-xs ${speed === s ? 'bg-amber-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-200'} disabled:opacity-50`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {!running ? (
            <button
              onClick={start}
              disabled={!selected || loading}
              className="w-full px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium disabled:bg-gray-700 disabled:text-gray-500 flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" /> Start replay
            </button>
          ) : (
            <button
              onClick={stop}
              className="w-full px-3 py-2 rounded bg-red-600 hover:bg-red-500 text-white font-medium flex items-center justify-center gap-2"
            >
              <Square className="w-4 h-4" /> Stop replay
            </button>
          )}

          {status && (
            <div className="space-y-1 pt-2 border-t border-gray-800 text-[11px]">
              <div className="flex justify-between"><span className="text-gray-500">File:</span><span className="font-mono text-gray-300">{status.file || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Speed:</span><span>{status.speed}×</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Messages:</span><span className="font-mono">{status.messagesPublished.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Progress:</span><span>{(status.progress * 100).toFixed(1)}%</span></div>
              <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${(status.progress * 100).toFixed(2)}%` }} />
              </div>
              {status.lastError && <div className="text-red-400 text-[10px]">{status.lastError}</div>}
            </div>
          )}

          {error && <div className="text-red-400 text-[11px]">{error}</div>}

          <div className="text-[10px] text-gray-600 pt-1 border-t border-gray-800">
            Replayed tracks have a <code>replay-</code> deviceId prefix and a <code>replay:true</code> flag, so they coexist with live tracks without collisions. Switch to a different venue if you want a pristine view.
          </div>
        </div>
      )}
    </div>
  )
}
