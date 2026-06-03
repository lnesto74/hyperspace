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
import { Film, X, ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react'
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
  selectFirstCampaign: () => void
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
    stage: (a) => { a.setViewMode('doohEffectiveness'); a.selectFirstCampaign() },
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
    stage: (a) => { a.setViewMode('profitRadar') },
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
    component: 'Replay Insights \u00b7 Story Grid',
    stage: (a) => { a.setViewMode('main'); a.openStoryGrid() },
    dim: 'tight',
  },
]

const AUTO_ADVANCE_MS = 14000
const REPLAY_SPEED = 3 // recording playback speed (recorded-time / wall-time)

// Total runtime of the Store Awakening opening sequence (ms). The MQTT replay
// is started by the parent only after this elapses (or when skipped).
const AWAKENING_MS = 15000

// Ceiling sensor nodes — wake left→right as the beam sweeps (staggered delays).
const AWK_SENSORS = [
  { x: 16, y: 18, d: 4.9 },
  { x: 32, y: 18, d: 5.4 },
  { x: 48, y: 18, d: 5.9 },
  { x: 64, y: 18, d: 6.4 },
  { x: 80, y: 18, d: 6.9 },
  { x: 80, y: 78, d: 7.3 },
  { x: 16, y: 78, d: 7.6 },
]

// Vertical shelf blocks (percent of the staged scene box).
const AWK_SHELVES = [
  { x: 19, w: 4.4 },
  { x: 32, w: 4.4 },
  { x: 45, w: 4.4 },
  { x: 58, w: 4.4 },
]

// A few floating dust motes that live inside the beam.
const AWK_DUST = Array.from({ length: 12 }, (_, i) => ({
  left: 8 + (i * 7.3) % 70,
  top: 18 + (i * 13.7) % 60,
  delay: 3 + (i % 6) * 0.6,
  dur: 6 + (i % 4) * 1.5,
}))

/**
 * StoreAwakening — a fully self-contained, pure-CSS cinematic that plays once at
 * the start of Story Mode (the 07:30 beat) before the MQTT replay begins. It
 * draws its own theatre: darkness → blueprint → a sweeping stage light that
 * reveals the floor → sensors waking → an entrance spotlight → the first few
 * customers. It calls onComplete when finished (or when skipped), after which the
 * parent starts the recording and shows the normal narrative card.
 *
 * No WebGL/Three, pointer-events: none, removable cleanly. Decorative only.
 */
