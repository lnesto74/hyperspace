import { useEffect, useState } from 'react';
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Bell, 
  BellOff, 
  Play, 
  Pause,
  MessageSquare,
  Loader2,
  AlertTriangle,
  TrendingUp,
  Info,
  ExternalLink,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { useNarrator } from '../../context/NarratorContext';
import { PERSONAS } from '../../features/businessReporting/personas';
import type { PersonaId, ProactiveInsight, RecommendedAction } from '../../types/narrator';

interface NarratorDrawerProps {
  onExecuteIntent: (intent: string, entityId?: string) => void;
}

export default function NarratorDrawer({ onExecuteIntent }: NarratorDrawerProps) {
  const narrator = useNarrator();
  const {
    isOpen,
    isLoading,
    proactiveMode,
    storyMode,
    currentStoryStep,
    activePersonaId,
    narration,
    proactiveInsights,
    error,
    closeNarrator,
    setProactiveMode,
    setStoryMode,
    setActivePersona,
    nextStoryStep,
    prevStoryStep,
    handleFollowUp,
    executeIntent,
  } = narrator;
  
  // Get data mode and time period from context (with fallbacks)
  const dataMode = (narrator as any).dataMode || 'historical';
  const timePeriod = (narrator as any).timePeriod || 'day';
  const setDataMode = (narrator as any).setDataMode || (() => { console.log('[Narrator] setDataMode not available'); });
  const setTimePeriod = (narrator as any).setTimePeriod || (() => { console.log('[Narrator] setTimePeriod not available'); });
  
  // Manual refresh handler
  const handleRefresh = async () => {
    console.log('[Narrator] Manual refresh triggered, dataMode:', dataMode, 'timePeriod:', timePeriod);
    if (setDataMode) {
      await setDataMode(dataMode);
    }
  };

  const [storyPaths, setStoryPaths] = useState<Record<string, { name: string; steps: { id: number; title: string }[] }>>({});

  // Fetch story paths
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/narrator/story-paths`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStoryPaths(data.storyPaths);
        }
      })
      .catch(() => {});
  }, []);

  const currentPath = storyPaths[activePersonaId];
  const totalSteps = currentPath?.steps?.length || 0;

  const handleIntentClick = (action: RecommendedAction) => {
    const [intent, entityId] = action.uiIntent.split(':');
    executeIntent(action.uiIntent);
    onExecuteIntent(intent, entityId);
  };

  const handleInsightClick = (insight: ProactiveInsight) => {
    // Focus narrator on this insight
    handleFollowUp({
      question: insight.headline,
      intentType: 'explain_kpi',
      context: { targetKpi: insight.kpiId },
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-gray-900 border-l border-gray-700 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-3 bg-gray-800">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span className="font-medium text-white">AI Narrator</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            title="Refresh analysis"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={closeNarrator}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Data Mode & Time Period */}
      <div className="px-3 py-2 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-400">Data:</span>
          <div className="flex-1 flex gap-1">
            <button
              onClick={() => setDataMode('realtime')}
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                dataMode === 'realtime'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              Realtime
            </button>
            <button
              onClick={() => setDataMode('historical')}
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                dataMode === 'historical'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              Historical
            </button>
          </div>
        </div>
        
        {/* Time Period (only show for historical) */}
        {dataMode === 'historical' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Period:</span>
            <div className="flex-1 flex gap-1">
              {(['hour', 'day', 'week', 'month'] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setTimePeriod(period)}
                  className={`flex-1 px-2 py-1 text-xs rounded capitalize transition-colors ${
                    timePeriod === period
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-3 py-2 border-b border-gray-700 bg-gray-800/50 flex items-center gap-2">
        {/* Persona Selector */}
        <select
          value={activePersonaId}
          onChange={(e) => setActivePersona(e.target.value as PersonaId)}
          className="flex-1 bg-gray-700 border border-gray-600 text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
        >
          {PERSONAS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Proactive Toggle */}
        <button
          onClick={() => setProactiveMode(!proactiveMode)}
          className={`p-1.5 rounded transition-colors ${
            proactiveMode
              ? 'bg-amber-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:text-white'
          }`}
          title={proactiveMode ? 'Proactive alerts ON' : 'Proactive alerts OFF'}
        >
          {proactiveMode ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        </button>

        {/* Story Mode Toggle */}
        <button
          onClick={() => setStoryMode(!storyMode)}
          className={`p-1.5 rounded transition-colors ${
            storyMode
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:text-white'
          }`}
          title={storyMode ? 'Story mode ON' : 'Story mode OFF'}
        >
          {storyMode ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
      </div>

      {/* Story Progress (if story mode) */}
      {storyMode && currentPath && (
        <div className="px-3 py-2 border-b border-gray-700 bg-purple-900/20">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>Step {currentStoryStep + 1} of {totalSteps}</span>
            <span className="text-purple-400">{currentPath.steps[currentStoryStep]?.title}</span>
          </div>
          <div className="flex gap-1">
            {currentPath.steps.map((_, idx) => (
              <div
                key={idx}
                className={`flex-1 h-1 rounded-full ${
                  idx <= currentStoryStep ? 'bg-purple-500' : 'bg-gray-700'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Proactive Alerts (collapsible) */}
      {proactiveMode && proactiveInsights.length > 0 && (
        <div className="border-b border-gray-700 bg-amber-900/10">
          <div className="px-3 py-2 text-xs text-amber-400 font-medium flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Proactive Alerts
          </div>
          <div className="px-3 pb-2 space-y-1">
            {proactiveInsights.map((insight, idx) => (
              <button
                key={idx}
                onClick={() => handleInsightClick(insight)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                  insight.severity === 'critical'
                    ? 'bg-red-900/30 text-red-300 hover:bg-red-900/50'
                    : insight.severity === 'warning'
                    ? 'bg-amber-900/30 text-amber-300 hover:bg-amber-900/50'
                    : 'bg-blue-900/30 text-blue-300 hover:bg-blue-900/50'
                }`}
              >
                {insight.severity === 'critical' ? (
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                ) : insight.severity === 'warning' ? (
                  <TrendingUp className="w-3 h-3 flex-shrink-0" />
                ) : (
                  <Info className="w-3 h-3 flex-shrink-0" />
                )}
                <span className="truncate">{insight.headline}</span>
                <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            {error}
          </div>
        ) : narration ? (
          <div className="p-4 space-y-4">
            {/* Headline */}
            <div className="text-lg font-semibold text-white leading-tight">
              {narration.headline}
            </div>

            {/* Narration bullets */}
            <ul className="space-y-2">
              {narration.narration.map((bullet, idx) => (
                <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            {/* Business Meaning */}
            <div className="text-sm text-gray-400 italic border-l-2 border-purple-500 pl-3">
              {narration.businessMeaning}
            </div>

            {/* Recommended Actions */}
            {narration.recommendedActions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-wide">
                  Recommended Actions
                </div>
                {narration.recommendedActions.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleIntentClick(action)}
                    className="w-full text-left px-3 py-2 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/50 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">{action.label}</div>
                      <div className="text-xs text-gray-400 truncate">{action.reason}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Follow-up Suggestions */}
            {narration.suggestedFollowUps.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-700">
                <div className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  Ask me about
                </div>
                {narration.suggestedFollowUps.map((followUp, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleFollowUp(followUp)}
                    className="w-full text-left px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors text-sm text-gray-300"
                  >
                    💬 "{followUp.question}"
                  </button>
                ))}
              </div>
            )}

            {/* Confidence indicator */}
            <div className="pt-2 flex items-center gap-2 text-xs text-gray-500">
              <span>Confidence:</span>
              <span
                className={`px-1.5 py-0.5 rounded ${
                  narration.confidence === 'high'
                    ? 'bg-green-900/50 text-green-400'
                    : narration.confidence === 'medium'
                    ? 'bg-amber-900/50 text-amber-400'
                    : 'bg-gray-700 text-gray-400'
                }`}
              >
                {narration.confidence}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 text-gray-500 text-sm">
            Select a persona and explore your data.
          </div>
        )}
      </div>

      {/* Story Navigation (if story mode) */}
      {storyMode && (
        <div className="border-t border-gray-700 px-3 py-2 flex items-center justify-between bg-gray-800">
          <button
            onClick={prevStoryStep}
            disabled={currentStoryStep === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>
          <button
            onClick={() => setStoryMode(false)}
            className="text-xs text-gray-500 hover:text-white transition-colors"
          >
            Exit Story Mode
          </button>
          <button
            onClick={nextStoryStep}
            disabled={currentStoryStep >= totalSteps - 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-gray-700 px-3 py-2 bg-gray-800/50">
        <div className="text-xs text-gray-500 text-center">
          AI-powered insights • Does not modify data
        </div>
      </div>
    </div>
  );
}
