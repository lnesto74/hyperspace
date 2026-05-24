import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Play, Square, X, ChevronDown, ChevronUp, RefreshCw, Loader2, Circle } from 'lucide-react'
import { API_BASE } from '../../config/api'

interface ReplayFile {
  name: string
  size: number
  path: string
  mtimeMs?: number
}

interface ReplayStatus {
  running: boolean
  file: string | null
  requestedFile?: string | null
  fileSize?: number
  fileMtimeMs?: number
  firstRecordedTs?: number | null
  lastRecordedTs?: number | null
  recordedCurrentTs?: number | null
  startProgress?: number
  startedAt: number | null
  speed: number
  messagesPublished: number
  progress: number
  currentTs: number
  lastError: string | null
  totalBytes?: number
  bytesRead?: number
  replayDir?: string
}

interface FileMeta {
  file: string
  firstRecordedTs: number | null
  lastRecordedTs: number | null
  spanMs: number
  size: number
  mtimeMs: number
}

interface RecordStatus {
  recording: boolean
  file: string | null
  bytesWritten: number
  messagesRecorded: number
  startedAt: number | null
  lastMessageAt: number | null
  error: string | null
  mqtt?: {
    connected: boolean
    active: boolean
    ageMs: number | null
    messagesReceived: number
  }
}

interface ReplayPanelProps {
  onClose: () => void
}

