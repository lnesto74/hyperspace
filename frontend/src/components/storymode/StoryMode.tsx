/**
 * StoryMode — opt-in demo storytelling layer.
 *
 * Fully self-contained and additive: when inactive it renders only a small
 * launch button and registers no listeners, so it cannot affect any existing
 * app behavior. When active, it drives the REAL app (view switching, Neural
 * Dashboard, Heatmap, Narrator) through a scripted sequence of beats and
 * overlays a narrative card + timeline rail. On exit it restores the exact
 * view/Neural/replay state it found, so nothing is left changed.
 *
 * Spatial beats (queue, journey leak, live) animate a curated Replay Insight
 * episode straight onto the 3D map using the same public track actions Insight
 * Mode uses (setReplayMode / setReplayTracks) — so the queue actually builds on
 * screen at the queue beat, deterministically. It never opens the Replay panel
 * or mutates the ReplayInsight context. If the episode/data isn't available it
 * silently falls back to the live view, so it can never break the demo.
 *
 * It talks to the app only through already-public context actions
 * (useHeatmap, useNarrator2, useTrackingActions) and two callbacks passed in as
 * props — it never reaches into or mutates other components.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Film, X, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react'
import { useHeatmap } from '../../context/HeatmapContext'
import { useNarrator2 } from '../../context/Narrator2Context'
import { useTrackingActions } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import type { TrackWithTrail } from '../../types'

// Mirrors App.tsx ViewMode union (kept local to avoid a circular import).
type StoryViewMode =
  | 'main'
  | 'planogram'
  | 'dwgImporter'
  | 'lidarPlanner'
  | 'edgeCommissioning'
  | 'doohAnalytics'
  | 'doohEffectiveness'
  | 'businessReporting'
  | 'profitRadar'
  | 'benchmark'

export interface StoryModeProps {
  /** Current app view mode (captured on enter, restored on exit). */
  viewMode: StoryViewMode
  setViewMode: (m: StoryViewMode) => void
  /** Current Neural Dashboard enabled flag (captured on enter, restored on exit). */
  neuralEnabled: boolean
  setNeuralEnabled: (enabled: boolean) => void
}

type Rung =
  | 'OBSERVE'
  | 'SENSE'
  | 'ALERT'
  | 'EXPLAIN'
  | 'QUANTIFY'
  | 'DECIDE'
  | 'RECOMMEND'
  | 'REMEMBER'

interface StageActions {
  setViewMode: (m: StoryViewMode) => void
  setNeuralEnabled: (enabled: boolean) => void
  openHeatmap: () => void
  closeHeatmap: () => void
  openNarrator: () => void
  closeNarrator: () => void
}

interface Beat {
  id: string
  time: string
  period: 'Morning' | 'Afternoon' | 'Evening'
  rung: Rung
  title: string
  floor: string
  hyperspace: string
  outcome: string
  component: string
  stage: (a: StageActions) => void
  /** Preferred Replay Insight episode types to animate on the map for this beat. */
  episodeTypes?: string[]
}

// ─── Replay playback helpers (pure, module scope) ───

type EpisodePos = { timestamp: number; x: number; z: number; vx?: number; vz?: number }

function interpPos(positions: EpisodePos[], time: number): EpisodePos | null {
  if (positions.length === 0) return null
  if (time <= positions[0].timestamp) return positions[0]
  const last = positions[positions.length - 1]
  if (time >= last.timestamp) return last
  let lo = 0
  let hi = positions.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (positions[mid].timestamp <= time) lo = mid
    else hi = mid
  }
  const p1 = positions[lo]
  const p2 = positions[hi]
  const span = p2.timestamp - p1.timestamp || 1
  const t = (time - p1.timestamp) / span
  return { timestamp: time, x: p1.x + (p2.x - p1.x) * t, z: p1.z + (p2.z - p1.z) * t, vx: p1.vx, vz: p1.vz }
}

