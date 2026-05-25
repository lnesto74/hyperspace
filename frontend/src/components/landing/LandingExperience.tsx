/**
 * LandingExperience — Viewport-native cinematic landing
 * Renders inside the 3D viewport area (absolute, not fixed z-100).
 * Phase 1: Welcome (venue select), Phase 2: Briefing (slideshow + histogram)
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Zap, TrendingUp, TrendingDown, Clock, SkipForward, AlertTriangle, Users, MapPin } from 'lucide-react';
import { useVenue } from '../../context/VenueContext';
import { useLidar } from '../../context/LidarContext';
import type { LidarPlacement } from '../../types';
import { useReplayInsight, NarrationPack } from '../../context/ReplayInsightContext';
import type { CaptureScreenshotFn } from '../venue/MainViewport';
import HistogramTimeline from './HistogramTimeline';
import LandingNarrator from './LandingNarrator';
import { highlightTerms, episodeHighlightTerms } from '../../utils/episodeTextUtils';
import { ROI_CATEGORY_COLOR } from '../../utils/roiCategoryUtils';

type Stage = 'black' | 'fade' | 'venue' | 'headline' | 'episodes' | 'ready';
const STAGE_TIMINGS: Record<Stage, number> = { black: 0, fade: 200, venue: 800, headline: 1600, episodes: 2400, ready: 3200 };

const EPISODE_CONFIG: Record<string, { icon: typeof Zap; label: string }> = {
  QUEUE_BUILDUP_SPIKE: { icon: Users, label: 'Queue spike' },
  LANE_UNDERSUPPLY: { icon: AlertTriangle, label: 'Lane gap' },
  LANE_OVERSUPPLY: { icon: AlertTriangle, label: 'Overcapacity' },
  ABANDONMENT_WAVE: { icon: Users, label: 'Abandonments' },
  HIGH_PASSBY_LOW_BROWSE: { icon: MapPin, label: 'Low engagement' },
  BROWSE_NO_CONVERT_PROXY: { icon: TrendingDown, label: 'Hesitation' },
  BOTTLENECK_CORRIDOR: { icon: Users, label: 'Congestion' },
  STORE_VISIT_TIME_SHIFT: { icon: Clock, label: 'Visit shift' },
  EXPOSURE_TO_ACTION_WIN: { icon: TrendingUp, label: 'DOOH success' },
  EXPOSURE_NO_FOLLOWTHROUGH: { icon: TrendingDown, label: 'DOOH miss' },
  ATTENTION_QUALITY_DROP: { icon: TrendingDown, label: 'Attention drop' },
};

function zoneCentroid(zones: NarrationPack['highlight_zones']): { x: number; z: number } {
  if (!zones || zones.length === 0) return { x: 0, z: 0 };
  let sx = 0, sz = 0, n = 0;
  for (const z of zones) for (const v of z.vertices) { sx += v.x; sz += v.z; n++; }
  return n > 0 ? { x: sx / n, z: sz / n } : { x: 0, z: 0 };
}

function Particle({ delay, duration, x, size, opacity }: { delay: number; duration: number; x: number; size: number; opacity: number }) {
  return <div className="absolute rounded-full pointer-events-none" style={{ left: `${x}%`, bottom: '-5%', width: size, height: size, background: `radial-gradient(circle, rgba(59,130,246,${opacity}) 0%, transparent 70%)`, animation: `landing-float ${duration}s ${delay}s ease-out infinite` }} />;
}

function VenueListCard({ name, dimensions, onClick, index }: { name: string; dimensions: string; onClick: () => void; index: number }) {
  return (
    <button onClick={onClick} className="group relative overflow-hidden rounded-xl border border-gray-700/30 hover:border-blue-500/30 transition-all duration-500 hover:scale-[1.02] hover:shadow-xl text-left w-full" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.04), rgba(17,24,39,0.95))', opacity: 0, animation: `landing-card-in 0.6s ${0.12 * index}s cubic-bezier(0.16, 1, 0.3, 1) forwards` }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.08), transparent 70%)' }} />
      <div className="relative p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/15 flex items-center justify-center shrink-0"><MapPin className="w-5 h-5 text-blue-400" /></div>
        <div className="min-w-0 flex-1"><h4 className="text-sm font-medium text-white truncate">{name}</h4><p className="text-[11px] text-gray-500">{dimensions}</p></div>
        <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-all shrink-0" />
      </div>
    </button>
  );
}

function HeroSlide({ episode, screenshot, isActive, onClick }: { episode: NarrationPack; screenshot: string | null; isActive: boolean; onClick: () => void }) {
  const config = EPISODE_CONFIG[episode.episode_type] || { icon: Zap, label: episode.episode_type };
  const Icon = config.icon;
  const productCategory = episode.product_category || (episode.features?.product_category as string | undefined) || null;
  const highlightTermsList = episodeHighlightTerms(episode);

  return (
    <button
      onClick={onClick}
      className={`absolute inset-0 rounded-2xl overflow-hidden transition-all duration-700 ease-out ${isActive ? 'opacity-100 scale-100 z-10' : 'opacity-0 scale-95 z-0 pointer-events-none'}`}
      style={{ border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {/* Background layer — screenshot visible, lighter treatment */}
      <div className="absolute inset-0">
        {screenshot ? (
          <img src={screenshot} alt="" className="w-full h-full object-cover" style={{ filter: 'brightness(0.6) saturate(1.3) contrast(1.1)' }} />
        ) : (
          <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${episode.color}18 0%, rgba(30,30,40,0.95) 50%, ${episode.color}10 100%)` }} />
        )}
        {/* Bottom gradient for text readability — only bottom half */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,15,0.95) 0%, rgba(10,10,15,0.7) 35%, rgba(10,10,15,0.15) 60%, transparent 100%)' }} />
      </div>

      {/* Subtle inner border glow */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)' }} />

      {/* Content */}
      <div className="relative h-full flex flex-col justify-end p-8 text-left">
        {/* Top badges */}
        <div className="absolute top-6 left-8 right-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider backdrop-blur-md shrink-0" style={{ color: episode.color, backgroundColor: `${episode.color}25`, border: `1px solid ${episode.color}40` }}>
              <Icon className="w-3.5 h-3.5" />{config.label}
            </div>
            {productCategory && (
              <div
                className="px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md truncate max-w-[220px] shrink"
                style={{ color: ROI_CATEGORY_COLOR, backgroundColor: 'rgba(252,211,77,0.15)', border: '1px solid rgba(252,211,77,0.35)' }}
                title={productCategory}
              >
                {productCategory}
              </div>
            )}
          </div>
          <span className="text-xs text-gray-300 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 shrink-0">{episode.time_label}</span>
        </div>

        {/* Title */}
        <h3 className="text-2xl font-bold text-white mb-3 leading-tight max-w-lg drop-shadow-lg">{highlightTerms(episode.title, highlightTermsList)}</h3>
        <p className="text-sm text-gray-200 mb-4 max-w-lg line-clamp-2 leading-relaxed drop-shadow-md">{highlightTerms(episode.business_summary, highlightTermsList)}</p>

        {/* KPI chips */}
        <div className="flex flex-wrap gap-2 mb-2">
          {episode.kpis?.slice(0, 4).map((kpi) => (
            <div key={kpi.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-md border" style={{
              background: kpi.direction === 'up' ? 'rgba(239,68,68,0.2)' : kpi.direction === 'down' ? 'rgba(34,197,94,0.2)' : 'rgba(107,114,128,0.2)',
              color: kpi.direction === 'up' ? '#fca5a5' : kpi.direction === 'down' ? '#86efac' : '#d1d5db',
              borderColor: kpi.direction === 'up' ? 'rgba(239,68,68,0.25)' : kpi.direction === 'down' ? 'rgba(34,197,94,0.25)' : 'rgba(107,114,128,0.25)',
            }}>
              {kpi.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : kpi.direction === 'down' ? <TrendingDown className="w-3 h-3" /> : null}
              <span>{kpi.label}</span>
              <span className="font-bold">{kpi.value}{kpi.unit === 'percent' ? '%' : kpi.unit === 'seconds' ? 's' : kpi.unit === 'per_minute' ? '/min' : ''}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1"><span>Click to explore</span><ArrowRight className="w-3 h-3" /></div>
      </div>
    </button>
  );
}

// ─── MAIN COMPONENT ───
interface LandingExperienceProps { onDismiss: () => void; captureScreenshot?: CaptureScreenshotFn | null; }

export default function LandingExperience({ onDismiss, captureScreenshot }: LandingExperienceProps) {
  const { venue, venueList, fetchVenueList, loadVenue } = useVenue();
  const { episodes, fetchEpisodes, selectEpisode } = useReplayInsight();
  const { setPlacements } = useLidar();
  const [stage, setStage] = useState<Stage>('black');
  const [phase, setPhase] = useState<'welcome' | 'briefing'>('welcome');
  const [isExiting, setIsExiting] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [screenshots, setScreenshots] = useState<Map<string, string>>(new Map());
  const [isPaused, setIsPaused] = useState(false);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const autoAdvanceRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const particlesRef = useRef(Array.from({ length: 12 }, () => ({ delay: Math.random() * 6, duration: 8 + Math.random() * 10, x: Math.random() * 100, size: 2 + Math.random() * 3, opacity: 0.05 + Math.random() * 0.15 })));
  const topEpisodes = useMemo(() => episodes.slice(0, 10), [episodes]);
  const severityCounts = useMemo(() => { const c = { high: 0, medium: 0, low: 0 }; episodes.forEach(e => { c[e.severity] = (c[e.severity] || 0) + 1; }); return c; }, [episodes]);
  const isAtLeast = useCallback((target: Stage) => { const order: Stage[] = ['black', 'fade', 'venue', 'headline', 'episodes', 'ready']; return order.indexOf(stage) >= order.indexOf(target); }, [stage]);

  useEffect(() => { fetchVenueList(); }, [fetchVenueList]);

  useEffect(() => {
    if (venue?.id && phase === 'welcome') {
      setPhase('briefing');
      stageTimerRef.current.forEach(clearTimeout);
      stageTimerRef.current = [];
      setStage('black');
      const stages: Stage[] = ['black', 'fade', 'venue', 'headline', 'episodes', 'ready'];
      let cum = 0;
      stages.forEach(s => { cum += STAGE_TIMINGS[s]; stageTimerRef.current.push(setTimeout(() => setStage(s), cum)); });
      fetchEpisodes({ period: 'day', type: undefined });
    }
  }, [venue?.id, phase, fetchEpisodes]);

  useEffect(() => {
    const stages: Stage[] = ['black', 'fade', 'venue', 'ready'];
    let cum = 0;
    stages.forEach(s => { cum += STAGE_TIMINGS[s]; stageTimerRef.current.push(setTimeout(() => setStage(s), cum)); });
    return () => { stageTimerRef.current.forEach(clearTimeout); };
  }, []);

  // Capture contextual 3D screenshots — each episode gets its own framing and zone highlights
  const [captureAttempt, setCaptureAttempt] = useState(0);
  useEffect(() => {
    if (!captureScreenshot || episodes.length === 0 || screenshots.size > 0) return;
    if (captureAttempt >= 5) return;
    const delay = captureAttempt === 0 ? 3000 : 2000;
    console.log('[Landing] Screenshot attempt', captureAttempt + 1, '- delay', delay);
    const timer = setTimeout(() => {
      const m = new Map<string, string>();
      const vcx = venue ? (venue.width || 10) / 2 : 5;
      const vcz = venue ? (venue.depth || 10) / 2 : 5;
      episodes.slice(0, 10).forEach((ep, idx) => {
        // Build zone data for this episode's highlights
        const zones = (ep.highlight_zones || [])
          .filter(z => z.vertices && z.vertices.length >= 3)
          .map(z => ({ vertices: z.vertices, color: z.color || ep.color }));
        // Fallback centroid if no zones
        const c = zoneCentroid(ep.highlight_zones);
        const tX = (c.x === 0 && c.z === 0) ? vcx : c.x;
        const tZ = (c.x === 0 && c.z === 0) ? vcz : c.z;
        // Unique angle per episode for visual variety
        const angle = (idx / Math.max(episodes.length, 1)) * Math.PI * 2;
        // Extract frozen-moment track positions from episode data
        const trackPositions: Array<{ x: number; z: number; color?: number }> = [];
        if (ep.track_positions) {
          const epMidTs = ((ep.replay_window?.start || 0) + (ep.replay_window?.end || 0)) / 2;
          Object.values(ep.track_positions).forEach(positions => {
            if (positions.length === 0) return;
            // Find position closest to the episode midpoint
            let closest = positions[0];
            let minDist = Math.abs(positions[0].timestamp - epMidTs);
            for (const p of positions) {
              const d = Math.abs(p.timestamp - epMidTs);
              if (d < minDist) { minDist = d; closest = p; }
            }
            trackPositions.push({ x: closest.x, z: closest.z, color: 0x3b82f6 });
          });
        }
        const url = captureScreenshot({
          targetX: tX,
          targetZ: tZ,
          height: 25,
          fov: 55,
          width: 800,
          imageHeight: 450,
          zones: zones.length > 0 ? zones : undefined,
          angleOffset: angle,
          trackPositions: trackPositions.length > 0 ? trackPositions : undefined,
        });
        if (url && url.length > 5000) m.set(ep.episode_id, url);
      });
      console.log('[Landing] Captured', m.size, 'screenshots (attempt', captureAttempt + 1, ')');
      if (m.size > 0) {
        setScreenshots(m);
      } else {
        setCaptureAttempt(prev => prev + 1);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [captureScreenshot, episodes, screenshots.size, venue, captureAttempt]);

  // Auto-advance slideshow
  useEffect(() => {
    if (phase !== 'briefing' || !isAtLeast('episodes') || isPaused || topEpisodes.length <= 1) return;
    autoAdvanceRef.current = setInterval(() => setSlideIndex(p => (p + 1) % topEpisodes.length), 6000);
    return () => { if (autoAdvanceRef.current) clearInterval(autoAdvanceRef.current); };
  }, [phase, isAtLeast, isPaused, topEpisodes.length]);

  const handleExit = useCallback(() => { setIsExiting(true); setTimeout(() => onDismiss(), 600); }, [onDismiss]);
  const handleSkip = useCallback(() => { stageTimerRef.current.forEach(clearTimeout); setStage('ready'); }, []);
  const handleSelectVenue = useCallback((id: string) => { loadVenue(id, (p) => { setPlacements(p as LidarPlacement[]); }); }, [loadVenue, setPlacements]);
  const handleEpisodeClick = useCallback((id: string) => { selectEpisode(id); handleExit(); }, [selectEpisode, handleExit]);
  const goToSlide = useCallback((i: number) => { setSlideIndex(i); setIsPaused(true); setTimeout(() => setIsPaused(false), 10000); }, []);

  return (
    <div className={`absolute inset-0 z-40 overflow-hidden ${isExiting ? 'opacity-0 scale-[1.02]' : 'opacity-100 scale-100'}`} style={{ transition: 'opacity 0.6s ease, transform 0.6s ease' }}>
      <style>{`
        @keyframes landing-float { 0% { transform: translateY(0) scale(1); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(-110vh) scale(0.5); opacity: 0; } }
        @keyframes landing-card-in { 0% { opacity: 0; transform: translateY(30px) scale(0.95); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes landing-pulse-ring { 0% { transform: scale(0.8); opacity: 0; } 50% { opacity: 0.4; } 100% { transform: scale(2.5); opacity: 0; } }
        @keyframes landing-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes landing-badge-pop { 0% { transform: scale(0) rotate(-10deg); opacity: 0; } 60% { transform: scale(1.15) rotate(2deg); } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
        @keyframes landing-hue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(-360deg); } }
        .gradient-text-animated {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 100;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: #f35626;
          background-image: linear-gradient(92deg, #f35626, #feab3a);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: landing-hue 10s infinite linear;
        }
      `}</style>

      {/* Background: dark + subtle glow, NO grid */}
      <div className="absolute inset-0 bg-gray-950" />
      <div className="absolute inset-0 transition-opacity duration-[2000ms]" style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(59,130,246,0.05) 0%, transparent 60%)', opacity: isAtLeast('fade') ? 1 : 0 }} />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {isAtLeast('fade') && particlesRef.current.map((p, i) => <Particle key={i} {...p} />)}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 overflow-y-auto">
        {/* Skip button */}
        {!isAtLeast('ready') && isAtLeast('fade') && (
          <button onClick={handleSkip} className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-all"><SkipForward className="w-3 h-3" />Skip</button>
        )}

        {/* ═══ PHASE 1: WELCOME ═══ */}
        {phase === 'welcome' && (
          <>
            <div className="text-center mb-10">
              <div className="relative inline-flex items-center justify-center mb-6 transition-all duration-[1500ms]" style={{ opacity: isAtLeast('venue') ? 1 : 0, transform: isAtLeast('venue') ? 'scale(1)' : 'scale(0.5)' }}>
                <div className="absolute w-36 h-36 rounded-full border border-blue-500/20" style={{ animation: 'landing-pulse-ring 3s ease-out infinite' }} />
                <div className="absolute w-36 h-36 rounded-full border border-blue-500/10" style={{ animation: 'landing-pulse-ring 3s 1s ease-out infinite' }} />
                <img src="/hyperspace-logo.png" alt="Hyperspace" className="w-28 h-28 object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/hyperspace.svg'; }} />
              </div>
              <div className="transition-all duration-[1200ms]" style={{ opacity: isAtLeast('venue') ? 1 : 0, transform: isAtLeast('venue') ? 'translateY(0)' : 'translateY(20px)' }}>
                <h1 className="gradient-text-animated text-2xl mb-3">Hyperspace</h1>
                <h2 className="text-2xl font-semibold text-white mb-2">Welcome back</h2>
                <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>
            <div className="w-full max-w-md transition-all duration-[1000ms]" style={{ opacity: isAtLeast('ready') ? 1 : 0, transform: isAtLeast('ready') ? 'translateY(0)' : 'translateY(20px)' }}>
              <div className="flex items-center gap-3 mb-4"><div className="h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent flex-1" /><span className="text-[10px] text-gray-500 uppercase tracking-widest">Select a venue</span><div className="h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent flex-1" /></div>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {venueList.length > 0 ? venueList.map((v, i) => <VenueListCard key={v.id} name={v.name} dimensions={`${v.width}m × ${v.depth}m`} onClick={() => handleSelectVenue(v.id)} index={i} />) : <div className="text-center py-8"><p className="text-sm text-gray-500">No venues available</p></div>}
              </div>
              <div className="mt-6 text-center"><button onClick={handleExit} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Skip to workspace →</button></div>
            </div>
          </>
        )}

        {/* ═══ PHASE 2: BRIEFING ═══ */}
        {phase === 'briefing' && venue && (
          <div className="w-full max-w-4xl flex flex-col items-center gap-6">
            {/* Header */}
            <div className="text-center transition-all duration-[1200ms]" style={{ opacity: isAtLeast('venue') ? 1 : 0, transform: isAtLeast('venue') ? 'translateY(0)' : 'translateY(20px)' }}>
              <img src="/hyperspace-logo.png" alt="" className="w-16 h-16 mx-auto mb-2 object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/hyperspace.svg'; }} />
              <h1 className="gradient-text-animated text-xl mb-8">Hyperspace</h1>
              <h2 className="text-xl font-semibold text-white mb-0.5">{venue.name}</h2>
              <p className="text-xs text-gray-500">Daily Brief — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
              {isAtLeast('headline') && episodes.length > 0 && (
                <div className="mt-3 inline-flex items-center gap-3">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-800/80 border border-gray-700/50 text-xs" style={{ animation: 'landing-badge-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
                    <span className="text-white font-medium">{episodes.length}</span><span className="text-gray-400">moments detected</span>
                  </div>
                  {severityCounts.high > 0 && <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 font-medium" style={{ opacity: 0, animation: 'landing-badge-pop 0.5s 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}><AlertTriangle className="w-3 h-3" />{severityCounts.high} high severity</div>}
                </div>
              )}
            </div>

            {/* AI Headline */}
            <div className="max-w-2xl text-center transition-all duration-[1000ms]" style={{ opacity: isAtLeast('headline') ? 1 : 0, transform: isAtLeast('headline') ? 'translateY(0)' : 'translateY(15px)' }}>
              {isAtLeast('headline') && <LandingNarrator episodes={topEpisodes} />}
            </div>

            {/* Episode Slideshow */}
            {isAtLeast('episodes') && topEpisodes.length > 0 && (
              <div className="w-full" style={{ opacity: 0, animation: 'landing-card-in 0.8s 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
                <div className="flex items-center gap-3" onMouseEnter={() => setIsPaused(true)} onMouseLeave={() => setIsPaused(false)}>
                  {/* Left arrow — outside card */}
                  {topEpisodes.length > 1 && (
                    <button onClick={() => goToSlide((slideIndex - 1 + topEpisodes.length) % topEpisodes.length)} className="shrink-0 w-10 h-10 rounded-full bg-gray-800/60 backdrop-blur-sm border border-gray-700/30 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700/80 transition-all"><ChevronLeft className="w-5 h-5" /></button>
                  )}
                  {/* Card */}
                  <div className="relative flex-1 min-w-0 aspect-[16/8] rounded-2xl overflow-hidden">
                    {topEpisodes.map((ep, i) => (
                      <HeroSlide key={ep.episode_id} episode={ep} screenshot={screenshots.get(ep.episode_id) || null} isActive={i === slideIndex} onClick={() => handleEpisodeClick(ep.episode_id)} />
                    ))}
                    {/* Dot indicators */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
                      {topEpisodes.map((_, i) => (
                        <button key={i} onClick={(e) => { e.stopPropagation(); goToSlide(i); }} className={`rounded-full transition-all duration-300 ${i === slideIndex ? 'w-6 h-2 bg-white' : 'w-2 h-2 bg-gray-500/60 hover:bg-gray-400/60'}`} />
                      ))}
                    </div>
                  </div>
                  {/* Right arrow — outside card */}
                  {topEpisodes.length > 1 && (
                    <button onClick={() => goToSlide((slideIndex + 1) % topEpisodes.length)} className="shrink-0 w-10 h-10 rounded-full bg-gray-800/60 backdrop-blur-sm border border-gray-700/30 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700/80 transition-all"><ChevronRight className="w-5 h-5" /></button>
                  )}
                </div>
              </div>
            )}

            {/* Histogram Timeline */}
            {isAtLeast('episodes') && topEpisodes.length > 0 && (
              <div className="w-full" style={{ opacity: 0, animation: 'landing-card-in 0.8s 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
                <HistogramTimeline episodes={topEpisodes} activeIndex={slideIndex} onBarClick={goToSlide} />
              </div>
            )}

            {episodes.length === 0 && isAtLeast('episodes') && (
              <div className="text-center py-8"><p className="text-sm text-gray-500">No episodes detected today yet.</p><p className="text-xs text-gray-600 mt-1">Episodes will appear as trajectory data flows in.</p></div>
            )}

            {/* Enter Workspace */}
            <div className="transition-all duration-700" style={{ opacity: isAtLeast('ready') ? 1 : 0, transform: isAtLeast('ready') ? 'translateY(0)' : 'translateY(20px)' }}>
              <button onClick={handleExit} className="group relative flex items-center gap-3 px-8 py-3 rounded-xl text-sm font-medium text-white overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.1), transparent)', backgroundSize: '200% 100%', animation: 'landing-shimmer 3s ease-in-out infinite' }} />
                <span className="relative">Enter Workspace</span>
                <ArrowRight className="relative w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
