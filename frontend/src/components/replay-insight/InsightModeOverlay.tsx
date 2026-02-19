/**
 * InsightModeOverlay
 * 
 * Top bar shown when the user enters Insight Mode.
 * Shows episode title, time, playback controls, and progress.
 * Implements animated track playback through historical positions.
 */

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { X, Play, Pause, RotateCcw } from 'lucide-react';
import { useReplayInsight } from '../../context/ReplayInsightContext';
import { useTracking } from '../../context/TrackingContext';

type TrackPosition = { timestamp: number; x: number; z: number; vx?: number; vz?: number };

export default function InsightModeOverlay() {
  const {
    selectedEpisode,
    isInsightMode,
    exitInsightMode,
  } = useReplayInsight();

  const { setReplayMode, setReplayTracks } = useTracking();
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0-1
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Parse track positions and compute time bounds
  const { trackData, minTime, maxTime, duration } = useMemo(() => {
    if (!selectedEpisode?.track_positions) {
      return { trackData: new Map(), minTime: 0, maxTime: 0, duration: 0 };
    }

    const data = new Map<string, TrackPosition[]>();
    let min = Infinity;
    let max = -Infinity;

    for (const [trackKey, positions] of Object.entries(selectedEpisode.track_positions)) {
      const posArray = positions as TrackPosition[];
      if (posArray.length === 0) continue;
      
      data.set(trackKey, posArray);
      
      for (const p of posArray) {
        if (p.timestamp < min) min = p.timestamp;
        if (p.timestamp > max) max = p.timestamp;
      }
    }

    return {
      trackData: data,
      minTime: min === Infinity ? 0 : min,
      maxTime: max === -Infinity ? 0 : max,
      duration: max - min,
    };
  }, [selectedEpisode?.track_positions]);

  // Interpolate position at a given time
  const getPositionAtTime = useCallback((positions: TrackPosition[], time: number): TrackPosition | null => {
    if (positions.length === 0) return null;
    if (time <= positions[0].timestamp) return positions[0];
    if (time >= positions[positions.length - 1].timestamp) return positions[positions.length - 1];

    // Binary search for the right interval
    let lo = 0;
    let hi = positions.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (positions[mid].timestamp <= time) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const p1 = positions[lo];
    const p2 = positions[hi];
    const t = (time - p1.timestamp) / (p2.timestamp - p1.timestamp);

    return {
      timestamp: time,
      x: p1.x + (p2.x - p1.x) * t,
      z: p1.z + (p2.z - p1.z) * t,
      vx: p1.vx,
      vz: p1.vz,
    };
  }, []);

  // Update tracks at current playback time
  const updateTracksAtProgress = useCallback((prog: number) => {
    if (trackData.size === 0 || duration === 0) return;

    const currentTime = minTime + prog * duration;
    const trackMap = new Map();

    for (const [trackKey, positions] of trackData) {
      const pos = getPositionAtTime(positions, currentTime);
      if (!pos) continue;

      // Build trail up to current time
      const trail = positions
        .filter(p => p.timestamp <= currentTime)
        .map(p => ({ x: p.x, y: 0, z: p.z }));

      trackMap.set(trackKey, {
        id: trackKey,
        trackKey,
        deviceId: 'insight-replay',
        timestamp: pos.timestamp,
        position: { x: pos.x, y: 0, z: pos.z },
        venuePosition: { x: pos.x, y: 0, z: pos.z },
        velocity: { x: pos.vx || 0, y: 0, z: pos.vz || 0 },
        objectType: 'person' as const,
        trail,
      });
    }

    setReplayTracks(trackMap);
  }, [trackData, minTime, duration, getPositionAtTime, setReplayTracks]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || duration === 0) return;

    const playbackSpeed = 10; // 10x speed (episode time / real time)
    const animate = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp;
      }

      const deltaMs = timestamp - lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;

      // Advance progress
      const deltaProgress = (deltaMs * playbackSpeed) / duration;
      
      setProgress(prev => {
        const next = prev + deltaProgress;
        if (next >= 1) {
          setIsPlaying(false);
          return 1;
        }
        return next;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    lastFrameTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, duration]);

  // Update tracks when progress changes
  useEffect(() => {
    if (isInsightMode && trackData.size > 0) {
      updateTracksAtProgress(progress);
    }
  }, [progress, isInsightMode, trackData, updateTracksAtProgress]);

  // Enter/exit replay mode
  useEffect(() => {
    if (isInsightMode && selectedEpisode) {
      setReplayMode(true);
      setProgress(0);
      setIsPlaying(false);
    }

    return () => {
      if (isInsightMode) {
        setReplayMode(false);
        setReplayTracks(new Map());
        setIsPlaying(false);
        setProgress(0);
      }
    };
  }, [isInsightMode, selectedEpisode, setReplayMode, setReplayTracks]);

  const handleExit = useCallback(() => {
    setIsPlaying(false);
    exitInsightMode();
  }, [exitInsightMode]);

  const handlePlayPause = useCallback(() => {
    if (progress >= 1) {
      setProgress(0);
    }
    setIsPlaying(prev => !prev);
  }, [progress]);

  const handleRestart = useCallback(() => {
    setProgress(0);
    setIsPlaying(true);
  }, []);

  if (!isInsightMode || !selectedEpisode) return null;

  const progressPercent = Math.round(progress * 100);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700 shadow-2xl">
        {/* Main bar */}
        <div className="px-4 py-2.5 flex items-center gap-3">
          {/* Episode indicator */}
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ 
              backgroundColor: selectedEpisode.color,
              animation: isPlaying ? 'none' : 'pulse 2s infinite',
            }}
          />

          {/* Title + time */}
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate max-w-[200px]">
              {selectedEpisode.title}
            </div>
            <div className="text-[10px] text-gray-400">
              {selectedEpisode.time_label}
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={handlePlayPause}
              className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={handleRestart}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Restart"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="w-px h-5 bg-gray-700" />

          {/* Exit button */}
          <button
            onClick={handleExit}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Exit Insight Mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2">
            <div 
              className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const newProgress = Math.max(0, Math.min(1, clickX / rect.width));
                setProgress(newProgress);
              }}
            >
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: selectedEpisode.color,
                }}
              />
            </div>
            <span className="text-[10px] text-gray-500 w-8 text-right">
              {progressPercent}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
