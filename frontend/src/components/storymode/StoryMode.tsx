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
import { STORY_INTRO_REPLAY_START } from './storyIntroConfig'
import { useStoryModeLayout } from './StoryModeLayoutContext'
import { STORY_BEATS, type StoryStageActions, type StoryViewMode } from './storyBeats'
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

export interface StoryModeProps {
  /** Current app view mode (captured on enter, restored on exit). */
  viewMode: StoryViewMode
  setViewMode: (m: StoryViewMode) => void
  /** Current Neural Dashboard enabled flag (captured on enter, restored on exit). */
  neuralEnabled: boolean
  setNeuralEnabled: (enabled: boolean) => void
}

const AUTO_ADVANCE_MS = 14000
const REPLAY_SPEED = 3 // recording playback speed (recorded-time / wall-time)

// The "Store Awakening" cinematic now runs on the REAL 3D scene inside
// MainViewport (real DWG floorplan, real camera/lights, real LiDAR placements).
// StoryMode just drives it via window events and waits for it to finish; this
// fallback bounds how long we wait before starting the replay anyway (e.g. if
// the 3D scene isn't mounted/ready).
const AWAKENING_FALLBACK_MS = 13000

function StoryIntroLogoOverlay() {
  return (
    <div className="fixed inset-0 z-[85] pointer-events-none flex items-center justify-center">
      <div
        className="flex flex-col items-center gap-3"
        style={{ animation: 'storyIntroLogoIn 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards', opacity: 0 }}
      >
        <img
          src="/hyperspace-logo-mark.png"
          alt="Hyperspace"
          className="w-[96px] h-[96px] object-contain drop-shadow-[0_0_28px_rgba(255,255,255,0.14)]"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
      </div>
      <style>{`
        @keyframes storyIntroLogoIn {
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
      className="absolute inset-0 z-[64] pointer-events-none"
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
  const { publishSnapshot, registerHandlers } = useStoryModeLayout()

  const [active, setActive] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [replayLive, setReplayLive] = useState(false)
  // Store Awakening intro overlay — plays once per session before the replay.
  const [introPlaying, setIntroPlaying] = useState(false)
  const introDoneRef = useRef(false)
  const introFallbackRef = useRef<number | null>(null)
  const introReplayStartedRef = useRef(false)
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
    publishSnapshot({
      active,
      introPlaying,
      beatIndex: index,
      beatTotal: STORY_BEATS.length,
      replayLive,
      playing,
    })
  }, [active, introPlaying, index, replayLive, playing, publishSnapshot])

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

  const actions: StoryStageActions = {
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
    const beat = STORY_BEATS[i]
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
    // Stage the floorplan (view=main) but hold the recording until the
    // Store Awakening intro finishes. If it already played this session, skip
    // straight to the replay.
    applyBeatRef.current(0)
    introReplayStartedRef.current = false
    if (!introDoneRef.current) {
      setIntroPlaying(true)
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
    const startId = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('hyperspace:cinematic-intro-start'))
    }, 90)
    const onDone = () => completeIntro()
    const onEarlyReplay = () => {
      introReplayStartedRef.current = true
      tokenRef.current += 1
      void startRecording(tokenRef.current, REPLAY_SPEED)
    }
    window.addEventListener('hyperspace:cinematic-intro-done', onDone)
    window.addEventListener(STORY_INTRO_REPLAY_START, onEarlyReplay)
    introFallbackRef.current = window.setTimeout(() => completeIntro(), AWAKENING_FALLBACK_MS)
    return () => {
      window.clearTimeout(startId)
      window.removeEventListener('hyperspace:cinematic-intro-done', onDone)
      window.removeEventListener(STORY_INTRO_REPLAY_START, onEarlyReplay)
      if (introFallbackRef.current) { window.clearTimeout(introFallbackRef.current); introFallbackRef.current = null }
    }
  }, [introPlaying, completeIntro, startRecording])

  const goto = useCallback((i: number) => {
    const next = Math.max(0, Math.min(STORY_BEATS.length - 1, i))
    setIndex(next)
    applyBeatRef.current(next)
  }, [])

  const next = useCallback(() => {
    setIndex((cur) => {
      const n = Math.min(STORY_BEATS.length - 1, cur + 1)
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
        if (cur >= STORY_BEATS.length - 1) { setPlaying(false); return cur }
        const n = cur + 1
        applyBeatRef.current(n)
        return n
      })
    }, AUTO_ADVANCE_MS)
    return () => window.clearTimeout(id)
  }, [active, playing, index])

  useEffect(() => {
    if (!active) {
      registerHandlers(null)
      return
    }
    registerHandlers({
      goto,
      next,
      prev,
      exit,
      togglePlaying: () => setPlaying((p) => !p),
    })
    return () => registerHandlers(null)
  }, [active, goto, next, prev, exit, registerHandlers])

  // Stop the recording if the component unmounts mid-demo (best effort).
  useEffect(() => () => {
    if (recordingActiveRef.current) {
      fetch(`${API_BASE}/api/replay/stop`, { method: 'POST' }).catch(() => {})
    }
  }, [])

  // Inactive: render nothing. The toggle lives in the footer status bar
  // (AppShell) for consistency with the other view toggles.
  if (!active) return null

  const beat = STORY_BEATS[index]
  const dim = beat?.dim ?? 'soft'

  if (introPlaying) {
    return (
      <>
        <StoryIntroLogoOverlay />
        <div className="fixed inset-0 z-[80] pointer-events-none flex flex-col items-center justify-end pb-10 gap-2">
          <span className="text-[11px] tracking-[0.3em] text-white/35 font-medium">PRESS &rarr; TO SKIP</span>
        </div>
      </>
    )
  }

  if (!beat) return null

  return (
    <div className="absolute inset-0 z-[70] pointer-events-none">
      {dim !== 'none' && <Spotlight mode={dim} />}
    </div>
  )
}
