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
 * Spatial beats are driven by the REAL MQTT replay pipeline: on enter Story Mode
 * starts playback of the most recent capture recording through the same
 * /api/replay endpoints the Replay panel uses, so the floor, Neural Dashboard,
 * queues and Checkout command center all show genuine recorded data (not a
 * client-side stand-in). Per beat it can /api/replay/seek to a position in the
 * recording (seekPct) so the relevant moment lands when its beat does. On exit it
 * stops the replay and restores the view/Neural state it found. If no recording
 * exists it silently runs the views without playback, so it can never break.
 *
 * It talks to the app only through already-public context actions
 * (useHeatmap, useNarrator2, useTrackingActions) and two callbacks passed in as
 * props — it never reaches into or mutates other components.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Film, X, ChevronLeft, ChevronRight, Play, Pause, GripHorizontal, Sparkles } from 'lucide-react'
import {
  getKineticIntroEnabled,
  setKineticIntroEnabled,
  resolveIntroVariant,
  KINETIC_INTRO_REPLAY_SPEED,
  KINETIC_INTRO_FALLBACK_MS,
  STORY_INTRO_REPLAY_START,
} from './storyIntroConfig'
import { useHeatmap } from '../../context/HeatmapContext'
import { useNarrator2 } from '../../context/Narrator2Context'
import { useReplayInsight } from '../../context/ReplayInsightContext'
import { useTrackingActions } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'

// Fire an existing app intent on the global narrator2 event bus (opens
// Checkout command center, etc.) without coupling to those components.
function emitIntent(intent: string) {
  window.dispatchEvent(new CustomEvent('narrator2-intent', { detail: { intent } }))
}

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
  | 'dailyDebrief'

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
  openCheckout: () => void
  openStoryGrid: () => void
  selectFirstCampaign: (name?: string) => void
  selectRadarZone: () => void
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
  /**
   * Optional position (0–1) to seek the recording to when this beat opens, so the
   * relevant moment (e.g. the queue building) lands on its beat. Omit to let the
   * recording keep playing continuously from wherever it is.
   */
  seekPct?: number
  /**
   * Spotlight focus for this beat — dims the rest of the UI so attention lands on
   * the component this beat is about. 'tight' for centered modals/dashboards,
   * 'soft' for the live floor, 'none' for full-page views that need to stay
   * fully readable. Defaults to 'soft'. The intro beat uses its own curtain.
   */
  dim?: 'soft' | 'tight' | 'none'
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
    dim: 'none',
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
    seekPct: 0.08,
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
    dim: 'tight',
  },
  {
    id: 'queue',
    time: '11:00',
    period: 'Morning',
    rung: 'ALERT',
    title: 'A queue forms \u2014 before a single complaint',
    floor: 'A line builds at checkout. By the time staff react, customers are already frustrated.',
    hyperspace: 'Queue buildup trips an alert; the Checkout command center opens with live lanes, waits and the fix: open Lane 4 \u2014 proactively.',
    outcome: 'wait 6m20s \u2192 1m50s',
    component: 'Checkout Command Center',
    stage: (a) => { a.setViewMode('main'); a.setNeuralEnabled(true); a.openCheckout() },
    seekPct: 0.45,
    dim: 'tight',
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
    stage: (a) => { a.setViewMode('doohEffectiveness'); a.selectFirstCampaign('Frutta E V') },
    dim: 'none',
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
    stage: (a) => { a.setViewMode('profitRadar'); a.selectRadarZone() },
    dim: 'none',
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
    seekPct: 0.72,
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
    dim: 'tight',
  },
  {
    id: 'review',
    time: '20:00',
    period: 'Evening',
    rung: 'REMEMBER',
    title: 'The store replays its own day',
    floor: 'The team goes home. Today\u2019s wins and misses usually walk out the door with them.',
    hyperspace: 'Every key moment was saved as a replayable episode \u2014 queue spikes, promo wins, friction points. The store hands back a ready-to-watch day, and tomorrow\u2019s plan writes itself.',
    outcome: 'a full day \u2192 a ranked plan',
    component: 'End-of-Day Debrief',
    stage: (a) => { a.setViewMode('dailyDebrief') },
    dim: 'tight',
  },
]

const AUTO_ADVANCE_MS = 14000
const REPLAY_SPEED = 3 // recording playback speed (recorded-time / wall-time)

