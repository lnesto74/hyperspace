/**
 * HistogramTimeline
 * 
 * SoundCloud-style dense waveform timeline using SVG for pixel-perfect
 * equal-width bars. White bars, continuous, no gaps. Episode regions
 * brighter. Active episode highlighted.
 */

import { useMemo, useRef } from 'react';
import type { NarrationPack } from '../../context/ReplayInsightContext';

interface HistogramTimelineProps {
  episodes: NarrationPack[];
  activeIndex: number;
  onBarClick: (episodeIndex: number) => void;
}

const TOTAL_BARS = 200;
const SVG_W = 1000; // viewBox width — bars are rendered in this coordinate space
const SVG_H = 48;   // viewBox height
const BAR_GAP = 0.8; // dark gap between bars for visible separation
const BAR_W = (SVG_W / TOTAL_BARS) - BAR_GAP; // bar width minus gap

export default function HistogramTimeline({ episodes, activeIndex, onBarClick }: HistogramTimelineProps) {
  const noiseRef = useRef<number[]>(Array.from({ length: TOTAL_BARS }, () => 0.05 + Math.random() * 0.18));

  const { bars, timeLabels, activeBarRange } = useMemo(() => {
    if (episodes.length === 0) return { bars: [], timeLabels: [], activeBarRange: [-1, -1] as [number, number] };

    let minTs = Infinity, maxTs = -Infinity;
    for (const ep of episodes) {
      const s = ep.replay_window?.start || 0;
      const e = ep.replay_window?.end || s;
      if (s > 0 && s < minTs) minTs = s;
      if (e > 0 && e > maxTs) maxTs = e;
    }
    if (!isFinite(minTs) || !isFinite(maxTs)) return { bars: [], timeLabels: [], activeBarRange: [-1, -1] as [number, number] };

    const range = Math.max(maxTs - minTs, 30 * 60 * 1000);
    const pad = range * 0.1;
    const start = minTs - pad;
    const end = maxTs + pad;
    const totalMs = end - start;
    const barMs = totalMs / TOTAL_BARS;

    const scores = new Float32Array(TOTAL_BARS);
    const barEpisodes: number[][] = Array.from({ length: TOTAL_BARS }, () => []);

    episodes.forEach((ep, idx) => {
      const epStart = ep.replay_window?.start || 0;
      const epEnd = ep.replay_window?.end || epStart;
      const iStart = Math.max(0, Math.floor((epStart - start) / barMs));
      const iEnd = Math.min(TOTAL_BARS - 1, Math.ceil((epEnd - start) / barMs));
      const score = ep.score || 1;
      for (let i = iStart; i <= iEnd; i++) {
        scores[i] += score;
        if (!barEpisodes[i].includes(idx)) barEpisodes[i].push(idx);
      }
    });

    const maxScore = Math.max(...scores, 1);

    const barsData = Array.from({ length: TOTAL_BARS }, (_, i) => {
      const hasEp = scores[i] > 0;
      const normalized = hasEp ? Math.max(0.12, scores[i] / maxScore) : noiseRef.current[i];
      return { height: normalized, hasEpisodes: hasEp, episodeIndices: barEpisodes[i] };
    });

    let aStart = -1, aEnd = -1;
    if (activeIndex >= 0 && activeIndex < episodes.length) {
      const ep = episodes[activeIndex];
      const epS = ep.replay_window?.start || 0;
      const epE = ep.replay_window?.end || epS;
      aStart = Math.max(0, Math.floor((epS - start) / barMs));
      aEnd = Math.min(TOTAL_BARS - 1, Math.ceil((epE - start) / barMs));
    }

    const labels: { position: number; text: string }[] = [];
    const labelCount = 7;
    for (let i = 0; i < labelCount; i++) {
      const frac = i / (labelCount - 1);
      const ts = start + frac * totalMs;
      labels.push({
        position: frac * 100,
        text: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }

    return { bars: barsData, timeLabels: labels, activeBarRange: [aStart, aEnd] as [number, number] };
  }, [episodes, activeIndex]);

  if (bars.length === 0) return null;

  return (
    <div className="w-full">
      {/* SVG waveform — pixel-perfect equal-width bars */}
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: 48, display: 'block' }}
      >
        {bars.map((bar, i) => {
          const isActive = i >= activeBarRange[0] && i <= activeBarRange[1] && activeBarRange[0] >= 0;
          const hasEp = bar.hasEpisodes;
          const barH = bar.height * SVG_H;
          const x = i * (BAR_W + BAR_GAP);
          const y = SVG_H - barH;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={BAR_W}
              height={barH}
              rx={0.3}
              fill={isActive ? 'rgba(255,255,255,0.95)' : hasEp ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)'}
              style={{
                cursor: hasEp ? 'pointer' : 'default',
                transition: 'fill 0.3s ease',
              }}
              onClick={() => {
                if (hasEp && bar.episodeIndices.length > 0) onBarClick(bar.episodeIndices[0]);
              }}
            >
              <animate
                attributeName="height"
                from="0"
                to={barH}
                dur="0.8s"
                begin={`${i * 0.003}s`}
                fill="freeze"
                calcMode="spline"
                keySplines="0.16 1 0.3 1"
              />
              <animate
                attributeName="y"
                from={SVG_H}
                to={y}
                dur="0.8s"
                begin={`${i * 0.003}s`}
                fill="freeze"
                calcMode="spline"
                keySplines="0.16 1 0.3 1"
              />
            </rect>
          );
        })}
      </svg>

      {/* Time labels */}
      <div className="relative h-5 mt-1.5">
        {timeLabels.map((label, i) => (
          <span key={i} className="absolute text-[9px] text-gray-500 -translate-x-1/2" style={{ left: `${label.position}%` }}>
            {label.text}
          </span>
        ))}
      </div>
    </div>
  );
}
