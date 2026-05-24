import { useCallback, useEffect, useState } from 'react'
import { Loader2, Play, AlertCircle } from 'lucide-react'
import { API_BASE } from '../../../config/api'

interface CaptureFile {
  name: string
  size: number
  mtimeMs?: number
}

interface BenchmarkJob {
  status: string
  stage?: string
  captureId?: string
  sourceFile?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

const STAGE_LABELS: Record<string, string> = {
  starting: 'Starting…',
  raw_explore: 'Stage 1 — raw perception',
  spatial_motion: 'Stage 2 — spatial motion',
  spatial_forensics: 'Stage 3 — forensics & coverage map',
  reconciler_sweep: 'Stage 4 — reconciler sweep',
  pipeline: 'Running pipeline…',
  done: 'Complete',
  failed: 'Failed',
}

interface Props {
  onStarted?: () => void
}

export default function RunBenchmarkPanel({ onStarted }: Props) {
  const [files, setFiles] = useState<CaptureFile[]>([])
  const [file, setFile] = useState('')
  const [captureId, setCaptureId] = useState('baseline_v0_overnight_2026-05-23')
  const [job, setJob] = useState<BenchmarkJob | null>(null)
  const [logTail, setLogTail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/capture-files`)
      if (!res.ok) return
      const data = await res.json()
      setFiles(data.files || [])
      if (!file && data.files?.length) {
        const trimmed = data.files.find((f: CaptureFile) => f.name.includes('trimmed'))
        setFile(trimmed?.name || data.files[0].name)
      }
    } catch { /* ignore */ }
  }, [file])

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/job`)
      if (!res.ok) return
      const data = await res.json()
      setJob(data.job)
      setLogTail(data.logTail || '')
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { fetchFiles() }, [fetchFiles])
  useEffect(() => {
    pollJob()
    const id = window.setInterval(pollJob, job?.status === 'running' ? 3000 : 15000)
    return () => window.clearInterval(id)
  }, [pollJob, job?.status])

  const start = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/benchmark/job/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId, file }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start')
      setJob(data.job)
      onStarted?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start benchmark')
    } finally {
      setLoading(false)
    }
  }

  const isRunning = job?.status === 'running'

  return (
    <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-100">Run benchmark on server</h3>
        {isRunning && (
          <span className="flex items-center gap-1.5 text-xs text-amber-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {STAGE_LABELS[job?.stage || ''] || job?.stage || 'Running…'}
          </span>
        )}
        {job?.status === 'completed' && (
          <span className="text-xs text-emerald-400">Last run completed — hit Refresh</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-gray-400">
          Capture file (.jsonl in replay folder)
          <select
            value={file}
            onChange={(e) => setFile(e.target.value)}
            disabled={isRunning}
            className="mt-1 w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
          >
            {files.length === 0 && <option value="">No .jsonl files found</option>}
            {files.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({(f.size / 1024 ** 3).toFixed(2)} GB)
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          Capture ID (run name)
          <input
            value={captureId}
            onChange={(e) => setCaptureId(e.target.value)}
            disabled={isRunning}
            className="mt-1 w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={loading || isRunning || !file || !captureId}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
        >
          {loading || isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {isRunning ? 'Running on server…' : 'Start benchmark'}
        </button>
        <p className="text-[11px] text-gray-500">
          Full 7 GB file takes hours. Runs on the main server — no SSH needed.
        </p>
      </div>

      {logTail && (
        <pre className="text-[10px] text-gray-500 bg-gray-950 border border-gray-800 rounded-lg p-2 max-h-28 overflow-y-auto font-mono whitespace-pre-wrap">
          {logTail}
        </pre>
      )}
    </div>
  )
}
