/**
 * Narrator2 Drawer Component
 * 
 * Modern ViewPack-based KPI storytelling UI.
 * Replaces the old AI Narrator with faster, cached responses.
 */

import { useState } from 'react';
import {
  X,
  Sparkles,
  RefreshCw,
  Loader2,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  ChevronRight,
  Send,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Settings,
} from 'lucide-react';
import { useNarrator2 } from '../../context/Narrator2Context';
import { useVenue } from '../../context/VenueContext';
import type { ViewPackKpi, Narrator2Action, KpiStatus } from '../../types/narrator2';
import VenueKPIThresholdsPanel from '../kpi/VenueKPIThresholdsPanel';

interface Narrator2DrawerProps {
  onExecuteIntent?: (intent: string) => void;
}

// Business-focused KPI explanations for tooltips
const KPI_BUSINESS_TOOLTIPS: Record<string, string> = {
  // Store Manager KPIs
  totalInStore: 'Total people currently in the store right now. Use for real-time staffing decisions, fire safety compliance, and understanding current traffic levels.',
  occupancyRate: 'Percentage of people in defined zones vs capacity. High rate may indicate crowding in specific areas. Use for zone-level staffing and layout decisions.',
  avgDwellTime: 'How long do customers spend per zone? Longer dwell = higher engagement. Low dwell may indicate poor product placement or layout issues.',
  avgStoreVisit: 'Total time customers spend in-store. Longer visits typically lead to higher basket sizes. Track to measure overall shopping experience.',
  queueWaitTime: 'Customer patience indicator. Long waits hurt satisfaction and can cause abandonment. Open more lanes when this exceeds 3 minutes.',
  cashierOpenCount: 'Active checkout capacity. Match to current traffic to minimize wait times while optimizing labor costs.',
  passByTraffic: 'Total footfall entering the store. Foundation metric for conversion calculations. Compare across days/weeks for trend analysis.',
  conversionRate: 'Visitors who made a purchase. The ultimate retail KPI. Low conversion with high traffic = merchandising or pricing issues.',
  engagementRate: 'Visitors who stopped and browsed (>2 min in zone). High engagement = effective displays. Low engagement = adjust layout or signage.',
  browsingRate: 'Percentage of visitors who explored beyond entrance. Low rate may indicate entry-point issues or lack of compelling draws.',
  bounceRate: 'Visitors who left quickly without engaging. High bounce = poor first impression or wrong customer targeting.',
  alertIndex: 'Number of active alerts requiring attention. Prioritize red alerts for immediate action.',
  
  // Category Manager / Merchandising KPIs
  categoryEngagementRate: 'Percentage of category visitors who engaged deeply (stayed >2 min). Low engagement = review product assortment, pricing, or shelf placement. Compare across categories to identify underperformers.',
  categoryDwellTime: 'Average time shoppers spend browsing this category. Longer dwell correlates with higher purchase intent. Below 1 min suggests products aren\'t capturing attention.',
  categoryConversionRate: 'Category browsers who made a purchase. Requires POS integration. Low conversion with high engagement = pricing or availability issues.',
  categoryRevenuePerVisit: 'Revenue generated per visitor to this category. Requires POS data. Use to prioritize high-value categories for premium shelf space.',
  categoryComparisonIndex: 'Performance vs category benchmark (1.0 = average). Above 1.0 = outperforming similar stores. Below 0.8 = investigate merchandising issues.',
  avgBrowseTime: 'Average seconds shoppers examine products on shelf. Longer browse = higher consideration. Below 15 sec suggests poor product visibility or assortment.',
  passbyCount: 'Shoppers who walked past the category without stopping. High pass-by = opportunity loss. Test end-caps, signage, or promotional displays to capture attention.',
  brandEfficiencyIndex: 'Brand engagement share ÷ shelf space share. Above 1.0 = brand over-performing its space allocation. Below 0.8 = consider reducing shelf space or repositioning.',
  skuPositionScoreAvg: 'Average shelf placement quality (0-100). Eye-level center positions score highest. Low scores indicate products in poor visibility zones.',
};

