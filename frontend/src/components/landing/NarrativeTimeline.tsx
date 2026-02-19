/**
 * NarrativeTimeline
 * 
 * Horizontal semantic timeline showing episode markers.
 * Each marker represents a business episode with time position,
 * color-coded severity, and animated entrance.
 */

import { useMemo } from 'react';
import { Zap } from 'lucide-react';
import type { NarrationPack } from '../../context/ReplayInsightContext';

interface NarrativeTimelineProps {
  episodes: NarrationPack[];
  onEpisodeClick: (episodeId: string) => void;
}

export default function NarrativeTimeline({ episodes, onEpisodeClick }: NarrativeTimelineProps) {
  // Extract time range from episodes
  const { minTs, totalSpan, timeLabels } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;

    for (const ep of episodes) {
      if (ep.replay_window?.start && ep.replay_window.start < min) min = ep.replay_window.start;
      if (ep.replay_window?.end && ep.replay_window.end > max) max = ep.replay_window.end;
    }

    // If no valid windows, use episode order
    if (!isFinite(min) || !isFinite(max) || max <= min) {
      return {
        minTs: 0,
        maxTs: episodes.length,
        totalSpan: episodes.length,
        timeLabels: [] as string[],
      };
    }

    // Generate 5 time labels across the span
    const labels: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ts = min + (max - min) * (i / 4);
      const d = new Date(ts);
      labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }

    return { minTs: min, maxTs: max, totalSpan: max - min, timeLabels: labels };
  }, [episodes]);

  // Position each episode on the timeline
  const markers = useMemo(() => {
    return episodes.map((ep, i) => {
      let position: number;
      if (totalSpan > 0 && ep.replay_window?.start) {
        const midTs = (ep.replay_window.start + (ep.replay_window.end || ep.replay_window.start)) / 2;
        position = ((midTs - minTs) / totalSpan) * 100;
      } else {
        position = ((i + 0.5) / episodes.length) * 100;
      }
      return { episode: ep, position: Math.max(4, Math.min(96, position)) };
    });
  }, [episodes, minTs, totalSpan]);

  if (episodes.length === 0) return null;

  return (
    <div className="relative">
      {/* Timeline track */}
      <div className="relative h-16">
        {/* Base line */}
        <div className="absolute top-8 left-0 right-0 h-px bg-gray-800" />

        {/* Animated progress line */}
        <div
          className="absolute top-8 left-0 h-px"
          style={{
            background: 'linear-gradient(90deg, rgba(59,130,246,0.4), rgba(139,92,246,0.4))',
            width: 0,
            animation: 'landing-line-draw 1.5s 0.3s ease forwards',
          }}
        />

        {/* Markers */}
        {markers.map(({ episode, position }, i) => (
          <button
            key={episode.episode_id}
            className="absolute group"
            style={{
              left: `${position}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              opacity: 0,
              animation: `landing-badge-pop 0.4s ${0.1 * i + 0.5}s cubic-bezier(0.16, 1, 0.3, 1) forwards`,
            }}
            onClick={() => onEpisodeClick(episode.episode_id)}
          >
            {/* Pulse ring */}
            {episode.severity === 'high' && (
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  width: 20,
                  height: 20,
                  margin: '-4px',
                  border: `1px solid ${episode.color}`,
                  animation: 'landing-pulse-ring 2s ease-out infinite',
                }}
              />
            )}

            {/* Dot */}
            <div
              className="w-3 h-3 rounded-full border-2 border-gray-900 shadow-lg transition-transform group-hover:scale-150"
              style={{ backgroundColor: episode.color }}
            />

            {/* Tooltip */}
            <div
              className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap"
            >
              <div className="bg-gray-800 border border-gray-600 rounded-lg px-2.5 py-1.5 shadow-xl">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <Zap className="w-2.5 h-2.5" style={{ color: episode.color }} />
                  <span className="text-white font-medium">{episode.title.slice(0, 40)}{episode.title.length > 40 ? '...' : ''}</span>
                </div>
                <div className="text-[9px] text-gray-400 mt-0.5">{episode.time_label}</div>
              </div>
              {/* Arrow */}
              <div className="w-2 h-2 bg-gray-800 border-b border-r border-gray-600 rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1" />
            </div>
          </button>
        ))}
      </div>

      {/* Time labels */}
      {timeLabels.length > 0 && (
        <div className="flex justify-between px-2 mt-1">
          {timeLabels.map((label, i) => (
            <span
              key={i}
              className="text-[9px] text-gray-600"
              style={{
                opacity: 0,
                animation: `landing-card-in 0.5s ${0.1 * i + 1}s ease forwards`,
              }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
