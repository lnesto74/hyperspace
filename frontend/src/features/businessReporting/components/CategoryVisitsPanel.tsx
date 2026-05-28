import { useMemo, useState } from 'react'
import { Map, ChevronRight } from 'lucide-react'
import { getCategoryVisual } from '../operationsConsole/categoryVisuals'
import type { CategoryRankingRow } from './CategoryRankingPanel'

export type { CategoryRankingRow } from './CategoryRankingPanel'

type MetricMode = 'visits' | 'dwell'

interface CategoryVisitsPanelProps {
  categories: CategoryRankingRow[]
  onOpenHeatmap?: (row: CategoryRankingRow) => void
  compact?: boolean
  embedded?: boolean
  metric?: MetricMode
  onMetricChange?: (metric: MetricMode) => void
  highlightCategory?: string | null
  hoveredCategory?: string | null
  lockedCategory?: string | null
  onHoverCategory?: (category: string | null) => void
  onSelectCategory?: (row: CategoryRankingRow) => void
}

function formatDwell(min: number): string {
  if (min >= 60) return `${(min / 60).toFixed(1)}h`
  return `${Math.round(min)}m`
}

export default function CategoryVisitsPanel({
  categories,
  onOpenHeatmap,
  compact = false,
  embedded = false,
  metric: metricProp,
  onMetricChange,
  highlightCategory = null,
  hoveredCategory = null,
  lockedCategory = null,
  onHoverCategory,
  onSelectCategory,
}: CategoryVisitsPanelProps) {
  const [internalMetric, setInternalMetric] = useState<MetricMode>('visits')
  const [internalHovered, setInternalHovered] = useState<string | null>(null)

  const metric = metricProp ?? internalMetric
  const setMetric = onMetricChange ?? setInternalMetric
  const activeHover = onHoverCategory ? hoveredCategory : internalHovered

  const sorted = useMemo(() => {
    const rows = [...categories].filter(c => c.totalVisits > 0 || (c.totalDwellMin ?? 0) > 0)
    return rows.sort((a, b) => {
      if (metric === 'dwell') {
        return (b.totalDwellMin ?? 0) - (a.totalDwellMin ?? 0) || b.totalVisits - a.totalVisits
      }
      return b.totalVisits - a.totalVisits || (b.totalDwellMin ?? 0) - (a.totalDwellMin ?? 0)
    })
  }, [categories, metric])

  const maxVisits = Math.max(...sorted.map(c => c.totalVisits), 1)
  const maxDwell = Math.max(...sorted.map(c => c.totalDwellMin ?? 0), 1)

  const totalVisitsAll = sorted.reduce((s, c) => s + c.totalVisits, 0)
  const uncategorized = sorted.find(c => c.category === 'Uncategorized')
  const uncategorizedPct = totalVisitsAll > 0 && uncategorized
    ? Math.round((uncategorized.totalVisits / totalVisitsAll) * 100)
    : 0
  const showUncategorizedWarning = uncategorizedPct >= 40

  if (!sorted.length) {
    return (
      <div className="text-sm text-gray-500 py-4">
        No category traffic yet. Map shelf categories in DWG import or Smart KPI.
      </div>
    )
  }

  const displayRows = compact ? sorted.slice(0, 8) : sorted

  const handleMouseEnter = (category: string) => {
    if (onHoverCategory) onHoverCategory(category)
    else setInternalHovered(category)
  }

  const handleMouseLeave = () => {
    if (onHoverCategory) onHoverCategory(null)
    else setInternalHovered(null)
  }

  return (
    <div className="space-y-3">
      {showUncategorizedWarning && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-200/90 leading-relaxed">
          <b>{uncategorizedPct}%</b> of shelf visits are Uncategorized ({uncategorized?.zoneCount ?? 0} zones lack
          category mapping). Map shelves in DWG import or Smart KPI to split traffic by Latticini, Frutta, Surgelati, etc.
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-gray-500">
          {embedded
            ? 'Hover to preview on map · click to lock'
            : 'Visits and dwell by product category · click a row to open zone heatmap'}
        </p>
        <div className="flex bg-gray-900/80 rounded-md p-0.5 border border-gray-700/60 shrink-0">
          <button
            type="button"
            onClick={() => setMetric('visits')}
            className={`px-2 py-0.5 text-[10px] rounded ${metric === 'visits' ? 'bg-white/10 text-white' : 'text-gray-500'}`}
          >
            Visits
          </button>
          <button
            type="button"
            onClick={() => setMetric('dwell')}
            className={`px-2 py-0.5 text-[10px] rounded ${metric === 'dwell' ? 'bg-white/10 text-white' : 'text-gray-500'}`}
          >
            Dwell
          </button>
        </div>
      </div>

      <div className="space-y-1">
        {displayRows.map(row => {
          const visitW = Math.max(Math.round((row.totalVisits / maxVisits) * 100), row.totalVisits > 0 ? 4 : 0)
          const dwellW = Math.max(Math.round(((row.totalDwellMin ?? 0) / maxDwell) * 100), (row.totalDwellMin ?? 0) > 0 ? 4 : 0)
          const isHovered = activeHover === row.category
          const isLocked = lockedCategory === row.category
          const isActive = isLocked || isHovered
          const canOpen = (onOpenHeatmap || onSelectCategory) && (row.roiIds?.length ?? 0) > 0
          const { Icon, color } = getCategoryVisual(row.category)

          return (
            <button
              key={row.category}
              type="button"
              disabled={!canOpen}
              onClick={() => {
                if (onSelectCategory) onSelectCategory(row)
                else if (onOpenHeatmap) onOpenHeatmap(row)
              }}
              onMouseEnter={() => handleMouseEnter(row.category)}
              onMouseLeave={handleMouseLeave}
              className={`w-full text-left rounded-md px-2 py-2 transition-colors border ${
                isLocked
                  ? 'border-white/30 bg-white/5'
                  : isHovered
                    ? 'border-transparent bg-gray-800/50'
                    : 'border-transparent hover:bg-gray-800/40'
              } ${canOpen ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs text-white truncate inline-flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} strokeWidth={2.25} />
                  {row.category}
                  {isLocked && (
                    <span className="text-[8px] uppercase tracking-wide text-gray-500 font-normal">locked</span>
                  )}
                </span>
                <div className="flex items-center gap-3 shrink-0 text-[10px] tabular-nums">
                  <span className="text-white">{row.totalVisits.toLocaleString()} visits</span>
                  <span className="text-gray-400">{formatDwell(row.totalDwellMin ?? 0)} dwell</span>
                  {canOpen && isActive && !embedded && (
                    <span className="text-gray-400 flex items-center gap-0.5">
                      <Map className="w-3 h-3" /> heatmap <ChevronRight className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>
              <div className="relative h-2 rounded-sm bg-gray-900/80 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm opacity-30"
                  style={{ width: `${dwellW}%`, backgroundColor: color }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-sm transition-all"
                  style={{
                    width: `${metric === 'visits' ? visitW : dwellW}%`,
                    backgroundColor: color,
                    opacity: isActive ? 0.85 : 0.55,
                  }}
                />
              </div>
              <div className="flex justify-between mt-0.5 text-[9px] text-gray-600">
                <span>{row.zoneCount} zone{row.zoneCount !== 1 ? 's' : ''}</span>
                <span>{row.avgBrowseTimeMin.toFixed(1)}m avg browse · {row.engagementRate}% engage</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
