import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, TrendingUp, Gauge, Layers, Pencil } from 'lucide-react'
import type { ProfitRadarInsight } from '../../../types'
import { recoveryForLever, conversionGap, LEVER_BY_ID, formatCurrency } from '../recoveryModel'

const LEVER_COLOR: Record<string, string> = {
  layout: '#34d399',
  pricing: '#60a5fa',
  wayfinding: '#fbbf24',
  crossmerch: '#c084fc',
  staffing: '#f87171',
}

const AI_COST_KEY = 'hyperspace.aiInvestmentAnnual'

interface MonetizationPanelProps {
  insights: ProfitRadarInsight[]
  onSelectInsight?: (insight: ProfitRadarInsight) => void
  selectedId?: string | null
}

/**
 * Store-wide monetization summary — the "is the AI paying for itself?" view for
 * CEO / CFO / CMO. Aggregates every insight's fingerprint-driven recovery
 * (recommended lever, expected effort) into:
 *   1. a KPI band (annual recoverable, ROI multiple, payback)
 *   2. a value bridge by action type
 *   3. a per-action ROI table grounded in real shelf SKUs
 */
export default function MonetizationPanel({ insights, onSelectInsight, selectedId }: MonetizationPanelProps) {
  const [open, setOpen] = useState(true)
  const [effortPct, setEffortPct] = useState(60)
  const [aiCost, setAiCost] = useState<number>(() => {
    const v = Number(localStorage.getItem(AI_COST_KEY))
    return Number.isFinite(v) && v > 0 ? v : 24000
  })
  const [editingCost, setEditingCost] = useState(false)
  const effort = effortPct / 100

  const currency = insights.find(i => i.economics)?.economics?.currency || '€'
  const cur = currency === 'EUR' ? '€' : currency

  const rows = useMemo(() => {
    return insights
      .filter(i => i.economics)
      .map(i => {
        const econ = i.economics!
        const r = recoveryForLever(econ, econ.recommendedLeverId, effort, 'expected')
        return {
          insight: i,
          econ,
          lever: LEVER_BY_ID[econ.recommendedLeverId],
          perWeek: r.perWeek,
          perYear: r.perYear,
          perDay: r.perDay,
        }
      })
      .sort((a, b) => b.perYear - a.perYear)
  }, [insights, effort])

  const totals = useMemo(() => {
    const perYear = rows.reduce((s, r) => s + r.perYear, 0)
    const perWeek = rows.reduce((s, r) => s + r.perWeek, 0)
    const byLever = new Map<string, number>()
    for (const r of rows) {
      byLever.set(r.econ.recommendedLeverId, (byLever.get(r.econ.recommendedLeverId) || 0) + r.perYear)
    }
    return { perYear, perWeek, byLever }
  }, [rows])

  const roi = aiCost > 0 ? totals.perYear / aiCost : 0
  const paybackMonths = totals.perYear > 0 ? (aiCost / (totals.perYear / 12)) : 0

  const saveCost = (v: number) => {
    const val = Math.max(0, Math.round(v))
    setAiCost(val)
    localStorage.setItem(AI_COST_KEY, String(val))
  }

  if (rows.length === 0) return null

  const maxLeverYear = Math.max(1, ...Array.from(totals.byLever.values()))

  return (
    <div className="flex-shrink-0 border-b border-gray-700 bg-gradient-to-b from-emerald-950/30 to-gray-900">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-white/5">
        <TrendingUp className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-white">Monetization — AI return</span>
        <div className="flex items-baseline gap-4 ml-2">
          <span className="text-emerald-400 font-bold text-base tabular-nums">{formatCurrency(cur, totals.perYear)}<span className="text-[10px] text-gray-500 font-normal ml-1">/yr recoverable</span></span>
          <span className="text-cyan-300 font-semibold text-sm tabular-nums hidden sm:inline">{roi.toFixed(1)}×<span className="text-[10px] text-gray-500 font-normal ml-1">ROI</span></span>
          <span className="text-amber-300 font-semibold text-sm tabular-nums hidden md:inline">{paybackMonths < 0.1 ? '<0.1' : paybackMonths.toFixed(1)}<span className="text-[10px] text-gray-500 font-normal ml-1">mo payback</span></span>
        </div>
        <span className="ml-auto">{open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}</span>
      </button>

      {open && (
        <div className="px-5 pb-4 space-y-4">
          {/* KPI band */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">Recoverable margin</div>
              <div className="text-xl font-bold text-emerald-400 tabular-nums">{formatCurrency(cur, totals.perYear)}<span className="text-[10px] text-gray-500 font-normal">/yr</span></div>
              <div className="text-[10px] text-gray-500">{formatCurrency(cur, totals.perWeek)}/wk across {rows.length} zones</div>
            </div>
            <div className="rounded-lg border border-cyan-700/40 bg-cyan-900/20 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-cyan-300/80">Return on AI</div>
              <div className="text-xl font-bold text-cyan-300 tabular-nums">{roi.toFixed(1)}×</div>
              <div className="text-[10px] text-gray-500">vs. platform cost</div>
            </div>
            <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-amber-300/80">Payback</div>
              <div className="text-xl font-bold text-amber-300 tabular-nums">{paybackMonths < 0.1 ? '<0.1' : paybackMonths.toFixed(1)} <span className="text-xs font-normal">mo</span></div>
              <div className="text-[10px] text-gray-500">time to break even</div>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wide text-gray-400">AI investment</div>
                <button onClick={() => setEditingCost(e => !e)} className="text-gray-500 hover:text-gray-300"><Pencil className="w-3 h-3" /></button>
              </div>
              {editingCost ? (
                <input
                  type="number"
                  autoFocus
                  defaultValue={aiCost}
                  onBlur={e => { saveCost(Number(e.target.value)); setEditingCost(false) }}
                  onKeyDown={e => { if (e.key === 'Enter') { saveCost(Number((e.target as HTMLInputElement).value)); setEditingCost(false) } }}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-sm text-white tabular-nums mt-0.5"
                />
              ) : (
                <div className="text-xl font-bold text-gray-200 tabular-nums">{formatCurrency(cur, aiCost)}<span className="text-[10px] text-gray-500 font-normal">/yr</span></div>
              )}
              <div className="text-[10px] text-gray-500">your assumption</div>
            </div>
          </div>

          {/* Global effort */}
          <div className="flex items-center gap-3">
            <Gauge className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-[11px] text-gray-400">Assumed execution effort</span>
            <input type="range" min={10} max={100} value={effortPct} onChange={e => setEffortPct(Number(e.target.value))} className="flex-1 max-w-xs accent-emerald-500" />
            <span className="text-[11px] text-emerald-300 font-medium tabular-nums w-9">{effortPct}%</span>
          </div>

          {/* Value bridge by lever */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-[11px] uppercase tracking-wide text-gray-400">Value bridge — by action type (€/yr)</span>
            </div>
            <div className="space-y-1.5">
              {Array.from(totals.byLever.entries()).sort((a, b) => b[1] - a[1]).map(([lid, val]) => {
                const lever = LEVER_BY_ID[lid]
                return (
                  <div key={lid} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 w-32 truncate" title={lever?.label}>{lever?.label || lid}</span>
                    <div className="flex-1 h-4 rounded bg-gray-800 overflow-hidden">
                      <div className="h-full rounded flex items-center justify-end pr-1.5" style={{ width: `${Math.max(6, (val / maxLeverYear) * 100)}%`, backgroundColor: LEVER_COLOR[lid] || '#34d399' }}>
                        <span className="text-[9px] font-semibold text-gray-900 tabular-nums">{formatCurrency(cur, val)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Per-action ROI table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-gray-500 text-left border-b border-gray-700/60">
                  <th className="py-1.5 pr-2 font-medium">Zone</th>
                  <th className="py-1.5 px-2 font-medium">Recommended action</th>
                  <th className="py-1.5 px-2 font-medium text-right">Shoppers/day</th>
                  <th className="py-1.5 px-2 font-medium text-right">Gap</th>
                  <th className="py-1.5 px-2 font-medium text-right">€/wk</th>
                  <th className="py-1.5 px-2 font-medium text-right">€/yr</th>
                  <th className="py-1.5 px-2 font-medium text-right">Conf.</th>
                  <th className="py-1.5 pl-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ insight, econ, lever, perWeek, perYear }) => {
                  const gap = conversionGap(econ)
                  const isSel = insight.id === selectedId
                  return (
                    <tr
                      key={insight.id}
                      onClick={() => onSelectInsight?.(insight)}
                      className={`border-b border-gray-800/60 cursor-pointer hover:bg-white/5 ${isSel ? 'bg-emerald-900/15' : ''}`}
                    >
                      <td className="py-1.5 pr-2 text-gray-200 max-w-[180px] truncate" title={insight.title}>{insight.title}</td>
                      <td className="py-1.5 px-2">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: LEVER_COLOR[econ.recommendedLeverId] || '#34d399' }} />
                          <span className="text-gray-300">{lever?.label || econ.recommendedLeverId}</span>
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-400 tabular-nums">{econ.exposedPerDay.toLocaleString()}</td>
                      <td className="py-1.5 px-2 text-right text-gray-400 tabular-nums">{Math.round(gap * 100)}pt</td>
                      <td className="py-1.5 px-2 text-right text-emerald-300 tabular-nums">{formatCurrency(cur, perWeek)}</td>
                      <td className="py-1.5 px-2 text-right text-emerald-400 font-semibold tabular-nums">{formatCurrency(cur, perYear)}</td>
                      <td className="py-1.5 px-2 text-right text-gray-500 tabular-nums">{Math.round(insight.confidence * 100)}%</td>
                      <td className="py-1.5 pl-2">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-700/60 text-gray-300">Projected</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-600">
            € is computed bottom-up per zone: shoppers/day × recoverable gap × {cur} margin/unit of the real SKUs on the shelf, with the action lever chosen by the behavioral fingerprint. Adjust effort and AI cost to match your assumptions.
          </p>
        </div>
      )}
    </div>
  )
}