function buildReplayTracks(
  data: Map<string, EpisodePos[]>,
  minTime: number,
  duration: number,
  prog: number,
): Map<string, TrackWithTrail> {
  const currentTime = minTime + prog * duration
  const map = new Map<string, TrackWithTrail>()
  for (const [key, positions] of data) {
    const pos = interpPos(positions, currentTime)
    if (!pos) continue
    const trail = positions.filter((p) => p.timestamp <= currentTime).map((p) => ({ x: p.x, y: 0, z: p.z }))
    map.set(key, {
      id: key,
      trackKey: key,
      deviceId: 'story-replay',
      timestamp: pos.timestamp,
      position: { x: pos.x, y: 0, z: pos.z },
      venuePosition: { x: pos.x, y: 0, z: pos.z },
      velocity: { x: pos.vx || 0, y: 0, z: pos.vz || 0 },
      objectType: 'person',
      trail,
    })
  }
  return map
}

const RUNG_COLOR: Record<Rung, string> = {
  OBSERVE: '#3b82f6',
  SENSE: '#3b82f6',
  ALERT: '#e0a83e',
  EXPLAIN: '#e0a83e',
  QUANTIFY: '#3ea06b',
  DECIDE: '#3b82f6',
  RECOMMEND: '#3ea06b',
  REMEMBER: '#9ca3af',
}

const BEATS: Beat[] = [
  {
    id: 'ready',
    time: '07:30',
    period: 'Morning',
    rung: 'OBSERVE',
    title: 'Before the doors open, the store wakes up',
    floor: 'Aisles are dark. Nobody knows yet if today\u2019s data will be trustworthy.',
    hyperspace: 'The digital twin comes online and every sensor self-checks before the first customer arrives.',
    outcome: '0 blind spots \u00b7 sensors green',
    component: 'Digital Twin \u00b7 LiDAR Network',
    stage: (a) => { a.setViewMode('main') },
  },
  {
    id: 'live',
    time: '08:00',
    period: 'Morning',
    rung: 'OBSERVE',
    title: 'Doors open \u2014 the store starts seeing',
    floor: 'First shoppers enter. A manager sees a busy floor and a gut feeling.',
    hyperspace: 'Every journey is tracked anonymously \u2014 no cameras \u2014 turning movement into live, measurable flow.',
    outcome: '100% anonymous \u00b7 live at 20 FPS',
    component: 'Real-Time Tracking \u00b7 Neural Dashboard',
    stage: (a) => { a.setViewMode('main'); a.setNeuralEnabled(true) },
    episodeTypes: ['STORE_VISIT_TIME_SHIFT', 'HIGH_PASSBY_LOW_BROWSE', 'BOTTLENECK_CORRIDOR'],
  },
  {
    id: 'heatmap',
    time: '09:30',
    period: 'Morning',
    rung: 'SENSE',
    title: 'Patterns no one would notice by eye',
    floor: 'The store looks full. A whole aisle is quietly being skipped.',
    hyperspace: 'The heatmap reveals a cold aisle pulling a fraction of average traffic \u2014 hiding in plain sight.',
    outcome: '12% of avg traffic \u00b7 Aisle 7',
    component: 'Heatmap Viewer',
    stage: (a) => { a.setViewMode('main'); a.openHeatmap() },
  },
  {
    id: 'queue',
    time: '11:00',
    period: 'Morning',
    rung: 'ALERT',
    title: 'A queue forms \u2014 before a single complaint',
    floor: 'A line builds at checkout. By the time staff react, customers are already frustrated.',
    hyperspace: 'Hyperspace alerts as wait time crosses the threshold and says: open Lane 4 \u2014 proactively.',
    outcome: 'wait 6m20s \u2192 1m50s',
    component: 'Checkout \u00b7 Neural Dashboard',
    stage: (a) => { a.setViewMode('main'); a.setNeuralEnabled(true) },
    episodeTypes: ['QUEUE_BUILDUP_SPIKE', 'LANE_UNDERSUPPLY', 'ABANDONMENT_WAVE'],
  },
  {
    id: 'peble',
    time: '13:00',
    period: 'Afternoon',
    rung: 'EXPLAIN',
    title: 'The promo gets seen \u2014 but doesn\u2019t convert',
    floor: 'The screen is clearly grabbing attention. Marketing assumes the campaign is working.',
    hyperspace: 'PEBLE\u2122 proves exposure is high but shelf lift is flat \u2014 the creative, not the traffic, is the problem.',
    outcome: '+38% seen \u00b7 +4% shelf lift',
    component: 'PEBLE\u2122 Attribution',
    stage: (a) => { a.setViewMode('doohEffectiveness') },
  },
  {
    id: 'radar',
    time: '15:00',
    period: 'Afternoon',
    rung: 'QUANTIFY',
    title: 'Opportunity, priced in euros',
    floor: 'A high-traffic aisle feels fine. Its real upside is invisible on a spreadsheet.',
    hyperspace: 'Profit Radar ranks opportunities by \u20ac impact and proposes the exact merchandising fix.',
    outcome: '\u20ac2,400 / wk recoverable',
    component: 'Profit Radar',
    stage: (a) => { a.setViewMode('profitRadar') },
  },
  {
    id: 'funnel',
    time: '16:30',
    period: 'Afternoon',
    rung: 'DECIDE',
    title: 'Where the journey leaks',
    floor: 'Sales are \u201ca bit soft\u201d today. No one can point to where shoppers drop off.',
    hyperspace: 'The conversion funnel pinpoints the ENGAGE \u2192 BASKET leak and the friction zone causing it.',
    outcome: '-11% at ENGAGE \u2192 BASKET',
    component: 'Conversion Funnel \u00b7 Intent Field',
    stage: (a) => { a.setViewMode('main'); a.setNeuralEnabled(true) },
    episodeTypes: ['BROWSE_NO_CONVERT_PROXY', 'BOTTLENECK_CORRIDOR', 'HIGH_PASSBY_LOW_BROWSE'],
  },
  {
    id: 'narrator',
    time: '18:00',
    period: 'Evening',
    rung: 'RECOMMEND',
    title: '\u201cWhat should I improve tomorrow?\u201d',
    floor: 'A manager wants answers, not dashboards \u2014 in plain language, ranked by what matters.',
    hyperspace: 'Narrator answers in plain English with a ranked action plan, each step linked to the proof.',
    outcome: '5 actions, ranked by \u20ac',
    component: 'AI Narrator',
    stage: (a) => { a.setViewMode('main'); a.openNarrator() },
  },
  {
    id: 'review',
    time: '20:00',
    period: 'Evening',
    rung: 'REMEMBER',
    title: 'The store replays its own day',
    floor: 'The team goes home. The day\u2019s lessons usually leave with them.',
    hyperspace: 'Replay Insights and the Executive Summary roll the day into tomorrow\u2019s plan \u2014 automatically.',
    outcome: '1 day \u2192 1 plan',
    component: 'Replay Insights \u00b7 Business Reporting',
    stage: (a) => { a.setViewMode('businessReporting') },
  },
]

