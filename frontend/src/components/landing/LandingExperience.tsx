/**
 * LandingExperience
 * 
 * Cinematic intro overlay shown when a venue is loaded.
 * Provides executive briefing with animated episode highlights.
 * Skippable, session-persisted preference.
 * 
 * Does NOT modify any existing component or context.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowRight, Zap, TrendingUp, TrendingDown, Clock, SkipForward, AlertTriangle, Users, MapPin } from 'lucide-react';
import { useVenue } from '../../context/VenueContext';
import { useReplayInsight, NarrationPack } from '../../context/ReplayInsightContext';
import NarrativeTimeline from './NarrativeTimeline';
import LandingNarrator from './LandingNarrator';

// ─── Animation Stages ───
type Stage = 'black' | 'grid' | 'venue' | 'headline' | 'episodes' | 'ready' | 'exit';

const STAGE_TIMINGS: Record<Stage, number> = {
  black: 0,
  grid: 300,
  venue: 1000,
  headline: 1800,
  episodes: 2800,
  ready: 3800,
  exit: 0, // manual
};

// ─── Episode type icons and colors ───
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

// ─── Floating Particle ───
function Particle({ delay, duration, x, size, opacity }: {
  delay: number; duration: number; x: number; size: number; opacity: number;
}) {
  return (
    <div
      className="absolute rounded-full"
      style={{
        left: `${x}%`,
        bottom: '-5%',
        width: size,
        height: size,
        background: `radial-gradient(circle, rgba(59,130,246,${opacity}) 0%, transparent 70%)`,
        animation: `landing-float ${duration}s ${delay}s ease-out infinite`,
      }}
    />
  );
}

// ─── Scan Line ───
function ScanLine() {
  return (
    <div
      className="absolute left-0 right-0 h-px pointer-events-none"
      style={{
        background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent)',
        animation: 'landing-scan 4s ease-in-out infinite',
      }}
    />
  );
}

// ─── Episode Card ───
function EpisodeCard({ episode, index, onClick }: {
  episode: NarrationPack; index: number; onClick: () => void;
}) {
  const config = EPISODE_CONFIG[episode.episode_type] || { icon: Zap, label: episode.episode_type };
  const Icon = config.icon;

  // Count KPI directions
  const upCount = episode.kpis?.filter(k => k.direction === 'up').length || 0;
  const downCount = episode.kpis?.filter(k => k.direction === 'down').length || 0;

  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-xl border transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl"
      style={{
        background: `linear-gradient(135deg, ${episode.color}08, ${episode.color}03, rgba(17,24,39,0.95))`,
        borderColor: `${episode.color}25`,
        opacity: 0,
        animation: `landing-card-in 0.7s ${0.15 * index}s cubic-bezier(0.16, 1, 0.3, 1) forwards`,
      }}
    >
      {/* Hover glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse at center, ${episode.color}15, transparent 70%)`,
        }}
      />

      {/* Content */}
      <div className="relative p-4 text-left">
        {/* Top row: severity + time */}
        <div className="flex items-center justify-between mb-2">
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color: episode.color,
              backgroundColor: `${episode.color}15`,
            }}
          >
            <Icon className="w-3 h-3" />
            {config.label}
          </div>
          <span className="text-[10px] text-gray-500">{episode.time_label}</span>
        </div>

        {/* Title */}
        <h4 className="text-sm font-medium text-white leading-snug mb-2 line-clamp-2 group-hover:text-gray-100 transition-colors">
          {episode.title}
        </h4>

        {/* KPI deltas */}
        <div className="flex items-center gap-3">
          {upCount > 0 && (
            <div className="flex items-center gap-0.5 text-[10px] text-emerald-400">
              <TrendingUp className="w-3 h-3" />
              {upCount} ↑
            </div>
          )}
          {downCount > 0 && (
            <div className="flex items-center gap-0.5 text-[10px] text-red-400">
              <TrendingDown className="w-3 h-3" />
              {downCount} ↓
            </div>
          )}
          <div className="flex-1" />
          <ArrowRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>

      {/* Bottom accent line */}
      <div
        className="h-0.5 w-0 group-hover:w-full transition-all duration-700"
        style={{ backgroundColor: episode.color }}
      />
    </button>
  );
}