// The "Store Awakening" cinematic now runs on the REAL 3D scene inside
// MainViewport (real DWG floorplan, real camera/lights, real LiDAR placements).
// StoryMode just drives it via window events and waits for it to finish; this
// fallback bounds how long we wait before starting the replay anyway (e.g. if
// the 3D scene isn't mounted/ready).
const AWAKENING_FALLBACK_MS = 13000

function KineticIntroOverlay() {
  return (
    <div className="fixed inset-0 z-[85] pointer-events-none flex items-center justify-center">
      <div
        className="flex flex-col items-center gap-3"
        style={{ animation: 'kineticLogoIn 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards', opacity: 0 }}
      >
        <img
          src="/hyperspace-logo-mark.png"
          alt="Hyperspace"
          className="w-[96px] h-[96px] object-contain drop-shadow-[0_0_28px_rgba(255,255,255,0.14)]"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
      </div>
      <style>{`
        @keyframes kineticLogoIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

/**
 * Spotlight — a soft cinematic vignette that dims the edges of the screen so the
 * active component reads as the focus of the beat. Purely decorative,
 * pointer-events none, and sits below the Story Mode controls/card. 'tight'
 * concentrates the bright area on centered modals/dashboards; 'soft' is a gentle
 * dim for the live floor. Never rendered for 'none' beats (full-page views).
 */
function Spotlight({ mode }: { mode: 'soft' | 'tight' }) {
  const bg =
    mode === 'tight'
      ? 'radial-gradient(70% 70% at 50% 46%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 42%, rgba(2,5,12,0.62) 100%)'
      : 'radial-gradient(120% 110% at 50% 42%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 60%, rgba(2,5,12,0.34) 100%)'
  return (
    <div
      className="fixed inset-0 z-[64] pointer-events-none"
      style={{ background: bg, animation: 'storyDim 600ms ease-out', transition: 'background 400ms ease-out' }}
    >
      <style>{`@keyframes storyDim { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  )
}

export default function StoryMode({ viewMode, setViewMode, neuralEnabled, setNeuralEnabled }: StoryModeProps) {
  const { openHeatmapModal, closeHeatmapModal } = useHeatmap()
  const { openNarrator, closeNarrator } = useNarrator2()
  const { openStoryGrid, closeStoryGrid } = useReplayInsight()
  const { setReplayMode, setMqttReplayActive, setStoryReplayActive, startDemoSession } = useTrackingActions()
  const { venue } = useVenue()

  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [replayLive, setReplayLive] = useState(false)
  // Draggable narrative card offset (reset each session).
  const [cardDrag, setCardDrag] = useState({ x: 0, y: 0 })
  const cardDragRef = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null)
  // Store Awakening intro overlay — plays once per session before the replay.
  const [introPlaying, setIntroPlaying] = useState(false)
  const introDoneRef = useRef(false)
  const introFallbackRef = useRef<number | null>(null)
  const introReplayStartedRef = useRef(false)
  const [kineticIntroEnabled, setKineticIntroEnabledState] = useState(getKineticIntroEnabled)

  // Snapshot of the app state when entering, restored verbatim on exit.
  const snapshotRef = useRef<{ viewMode: StoryViewMode; neuralEnabled: boolean } | null>(null)

  // MQTT recording playback state.
  const recordingFileRef = useRef<string | null>(null)
  const recordingActiveRef = useRef(false)
  const tokenRef = useRef(0)
  const venueRef = useRef<string | undefined>(undefined)
  const applyBeatRef = useRef<(i: number) => void>(() => {})

  useEffect(() => { venueRef.current = venue?.id }, [venue?.id])

  useEffect(() => {
    const onPref = (e: Event) => {
      const en = (e as CustomEvent<{ enabled?: boolean }>).detail?.enabled
      if (typeof en === 'boolean') setKineticIntroEnabledState(en)
    }
    window.addEventListener('hyperspace:story-kinetic-intro-changed', onPref)
    return () => window.removeEventListener('hyperspace:story-kinetic-intro-changed', onPref)
  }, [])

  // Drag-to-reposition for the narrative card (listeners mounted once).
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = cardDragRef.current
      if (!s) return
      setCardDrag({ x: s.bx + (e.clientX - s.sx), y: s.by + (e.clientY - s.sy) })
    }
    const up = () => { cardDragRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])
  const startCardDrag = useCallback((e: React.PointerEvent) => {
    cardDragRef.current = { sx: e.clientX, sy: e.clientY, bx: cardDrag.x, by: cardDrag.y }
  }, [cardDrag.x, cardDrag.y])

  // Broadcast active state so the footer toggle + sidebar can react.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('hyperspace:story-mode-state', { detail: { active } }))
  }, [active])

  // Stop the MQTT replay and return the venue to live.
  const stopRecording = useCallback(async () => {
    recordingActiveRef.current = false
    recordingFileRef.current = null
    setReplayLive(false)
    try {
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' })
    } catch { /* best effort */ }
    setMqttReplayActive(false)
    setReplayMode(false)
  }, [setMqttReplayActive, setReplayMode])

  // Start playback of the most recent capture recording through the real
  // pipeline so the floor, Neural Dashboard and checkout all show genuine data.
  const startRecording = useCallback(async (token: number, speed = REPLAY_SPEED) => {
    const vid = venueRef.current
    try {
      const res = await fetch(`${API_BASE}/api/replay/files`)
      const data = res.ok ? await res.json() : null
      const list: Array<{ name: string }> = (data?.files || []).filter(
        (f: { name: string }) => !String(f.name).endsWith('.reconciled.jsonl'),
      )
      const file = list[0]?.name
      if (!file || token !== tokenRef.current) { setReplayLive(false); return }

      recordingFileRef.current = file
      setReplayMode(false)
      setStoryReplayActive(false)
      setMqttReplayActive(true)

      await fetch(`${API_BASE}/api/replay/stories/stop`, { method: 'POST' }).catch(() => {})
      await fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' }).catch(() => {})
      if (vid) await startDemoSession(vid)
      if (token !== tokenRef.current) return

      const startRes = await fetch(`${API_BASE}/api/replay/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, speed, rewriteTimestamps: true, startProgress: 0 }),
      })
      if (token !== tokenRef.current) return
      if (startRes.ok) {
        recordingActiveRef.current = true
        setReplayLive(true)
      } else {
        setMqttReplayActive(false)
        setReplayLive(false)
      }
    } catch {
      setMqttReplayActive(false)
      setReplayLive(false)
    }
  }, [setMqttReplayActive, setStoryReplayActive, setReplayMode, startDemoSession])

  // Jump the running recording to a position so a beat's moment lands on cue.
  const seekRecording = useCallback(async (pct: number) => {
    const file = recordingFileRef.current
    if (!file || !recordingActiveRef.current) return
    const progress = Math.max(0, Math.min(1, pct))
    try {
      await fetch(`${API_BASE}/api/replay/seek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, progress, speed: REPLAY_SPEED }),
      })
    } catch { /* non-fatal: recording keeps playing from wherever it is */ }
  }, [])

  // Tell the running app to preselect the first PEBLE campaign (no empty state
  // mid-demo). Fired with retries because the campaign list loads async.
  const selectFirstCampaign = useCallback((name?: string) => {
    const fire = () => window.dispatchEvent(new CustomEvent('hyperspace:select-first-campaign', { detail: { name } }))
    fire()
    ;[500, 1100, 2000].forEach((ms) => window.setTimeout(fire, ms))
  }, [])

  // Preselect an underperforming-zone insight on the Profit Radar beat. Retried
  // because Profit Radar insights stream in async.
  const selectRadarZone = useCallback(() => {
    const fire = () => window.dispatchEvent(new CustomEvent('hyperspace:profit-radar-select-zone'))
    fire()
    ;[500, 1100, 2000, 3200].forEach((ms) => window.setTimeout(fire, ms))
  }, [])

  // Open the Checkout command center on its Command Map tab (not Lane Overview).
  // Retried because the modal opens async after the intent fires.
  const openCheckout = useCallback(() => {
    emitIntent('open_checkout')
    const fire = () => window.dispatchEvent(new CustomEvent('hyperspace:checkout-select-command-map'))
    fire()
    ;[300, 800, 1500].forEach((ms) => window.setTimeout(fire, ms))
  }, [])

  const actions: StageActions = {
    setViewMode,
    setNeuralEnabled,
    openHeatmap: openHeatmapModal,
    closeHeatmap: closeHeatmapModal,
    openNarrator: () => { void openNarrator() },
    closeNarrator,
    openCheckout,
    openStoryGrid,
    selectFirstCampaign,
    selectRadarZone,
  }

  // Close every transient surface this layer can open, so each beat starts clean.
  const resetStage = () => {
    closeHeatmapModal()
    closeNarrator()
    closeStoryGrid()
    emitIntent('close_checkout')
  }

  // Reassigned every render so it always closes over fresh callbacks.
  applyBeatRef.current = (i: number) => {
    const beat = BEATS[i]
    if (!beat) return
    tokenRef.current += 1
    resetStage()
    beat.stage(actions)
    // Recording plays continuously; only jump when a beat pins a specific moment.
    if (typeof beat.seekPct === 'number') void seekRecording(beat.seekPct)
  }

  const enter = useCallback(() => {
    snapshotRef.current = { viewMode, neuralEnabled }
    setActive(true)
    setIndex(0)
    setPlaying(false)
    setCardDrag({ x: 0, y: 0 })
    // Stage the floorplan (view=main) but hold the recording until the
    // Store Awakening intro finishes. If it already played this session, skip
    // straight to the replay.
    applyBeatRef.current(0)
    introReplayStartedRef.current = false
    if (!introDoneRef.current) {
      setIntroPlaying(true)
      setKineticIntroEnabledState(getKineticIntroEnabled())
    } else {
      tokenRef.current += 1
      void startRecording(tokenRef.current)
    }
  }, [viewMode, neuralEnabled, startRecording])

  // Fired when the awakening sequence ends (or is skipped) — start the replay.
  const completeIntro = useCallback(() => {
    if (introDoneRef.current) return
    introDoneRef.current = true
    setIntroPlaying(false)
    tokenRef.current += 1
    if (introReplayStartedRef.current) {
      const file = recordingFileRef.current
      if (file && recordingActiveRef.current) {
        void fetch(`${API_BASE}/api/replay/seek`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, progress: 0, speed: REPLAY_SPEED }),
        }).catch(() => {})
      }
    } else {
      void startRecording(tokenRef.current, REPLAY_SPEED)
    }
    introReplayStartedRef.current = false
  }, [startRecording])

  const exit = useCallback(() => {
    setActive(false)
    setPlaying(false)
    setIntroPlaying(false)
    introDoneRef.current = false
    introReplayStartedRef.current = false
    tokenRef.current += 1
    // Make sure the real-scene cinematic restores the scene if we leave mid-intro.
    window.dispatchEvent(new CustomEvent('hyperspace:cinematic-intro-stop'))
    void stopRecording()
    closeHeatmapModal()
    closeNarrator()
    closeStoryGrid()
    emitIntent('close_checkout')
    const snap = snapshotRef.current
    if (snap) {
      setNeuralEnabled(snap.neuralEnabled)
      setViewMode(snap.viewMode)
    }
    snapshotRef.current = null
  }, [stopRecording, closeHeatmapModal, closeNarrator, closeStoryGrid, setNeuralEnabled, setViewMode])

  // Footer toggle (in the status bar) drives enter/exit via the event bus.
  useEffect(() => {
    const onToggle = () => { if (active) exit(); else enter() }
    window.addEventListener('hyperspace:story-mode-toggle', onToggle)
    return () => window.removeEventListener('hyperspace:story-mode-toggle', onToggle)
  }, [active, enter, exit])

  // While the intro is playing, drive the REAL-scene cinematic in MainViewport
  // via window events and wait for it to finish (or a fallback) before the
  // recording starts. Scoped entirely to introPlaying so it adds no listeners
  // otherwise.
  useEffect(() => {
    if (!introPlaying) return
    const variant = resolveIntroVariant()
    const startId = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('hyperspace:cinematic-intro-start', { detail: { variant } }))
    }, 90)
    const onDone = () => completeIntro()
    const onEarlyReplay = () => {
      introReplayStartedRef.current = true
      tokenRef.current += 1
      void startRecording(tokenRef.current, KINETIC_INTRO_REPLAY_SPEED)
    }
    window.addEventListener('hyperspace:cinematic-intro-done', onDone)
    window.addEventListener(STORY_INTRO_REPLAY_START, onEarlyReplay)
    const fallbackMs = variant === 'kinetic' ? KINETIC_INTRO_FALLBACK_MS : AWAKENING_FALLBACK_MS
    introFallbackRef.current = window.setTimeout(() => completeIntro(), fallbackMs)
    return () => {
      window.clearTimeout(startId)
      window.removeEventListener('hyperspace:cinematic-intro-done', onDone)
      window.removeEventListener(STORY_INTRO_REPLAY_START, onEarlyReplay)
      if (introFallbackRef.current) { window.clearTimeout(introFallbackRef.current); introFallbackRef.current = null }
    }
  }, [introPlaying, completeIntro, startRecording])

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
      if (e.key === 'Escape') { e.preventDefault(); exit(); return }
      // During the intro, advance/space skips the cinematic instead of navigating.
      if (introPlaying) {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter' || e.key === 'PageDown') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('hyperspace:cinematic-intro-stop'))
          completeIntro()
        }
        return
      }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, introPlaying, next, prev, exit, completeIntro])

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

  // Stop the recording if the component unmounts mid-demo (best effort).
  useEffect(() => () => {
    if (recordingActiveRef.current) {
      fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' }).catch(() => {})
    }
  }, [])

  // Inactive: render nothing. The toggle lives in the footer status bar
  // (AppShell) for consistency with the other view toggles.
  if (!active) return null

  const beat = BEATS[index]
  const color = RUNG_COLOR[beat.rung]
  const dim = beat.dim ?? 'soft'

  if (introPlaying) {
    const showKineticLogo = resolveIntroVariant() === 'kinetic'
    return (
      <>
        {showKineticLogo && <KineticIntroOverlay />}
        <div className="fixed inset-0 z-[80] pointer-events-none flex flex-col items-center justify-end pb-10 gap-2">
          {showKineticLogo && (
            <span className="text-[9px] tracking-[0.22em] text-cyan-400/50 font-medium uppercase">Kinetic intro</span>
          )}
          <span className="text-[11px] tracking-[0.3em] text-white/35 font-medium">PRESS &rarr; TO SKIP</span>
        </div>
      </>
    )
  }

  return (
    <>
    {dim !== 'none' && <Spotlight mode={dim} />}
    <div className="fixed inset-0 z-[70] pointer-events-none">
      {/* Narrative card (draggable) — glass panel, serif headline, no accent bar */}
      <div
        className="absolute bottom-24 left-6 w-[24rem] max-w-[88vw] pointer-events-auto"
        style={{ transform: `translate(${cardDrag.x}px, ${cardDrag.y}px)` }}
      >
        <div
          className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
          style={{
            background: 'linear-gradient(155deg, rgba(20,23,32,0.74), rgba(9,11,17,0.62))',
            backdropFilter: 'blur(22px) saturate(135%)',
            WebkitBackdropFilter: 'blur(22px) saturate(135%)',
            boxShadow: '0 24px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          {/* Header doubles as the drag handle */}
          <div
            onPointerDown={startCardDrag}
            className="flex items-center justify-between px-5 pt-3.5 pb-1 cursor-move select-none touch-none"
            title="Drag to reposition"
          >
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] tracking-wider text-white/75">{beat.time}</span>
              <span className="text-[9px] uppercase tracking-[0.22em] text-white/40">{beat.period}</span>
              {replayLive && (
                <span className="flex items-center gap-1 text-[9px] tracking-wide text-emerald-400/90">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  REPLAY
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[9px] font-medium uppercase tracking-[0.2em]" style={{ color }}>{beat.rung}</span>
              <GripHorizontal className="w-3.5 h-3.5 text-white/25" />
            </div>
          </div>

          <div className="px-5 pb-5 pt-1.5">
            <h3
              className="text-white mb-4"
              style={{ fontFamily: "'Noto Serif Display', Georgia, serif", fontSize: '1.4rem', lineHeight: 1.22, fontWeight: 500, letterSpacing: '-0.01em' }}
            >
              {beat.title}
            </h3>

            <div className="space-y-3">
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/35 mb-1">On the floor</div>
                <p className="text-[13px] leading-relaxed text-white/55">{beat.floor}</p>
              </div>
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/35 mb-1">What Hyperspace does</div>
                <p className="text-[13px] leading-relaxed text-white/85">{beat.hyperspace}</p>
              </div>
            </div>

            <div className="mt-4 pt-3 flex items-end justify-between border-t border-white/10">
              <span style={{ fontFamily: "'Noto Serif Display', Georgia, serif", color, fontSize: '1.05rem', fontWeight: 500, lineHeight: 1.1 }}>
                {beat.outcome}
              </span>
              <span className="text-[9px] uppercase tracking-[0.14em] text-white/40 text-right max-w-[42%]">{beat.component}</span>
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

          <button
            type="button"
            onClick={() => {
              const next = !kineticIntroEnabled
              setKineticIntroEnabled(next)
              setKineticIntroEnabledState(next)
            }}
            className={`p-1.5 rounded transition-colors ${
              kineticIntroEnabled ? 'bg-cyan-600/80 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700'
            }`}
            title={kineticIntroEnabled ? 'Kinetic intro ON (next run) — click for classic Store Awakening' : 'Classic intro ON — click for kinetic reel'}
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>

          <button onClick={exit} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors" title="Exit Story Mode (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