// Get business tooltip for a KPI
function getBusinessTooltip(kpiId: string): string {
  return KPI_BUSINESS_TOOLTIPS[kpiId] || 'Key performance indicator for store operations.';
}

// Highlight numbers in text with semantic colors
function highlightNumbers(text: string): React.ReactNode[] {
  // Regex to match numbers with optional % or "min" suffix
  const numberRegex = /(\d+\.?\d*)\s*(%|min|visitors|pax)?/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIndex = 0;

  while ((match = numberRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const value = parseFloat(match[1]);
    const suffix = match[2] || '';
    const fullMatch = match[0];

    // Determine color based on context
    let colorClass = 'bg-blue-500/20 text-blue-400'; // Default: neutral blue
    
    if (suffix === '%') {
      // Percentage - use semantic colors based on value
      if (value >= 50) {
        colorClass = 'bg-green-500/20 text-green-400';
      } else if (value >= 20) {
        colorClass = 'bg-amber-500/20 text-amber-400';
      } else {
        colorClass = 'bg-red-500/20 text-red-400';
      }
    } else if (suffix === 'min') {
      // Time values - longer is generally better for dwell
      if (value >= 2) {
        colorClass = 'bg-green-500/20 text-green-400';
      } else if (value >= 0.5) {
        colorClass = 'bg-amber-500/20 text-amber-400';
      } else {
        colorClass = 'bg-red-500/20 text-red-400';
      }
    } else if (suffix === 'visitors' || suffix === 'pax') {
      // Visitor counts - neutral blue
      colorClass = 'bg-cyan-500/20 text-cyan-400';
    }

    parts.push(
      <span key={keyIndex++} className={`${colorClass} px-1.5 py-0.5 rounded font-medium`}>
        {fullMatch}
      </span>
    );

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// Status icon component
function StatusIcon({ status }: { status?: KpiStatus }) {
  switch (status) {
    case 'green':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
    case 'amber':
      return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
    case 'red':
      return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    default:
      return <Minus className="w-3.5 h-3.5 text-gray-500" />;
  }
}

// Format KPI value for display
function formatKpiValue(kpi: ViewPackKpi): string {
  if (kpi.value === null || kpi.value === undefined) return 'N/A';
  
  switch (kpi.format) {
    case 'pct':
      return `${kpi.value.toFixed(1)}${kpi.unit || '%'}`;
    case 'sec':
      return `${kpi.value.toFixed(1)}${kpi.unit || 's'}`;
    case 'min':
      return `${kpi.value.toFixed(1)}${kpi.unit || ' min'}`;
    case 'count':
      return `${Math.round(kpi.value).toLocaleString()}${kpi.unit ? ` ${kpi.unit}` : ''}`;
    case 'currency':
      return `${kpi.unit || '$'}${kpi.value.toFixed(2)}`;
    case 'index':
    case 'score':
      return `${kpi.value.toFixed(1)}${kpi.unit ? ' ' + kpi.unit : ''}`;
    default:
      return `${kpi.value}${kpi.unit ? ' ' + kpi.unit : ''}`;
  }
}

export default function Narrator2Drawer({ onExecuteIntent }: Narrator2DrawerProps) {
  const {
    isOpen,
    isLoading,
    activePersona,
    activeStep,
    period,
    viewPack,
    narration,
    error,
    personas,
    useOpenAI,
    setUseOpenAI,
    closeNarrator,
    setPersona,
    setStep,
    setPeriod,
    refresh,
    askQuestion,
    executeIntent,
  } = useNarrator2();

  const { venue } = useVenue();

  const [questionInput, setQuestionInput] = useState('');
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [showThresholdsPanel, setShowThresholdsPanel] = useState(false);
  const [hoveredKpiId, setHoveredKpiId] = useState<string | null>(null);

  const handleAskQuestion = async () => {
    if (!questionInput.trim()) return;
    setIsAskingQuestion(true);
    await askQuestion(questionInput.trim());
    setQuestionInput('');
    setIsAskingQuestion(false);
  };

  const handleIntentClick = (action: Narrator2Action) => {
    executeIntent(action.uiIntent);
    onExecuteIntent?.(action.uiIntent);
  };

  const currentStepDef = activePersona?.steps.find(s => s.id === activeStep);

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-gray-900 border-l border-gray-700 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-gray-700 flex items-center justify-between px-4 bg-gradient-to-r from-purple-900/50 to-gray-800">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span className="font-semibold text-white">Copilot</span>
          <span className="text-xs text-purple-300 bg-purple-900/50 px-1.5 py-0.5 rounded">AI</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowThresholdsPanel(true)}
            className="p-2 text-gray-400 hover:text-amber-400 hover:bg-amber-500/20 rounded-lg transition-colors"
            title="KPI Thresholds Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={refresh}
            disabled={isLoading}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={closeNarrator}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/50 space-y-3">
        {/* Persona selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-16">Persona</span>
          <select
            value={activePersona?.id || ''}
            onChange={(e) => setPersona(e.target.value as any)}
            className="flex-1 bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Step selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-16">Step</span>
          <select
            value={activeStep || ''}
            onChange={(e) => setStep(e.target.value as any)}
            className="flex-1 bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            {activePersona?.steps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-16">Period</span>
          <div className="flex-1 flex gap-1">
            {(['hour', 'day', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 px-2 py-1.5 text-xs rounded-lg capitalize transition-colors ${
                  period === p
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* OpenAI Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-16">AI Mode</span>
          <button
            onClick={() => setUseOpenAI(!useOpenAI)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              useOpenAI
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            {useOpenAI ? 'OpenAI Enabled' : 'OpenAI Disabled'}
          </button>
        </div>
      </div>

      {/* Step description */}
      {currentStepDef && (
        <div className="px-4 py-2 border-b border-gray-700 bg-purple-900/10">
          <div className="text-sm font-medium text-purple-300">{currentStepDef.title}</div>
          <div className="text-xs text-gray-400">{currentStepDef.description}</div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && !viewPack ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 text-red-400 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* KPIs Grid */}
            {viewPack && viewPack.kpis.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-wide flex items-center justify-between">
                  <span>KPIs ({viewPack.kpis.length})</span>
                  {viewPack._meta && (
                    <span className="text-gray-600">
                      {viewPack._meta.cache.hit ? '⚡ cached' : `${viewPack._meta.latencyMs}ms`}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {viewPack.kpis.map((kpi) => (
                    <div
                      key={kpi.id}
                      onMouseEnter={() => setHoveredKpiId(kpi.id)}
                      onMouseLeave={() => setHoveredKpiId(null)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        hoveredKpiId === kpi.id
                          ? 'ring-2 ring-purple-500 ring-offset-1 ring-offset-gray-900'
                          : ''
                      } ${
                        kpi.status === 'red'
                          ? 'bg-red-900/20 border-red-800/50 hover:bg-red-900/30'
                          : kpi.status === 'amber'
                          ? 'bg-amber-900/20 border-amber-800/50 hover:bg-amber-900/30'
                          : kpi.status === 'green'
                          ? 'bg-green-900/20 border-green-800/50 hover:bg-green-900/30'
                          : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-400 truncate">{kpi.label}</span>
                        <StatusIcon status={kpi.status} />
                      </div>
                      <div className="text-lg font-semibold text-white">
                        {formatKpiValue(kpi)}
                      </div>
                      {kpi.delta !== null && kpi.delta !== undefined && (
                        <div className={`text-xs flex items-center gap-1 mt-1 ${
                          kpi.delta > 0 ? 'text-green-400' : kpi.delta < 0 ? 'text-red-400' : 'text-gray-500'
                        }`}>
                          {kpi.delta > 0 ? <TrendingUp className="w-3 h-3" /> : kpi.delta < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                          {kpi.delta > 0 ? '+' : ''}{kpi.delta.toFixed(1)}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* KPI Description Area */}
                <div className={`mt-3 p-3 rounded-lg border transition-all duration-200 ${
                  hoveredKpiId 
                    ? 'bg-purple-900/20 border-purple-700/50 opacity-100' 
                    : 'bg-gray-800/30 border-gray-700/50 opacity-60'
                }`}>
                  {hoveredKpiId ? (
                    <>
                      <div className="text-xs text-purple-300 font-medium mb-1">
                        {viewPack.kpis.find(k => k.id === hoveredKpiId)?.label}
                      </div>
                      <div className="text-xs text-gray-300 leading-relaxed">
                        {getBusinessTooltip(hoveredKpiId)}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-500 italic text-center">
                      Hover over a KPI card to see its business description
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Narration */}
            {narration && (
              <div className="space-y-3 pt-2 border-t border-gray-700">
                {/* Headline */}
                <div className="text-lg font-semibold text-white leading-tight">
                  {narration.headline}
                </div>

                {/* Bullets with highlighted numbers */}
                <ul className="space-y-2">
                  {narration.bullets.map((bullet, idx) => (
                    <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-purple-400 mt-1">•</span>
                      <span>{highlightNumbers(bullet)}</span>
                    </li>
                  ))}
                </ul>

                {/* Why it matters */}
                {narration.whyItMatters && (
                  <div className="text-sm text-gray-400 italic border-l-2 border-purple-500 pl-3">
                    {narration.whyItMatters}
                  </div>
                )}

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
                        <span className="text-sm text-white">{action.label}</span>
                        <ChevronRight className="w-4 h-4 ml-auto text-purple-400" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Suggested Questions - Guided Storytelling */}
                {narration.suggestedQuestions && narration.suggestedQuestions.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs text-gray-500 uppercase tracking-wide">
                      Ask me about
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {narration.suggestedQuestions.map((question, idx) => (
                        <button
                          key={idx}
                          onClick={async () => {
                            if (isAskingQuestion) return;
                            setIsAskingQuestion(true);
                            await askQuestion(question);
                            setIsAskingQuestion(false);
                          }}
                          disabled={isAskingQuestion}
                          className="px-3 py-1.5 bg-gray-700 hover:bg-purple-900/50 border border-gray-600 hover:border-purple-500 rounded-full text-sm text-gray-300 hover:text-white transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <MessageSquare className="w-3 h-3 text-purple-400" />
                          <span>{question}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Confidence */}
                <div className="flex items-center gap-2 text-xs text-gray-500">
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
                  {narration._meta?.usedOpenAI && (
                    <span className="text-purple-400">• AI enhanced</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Question Input */}
      <div className="border-t border-gray-700 px-4 py-3 bg-gray-800">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={questionInput}
            onChange={(e) => setQuestionInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAskQuestion()}
            placeholder="Ask about these KPIs..."
            className="flex-1 bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-gray-500"
            disabled={isAskingQuestion}
          />
          <button
            onClick={handleAskQuestion}
            disabled={!questionInput.trim() || isAskingQuestion}
            className="p-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
          >
            {isAskingQuestion ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-700 px-4 py-2 bg-gray-800/50">
        <div className="text-xs text-gray-500 text-center flex items-center justify-center gap-2">
          <span>Copilot • AI-powered insights</span>
          {viewPack?.evidence?.sampleN && (
            <span className="text-gray-600">• {viewPack.evidence.sampleN.toLocaleString()} samples</span>
          )}
        </div>
      </div>

      {/* Venue KPI Thresholds Panel */}
      {venue && (
        <VenueKPIThresholdsPanel
          venueId={venue.id}
          venueName={venue.name}
          isOpen={showThresholdsPanel}
          onClose={() => setShowThresholdsPanel(false)}
        />
      )}
    </div>
  );
}
