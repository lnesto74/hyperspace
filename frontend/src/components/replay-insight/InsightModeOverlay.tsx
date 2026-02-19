/**
 * InsightModeOverlay
 * 
 * Minimal top bar shown when the user enters Insight Mode.
 * Shows episode title, time, and playback controls only.
 * Step-through and "Explain this" are now in the right panel.
 */

import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useReplayInsight } from '../../context/ReplayInsightContext';
import { useTracking } from '../../context/TrackingContext';

export default function InsightModeOverlay() {
  const {
    selectedEpisode,
    isInsightMode,
    exitInsightMode,
  } = useReplayInsight();

  const { setReplayMode, setReplayTracks } = useTracking();

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
    exitInsightMode();
  }, [exitInsightMode]);

  if (!isInsightMode || !selectedEpisode) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700 px-4 py-2.5 shadow-2xl flex items-center gap-3">
        {/* Episode indicator */}
        <div
          className="w-2 h-2 rounded-full shrink-0 animate-pulse"
          style={{ backgroundColor: selectedEpisode.color }}
        />

        {/* Title + time */}
        <div className="min-w-0">
          <div className="text-sm font-medium text-white truncate max-w-[280px]">
            {selectedEpisode.title}
          </div>
          <div className="text-[10px] text-gray-400">
            {selectedEpisode.time_label}
          </div>
        </div>

        {/* Exit button */}
        <button
          onClick={handleExit}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors ml-2"
          title="Exit Insight Mode"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