function StoreAwakening({ onComplete }: { onComplete: () => void }) {
  const doneRef = useRef(false)
  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onComplete()
  }, [onComplete])

  useEffect(() => {
    const id = window.setTimeout(finish, AWAKENING_MS)
    return () => window.clearTimeout(id)
  }, [finish])

  const blue = 'rgba(150,190,255,'
  const white = 'rgba(225,238,255,'

  return (
    <div
      className="fixed inset-0 z-[80] pointer-events-none overflow-hidden"
      style={{ background: '#01030a', animation: `awkRootIn .5s ease-out, awkRootOut 1.6s ease-in ${(AWAKENING_MS - 1600) / 1000}s forwards` }}
    >
      <style>{`
        @keyframes awkRootIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes awkRootOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes awkBaseIn { from { opacity: 0 } to { opacity: .09 } }
        @keyframes awkReveal { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
        @keyframes awkBeam {
          0% { transform: translateX(-12%) rotate(-7deg); opacity: 0 }
          14% { opacity: .95 }
          82% { opacity: .9 }
          100% { transform: translateX(186%) rotate(9deg); opacity: 0 }
        }
        @keyframes awkCore { from { opacity: 0; transform: scale(.3) } to { opacity: 1; transform: scale(1) } }
        @keyframes awkRing { 0% { opacity: .9; transform: scale(.3) } 100% { opacity: 0; transform: scale(2.6) } }
        @keyframes awkEntrance { 0% { opacity: 0; transform: scale(.7) } 30% { opacity: 1; transform: scale(1) } 70% { opacity: .9; transform: scale(1.06) } 100% { opacity: 0; transform: scale(1.1) } }
        @keyframes awkCustomer { 0% { opacity: 0 } 22% { opacity: 1 } 100% { opacity: 1 } }
        @keyframes awkDust { 0% { opacity: 0; transform: translate(0,0) } 25% { opacity: .55 } 75% { opacity: .35 } 100% { opacity: 0; transform: translate(-14px,-22px) } }
        @keyframes awkFog { 0% { transform: translate(-6%,0) } 50% { transform: translate(6%,-3%) } 100% { transform: translate(-6%,0) } }
        @keyframes awkPulseLine { 0% { stroke-dashoffset: 240; opacity: 0 } 30% { opacity: .5 } 100% { stroke-dashoffset: 0; opacity: 0 } }
      `}</style>

      {/* Drifting fog layers */}
      <div className="absolute inset-0" style={{ opacity: .5, background: 'radial-gradient(40% 50% at 30% 70%, rgba(20,40,80,0.25), transparent 70%)', filter: 'blur(40px)', animation: 'awkFog 16s ease-in-out infinite' }} />
      <div className="absolute inset-0" style={{ opacity: .4, background: 'radial-gradient(45% 55% at 75% 35%, rgba(30,50,90,0.22), transparent 70%)', filter: 'blur(48px)', animation: 'awkFog 20s ease-in-out infinite reverse' }} />

      {/* Centered staged scene box (keeps floorplan + customers aligned) */}
      <div className="absolute" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(92vw, 1080px)', height: 'min(66vh, 600px)' }}>

        {/* Base dim blueprint — barely visible, fades in during Phase 2 */}
        <svg viewBox="0 0 1000 600" width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0, animation: 'awkBaseIn 2s ease-out 2s forwards' }}>
          <AwkFloorplan blue={blue} white={white} dim />
        </svg>

        {/* Bright blueprint — revealed left→right by the sweeping beam (Phase 3) */}
        <svg viewBox="0 0 1000 600" width="100%" height="100%" style={{ position: 'absolute', inset: 0, clipPath: 'inset(0 100% 0 0)', animation: 'awkReveal 4s cubic-bezier(.45,.05,.3,1) 4s forwards' }}>
          <AwkFloorplan blue={blue} white={white} />
        </svg>

        {/* Sensor nodes wake one by one as the beam passes */}
        {AWK_SENSORS.map((s, i) => (
          <div key={i} className="absolute" style={{ left: `${s.x}%`, top: `${s.y}%`, width: 0, height: 0 }}>
            <span className="absolute rounded-full" style={{ left: -4, top: -4, width: 8, height: 8, background: `${white}.95)`, boxShadow: `0 0 10px ${blue}.9)`, opacity: 0, animation: `awkCore .6s ease-out ${s.d}s forwards` }} />
            <span className="absolute rounded-full" style={{ left: -10, top: -10, width: 20, height: 20, border: `1px solid ${blue}.8)`, opacity: 0, animation: `awkRing 2.4s ease-out ${s.d}s 2` }} />
          </div>
        ))}

        {/* Volumetric stage-light beam — a cone sweeping across the floor */}
        <div
          className="absolute"
          style={{
            left: '-8%', top: '-14%', width: '40%', height: '132%',
            background: `linear-gradient(180deg, ${white}.30) 0%, ${blue}.12) 42%, transparent 78%)`,
            clipPath: 'polygon(42% 0%, 58% 0%, 100% 100%, 0% 100%)',
            filter: 'blur(7px)', mixBlendMode: 'screen', transformOrigin: '50% 0%',
            animation: 'awkBeam 4s cubic-bezier(.45,.05,.3,1) 4s forwards',
          }}
        >
          {/* dust motes inside the beam */}
          {AWK_DUST.map((d, i) => (
            <span key={i} className="absolute rounded-full" style={{ left: `${d.left}%`, top: `${d.top}%`, width: 3, height: 3, background: `${white}.8)`, opacity: 0, animation: `awkDust ${d.dur}s ease-in-out ${d.delay}s infinite` }} />
          ))}
        </div>

        {/* Entrance spotlight (right side) — the stage waits for the first actor */}
        <div
          className="absolute rounded-full"
          style={{
            left: '78%', top: '40%', width: '34%', height: '46%', transform: 'translate(-50%,-50%)',
            background: `radial-gradient(circle, ${white}.34) 0%, ${blue}.16) 38%, transparent 70%)`,
            filter: 'blur(6px)', mixBlendMode: 'screen', opacity: 0,
            animation: 'awkEntrance 4.5s ease-in-out 8s forwards',
          }}
        />

        {/* First customers entering from the right (Phase 6) */}
        {[
          { top: '52%', delay: 11, tx: -190, ty: 8 },
          { top: '58%', delay: 11.6, tx: -150, ty: -22 },
          { top: '48%', delay: 12.2, tx: -120, ty: 30 },
        ].map((c, i) => (
          <div key={i} className="absolute" style={{ left: '90%', top: c.top, opacity: 0, animation: `awkCustomer 3s ease-out ${c.delay}s forwards` }}>
            <span
              className="block rounded-full"
              style={{ width: 9, height: 9, background: `${white}.95)`, boxShadow: `0 0 12px ${blue}1), 0 0 22px ${blue}.6)`, animation: `awkSlide-${i} 3s ease-out ${c.delay}s forwards` }}
            />
            <style>{`@keyframes awkSlide-${i} { from { transform: translate(0,0) } to { transform: translate(${c.tx}px, ${c.ty}px) } }`}</style>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Pure-SVG store blueprint used by both the dim and bright awakening layers. */
function AwkFloorplan({ blue, white, dim }: { blue: string; white: string; dim?: boolean }) {
  const stroke = dim ? `${white}.9)` : `${white}.85)`
  const glow = dim ? 'none' : `drop-shadow(0 0 3px ${blue}.55))`
  const sw = dim ? 1 : 1.4
  return (
    <g fill="none" stroke={stroke} strokeWidth={sw} style={{ filter: glow }}>
      {/* outer walls with an entrance gap on the right wall */}
      <path d="M70 70 H930 V300 M930 380 V530 H70 V70" />
      {/* entrance threshold marker (right) */}
      <path d="M930 300 h26 M930 380 h26" stroke={`${blue}.9)`} />
      {/* vertical shelf aisles */}
      {AWK_SHELVES.map((s, i) => {
        const x = (s.x / 100) * 1000
        const w = (s.w / 100) * 1000
        return <rect key={i} x={x} y={140} width={w} height={220} rx={3} stroke={`${blue}.7)`} />
      })}
      {/* checkout counters near the bottom */}
      {[240, 360, 480].map((x, i) => (
        <rect key={i} x={x} y={430} width={80} height={24} rx={3} stroke={`${blue}.7)`} />
      ))}
      {/* faint neural pulse lines threading the floor (premium touch) */}
      {!dim && (
        <g stroke={`${blue}.8)`} strokeWidth={1} strokeDasharray="6 8">
          <path d="M120 500 C 300 420, 520 470, 900 340" style={{ strokeDasharray: 240, animation: 'awkPulseLine 3.5s ease-in-out 6s infinite' }} />
          <path d="M120 120 C 360 200, 620 160, 900 340" style={{ strokeDasharray: 240, animation: 'awkPulseLine 3.5s ease-in-out 7s infinite' }} />
        </g>
      )}
    </g>
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
  // Store Awakening intro overlay — plays once per session before the replay.
  const [introPlaying, setIntroPlaying] = useState(false)
  const introDoneRef = useRef(false)

  // Snapshot of the app state when entering, restored verbatim on exit.
  const snapshotRef = useRef<{ viewMode: StoryViewMode; neuralEnabled: boolean } | null>(null)

  // MQTT recording playback state.
  const recordingFileRef = useRef<string | null>(null)
  const recordingActiveRef = useRef(false)
  const tokenRef = useRef(0)
  const venueRef = useRef<string | undefined>(undefined)
  const applyBeatRef = useRef<(i: number) => void>(() => {})

  useEffect(() => { venueRef.current = venue?.id }, [venue?.id])

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
  const startRecording = useCallback(async (token: number) => {
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
        body: JSON.stringify({ file, speed: REPLAY_SPEED, rewriteTimestamps: true, startProgress: 0 }),
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
  const selectFirstCampaign = useCallback(() => {
    const fire = () => window.dispatchEvent(new CustomEvent('hyperspace:select-first-campaign'))
    fire()
    ;[500, 1100, 2000].forEach((ms) => window.setTimeout(fire, ms))
  }, [])

  const actions: StageActions = {
    setViewMode,
    setNeuralEnabled,
    openHeatmap: openHeatmapModal,
    closeHeatmap: closeHeatmapModal,
    openNarrator: () => { void openNarrator() },
    closeNarrator,
    openCheckout: () => emitIntent('open_checkout'),
    openStoryGrid,
    selectFirstCampaign,
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
    // Stage the floorplan (view=main) but hold the recording until the
    // Store Awakening intro finishes. If it already played this session, skip
    // straight to the replay.
    applyBeatRef.current(0)
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
    void startRecording(tokenRef.current)
  }, [startRecording])

  const exit = useCallback(() => {
    setActive(false)
    setPlaying(false)
    setIntroPlaying(false)
    introDoneRef.current = false
    tokenRef.current += 1
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
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter' || e.key === 'PageDown') { e.preventDefault(); completeIntro() }
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
  const dim = beat.dim ?? 'soft'

  if (introPlaying) {
    return <StoreAwakening onComplete={completeIntro} />
  }

  return (
    <>
    {dim !== 'none' && <Spotlight mode={dim} />}
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
    </>
  )
}