const AUTO_ADVANCE_MS = 14000
const REPLAY_SPEED = 6 // episode-time / wall-time

export default function StoryMode({ viewMode, setViewMode, neuralEnabled, setNeuralEnabled }: StoryModeProps) {
  const { openHeatmapModal, closeHeatmapModal } = useHeatmap()
  const { openNarrator, closeNarrator } = useNarrator2()
  const { setReplayMode, setReplayTracks } = useTrackingActions()
  const { venue } = useVenue()

  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [replayLive, setReplayLive] = useState(false)

  // Snapshot of the app state when entering, restored verbatim on exit.
  const snapshotRef = useRef<{ viewMode: StoryViewMode; neuralEnabled: boolean } | null>(null)

  // Replay player refs.
  const rafRef = useRef<number | null>(null)
  const progressRef = useRef(0)
  const lastTsRef = useRef(0)
  const playerRef = useRef<{ data: Map<string, EpisodePos[]>; minTime: number; duration: number } | null>(null)
  const tokenRef = useRef(0)
  const episodeListRef = useRef<Array<{ episode_id: string; episode_type: string }> | null>(null)
  const venueRef = useRef<string | undefined>(undefined)
  const applyBeatRef = useRef<(i: number) => void>(() => {})

  useEffect(() => { venueRef.current = venue?.id }, [venue?.id])

  const animate = useCallback((ts: number) => {
    const player = playerRef.current
    if (!player) return
    if (lastTsRef.current === 0) lastTsRef.current = ts
    const delta = ts - lastTsRef.current
    lastTsRef.current = ts
    progressRef.current += (delta * REPLAY_SPEED) / player.duration
    if (progressRef.current >= 1) progressRef.current = 0 // loop so it reads as continuous live motion
    setReplayTracks(buildReplayTracks(player.data, player.minTime, player.duration, progressRef.current))
    rafRef.current = requestAnimationFrame(animate)
  }, [setReplayTracks])

  const stopReplay = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    playerRef.current = null
    lastTsRef.current = 0
    progressRef.current = 0
    setReplayMode(false)
    setReplayLive(false)
  }, [setReplayMode])

  const startPlayback = useCallback((positions: Record<string, EpisodePos[]>) => {
    const data = new Map<string, EpisodePos[]>()
    let min = Infinity
    let max = -Infinity
    for (const [k, arr] of Object.entries(positions)) {
      if (!arr || arr.length === 0) continue
      data.set(k, arr)
      for (const p of arr) { if (p.timestamp < min) min = p.timestamp; if (p.timestamp > max) max = p.timestamp }
    }
    if (data.size === 0 || max <= min) { stopReplay(); return }
    playerRef.current = { data, minTime: min, duration: max - min }
    progressRef.current = 0
    lastTsRef.current = 0
    setReplayMode(true)
    setReplayLive(true)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
  }, [animate, setReplayMode, stopReplay])

  const playPreferredEpisode = useCallback(async (types: string[], token: number) => {
    const vid = venueRef.current
    if (!vid) { stopReplay(); return }
    try {
      if (!episodeListRef.current) {
        const res = await fetch(`${API_BASE}/api/replay-insights?venueId=${encodeURIComponent(vid)}`)
        const j = res.ok ? await res.json() : null
        episodeListRef.current = (j?.episodes || []).map((e: { episode_id: string; episode_type: string }) => ({
          episode_id: e.episode_id,
          episode_type: e.episode_type,
        }))
      }
      if (token !== tokenRef.current) return // beat changed while loading
      const match = (episodeListRef.current || []).find((e) => types.includes(e.episode_type))
      if (!match) { stopReplay(); return }
      const dRes = await fetch(`${API_BASE}/api/replay-insights/${match.episode_id}`)
      const detail = dRes.ok ? await dRes.json() : null
      if (token !== tokenRef.current) return
      const positions = detail?.track_positions as Record<string, EpisodePos[]> | undefined
      if (!positions || Object.keys(positions).length === 0) { stopReplay(); return }
      startPlayback(positions)
    } catch {
      stopReplay()
    }
  }, [startPlayback, stopReplay])

  const actions: StageActions = {
    setViewMode,
    setNeuralEnabled,
    openHeatmap: openHeatmapModal,
    closeHeatmap: closeHeatmapModal,
    openNarrator: () => { void openNarrator() },
    closeNarrator,
  }

  // Reassigned every render so it always closes over fresh callbacks.
  applyBeatRef.current = (i: number) => {
    const beat = BEATS[i]
    if (!beat) return
    tokenRef.current += 1
    const token = tokenRef.current
    closeHeatmapModal()
    closeNarrator()
    beat.stage(actions)
    if (beat.episodeTypes && beat.episodeTypes.length > 0) {
      void playPreferredEpisode(beat.episodeTypes, token)
    } else {
      stopReplay()
    }
  }

  const enter = useCallback(() => {
    snapshotRef.current = { viewMode, neuralEnabled }
    setActive(true)
    setIndex(0)
    setPlaying(false)
    applyBeatRef.current(0)
  }, [viewMode, neuralEnabled])

  const exit = useCallback(() => {
    setActive(false)
    setPlaying(false)
    tokenRef.current += 1
    stopReplay()
    closeHeatmapModal()
    closeNarrator()
    const snap = snapshotRef.current
    if (snap) {
      setNeuralEnabled(snap.neuralEnabled)
      setViewMode(snap.viewMode)
    }
    snapshotRef.current = null
  }, [stopReplay, closeHeatmapModal, closeNarrator, setNeuralEnabled, setViewMode])

  const goto = useCallback((i: number) => {
    const next = Math.max(0, Math.min(BEATS.length - 1, i))
    setIndex(next)
    applyBeatRef.current(next)
  }, [])

  const next = useCallback(() => {
    setIndex((cur) => {
      const n = Math.min(BEATS.length - 1, cur + 1)
      applyBeatRef.current(n)
      return n
    })
  }, [])

  const prev = useCallback(() => {
    setIndex((cur) => {
      const n = Math.max(0, cur - 1)
      applyBeatRef.current(n)
      return n
    })
  }, [])

  // Keyboard control — only while active.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev() }
      else if (e.key === 'Escape') { e.preventDefault(); exit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, next, prev, exit])

  // Auto-advance when playing.
  useEffect(() => {
    if (!active || !playing) return
    const id = window.setTimeout(() => {
      setIndex((cur) => {
        if (cur >= BEATS.length - 1) { setPlaying(false); return cur }
        const n = cur + 1
        applyBeatRef.current(n)
        return n
      })
    }, AUTO_ADVANCE_MS)
    return () => window.clearTimeout(id)
  }, [active, playing, index])

  // Cancel any in-flight animation if the component unmounts.
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // ── Launch button (only DOM added when inactive) ──
  if (!active) {
    return (
      <button
        onClick={enter}
        title="Start demo storytelling"
        className="fixed bottom-4 left-4 z-[55] flex items-center gap-2 px-3 py-2 rounded-full bg-gray-900/90 hover:bg-gray-800 text-gray-200 text-xs font-medium border border-gray-700 backdrop-blur-md transition-colors"
      >
        <Film className="w-4 h-4 text-blue-400" />
        Story Mode
      </button>
    )
  }

  const beat = BEATS[index]
  const color = RUNG_COLOR[beat.rung]

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none">
      {/* Narrative card */}
      <div className="absolute bottom-24 left-6 max-w-sm pointer-events-auto">
        <div className="rounded-2xl bg-gray-900/95 backdrop-blur-md border border-gray-700 shadow-2xl overflow-hidden">
          <div className="h-1" style={{ backgroundColor: color }} />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold tracking-wide text-white">{beat.time}</span>
              <span className="text-[10px] text-gray-500">{beat.period}</span>
              {replayLive && (
                <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  REPLAY
                </span>
              )}
              <span
                className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ color, backgroundColor: `${color}22`, border: `1px solid ${color}55` }}
              >
                {beat.rung}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white leading-snug mb-3">{beat.title}</h3>

            <div className="mb-2">
              <div className="text-[10px] font-semibold text-gray-500 tracking-wider mb-0.5">ON THE FLOOR</div>
              <div className="text-xs text-gray-400 leading-relaxed">{beat.floor}</div>
            </div>
            <div className="mb-3">
              <div className="text-[10px] font-semibold text-gray-500 tracking-wider mb-0.5">WHAT HYPERSPACE DOES</div>
              <div className="text-xs text-gray-200 leading-relaxed">{beat.hyperspace}</div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-800 pt-2.5">
              <span className="text-sm font-semibold" style={{ color }}>{beat.outcome}</span>
              <span className="text-[10px] text-gray-500">{beat.component}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom control rail */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="flex items-center gap-3 px-3 py-2 rounded-full bg-gray-900/95 backdrop-blur-md border border-gray-700 shadow-2xl">
          <div className="flex items-center gap-1.5 pr-1">
            <Film className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[10px] font-semibold text-gray-300 tracking-wide">STORY MODE</span>
          </div>

          <div className="w-px h-5 bg-gray-700" />

          <button onClick={prev} disabled={index === 0} className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 hover:bg-gray-700 rounded-lg transition-colors" title="Previous (\u2190)">
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Beat ticks */}
          <div className="flex items-center gap-1.5 px-1">
            {BEATS.map((b, i) => (
              <button
                key={b.id}
                onClick={() => goto(i)}
                title={`${b.time} \u00b7 ${b.title}`}
                className="group relative"
              >
                <span
                  className="block rounded-full transition-all"
                  style={{
                    width: i === index ? 10 : 7,
                    height: i === index ? 10 : 7,
                    backgroundColor: i === index ? RUNG_COLOR[b.rung] : '#4b5563',
                  }}
                />
              </button>
            ))}
          </div>

          <button onClick={next} disabled={index === BEATS.length - 1} className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 hover:bg-gray-700 rounded-lg transition-colors" title="Next (\u2192 / space)">
            <ChevronRight className="w-4 h-4" />
          </button>

          <button onClick={() => setPlaying((p) => !p)} className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors" title={playing ? 'Pause auto-advance' : 'Auto-advance'}>
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <span className="text-[10px] text-gray-500 w-9 text-center tabular-nums">{index + 1} / {BEATS.length}</span>

          <div className="w-px h-5 bg-gray-700" />

          <button onClick={exit} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors" title="Exit Story Mode (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
