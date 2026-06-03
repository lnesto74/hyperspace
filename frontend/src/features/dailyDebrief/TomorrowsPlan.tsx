import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Check, UserPlus, ClipboardList, ArrowUpRight, ListChecks } from 'lucide-react'
import type { ProfitRadarInsight } from '../../types'
import type { NarrationPack } from '../../context/ReplayInsightContext'

interface PlanRow {
  key: string
  rank: number
  severity: string
  typeLabel: string
  title: string
  fix: string
  weekly: number | null
  currency: string
  insightId?: string
}

interface TomorrowsPlanProps {
  insights: ProfitRadarInsight[]
  episodes: NarrationPack[]
  onOpenInsight?: (insight: ProfitRadarInsight) => void
}

const TYPE_LABEL: Record<string, string> = {
  lost_sales: 'Lost Sales',
  underperforming_zone: 'Underperforming Zone',
  staff_misallocation: 'Staffing',
  layout_friction: 'Layout Friction',
}

const SEVERITY_DOT: Record<string, string> = {
  high: '#f87171',
  medium: '#fbbf24',
  low: '#60a5fa',
}

export default function TomorrowsPlan({ insights, episodes, onOpenInsight }: TomorrowsPlanProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, Set<string>>>({})

  const { rows, totalWeekly, currency } = useMemo(() => {
    const cur = insights[0]?.impact.currency === 'EUR' ? '€' : insights[0]?.impact.currency || '€'
    const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
    const built: PlanRow[] = insights
      .map(i => ({
        key: i.id,
        rank: 0,
        severity: i.severity,
        typeLabel: TYPE_LABEL[i.type] || 'Insight',
        title: i.title,
        fix: i.suggestedFix,
        weekly: ((i.impact.min + i.impact.max) / 2) * 7,
        currency: cur,
        insightId: i.id,
      }))
      .sort((a, b) => (b.weekly ?? 0) - (a.weekly ?? 0))

    // Fallback: derive from the day's episodes when no € insights exist.
    if (built.length === 0) {
      const epRows: PlanRow[] = [...episodes]
        .sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3) || b.score - a.score)
        .slice(0, 6)
        .map(e => ({
          key: e.episode_id,
          rank: 0,
          severity: e.severity,
          typeLabel: e.category,
          title: e.title,
          fix: e.recommended_actions?.[0] || e.business_summary,
          weekly: null,
          currency: cur,
        }))
      epRows.forEach((r, idx) => (r.rank = idx + 1))
      return { rows: epRows, totalWeekly: 0, currency: cur }
    }

    built.forEach((r, idx) => (r.rank = idx + 1))
    const total = built.reduce((s, r) => s + (r.weekly ?? 0), 0)
    return { rows: built, totalWeekly: total, currency: cur }
  }, [insights, episodes])

  const insightById = useMemo(() => new Map(insights.map(i => [i.id, i])), [insights])

  const act = (rowKey: string, actionId: string) => {
    setDone(prev => {
      const next = { ...prev }
      const set = new Set(next[rowKey] ?? [])
      set.add(actionId)
      next[rowKey] = set
      return next
    })
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/60 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-gray-700/60">
        <div className="flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-base font-semibold text-white">Tomorrow's Plan</h3>
            <p className="text-xs text-gray-500">The day's findings, ranked by € impact — ready to assign</p>
          </div>
        </div>
        {totalWeekly > 0 && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">Total recoverable</div>
            <div className="text-xl font-bold text-emerald-400 tabular-nums">+{currency}{Math.round(totalWeekly).toLocaleString()}<span className="text-xs text-gray-500 font-normal ml-1">/ wk</span></div>
          </div>
        )}
      </div>

      <div className="divide-y divide-gray-800">
        {rows.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-gray-500">No actionable findings for today yet.</div>
        )}
        {rows.map(row => {
          const isOpen = expanded === row.key
          const rowDone = done[row.key] ?? new Set<string>()
          return (
            <div key={row.key}>
              <button
                onClick={() => setExpanded(isOpen ? null : row.key)}
                className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-800/40 transition-colors"
              >
                <span className="shrink-0 w-6 h-6 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">{row.rank}</span>
                <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: SEVERITY_DOT[row.severity] }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{row.title}</div>
                  <div className="text-[11px] text-gray-500 truncate">{row.typeLabel} · {row.fix}</div>
                </div>
                {row.weekly != null && (
                  <span className="shrink-0 text-sm font-semibold text-emerald-400 tabular-nums">+{row.currency}{Math.round(row.weekly).toLocaleString()}/wk</span>
                )}
                {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
              </button>

              {isOpen && (
                <div className="px-5 pb-4 pl-14">
                  <p className="text-xs text-gray-300 leading-relaxed mb-3">{row.fix}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => act(row.key, 'assign')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        rowDone.has('assign') ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      }`}
                    >
                      {rowDone.has('assign') ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                      {rowDone.has('assign') ? 'Assigned' : 'Assign'}
                    </button>
                    <button
                      onClick={() => act(row.key, 'plan')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        rowDone.has('plan') ? 'bg-gray-700 text-emerald-300 border border-emerald-500/30' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                      }`}
                    >
                      {rowDone.has('plan') ? <Check className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
                      {rowDone.has('plan') ? 'Added to plan' : 'Add to plan'}
                    </button>
                    {row.insightId && onOpenInsight && (
                      <button
                        onClick={() => { const i = insightById.get(row.insightId!); if (i) onOpenInsight(i) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-200"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" /> Open in Profit Radar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
