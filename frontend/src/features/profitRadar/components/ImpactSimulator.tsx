import { useState } from 'react'
import { TrendingUp, UserPlus, ClipboardList, Check } from 'lucide-react'
import type { ProfitRadarInsight } from '../../../types'

interface MetricModel {
  label: string
  current: number
  /** projected value at a given effort (0..1) */
  project: (effort: number) => number
  lowerIsBetter: boolean
}

function metricFor(insight: ProfitRadarInsight): MetricModel {
  const db = insight.dataBasis || {}
  switch (insight.type) {
    case 'lost_sales': {
      const current = Number(db.commitment ?? 0.2)
      return { label: 'Purchase commitment', current, project: e => Math.min(0.85, current + 0.3 * e), lowerIsBetter: false }
    }
    case 'staff_misallocation': {
      const current = Number(db.queueScore ?? 0.6)
      return { label: 'Queue / wait pressure', current, project: e => Math.max(0.05, current * (1 - 0.6 * e)), lowerIsBetter: true }
    }
    case 'layout_friction': {
      const current = Number(db.score ?? 0.5)
      return { label: 'Friction score', current, project: e => Math.max(0.05, current * (1 - 0.55 * e)), lowerIsBetter: true }
    }
    case 'underperforming_zone':
    default: {
      const current = Number(db.engagement ?? 0)
      return { label: 'Product engagement', current, project: e => Math.min(0.6, current + 0.28 * e), lowerIsBetter: false }
    }
  }
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, backgroundColor: color }} />
    </div>
  )
}

/**
 * Turns an insight into an action: projects the upside of applying the fix and
 * offers next-step actions. The € figure is anchored to the insight's own
 * estimated impact (scaled by chosen effort).
 */
export default function ImpactSimulator({ insight }: { insight: ProfitRadarInsight }) {
  const [effortPct, setEffortPct] = useState(60)
  const [done, setDone] = useState<Set<string>>(new Set())
  const effort = effortPct / 100

  const m = metricFor(insight)
  const projected = m.project(effort)
  const cur = insight.impact.currency === 'EUR' ? '€' : insight.impact.currency
  const recoveredPerDay = insight.impact.min + (insight.impact.max - insight.impact.min) * effort
  const recoveredPerWeek = recoveredPerDay * 7

  const delta = m.lowerIsBetter ? m.current - projected : projected - m.current
  const deltaPct = (delta * 100).toFixed(0)

  const act = (id: string) => setDone(prev => new Set(prev).add(id))

  return (
    <div className="rounded-lg border border-emerald-700/40 bg-emerald-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-emerald-700/30">
        <TrendingUp className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-medium text-white">Impact Simulator</span>
        <span className="ml-auto text-[10px] text-emerald-300/80">projected — apply the fix</span>
      </div>

      <div className="p-4 space-y-4">
        {/* effort */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-gray-400">Merchandising effort</span>
            <span className="text-emerald-300 font-medium tabular-nums">{effortPct}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={effortPct}
            onChange={e => setEffortPct(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </div>

        {/* metric before -> after */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-400">{m.label}</span>
            <span className="tabular-nums">
              <span className="text-gray-500">{(m.current * 100).toFixed(0)}%</span>
              <span className="text-gray-600 mx-1">→</span>
              <span className="text-emerald-300 font-semibold">{(projected * 100).toFixed(0)}%</span>
              <span className="text-emerald-400/80 ml-1">({m.lowerIsBetter ? '−' : '+'}{Math.abs(Number(deltaPct))}pt)</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniBar value={m.current} color="#6b7280" />
            <MiniBar value={projected} color="#34d399" />
          </div>
        </div>

        {/* € recovered */}
        <div className="rounded-md bg-gray-900/60 border border-gray-700/60 px-3 py-2.5">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">Projected recovery</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-emerald-400 tabular-nums">+{cur}{Math.round(recoveredPerWeek).toLocaleString()}</span>
            <span className="text-xs text-gray-500">/ week</span>
          </div>
          <div className="text-[10px] text-gray-500">≈ {cur}{Math.round(recoveredPerDay).toLocaleString()} / day at {effortPct}% effort</div>
        </div>

        {/* actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => act('assign')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              done.has('assign')
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {done.has('assign') ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
            {done.has('assign') ? 'Assigned' : 'Assign to merchandiser'}
          </button>
          <button
            onClick={() => act('plan')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              done.has('plan')
                ? 'bg-gray-700 text-emerald-300 border border-emerald-500/30'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`}
          >
            {done.has('plan') ? <Check className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
            {done.has('plan') ? 'Added to plan' : 'Add to action plan'}
          </button>
        </div>
      </div>
    </div>
  )
}