// ─── Main Component ───
export default function LandingExperience({ onDismiss }: { onDismiss: () => void }) {
  const { venue } = useVenue();
  const { episodes, fetchEpisodes, selectEpisode } = useReplayInsight();
  const [stage, setStage] = useState<Stage>('black');
  const [isExiting, setIsExiting] = useState(false);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const particlesRef = useRef(
    Array.from({ length: 30 }, () => ({
      delay: Math.random() * 6,
      duration: 6 + Math.random() * 8,
      x: Math.random() * 100,
      size: 2 + Math.random() * 4,
      opacity: 0.1 + Math.random() * 0.3,
    }))
  );

  // Fetch episodes on mount
  useEffect(() => {
    if (venue?.id) {
      fetchEpisodes({ period: 'day', type: undefined });
    }
  }, [venue?.id, fetchEpisodes]);

  // Auto-advance stages
  useEffect(() => {
    const stages: Stage[] = ['black', 'grid', 'venue', 'headline', 'episodes', 'ready'];
    let cumulative = 0;

    stages.forEach((s) => {
      cumulative += STAGE_TIMINGS[s];
      const timer = setTimeout(() => setStage(s), cumulative);
      stageTimerRef.current.push(timer);
    });

    return () => {
      stageTimerRef.current.forEach(clearTimeout);
    };
  }, []);

  // Exit transition
  const handleExit = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(), 600);
  }, [onDismiss]);

  // Skip — jump to ready
  const handleSkip = useCallback(() => {
    stageTimerRef.current.forEach(clearTimeout);
    setStage('ready');
  }, []);

  // Episode click
  const handleEpisodeClick = useCallback((episodeId: string) => {
    selectEpisode(episodeId);
    handleExit();
  }, [selectEpisode, handleExit]);

  // Top episodes (max 6)
  const topEpisodes = useMemo(() => episodes.slice(0, 6), [episodes]);

  // Severity breakdown
  const severityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    episodes.forEach(e => { counts[e.severity] = (counts[e.severity] || 0) + 1; });
    return counts;
  }, [episodes]);

  const isAtLeast = (target: Stage) => {
    const order: Stage[] = ['black', 'grid', 'venue', 'headline', 'episodes', 'ready'];
    return order.indexOf(stage) >= order.indexOf(target);
  };

  if (!venue) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] overflow-hidden transition-opacity duration-600 ${
        isExiting ? 'opacity-0 scale-105' : 'opacity-100 scale-100'
      }`}
      style={{ transition: 'opacity 0.6s ease, transform 0.6s ease' }}
    >
      {/* ─── CSS Animations (injected once) ─── */}
      <style>{`
        @keyframes landing-float {
          0% { transform: translateY(0) scale(1); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-110vh) scale(0.5); opacity: 0; }
        }
        @keyframes landing-scan {
          0% { top: -2px; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes landing-grid-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes landing-card-in {
          0% { opacity: 0; transform: translateY(30px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes landing-pulse-ring {
          0% { transform: scale(0.8); opacity: 0; }
          50% { opacity: 0.4; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes landing-text-reveal {
          0% { clip-path: inset(0 100% 0 0); }
          100% { clip-path: inset(0 0 0 0); }
        }
        @keyframes landing-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes landing-glow-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes landing-badge-pop {
          0% { transform: scale(0) rotate(-10deg); opacity: 0; }
          60% { transform: scale(1.15) rotate(2deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes landing-line-draw {
          0% { width: 0; }
          100% { width: 100%; }
        }
      `}</style>

      {/* ─── Background Layers ─── */}
      <div className="absolute inset-0 bg-gray-950" />

      {/* Radial gradient center glow */}
      <div
        className="absolute inset-0 transition-opacity duration-[2000ms]"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, rgba(59,130,246,0.06) 0%, transparent 60%)',
          opacity: isAtLeast('grid') ? 1 : 0,
        }}
      />

      {/* Grid lines */}
      <div
        className="absolute inset-0 transition-opacity duration-[1500ms]"
        style={{
          opacity: isAtLeast('grid') ? 0.08 : 0,
          backgroundImage: `
            linear-gradient(rgba(59,130,246,0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(59,130,246,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          animation: isAtLeast('grid') ? 'landing-grid-in 2s ease' : 'none',
        }}
      />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {isAtLeast('grid') && particlesRef.current.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </div>

      {/* Scan line */}
      {isAtLeast('venue') && <ScanLine />}

      {/* ─── Content ─── */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8">

        {/* Skip button (top right) */}
        <button
          onClick={handleSkip}
          className={`absolute top-6 right-6 flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-all duration-300 ${
            isAtLeast('grid') && !isAtLeast('ready') ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <SkipForward className="w-3 h-3" />
          Skip intro
        </button>

        {/* ─── VENUE IDENTITY BLOCK ─── */}
        <div className="text-center mb-12">
          {/* Animated ring */}
          <div
            className="relative inline-flex items-center justify-center mb-6 transition-all duration-[1500ms]"
            style={{
              opacity: isAtLeast('venue') ? 1 : 0,
              transform: isAtLeast('venue') ? 'scale(1)' : 'scale(0.5)',
            }}
          >
            <div
              className="absolute w-20 h-20 rounded-full border border-blue-500/20"
              style={{ animation: 'landing-pulse-ring 3s ease-out infinite' }}
            />
            <div
              className="absolute w-20 h-20 rounded-full border border-blue-500/10"
              style={{ animation: 'landing-pulse-ring 3s 1s ease-out infinite' }}
            />
            <div className="w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-blue-400" />
            </div>
          </div>

          {/* HYPERSPACE text */}
          <div
            className="transition-all duration-[1200ms]"
            style={{
              opacity: isAtLeast('venue') ? 1 : 0,
              transform: isAtLeast('venue') ? 'translateY(0)' : 'translateY(20px)',
            }}
          >
            <h1 className="text-xs font-bold tracking-[0.3em] text-gray-500 uppercase mb-2">
              Hyperspace
            </h1>
            <h2 className="text-2xl font-semibold text-white mb-1">
              {venue.name}
            </h2>
            <p className="text-sm text-gray-500">
              Daily Brief — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>

          {/* Episode count badge */}
          {isAtLeast('headline') && episodes.length > 0 && (
            <div className="mt-4 inline-flex items-center gap-3">
              <div
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-800/80 border border-gray-700/50 text-xs"
                style={{ animation: 'landing-badge-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
              >
                <span className="text-white font-medium">{episodes.length}</span>
                <span className="text-gray-400">moments detected</span>
              </div>
              {severityCounts.high > 0 && (
                <div
                  className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 font-medium"
                  style={{ opacity: 0, animation: 'landing-badge-pop 0.5s 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
                >
                  <AlertTriangle className="w-3 h-3" />
                  {severityCounts.high} high severity
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── AI HEADLINE ─── */}
        <div
          className="max-w-2xl text-center mb-10 transition-all duration-[1000ms]"
          style={{
            opacity: isAtLeast('headline') ? 1 : 0,
            transform: isAtLeast('headline') ? 'translateY(0)' : 'translateY(15px)',
          }}
        >
          {isAtLeast('headline') && (
            <LandingNarrator episodes={topEpisodes} />
          )}
        </div>

        {/* ─── EPISODE CARDS ─── */}
        <div
          className="w-full max-w-4xl transition-all duration-[1000ms]"
          style={{
            opacity: isAtLeast('episodes') ? 1 : 0,
          }}
        >
          {topEpisodes.length > 0 && isAtLeast('episodes') && (
            <>
              {/* Divider line */}
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent"
                  style={{ flex: 1, animation: 'landing-line-draw 1s ease forwards' }}
                />
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">Key Moments</span>
                <div
                  className="h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent"
                  style={{ flex: 1, animation: 'landing-line-draw 1s ease forwards' }}
                />
              </div>

              {/* Cards grid */}
              <div className="grid grid-cols-3 gap-3">
                {topEpisodes.slice(0, 6).map((ep, i) => (
                  <EpisodeCard
                    key={ep.episode_id}
                    episode={ep}
                    index={i}
                    onClick={() => handleEpisodeClick(ep.episode_id)}
                  />
                ))}
              </div>
            </>
          )}

          {episodes.length === 0 && isAtLeast('episodes') && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">No episodes detected today yet.</p>
              <p className="text-xs text-gray-600 mt-1">Episodes will appear as trajectory data flows in.</p>
            </div>
          )}
        </div>

        {/* ─── NARRATIVE TIMELINE ─── */}
        {isAtLeast('episodes') && topEpisodes.length > 0 && (
          <div
            className="w-full max-w-4xl mt-6"
            style={{
              opacity: 0,
              animation: 'landing-card-in 0.8s 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <NarrativeTimeline
              episodes={topEpisodes}
              onEpisodeClick={handleEpisodeClick}
            />
          </div>
        )}

        {/* ─── ENTER WORKSPACE BUTTON ─── */}
        <div
          className="mt-10 transition-all duration-700"
          style={{
            opacity: isAtLeast('ready') ? 1 : 0,
            transform: isAtLeast('ready') ? 'translateY(0)' : 'translateY(20px)',
          }}
        >
          <button
            onClick={handleExit}
            className="group relative flex items-center gap-3 px-8 py-3 rounded-xl text-sm font-medium text-white overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))',
              border: '1px solid rgba(59,130,246,0.2)',
            }}
          >
            {/* Shimmer effect */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.1), transparent)',
                backgroundSize: '200% 100%',
                animation: 'landing-shimmer 3s ease-in-out infinite',
              }}
            />
            <span className="relative">Enter Workspace</span>
            <ArrowRight className="relative w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-gray-950 to-transparent pointer-events-none" />
    </div>
  );
}
