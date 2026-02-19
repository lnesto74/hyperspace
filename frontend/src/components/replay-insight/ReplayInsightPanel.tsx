/**
 * ReplayInsightPanel
 * 
 * Slide-over panel showing episode detail: title, KPI cards,
 * business summary, recommended actions, and Play Insight button.
 * Does NOT modify any existing panel or drawer.
 */

import { useState } from 'react';
import { X, Play, ChevronLeft, ChevronRight, Zap, AlertTriangle, Info, CheckCircle, MessageSquare, MapPin } from 'lucide-react';
import { useReplayInsight } from '../../context/ReplayInsightContext';
import EpisodeKPICards from './EpisodeKPICards';

const SEVERITY_CONFIG = {
  high: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  medium: { icon: Info, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  low: { icon: CheckCircle, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
};

export default function ReplayInsightPanel() {
  const {
    selectedEpisode,
    isPanelOpen,
    closePanel,
    enterInsightMode,
    isInsightMode,
    exitInsightMode,
    activePlaylist,
    activePlaylistIndex,
    playlistNext,
    playlistPrev,
    clearPlaylist,
  } = useReplayInsight();

  if (!isPanelOpen || !selectedEpisode) return null;

  const severity = SEVERITY_CONFIG[selectedEpisode.severity] || SEVERITY_CONFIG.low;
  const SeverityIcon = severity.icon;
  const hasPlaylist = activePlaylist.length > 0;
  
  // Step-through state for Insight Mode
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = selectedEpisode.recommended_actions?.length || 1;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[380px] bg-gray-900/98 backdrop-blur-md border-l border-gray-700 z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: selectedEpisode.color }} />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {selectedEpisode.category}
          </span>
        </div>
        <button
          onClick={() => {
            closePanel();
            if (hasPlaylist) clearPlaylist();
          }}
          className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Playlist navigation */}
      {hasPlaylist && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/30 bg-gray-800/50">
          <button
            onClick={playlistPrev}
            disabled={activePlaylistIndex === 0}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-400">
            {activePlaylist[activePlaylistIndex]?.step_label} ({activePlaylistIndex + 1}/{activePlaylist.length})
          </span>
          <button
            onClick={playlistNext}
            disabled={activePlaylistIndex >= activePlaylist.length - 1}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Severity badge + time */}
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${severity.bg} ${severity.color} border ${severity.border}`}>
            <SeverityIcon className="w-3 h-3" />
            {selectedEpisode.severity}
          </div>
          <span className="text-[11px] text-gray-500">{selectedEpisode.time_label}</span>
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-white leading-snug">
          {selectedEpisode.title}
        </h3>

        {/* KPI Cards */}
        <EpisodeKPICards kpis={selectedEpisode.kpis} />

        {/* Business Summary */}
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
            Why this matters
          </h4>
          <p className="text-sm text-gray-300 leading-relaxed">
            {selectedEpisode.business_summary}
          </p>
        </div>

        {/* Recommended Actions */}
        {selectedEpisode.recommended_actions.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
              Recommended actions
            </h4>
            <ul className="space-y-1">
              {selectedEpisode.recommended_actions.map((action, i) => (
                <li key={i} className="text-sm text-gray-300 flex gap-2">
                  <span className="text-gray-500 shrink-0">→</span>
                  {action}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Confidence indicator */}
        <div className="flex items-center gap-2 pt-2">
          <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(selectedEpisode.confidence * 100)}%`,
                backgroundColor: selectedEpisode.color,
              }}
            />
          </div>
          <span className="text-[10px] text-gray-500">
            {Math.round(selectedEpisode.confidence * 100)}% confidence
          </span>
        </div>

        {/* Focus Zones (shown during Insight Mode) */}
        {isInsightMode && selectedEpisode.highlight_zones && selectedEpisode.highlight_zones.length > 0 && (
          <div className="space-y-1.5 pt-3 border-t border-gray-700/30 mt-3">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 text-gray-400" />
              <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                Focus zones
              </h4>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedEpisode.highlight_zones.map((zone: { id: string; name: string; color: string }) => (
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
        )}
      </div>

      {/* Insight Mode: Step-through section */}
      {isInsightMode && (
        <div className="px-4 py-3 border-t border-gray-700/50 bg-gray-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">
              Step {currentStep + 1} of {totalSteps}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                disabled={currentStep === 0}
                className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCurrentStep(Math.min(totalSteps - 1, currentStep + 1))}
                disabled={currentStep >= totalSteps - 1}
                className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-200 leading-relaxed mb-3">
            {selectedEpisode.recommended_actions?.[currentStep] || selectedEpisode.business_summary}
          </p>
          <button
            onClick={() => {
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
      )}

      {/* Footer — Play Insight button */}
      <div className="px-4 py-3 border-t border-gray-700/50">
        {!isInsightMode ? (
          <button
            onClick={enterInsightMode}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all"
            style={{
              backgroundColor: selectedEpisode.color + '20',
              color: selectedEpisode.color,
              border: `1px solid ${selectedEpisode.color}40`,
            }}
          >
            <Play className="w-4 h-4" />
            Play Insight
          </button>
        ) : (
          <button
            onClick={exitInsightMode}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium text-sm transition-colors"
          >
            Exit Insight Mode
          </button>
        )}
      </div>
    </div>
  );
}