const formatBytes = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const formatFileAge = (mtimeMs?: number) => {
  if (!mtimeMs) return ''
  const d = new Date(mtimeMs)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatRecordedTs = (ts?: number | null) => {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const tsAtProgress = (meta: FileMeta | null, progress: number) => {
  if (!meta?.firstRecordedTs || !meta?.lastRecordedTs) return null
  return meta.firstRecordedTs + (meta.lastRecordedTs - meta.firstRecordedTs) * progress
}

const RECORD_SOFT_CAP_BYTES = 500 * 1024 * 1024

export default function ReplayPanel({ onClose }: ReplayPanelProps) {
  const [files, setFiles] = useState<ReplayFile[]>([])
  const [selected, setSelected] = useState<string>('')
  const [speed, setSpeed] = useState<number>(4)
  const [status, setStatus] = useState<ReplayStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [replayDir, setReplayDir] = useState<string>('')

  const [recordLabel, setRecordLabel] = useState('grocery_capture')
  const [recordStatus, setRecordStatus] = useState<RecordStatus | null>(null)
  const [recordBusy, setRecordBusy] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null)
  const [seeking, setSeeking] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const selectedRef = useRef<string>('')
  const startingReplayRef = useRef(false)
  const scrubbingRef = useRef(false)
  selectedRef.current = selected

  const readSelectedFile = () => {
    const fromDom = selectRef.current?.value?.trim()
    if (fromDom) return fromDom
    return selectedRef.current
  }

  const selectedMeta = files.find(f => f.name === selected)

  const recording = !!recordStatus?.recording

  const refreshFiles = useCallback(async (preferNewest = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/files`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const list: ReplayFile[] = data.files || []
      setFiles(list)
      setReplayDir(data.replayDir || '')
      setSelected(prev => {
        if (preferNewest && list[0]?.name) return list[0].name
        if (prev && list.some(f => f.name === prev)) return prev
        return list[0]?.name || ''
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    if (startingReplayRef.current) return
    try {
      const res = await fetch(`${API_BASE}/api/replay/status`)
      if (!res.ok) return
      const next: ReplayStatus = await res.json()
      setStatus(next)
      // Only mirror the active file into the dropdown while playback is running.
      if (next.running && next.file) {
        setSelected(next.file)
        selectedRef.current = next.file
      }
    } catch { /* ignore */ }
  }, [])

  const refreshRecordStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/replay/record/status`)
      if (!res.ok) return
      const data = await res.json()
      setRecordStatus(data.status || null)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    refreshFiles()
    refreshStatus()
    refreshRecordStatus()
    pollRef.current = setInterval(refreshStatus, 1000)
    recordPollRef.current = setInterval(refreshRecordStatus, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (recordPollRef.current) clearInterval(recordPollRef.current)
    }
  }, [refreshFiles, refreshStatus, refreshRecordStatus])

  useEffect(() => {
    if (!selected) {
      setFileMeta(null)
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/api/replay/meta?file=${encodeURIComponent(selected)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data) setFileMeta(data) })
      .catch(() => { if (!cancelled) setFileMeta(null) })
    return () => { cancelled = true }
  }, [selected])

  useEffect(() => {
    if (scrubbingRef.current || seeking) return
    if (status?.progress != null && Number.isFinite(status.progress)) {
      setScrubPct(status.progress * 100)
    }
  }, [status?.progress, seeking])

  const startRecord = useCallback(async () => {
    setRecordBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/record/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: recordLabel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setRecordStatus(data.status)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecordBusy(false)
    }
  }, [recordLabel])

  const stopRecord = useCallback(async () => {
    setRecordBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/record/stop`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setRecordStatus(data.stopped || null)
      if (data.file?.name) setSelected(data.file.name)
      await refreshFiles(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecordBusy(false)
    }
  }, [refreshFiles])

  const waitForReplayStopped = useCallback(async () => {
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${API_BASE}/api/replay/status`)
      if (!res.ok) break
      const st: ReplayStatus = await res.json()
      if (!st.running) return st
      await new Promise(r => setTimeout(r, 150))
    }
    return null
  }, [])

  const start = useCallback(async (startProgress?: number) => {
    const fileToPlay = readSelectedFile()
    if (!fileToPlay) return
    const progress = startProgress ?? scrubPct / 100
    startingReplayRef.current = true
    setError(null)
    try {
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' })
      await waitForReplayStopped()

      const res = await fetch(`${API_BASE}/api/replay/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fileToPlay, speed, rewriteTimestamps: true, startProgress: progress }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const playing = data.status?.file || data.requestedFile
      if (playing && playing !== fileToPlay) {
        throw new Error(`Server started "${playing}" instead of "${fileToPlay}"`)
      }
      setSelected(fileToPlay)
      selectedRef.current = fileToPlay
      await refreshStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      startingReplayRef.current = false
    }
  }, [speed, refreshStatus, waitForReplayStopped, scrubPct])

  const seekTo = useCallback(async (pct: number) => {
    const fileToPlay = readSelectedFile() || status?.file
    if (!fileToPlay) return
    setSeeking(true)
    startingReplayRef.current = true
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/seek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fileToPlay, progress: pct / 100, speed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await refreshStatus()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSeeking(false)
      startingReplayRef.current = false
    }
  }, [speed, refreshStatus, status?.file])

  const stop = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' })
      await refreshStatus()
    } catch (err) {
      console.error(err)
    }
  }, [refreshStatus])

  const running = !!status?.running
  const playingFile = status?.file || null
  const selectionMismatch = running && playingFile && playingFile !== selected
  const mqttActive = recordStatus?.mqtt?.active ?? false
  const streamLive = recordStatus?.lastMessageAt
    ? (Date.now() - recordStatus.lastMessageAt) < 4000
    : false
  const recordProgress = recordStatus?.bytesWritten
    ? Math.min(100, (recordStatus.bytesWritten / RECORD_SOFT_CAP_BYTES) * 100)
    : 0

  const scrubProgress = scrubPct / 100
  const displayRecordedTs = running && status?.recordedCurrentTs
    ? status.recordedCurrentTs
    : tsAtProgress(fileMeta, scrubProgress)
  const metaForLabels = fileMeta || (status?.firstRecordedTs && status?.lastRecordedTs ? {
    file: status.file || '',
    firstRecordedTs: status.firstRecordedTs,
    lastRecordedTs: status.lastRecordedTs,
    spanMs: status.lastRecordedTs - status.firstRecordedTs,
    size: status.fileSize || 0,
    mtimeMs: status.fileMtimeMs || 0,
  } : null)

  return (
    <div className="absolute top-4 left-16 z-30 w-[26rem] bg-gray-900/95 backdrop-blur border border-amber-700/60 rounded-xl shadow-2xl text-gray-200 text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/80">
        <History className="w-4 h-4 text-amber-400" />
        <span className="font-semibold text-white">MQTT Replay</span>
        {running && <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400 animate-pulse">replaying</span>}
        {recording && <span className="ml-1 text-[10px] uppercase tracking-wider text-red-400 animate-pulse">rec</span>}
        <div className="flex-1" />
        <button onClick={() => { refreshFiles(); refreshRecordStatus() }} disabled={loading} className="p-1 rounded hover:bg-gray-700/60 disabled:opacity-50" title="Refresh">
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
        <div className="p-3 space-y-3 max-h-[80vh] overflow-y-auto">
          {/* Record on main server */}
          <div className="space-y-2 pb-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Circle className={`w-2 h-2 ${recording ? 'fill-red-500 text-red-500 animate-pulse' : 'fill-gray-600 text-gray-600'}`} />
              <span className="font-medium text-white">Record live MQTT</span>
            </div>
            <p className="text-[10px] text-gray-500">
              Captures trajectories as they arrive on this server (edge → Mosquitto → here). No edge update needed.
            </p>

            <div>
              <div className="text-gray-400 mb-1">Filename label</div>
              <input
                type="text"
                value={recordLabel}
                onChange={e => setRecordLabel(e.target.value)}
                disabled={recording || recordBusy}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
              />
            </div>

            <div className="flex items-center gap-3 text-[10px]">
              <div className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-full ${mqttActive ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                <span className="text-gray-400">MQTT broker</span>
                <span className={mqttActive ? 'text-emerald-400' : 'text-gray-500'}>
                  {mqttActive ? 'receiving tracks' : recordStatus?.mqtt?.connected ? 'connected, idle' : 'waiting…'}
                </span>
              </div>
              {recording && (
                <div className="flex items-center gap-1">
                  <span className={`inline-block w-2 h-2 rounded-full ${streamLive ? 'bg-emerald-400' : 'bg-amber-500'}`} />
                  <span className={streamLive ? 'text-emerald-400' : 'text-amber-400'}>
                    {streamLive ? 'writing' : 'no msgs yet'}
                  </span>
                </div>
              )}
            </div>

            {!recording ? (
              <button
                onClick={startRecord}
                disabled={recordBusy}
                className="w-full px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-white font-medium disabled:bg-gray-700 disabled:text-gray-500 flex items-center justify-center gap-2"
              >
                {recordBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Circle className="w-3 h-3 fill-current" />}
                Start recording
              </button>
            ) : (
              <button
                onClick={stopRecord}
                disabled={recordBusy}
                className="w-full px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white font-medium flex items-center justify-center gap-2"
              >
                {recordBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                Stop recording
              </button>
            )}

            {recording && recordStatus && (
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-500">File</span>
                  <span className="font-mono text-gray-300 truncate max-w-[12rem]">{recordStatus.file || '—'}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-500">Size</span>
                  <span className="font-mono">{formatBytes(recordStatus.bytesWritten)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-500">Messages</span>
                  <span className="font-mono">{recordStatus.messagesRecorded.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-gray-800 rounded overflow-hidden">
                  <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${recordProgress}%` }} />
                </div>
                <div className="text-[10px] text-gray-600 text-right">
                  {formatBytes(recordStatus.bytesWritten)} (bar ref: 500 MB)
                </div>
              </div>
            )}
          </div>

          {/* Replay */}
          <div>
            <div className="text-gray-400 mb-1">Recorded capture</div>
            <select
              ref={selectRef}
              value={selected}
              onChange={e => {
                const v = e.target.value
                selectedRef.current = v
                setSelected(v)
              }}
              disabled={running}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
            >
              {files.length === 0 && <option value="">(no files in {replayDir || '/data/replay'})</option>}
              {files.map(f => (
                <option key={f.name} value={f.name}>
                  {f.name} ({formatBytes(f.size)}{f.mtimeMs ? ` · ${formatFileAge(f.mtimeMs)}` : ''})
                </option>
              ))}
            </select>
            {running && playingFile && (
              <div className="mt-1 text-[10px] text-amber-400">
                Now playing: <span className="font-mono">{playingFile}</span>
                {status?.fileMtimeMs ? ` · ${formatFileAge(status.fileMtimeMs)}` : ''}
                {status?.fileSize ? ` · ${formatBytes(status.fileSize)}` : ''}
                {selectionMismatch && ' — stop replay to switch files'}
              </div>
            )}
            {!running && selectedMeta && (
              <div className="mt-1 text-[10px] text-gray-500">
                Selected: <span className="font-mono text-gray-300">{selectedMeta.name}</span>
                {' · '}{formatBytes(selectedMeta.size)}
                {selectedMeta.mtimeMs ? ` · ${formatFileAge(selectedMeta.mtimeMs)}` : ''}
              </div>
            )}
            {files.length === 1 && (
              <div className="mt-1 text-[10px] text-amber-300/90">
                Only one capture in {replayDir || '/data/replay'}.
              </div>
            )}
            {files.length > 1 && !running && (
              <div className="mt-1 text-[10px] text-gray-500">
                {files.length} captures available — pick one, then Start replay.
              </div>
            )}
            {mqttActive && running && (
              <div className="mt-1 text-[10px] text-sky-400">
                Live edge tracks are also visible — replay tracks use the replay- prefix.
              </div>
            )}
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
              onClick={() => start()}
              disabled={!selected || loading || seeking}
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

          {(selected || status?.file) && (
            <div className="space-y-1.5 pt-2 border-t border-gray-800">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-400">Scrub position</span>
                <span className="font-mono text-amber-300">{scrubPct.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={scrubPct}
                disabled={seeking || !selected}
                className="w-full h-2 accent-amber-500 cursor-pointer disabled:opacity-40"
                onPointerDown={() => { scrubbingRef.current = true }}
                onChange={e => setScrubPct(Number(e.target.value))}
                onPointerUp={() => {
                  scrubbingRef.current = false
                  void seekTo(scrubPct)
                }}
              />
              <div className="flex justify-between text-[10px] text-gray-500">
                <span>{formatRecordedTs(metaForLabels?.firstRecordedTs)}</span>
                <span className="text-amber-300/90">{formatRecordedTs(displayRecordedTs)}</span>
                <span>{formatRecordedTs(metaForLabels?.lastRecordedTs)}</span>
              </div>
              <p className="text-[10px] text-gray-500">
                Drag the slider to jump inside the file — release to seek and play from that point.
                {seeking && ' Seeking…'}
              </p>
            </div>
          )}

          {status && (
            <div className="space-y-1 pt-2 border-t border-gray-800 text-[11px]">
              <div className="flex justify-between"><span className="text-gray-500">File:</span><span className="font-mono text-gray-300">{status.file || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Progress:</span><span>{(status.progress * 100).toFixed(1)}%</span></div>
              {status.recordedCurrentTs ? (
                <div className="flex justify-between"><span className="text-gray-500">Capture time:</span><span className="font-mono text-gray-300">{formatRecordedTs(status.recordedCurrentTs)}</span></div>
              ) : null}
              <div className="h-1.5 bg-gray-800 rounded overflow-hidden pointer-events-none">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.min(100, status.progress * 100)}%` }} />
              </div>
            </div>
          )}

          {error && <div className="text-red-400 text-[11px]">{error}</div>}
        </div>
      )}
    </div>
  )
}
