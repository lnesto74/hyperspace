import { useState } from 'react'
import { AlertTriangle, TrendingDown, Users, LayoutDashboard, ChevronDown, ChevronUp, Eye, Lightbulb, Wrench, BarChart3 } from 'lucide-react'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import type { ProfitRadarInsight, InsightType } from '../../types'

const TYPE_CONFIG: Record<InsightType, { icon: typeof AlertTriangle; color: string; bgColor: string; label: string }> = {
  lost_sales: { icon: AlertTriangle, color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/30', label: 'Lost Sales' },
  underperforming_zone: { icon: TrendingDown, color: 'text-amber-400', bgColor: 'bg-amber-500/10 border-amber-500/30', label: 'Underperforming Zone' },
  staff_misallocation: { icon: Users, color: 'text-blue-400', bgColor: 'bg-blue-500/10 border-blue-500/30', label: 'Staff Misallocation' },
  layout_friction: { icon: LayoutDashboard, color: 'text-purple-400', bgColor: 'bg-purple-500/10 border-purple-500/30', label: 'Layout Friction' },
}

const SEVERITY_BADGE: Record<string, string> = {
  high: 'bg-red-600 text-white',
  medium: 'bg-amber-600 text-white',
  low: 'bg-gray-600 text-gray-200',
}

function InsightCard({ insight, isSelected, onSelect }: { insight: ProfitRadarInsight; isSelected: boolean; onSelect: () => void }) {
  const config = TYPE_CONFIG[insight.type] || TYPE_CONFIG.lost_sales
  const Icon = config.icon

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-4 transition-all ${
        isSelected ? 'ring-2 ring-highlight ' + config.bgColor : 'bg-gray-800/50 border-gray-700 hover:border-gray-500'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${config.color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_BADGE[insight.severity]}`}>
              {insight.severity}
            </span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">{config.label}</span>
          </div>
          <h3 className="text-sm font-medium text-white truncate">{insight.title}</h3>
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">{insight.summary}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] text-gray-500">
              Confidence: {(insight.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-green-400 font-medium">
              {insight.impact.currency}{insight.impact.min}–{insight.impact.max}/day
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

function DetailPanel({ insight }: { insight: ProfitRadarInsight }) {
  const [showWhy, setShowWhy] = useState(true)
  const [showFix, setShowFix] = useState(true)
  const [showData, setShowData] = useState(false)

  return (
    <div className="space-y-3">
      {/* Why Panel */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
        <button onClick={() => setShowWhy(!showWhy)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-700/30">
          <Eye className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-white flex-1">Why is this happening?</span>
          {showWhy ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showWhy && (
          <div className="px-4 pb-3 text-xs text-gray-300 leading-relaxed border-t border-gray-700/50 pt-3">
            {insight.why}
          </div>
        )}
      </div>

      {/* Suggested Fix Panel */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
        <button onClick={() => setShowFix(!showFix)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-700/30">
          <Wrench className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-white flex-1">Suggested Fix</span>
          {showFix ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showFix && (
          <div className="px-4 pb-3 text-xs text-gray-300 leading-relaxed border-t border-gray-700/50 pt-3">
            {insight.suggestedFix}
          </div>
        )}
      </div>

      {/* Data Basis Panel */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
        <button onClick={() => setShowData(!showData)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-700/30">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-medium text-white flex-1">Data Basis</span>
          {showData ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showData && (
          <div className="px-4 pb-3 border-t border-gray-700/50 pt-3">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(insight.dataBasis).map(([key, value]) => (
                <div key={key} className="text-xs">
                  <span className="text-gray-500">{key}: </span>
                  <span className="text-gray-300">{typeof value === 'number' ? value.toFixed(2) : Array.isArray(value) ? value.join(', ') : String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Impact */}
      <div className="rounded-lg border border-green-800/50 bg-green-900/20 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-green-300">Estimated Impact</span>
        </div>
        <p className="text-lg font-bold text-green-400">
          {insight.impact.currency}{insight.impact.min} – {insight.impact.currency}{insight.impact.max}
          <span className="text-xs text-green-500 font-normal ml-1">per day</span>
        </p>
      </div>
    </div>
  )
}

interface ProfitRadarPageProps {
  onClose: () => void
}

export default function ProfitRadarPage({ onClose }: ProfitRadarPageProps) {
  const { insights, zoneField, clusters, selectedInsight, setSelectedInsight } = useProfitRadar()

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-gray-700 flex items-center justify-between px-4 bg-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">← Back to Main</button>
          <div className="w-px h-5 bg-gray-700" />
          <h1 className="text-white font-medium text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Profit Radar
          </h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>{insights.length} active insights</span>
          <span>•</span>
          <span>{zoneField.length} zones</span>
          <span>•</span>
          <span>{clusters.length} clusters</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Insight List */}
        <div className="w-[400px] border-r border-gray-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
            <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Active Insights</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {insights.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <BarChart3 className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">Waiting for data…</p>
                <p className="text-xs mt-1">Insights appear as shoppers move through zones</p>
              </div>
            ) : (
              insights.map(insight => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  isSelected={selectedInsight?.id === insight.id}
                  onSelect={() => setSelectedInsight(selectedInsight?.id === insight.id ? null : insight)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 overflow-y-auto">
          {selectedInsight ? (
            <div className="max-w-2xl mx-auto p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">{selectedInsight.title}</h2>
                <p className="text-sm text-gray-400">{selectedInsight.summary}</p>
              </div>
              <DetailPanel insight={selectedInsight} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Lightbulb className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">Select an insight to see details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
