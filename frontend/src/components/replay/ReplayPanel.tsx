import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Play, Square, X, ChevronDown, ChevronUp, RefreshCw, Loader2, Circle, GripVertical, Sparkles, Wand2, AlertTriangle, Trash2 } from 'lucide-react'
import { API_BASE } from '../../config/api'
import { useTrackingActions, useTracking } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import { useDraggablePanel } from '../../hooks/useDraggablePanel'

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
  durationMinutes?: number | null
  stopsAt?: number | null
  remainingMs?: number | null
  autoStop?: boolean
  mqtt?: {
    connected: boolean
    active: boolean
    ageMs: number | null
    messagesReceived: number
  }
}

interface ReconcilePreset {
  id: string
  label: string
  description: string
}

interface ReconcileJob {
  id: string
  sourceFile: string
  presetId: string
  presetLabel: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  progress: number
  artifactName?: string | null
  meta?: {
    metrics?: {
      merged_tracks?: number
      raw_messages?: number
      batch_count?: number
      forward_fragments?: number
      merge_reduction?: number
    }
    batchCount?: number
  } | null
  error?: string | null
  createdAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

const reconcilePhaseLabel = (progress: number, batches?: number) => {
  if (progress >= 1) return 'Complete'
  if (progress >= 0.995) return 'Finalizing artifact file…'
  if (progress >= 0.9) {
    return batches
      ? `Writing reconciled artifact (${batches.toLocaleString()} batches so far — large captures can take several minutes)`
      : 'Writing reconciled artifact to disk'
  }
  if (progress >= 0.86) return 'Smoothing trajectories'
  if (progress >= 0.82) return 'Merging track fragments (global path merge)'
  if (progress >= 0.1) return 'Forward pass — reading capture & reconciling'
  return 'Starting job…'
}

const friendlyReconcileError = (msg: string) => {
  if (/502|503|504|fetch failed|network/i.test(msg)) {
    return `${msg} — backend may have restarted while the job was still running; check server logs and reconciled/ folder`
  }
  return msg
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
const RECORD_DURATION_STORAGE_KEY = 'hyperspace.replay.recordDurationMinutes'

const formatCountdown = (ms: number) => {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

const readStoredDuration = () => {
  try {
    const v = localStorage.getItem(RECORD_DURATION_STORAGE_KEY)
    if (v == null || v === '') return '35'
    return v
  } catch {
    return '35'
  }
}

export default function ReplayPanel({ onClose }: ReplayPanelProps) {
  const { venue } = useVenue()
  const { demoSessionId } = useTracking()
  const { clearReplayTracks, setMqttReplayActive, startDemoSession, stopDemoSession } = useTrackingActions()
  const [files, setFiles] = useState<ReplayFile[]>([])
  const [selected, setSelected] = useState<string>('')
  const [speed, setSpeed] = useState<number>(4)
  const [status, setStatus] = useState<ReplayStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [replayDir, setReplayDir] = useState<string>('')

  const [recordLabel, setRecordLabel] = useState('grocery_capture')
  const [recordDurationMinutes, setRecordDurationMinutes] = useState(readStoredDuration)
  const [recordStatus, setRecordStatus] = useState<RecordStatus | null>(null)
  const [recordBusy, setRecordBusy] = useState(false)
  const [countdownTick, setCountdownTick] = useState(Date.now())
  const [scrubPct, setScrubPct] = useState(0)
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null)
  const [seeking, setSeeking] = useState(false)

  const [reconcilePresets, setReconcilePresets] = useState<ReconcilePreset[]>([])
  const [reconcilePresetId, setReconcilePresetId] = useState('GROCERY_BALANCED')
  const [reconcileJobs, setReconcileJobs] = useState<ReconcileJob[]>([])
  const [selectedReconcileJobId, setSelectedReconcileJobId] = useState('')
  const [playbackSource, setPlaybackSource] = useState<'raw' | 'reconciled'>('raw')
  const [reconcileBusy, setReconcileBusy] = useState(false)
  const [reconcileError, setReconcileError] = useState<string | null>(null)
  const [reconcileCancelBusy, setReconcileCancelBusy] = useState(false)
  const [reconcileDeleteBusy, setReconcileDeleteBusy] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const selectedRef = useRef<string>('')
  const startingReplayRef = useRef(false)
  const scrubbingRef = useRef(false)
  const prevRecordingRef = useRef(false)
  selectedRef.current = selected

  const { panelRef, panelStyle, dragging, headerProps } = useDraggablePanel({
    storageKey: 'hyperspace.panel.replay.position',
    defaultX: 64,
    defaultY: 16,
  })

  const readSelectedFile = () => {
    const fromDom = selectRef.current?.value?.trim()
    if (fromDom) return fromDom
    return selectedRef.current
  }

  const selectedMeta = files.find(f => f.name === selected)

  const recording = !!recordStatus?.recording

  const refreshReconcilePresets = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/presets`)
      if (!res.ok) return
      const data = await res.json()
      setReconcilePresets(data.presets || [])
    } catch { /* ignore */ }
  }, [])

  const refreshReconcileJobs = useCallback(async (sourceFile?: string) => {
    const file = sourceFile || selectedRef.current
    if (!file) {
      setReconcileJobs([])
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/jobs?sourceFile=${encodeURIComponent(file)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const jobs: ReconcileJob[] = data.jobs || []
      setReconcileJobs(jobs)
      const active = jobs.find(j => j.status === 'running' || j.status === 'pending')
      const complete = jobs.find(j => j.status === 'complete')
      if (active) setSelectedReconcileJobId(active.id)
      else if (complete && !selectedReconcileJobId) setSelectedReconcileJobId(complete.id)
      if (!active && complete) setReconcileError(null)
    } catch (err: unknown) {
      setReconcileError(friendlyReconcileError(err instanceof Error ? err.message : String(err)))
    }
  }, [selectedReconcileJobId])

  const refreshFiles = useCallback(async (preferNewest = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/files`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const list: ReplayFile[] = (data.files || []).filter((f: ReplayFile) => !f.name.endsWith('.reconciled.jsonl'))
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
      setMqttReplayActive(!!next.running)
      // Only mirror the active file into the dropdown while playback is running.
      if (next.running && next.file) {
        setSelected(next.file)
        selectedRef.current = next.file
      }
    } catch { /* ignore */ }
  }, [setMqttReplayActive])

  const refreshRecordStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/replay/record/status`)
      if (!res.ok) return
      const data = await res.json()
      const next: RecordStatus | null = data.status || null
      setRecordStatus(next)
      if (prevRecordingRef.current && next && !next.recording) {
        if (next.file) {
          setSelected(next.file)
          selectedRef.current = next.file
        }
        await refreshFiles(true)
        if (next.autoStop) {
          setError(null)
        }
      }
      prevRecordingRef.current = !!next?.recording
    } catch { /* ignore */ }
  }, [refreshFiles])

  useEffect(() => {
    refreshFiles()
    refreshStatus()
    refreshRecordStatus()
    refreshReconcilePresets()
    pollRef.current = setInterval(refreshStatus, 1000)
    recordPollRef.current = setInterval(refreshRecordStatus, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (recordPollRef.current) clearInterval(recordPollRef.current)
    }
  }, [refreshFiles, refreshStatus, refreshRecordStatus, refreshReconcilePresets])

  useEffect(() => {
    if (selected) void refreshReconcileJobs(selected)
  }, [selected, refreshReconcileJobs])

  useEffect(() => {
    const runningJob = reconcileJobs.find(j => j.status === 'running' || j.status === 'pending')
    if (!runningJob) return
    const iv = window.setInterval(() => { void refreshReconcileJobs(selected) }, 1000)
    return () => window.clearInterval(iv)
  }, [reconcileJobs, selected, refreshReconcileJobs])

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

  useEffect(() => {
    if (!recording) return
    const iv = window.setInterval(() => setCountdownTick(Date.now()), 1000)
    return () => window.clearInterval(iv)
  }, [recording])

  const scheduledDurationMinutes = Number(recordDurationMinutes)
  const hasAutoStop = Number.isFinite(scheduledDurationMinutes) && scheduledDurationMinutes > 0
  const remainingMs = recording && recordStatus?.stopsAt
    ? Math.max(0, recordStatus.stopsAt - countdownTick)
    : recordStatus?.remainingMs ?? null
  const timerProgress = recording && recordStatus?.startedAt && recordStatus.durationMinutes
    ? Math.min(100, ((countdownTick - recordStatus.startedAt) / (recordStatus.durationMinutes * 60 * 1000)) * 100)
    : 0

  const startRecord = useCallback(async () => {
    setRecordBusy(true)
    setError(null)
    try {
      localStorage.setItem(RECORD_DURATION_STORAGE_KEY, recordDurationMinutes)
      const durationMinutes = hasAutoStop ? scheduledDurationMinutes : undefined
      const res = await fetch(`${API_BASE}/api/replay/record/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: recordLabel, durationMinutes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setRecordStatus(data.status)
      prevRecordingRef.current = true
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecordBusy(false)
    }
  }, [recordLabel, recordDurationMinutes, hasAutoStop, scheduledDurationMinutes])

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

  const startReconcileJob = useCallback(async () => {
    const file = readSelectedFile()
    if (!file || !reconcilePresetId) return
    setReconcileBusy(true)
    setReconcileError(null)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFile: file, presetId: reconcilePresetId, venueId: venue?.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSelectedReconcileJobId(data.job?.id || '')
      await refreshReconcileJobs(file)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setReconcileError(friendlyReconcileError(msg))
      setError(msg)
    } finally {
      setReconcileBusy(false)
    }
  }, [reconcilePresetId, venue?.id, refreshReconcileJobs])

  const cancelReconcileJob = useCallback(async (jobId: string) => {
    setReconcileCancelBusy(true)
    setReconcileError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await refreshReconcileJobs(selectedRef.current)
    } catch (err: unknown) {
      setReconcileError(friendlyReconcileError(err instanceof Error ? err.message : String(err)))
    } finally {
      setReconcileCancelBusy(false)
    }
  }, [refreshReconcileJobs])

  const deleteReconcileJob = useCallback(async (jobId: string) => {
    setReconcileDeleteBusy(jobId)
    setReconcileError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (selectedReconcileJobId === jobId) setSelectedReconcileJobId('')
      await refreshReconcileJobs(selectedRef.current)
    } catch (err: unknown) {
      setReconcileError(friendlyReconcileError(err instanceof Error ? err.message : String(err)))
    } finally {
      setReconcileDeleteBusy(null)
    }
  }, [refreshReconcileJobs, selectedReconcileJobId])

  const clearFailedReconcileJobs = useCallback(async () => {
    const file = readSelectedFile()
    if (!file) return
    setReconcileDeleteBusy('all')
    setReconcileError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/jobs/clear-failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFile: file }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const failedSelected = reconcileJobs.find(j => j.status === 'failed' && j.id === selectedReconcileJobId)
      if (failedSelected) setSelectedReconcileJobId('')
      await refreshReconcileJobs(file)
    } catch (err: unknown) {
      setReconcileError(friendlyReconcileError(err instanceof Error ? err.message : String(err)))
    } finally {
      setReconcileDeleteBusy(null)
    }
  }, [refreshReconcileJobs, reconcileJobs, selectedReconcileJobId])

  const start = useCallback(async (startProgress?: number) => {
    const fileToPlay = readSelectedFile()
    if (!fileToPlay) return
    const progress = startProgress ?? scrubPct / 100
    startingReplayRef.current = true
    setMqttReplayActive(true)
    setError(null)
    try {
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' })
      await waitForReplayStopped()

      if (venue?.id) {
        await startDemoSession(venue.id)
      }

      const useReconciled = playbackSource === 'reconciled' && selectedReconcileJobId
      const body: Record<string, unknown> = {
        speed,
        rewriteTimestamps: true,
        startProgress: progress,
      }
      if (useReconciled) {
        body.jobId = selectedReconcileJobId
        body.reconciled = true
      } else {
        body.file = fileToPlay
      }

      const res = await fetch(`${API_BASE}/api/replay/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      // Reconciled replay plays the artifact file, not the raw capture selected in the dropdown.
      if (!useReconciled) {
        const playing = data.status?.file || data.requestedFile
        if (playing && playing !== fileToPlay) {
          throw new Error(`Server started "${playing}" instead of "${fileToPlay}"`)
        }
      } else if (!data.status?.running) {
        throw new Error(data.error || 'Reconciled replay failed to start')
      }
      setSelected(fileToPlay)
      selectedRef.current = fileToPlay
      await refreshStatus()
    } catch (err: unknown) {
      setMqttReplayActive(false)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      startingReplayRef.current = false
    }
  }, [speed, refreshStatus, waitForReplayStopped, scrubPct, setMqttReplayActive, venue?.id, startDemoSession, playbackSource, selectedReconcileJobId])

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
    setMqttReplayActive(false)
    clearReplayTracks()
    try {
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' })
      await stopDemoSession()
      clearReplayTracks()
      await refreshStatus()
    } catch (err) {
      console.error(err)
    }
  }, [refreshStatus, clearReplayTracks, setMqttReplayActive, stopDemoSession])

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

  const activeReconcileJob = reconcileJobs.find(j => j.status === 'running' || j.status === 'pending') ?? null
  const failedReconcileJobs = reconcileJobs.filter(j => j.status === 'failed')
  const latestFailedReconcileJob = failedReconcileJobs[0] ?? null
  const latestCompleteReconcileJob = reconcileJobs.find(j => j.status === 'complete') ?? null
  const reconcileProgressPct = Math.min(100, Math.max(0, (activeReconcileJob?.progress ?? 0) * 100))
  const showFailedBanner = !activeReconcileJob && (reconcileError || latestFailedReconcileJob?.error)

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
    <div
      ref={panelRef}
      className="absolute z-30 w-[26rem] bg-gray-900/95 backdrop-blur border border-amber-700/60 rounded-xl shadow-2xl text-gray-200 text-xs"
      style={panelStyle}
    >
      <div
        {...headerProps}
        className={`flex items-center gap-2 px-3 py-2 border-b border-gray-700/80 select-none touch-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="Drag to move"
      >
        <GripVertical className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        <History className="w-4 h-4 text-amber-400" />
        <span className="font-semibold text-white">MQTT Replay</span>
        {running && <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400 animate-pulse">replaying</span>}
        {demoSessionId && (
          <span className="ml-1 text-[10px] uppercase tracking-wider text-emerald-400" title="KPIs recorded to isolated demo DB">
            demo kpis
          </span>
        )}
        {recording && <span className="ml-1 text-[10px] uppercase tracking-wider text-red-400 animate-pulse">rec</span>}
        {activeReconcileJob && (
          <span className="ml-1 text-[10px] uppercase tracking-wider text-emerald-400 animate-pulse">
            reconcile {Math.round(reconcileProgressPct)}%
          </span>
        )}
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

            <div>
              <div className="text-gray-400 mb-1">Auto-stop after (minutes)</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={720}
                  step={1}
                  value={recordDurationMinutes}
                  onChange={e => setRecordDurationMinutes(e.target.value)}
                  disabled={recording || recordBusy}
                  placeholder="0 = manual stop"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
                />
                <span className="text-[10px] text-gray-500 shrink-0">0 = off</span>
              </div>
              <p className="text-[10px] text-gray-600 mt-1">
                Server stops the capture when the timer ends (~1 GB / 35 min). Max 720 min.
              </p>
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
                {hasAutoStop
                  ? `Start recording (${scheduledDurationMinutes} min timer)`
                  : 'Start recording'}
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
                {recordStatus.stopsAt != null && remainingMs != null && (
                  <>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-500">Auto-stop</span>
                      <span className="font-mono text-amber-300">
                        {remainingMs > 0 ? formatCountdown(remainingMs) : 'stopping…'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-1000"
                        style={{ width: `${timerProgress}%` }}
                      />
                    </div>
                  </>
                )}
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

          {/* Offline post-process reconciliation */}
          <div className="space-y-2 pb-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium text-white">Post-process reconciliation</span>
            </div>
            <p className="text-[10px] text-gray-500">
              Full-session analysis with grocery-aware path merge. Does not affect live canvas.
            </p>

            <div>
              <div className="text-gray-400 mb-1">Preset</div>
              <select
                value={reconcilePresetId}
                onChange={e => setReconcilePresetId(e.target.value)}
                disabled={reconcileBusy || running}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
              >
                {reconcilePresets.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              {reconcilePresets.find(p => p.id === reconcilePresetId)?.description && (
                <p className="text-[10px] text-gray-600 mt-1">
                  {reconcilePresets.find(p => p.id === reconcilePresetId)?.description}
                </p>
              )}
            </div>

            <button
              onClick={() => void startReconcileJob()}
              disabled={!selected || reconcileBusy || running || !!activeReconcileJob}
              className="w-full px-3 py-2 rounded bg-emerald-800 hover:bg-emerald-700 text-white font-medium disabled:bg-gray-700 disabled:text-gray-500 flex items-center justify-center gap-2"
            >
              {reconcileBusy || activeReconcileJob ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {activeReconcileJob ? 'Post-process running…' : 'Run post-process on selected capture'}
            </button>

            {activeReconcileJob && (
              <div className="space-y-1.5 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-2 py-2">
                <div className="flex justify-between items-center text-[11px] gap-2">
                  <span className="text-emerald-300 font-medium truncate">{activeReconcileJob.presetLabel}</span>
                  <span className="font-mono text-emerald-200 shrink-0">{reconcileProgressPct.toFixed(0)}%</span>
                </div>
                <div className="text-[10px] text-gray-400">
                  {reconcilePhaseLabel(activeReconcileJob.progress || 0)}
                </div>
                <div className="h-2 bg-gray-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-700 ease-out"
                    style={{ width: `${reconcileProgressPct}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[10px] text-gray-500 gap-2">
                  <span className="font-mono truncate" title={activeReconcileJob.id}>
                    job {activeReconcileJob.id.slice(0, 8)}…
                  </span>
                  <button
                    type="button"
                    onClick={() => void cancelReconcileJob(activeReconcileJob.id)}
                    disabled={reconcileCancelBusy || running}
                    className="shrink-0 px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-red-300 disabled:opacity-50"
                  >
                    {reconcileCancelBusy ? 'Cancelling…' : 'Cancel'}
                  </button>
                </div>
                {activeReconcileJob.startedAt && (
                  <div className="text-[10px] text-gray-600">
                    Started {formatRecordedTs(new Date(activeReconcileJob.startedAt).getTime())}
                  </div>
                )}
              </div>
            )}

            {latestCompleteReconcileJob && !activeReconcileJob && (
              <div className="text-[10px] text-emerald-400/90 bg-emerald-950/20 border border-emerald-900/40 rounded px-2 py-1.5">
                Latest complete: {latestCompleteReconcileJob.presetLabel}
                {' — '}
                {latestCompleteReconcileJob.meta?.metrics?.merged_tracks ?? '?'} tracks
                {latestCompleteReconcileJob.meta?.metrics?.batch_count != null
                  ? `, ${latestCompleteReconcileJob.meta.metrics.batch_count} batches`
                  : ''}
                {latestCompleteReconcileJob.artifactName
                  ? ` · ${latestCompleteReconcileJob.artifactName}`
                  : ''}
              </div>
            )}

            {showFailedBanner && (
              <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-2 py-2 space-y-1">
                <div className="flex items-start gap-1.5 text-[11px] text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Reconcile error</div>
                    <div className="text-red-200/90 break-words font-mono text-[10px] mt-0.5">
                      {friendlyReconcileError(reconcileError || latestFailedReconcileJob?.error || '')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {latestFailedReconcileJob && (
                      <button
                        type="button"
                        onClick={() => void deleteReconcileJob(latestFailedReconcileJob.id)}
                        disabled={!!reconcileDeleteBusy || running}
                        className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-red-200 disabled:opacity-50 text-[10px]"
                      >
                        {reconcileDeleteBusy === latestFailedReconcileJob.id ? '…' : 'Delete'}
                      </button>
                    )}
                    {failedReconcileJobs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => void clearFailedReconcileJobs()}
                        disabled={reconcileDeleteBusy === 'all' || running}
                        className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-red-200 disabled:opacity-50 text-[10px]"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>
                {latestFailedReconcileJob && !reconcileError && (
                  <div className="text-[10px] text-red-300/70 font-mono pl-5 space-y-0.5">
                    <div>job: {latestFailedReconcileJob.id}</div>
                    <div>preset: {latestFailedReconcileJob.presetId}</div>
                    {latestFailedReconcileJob.finishedAt && (
                      <div>failed: {formatRecordedTs(new Date(latestFailedReconcileJob.finishedAt).getTime())}</div>
                    )}
                    {latestFailedReconcileJob.progress > 0 && (
                      <div>last progress: {Math.round(latestFailedReconcileJob.progress * 100)}%</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {reconcileJobs.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-gray-400 text-[10px] uppercase tracking-wide">Jobs for this capture</div>
                  {failedReconcileJobs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void clearFailedReconcileJobs()}
                      disabled={reconcileDeleteBusy === 'all' || running}
                      className="text-[10px] text-red-300/80 hover:text-red-200 disabled:opacity-40 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear {failedReconcileJobs.length} failed
                    </button>
                  )}
                </div>
                {reconcileJobs.slice(0, 5).map(job => (
                  <div key={job.id} className="flex justify-between items-center gap-2 text-[10px] bg-gray-800/60 rounded px-2 py-1">
                    <span className="text-gray-300 truncate min-w-0">{job.presetLabel || job.presetId}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {(job.status === 'running' || job.status === 'pending') && (
                        <div className="w-12 h-1 bg-gray-700 rounded overflow-hidden">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${Math.min(100, (job.progress || 0) * 100)}%` }}
                          />
                        </div>
                      )}
                      <span className={
                        job.status === 'complete' ? 'text-emerald-400'
                          : job.status === 'failed' ? 'text-red-400'
                            : job.status === 'running' ? 'text-amber-300' : 'text-gray-500'
                      }>
                        {job.status === 'running' || job.status === 'pending'
                          ? `${Math.round((job.progress || 0) * 100)}%`
                          : job.status}
                      </span>
                      {job.status === 'failed' && (
                        <button
                          type="button"
                          title="Delete failed job"
                          onClick={() => void deleteReconcileJob(job.id)}
                          disabled={!!reconcileDeleteBusy || running}
                          className="p-0.5 rounded hover:bg-gray-700 text-red-300/80 hover:text-red-200 disabled:opacity-40"
                        >
                          {reconcileDeleteBusy === job.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Trash2 className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <div className="text-gray-400 mb-1">Playback source</div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setPlaybackSource('raw')}
                  disabled={running}
                  className={`py-1.5 rounded text-xs ${playbackSource === 'raw' ? 'bg-amber-700 text-white' : 'bg-gray-800 hover:bg-gray-700'}`}
                >
                  Raw capture
                </button>
                <button
                  type="button"
                  onClick={() => setPlaybackSource('reconciled')}
                  disabled={running}
                  className={`py-1.5 rounded text-xs ${playbackSource === 'reconciled' ? 'bg-emerald-700 text-white' : 'bg-gray-800 hover:bg-gray-700'}`}
                >
                  Reconciled
                </button>
              </div>
            </div>

            {playbackSource === 'reconciled' && (
              <div>
                <div className="text-gray-400 mb-1">Reconciled artifact (complete jobs only)</div>
                <select
                  value={selectedReconcileJobId}
                  onChange={e => setSelectedReconcileJobId(e.target.value)}
                  disabled={running}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white"
                >
                  <option value="">Select a completed job…</option>
                  {reconcileJobs.filter(j => j.status === 'complete').map(j => (
                    <option key={j.id} value={j.id}>
                      {j.presetLabel} — {j.meta?.metrics?.merged_tracks ?? '?'} tracks
                    </option>
                  ))}
                </select>
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
              disabled={
                !selected || loading || seeking
                || (playbackSource === 'reconciled' && !selectedReconcileJobId)
              }
              className="w-full px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium disabled:bg-gray-700 disabled:text-gray-500 flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              {playbackSource === 'reconciled' ? 'Start reconciled replay' : 'Start raw replay'}
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
