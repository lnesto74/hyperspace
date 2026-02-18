/**
 * InsightModeOverlay
 * 
 * Overlay controls shown when the user enters Insight Mode from the panel.
 * Shows episode context, play/pause, step-through, and "Explain this" button.
 * Uses existing setReplayMode/setReplayTracks from TrackingContext.
 */

import { useEffect, useState, useCallback } from 'react';
import { Play, Pause, SkipForward, X, MessageSquare, Eye } from 'lucide-react';
import { useReplayInsight } from '../../context/ReplayInsightContext';
import { useTracking } from '../../context/TrackingContext';

export default function InsightModeOverlay() {
  const {
    selectedEpisode,
    isInsightMode,
    exitInsightMode,
  } = useReplayInsight();

  const { setReplayMode, setReplayTracks } = useTracking();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Enter/exit replay mode when insight mode changes
  useEffect(() => {
    if (isInsightMode && selectedEpisode) {
      setReplayMode(true);

      // Load representative tracks into the 3D view
      if (selectedEpisode.track_positions) {
        const trackMap = new Map();
        for (const [trackKey, positions] of Object.entries(selectedEpisode.track_positions)) {
          const posArray = positions as Array<{ timestamp: number; x: number; z: number; vx: number; vz: number }>;
          if (posArray.length === 0) continue;

          const lastPos = posArray[posArray.length - 1];
          const trail = posArray.map((p: { x: number; z: number }) => ({ x: p.x, y: 0, z: p.z }));

          trackMap.set(trackKey, {
            id: trackKey,
            trackKey,
            deviceId: 'insight-replay',
            timestamp: lastPos.timestamp,
            position: { x: lastPos.x, y: 0, z: lastPos.z },
            venuePosition: { x: lastPos.x, y: 0, z: lastPos.z },
            velocity: { x: lastPos.vx || 0, y: 0, z: lastPos.vz || 0 },
            objectType: 'person' as const,
            trail,
          });
        }
        setReplayTracks(trackMap);
      }
    }

    return () => {
      if (isInsightMode) {
        setReplayMode(false);
        setReplayTracks(new Map());
      }
    };
  }, [isInsightMode, selectedEpisode, setReplayMode, setReplayTracks]);

  const handleExit = useCallback(() => {
    setIsPlaying(false);
    setCurrentStep(0);
    exitInsightMode();
  }, [exitInsightMode]);

  if (!isInsightMode || !selectedEpisode) return null;

  const totalSteps = selectedEpisode.recommended_actions?.length || 1;

  return (
    <>
      {/* Top bar — episode context */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
        <div className="bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700 px-5 py-3 shadow-2xl flex items-center gap-4 max-w-xl">
          {/* Episode indicator */}
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse"
            style={{ backgroundColor: selectedEpisode.color }}
          />

          {/* Title + time */}
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">
              {selectedEpisode.title}
            </div>
            <div className="text-[10px] text-gray-400">
              {selectedEpisode.time_label}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setCurrentStep(Math.min(totalSteps - 1, currentStep + 1))}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Next step"
            >
              <SkipForward className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-gray-700 mx-1" />
            <button
              onClick={handleExit}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Exit Insight Mode"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom left — explanation step */}
      <div className="fixed bottom-16 left-4 z-50">
        <div className="bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700 p-4 shadow-2xl max-w-sm">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">
              Step {currentStep + 1} of {totalSteps}
            </span>
          </div>
          <p className="text-sm text-gray-200 leading-relaxed">
            {selectedEpisode.recommended_actions?.[currentStep] || selectedEpisode.business_summary}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                // Dispatch narrator2 intent to explain the episode
                const event = new CustomEvent('narrator2-intent', {
                  detail: { intent: `explain_episode:${selectedEpisode.episode_id}` },
                });
                window.dispatchEvent(event);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              <MessageSquare className="w-3 h-3" />
              Explain this
            </button>
          </div>
        </div>
      </div>

      {/* Zone highlight overlay hint */}
      {selectedEpisode.highlight_zones && selectedEpisode.highlight_zones.length > 0 && (
        <div className="fixed bottom-16 right-[396px] z-50">
          <div className="bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-700/50 px-3 py-2 shadow-lg">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Focus zones</div>
            <div className="flex flex-wrap gap-1">
              {selectedEpisode.highlight_zones.map((zone) => (
                <span
                  key={zone.id}
                  className="text-[11px] px-2 py-0.5 rounded-full border"
                  style={{
                    color: zone.color,
                    borderColor: zone.color + '40',
                    backgroundColor: zone.color + '15',
                  }}
                >
                  {zone.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
