import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download, Film, Loader2, MapPin, Play, Sparkles, Square, Target,
} from 'lucide-react'
import { API_BASE } from '../../config/api'
import { useTrackingActions } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import type { TrackStoriesDocument, TrackStory } from '../../types/trackStories'
import { fmtStory } from '../../types/trackStories'

interface Props {
  jobId: string
  speed: number
  disabled?: boolean
  initialStoryId?: string
}

function mergeMarkerPct(story: TrackStory, t: number) {
  const span = Math.max(1, story.tEnd - story.tStart)
  return ((t - story.tStart) / span) * 100
}

export default function TrackStoriesPanel({
  jobId,
  speed,
  disabled,
  initialStoryId,
}: Props) {
  const { venue } = useVenue()
  const { setStoryReplayActive, setMqttReplayActive } = useTrackingActions()
  const exportRef = useRef<HTMLDivElement>(null)

  const [doc, setDoc] = useState<TrackStoriesDocument | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedStoryId, setSelectedStoryId] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)
  const [pickMode, setPickMode] = useState(false)
  const scrubbingRef = useRef(false)

  const selectedStory = doc?.stories?.find(s => s.id === selectedStoryId) ?? doc?.stories?.[0] ?? null

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('hyperspace:story-pick-mode', { detail: { active: pickMode } }))
    return () => {
      window.dispatchEvent(new CustomEvent('hyperspace:story-pick-mode', { detail: { active: false } }))
    }
  }, [pickMode])

  const loadStories = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/replay/reconcile/jobs/${encodeURIComponent(jobId)}/stories`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const storiesDoc = data.stories as TrackStoriesDocument
      setDoc(storiesDoc)
      const pick = initialStoryId && storiesDoc.stories?.some(s => s.id === initialStoryId)
        ? initialStoryId
        : storiesDoc.stories?.[0]?.id || ''
      setSelectedStoryId(pick)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setDoc(null)
    } finally {
      setLoading(false)
    }
  }, [jobId, initialStoryId])

  useEffect(() => { void loadStories() }, [loadStories])

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/replay/stories/status`)
      if (!res.ok) return
      const data = await res.json()
      const st = data.status
      setRunning(!!st?.running)
      if (st?.progress != null) {
        if (!scrubbingRef.current) setScrubPct(st.progress * 100)
      }
      if (st?.running) setStoryReplayActive(true)
    } catch { /* ignore */ }
  }, [setStoryReplayActive])

  useEffect(() => {
    pollStatus()
    const iv = window.setInterval(pollStatus, running ? 500 : 3000)
    return () => window.clearInterval(iv)
  }, [pollStatus, running])

  useEffect(() => {
    const onPick = (e: Event) => {
      if (!pickMode || !doc?.stories?.length) return
      const { x, z } = (e as CustomEvent<{ x: number; z: number }>).detail || {}
      if (!Number.isFinite(x) || !Number.isFinite(z)) return
      let best: TrackStory | null = null
      let bestD = Infinity
      for (const s of doc.stories) {
        const ax = s.anchor?.x ?? s.reconSamples?.[0]?.x
        const az = s.anchor?.z ?? s.reconSamples?.[0]?.z
        if (ax == null || az == null) continue
        const d = Math.hypot(x - ax, z - az)
        if (d < bestD) { bestD = d; best = s }
      }
      if (best && bestD < 8) {
        setSelectedStoryId(best.id)
        setPickMode(false)
      }
    }
    window.addEventListener('hyperspace:story-floor-pick', onPick)
    return () => window.removeEventListener('hyperspace:story-floor-pick', onPick)
  }, [pickMode, doc])

  const startStory = useCallback(async (startProgress?: number) => {
    if (!selectedStory) return
    setError(null)
    setMqttReplayActive(false)
    setStoryReplayActive(true)
    try {
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' })
      await fetch(`${API_BASE}/api/replay/stories/stop`, { method: 'POST' })
      const res = await fetch(`${API_BASE}/api/replay/stories/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          storyId: selectedStory.id,
          venueId: venue?.id,
          speed,
          startProgress: startProgress ?? scrubPct / 100,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setRunning(true)
    } catch (err: unknown) {
      setStoryReplayActive(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [selectedStory, jobId, venue?.id, speed, scrubPct, setMqttReplayActive, setStoryReplayActive])

  const stopStory = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/replay/stories/stop`, { method: 'POST' })
    } finally {
      setRunning(false)
      setStoryReplayActive(false)
    }
  }, [setStoryReplayActive])

  const seekStory = useCallback(async (pct: number) => {
    if (!selectedStory) return
    try {
      const res = await fetch(`${API_BASE}/api/replay/stories/seek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          storyId: selectedStory.id,
          venueId: venue?.id,
          speed,
          progress: pct / 100,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setRunning(true)
      setStoryReplayActive(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [selectedStory, jobId, venue?.id, speed, setStoryReplayActive])

  const exportSlide = useCallback(async () => {
    if (!selectedStory || !exportRef.current) return
    try {
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: '#111827',
        scale: 2,
      })
      const link = document.createElement('a')
      link.download = `track-story-${selectedStory.id}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch {
      setError('Export failed — try again or screenshot the panel')
    }
  }, [selectedStory])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading track stories…
      </div>
    )
  }

  if (error && !doc) {
    return (
      <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
        {error}
        <p className="text-[10px] text-amber-200/60 mt-1">Re-run post-process on this capture to generate stories.json</p>
      </div>
    )
  }

  if (!doc?.stories?.length) return null

  const kpis = selectedStory?.kpis

  return (
    <div className="space-y-3 rounded-xl border border-violet-800/40 bg-violet-950/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-violet-100">
          <Film className="w-4 h-4 text-violet-400" />
          Compare sample tracks
        </div>
        <span className="text-[10px] text-violet-300/70">{doc.stories.length} stories</span>
      </div>

      <p className="text-[10px] text-gray-500 leading-relaxed">
        Dashed blue = raw perception fragments. Solid green = reconciled path. Only this story plays — full floor replay stays in the other mode.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {doc.stories.map(s => (
          <button
            key={s.id}
            type="button"
            disabled={disabled || running}
            onClick={() => setSelectedStoryId(s.id)}
            className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
              selectedStoryId === s.id
                ? 'border-violet-500 bg-violet-900/50 text-violet-100'
                : 'border-gray-700 text-gray-400 hover:border-gray-600'
            }`}
          >
            {s.rawFragmentCount}→1 · {s.kpis.reconPathM.toFixed(0)}m
          </button>
        ))}
      </div>

      {selectedStory && kpis && (
        <div ref={exportRef} className="rounded-lg border border-gray-700 bg-gray-900/80 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-medium text-white">{selectedStory.label}</span>
            <span className="text-[10px] text-gray-500 font-mono">{selectedStory.id}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded bg-blue-950/30 border border-blue-900/40 px-2 py-1.5">
              <div className="text-blue-400/80 text-[10px] uppercase">Before (raw)</div>
              <div className="text-blue-200 font-mono">{kpis.rawPerceptionIds} IDs</div>
              <div className="text-gray-500">{fmtStory(kpis.rawMeanLifetimeS)}s avg · {fmtStory(kpis.rawTotalPathM)}m path</div>
            </div>
            <div className="rounded bg-emerald-950/30 border border-emerald-900/40 px-2 py-1.5">
              <div className="text-emerald-400/80 text-[10px] uppercase">After (reconciled)</div>
              <div className="text-emerald-200 font-mono">{fmtStory(kpis.reconLifetimeS)}s · {fmtStory(kpis.reconPathM)}m</div>
              <div className="text-gray-500">{kpis.reconShopperGrade ? 'Shopper-grade ≥30m' : 'Short path'}</div>
            </div>
          </div>
          {selectedStory.mergeEvents.length > 0 && (
            <div className="text-[10px] text-gray-500">
              {selectedStory.mergeEvents.length} merge point{selectedStory.mergeEvents.length > 1 ? 's' : ''} on timeline
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>Story timeline</span>
          <span>{scrubPct.toFixed(0)}%</span>
        </div>
        <div className="relative">
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={scrubPct}
            disabled={!selectedStory}
            className="w-full h-2 accent-violet-500"
            onPointerDown={() => { scrubbingRef.current = true }}
            onChange={e => setScrubPct(Number(e.target.value))}
            onPointerUp={() => {
              scrubbingRef.current = false
              void seekStory(scrubPct)
            }}
          />
          {selectedStory?.mergeEvents?.map((ev, i) => {
            if (ev.t == null) return null
            const left = mergeMarkerPct(selectedStory, ev.t)
            return (
              <div
                key={`${ev.fromFragmentId}-${i}`}
                title={`Merge @ ${new Date(ev.t).toLocaleTimeString()}`}
                className="absolute top-1/2 -translate-y-1/2 w-1.5 h-3.5 rounded-sm bg-amber-400/90 pointer-events-none"
                style={{ left: `calc(${left}% - 3px)` }}
              />
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <button
            type="button"
            disabled={disabled || !selectedStory}
            onClick={() => void startStory()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> Play story
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void stopStory()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium"
          >
            <Square className="w-3.5 h-3.5" /> Stop
          </button>
        )}
        <button
          type="button"
          onClick={() => setPickMode(v => !v)}
          className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs border ${
            pickMode ? 'border-amber-500 text-amber-200 bg-amber-950/40' : 'border-gray-700 text-gray-400'
          }`}
          title="Click the floor to pick nearest story"
        >
          <Target className="w-3.5 h-3.5" /> Pick on floor
        </button>
        <button
          type="button"
          onClick={() => void exportSlide()}
          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs border border-gray-700 text-gray-400 hover:text-white"
        >
          <Download className="w-3.5 h-3.5" /> Export slide
        </button>
      </div>

      {pickMode && (
        <p className="text-[10px] text-amber-300/90 flex items-center gap-1">
          <MapPin className="w-3 h-3" /> Click near a trail on the floorplan to switch story
        </p>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
