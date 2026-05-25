import { TrendingUp, TrendingDown, Minus, Store, ShoppingBag, MonitorPlay, Users } from 'lucide-react'
import type { ZonePerformanceItem } from './ZonePerformanceViewport'
import type { CampaignPerformanceItem } from './PebleEffectivenessViewport'
import type { CategoryRankingRow } from './CategoryRankingPanel'
import ZonePerformanceViewport from './ZonePerformanceViewport'

export interface ExecutivePillar {
  id: string
  label: string
  metric: string
  value: number
  format: 'int' | 'percent' | 'minutes' | 'score'
  status: 'good' | 'warn' | 'bad' | 'neutral'
  deltaPct?: number | null
  detail?: string
}

export interface ExecutiveHighlights {
  topZone?: ZonePerformanceItem | null
  worstZone?: ZonePerformanceItem | null
  topCategory?: CategoryRankingRow | null
  topCampaign?: CampaignPerformanceItem | null
}

export interface PeriodDeltas {
  visitorsDeltaPct?: number | null
  visitsDeltaPct?: number | null
  engagementDeltaPct?: number | null
}

interface ExecutiveSummaryViewportProps {
  venueId: string
  pillars: ExecutivePillar[]
  highlights: ExecutiveHighlights
  periodDeltas?: PeriodDeltas
  deadZones: ZonePerformanceItem[]
  topZones: ZonePerformanceItem[]
  zoneUtilThresholdPct?: number
}

const PILLAR_ICON: Record<string, typeof Users> = {
  traffic: Users,
  operations: Store,
  merchandising: ShoppingBag,
  media: MonitorPlay,
}

const PILLAR_COLOR: Record<string, string> = {
  traffic: '#3b82f6',
  operations: '#22c55e',
  merchandising: '#f59e0b',
  media: '#8b5cf6',
}

const STATUS_BORDER: Record<string, string> = {
  good: 'border-green-500/40',
  warn: 'border-amber-500/40',
  bad: 'border-red-500/40',
  neutral: 'border-gray-600/60',
}

const STATUS_TEXT: Record<string, string> = {
  good: 'text-green-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  neutral: 'text-gray-300',
}

function formatPillarValue(value: number, format: ExecutivePillar['format']): string {
  switch (format) {
    case 'percent': return `${value.toFixed(1)}%`
    case 'minutes': return `${value.toFixed(1)}m`
    case 'score': return value.toFixed(1)
    case 'int': return Math.round(value).toLocaleString()
    default: return String(value)
  }
}

function DeltaBadge({ delta }: { delta?: number | null }) {
  if (delta == null) return null
  const Icon = delta >= 0 ? TrendingUp : TrendingDown
  const color = delta >= 0 ? 'text-green-400' : 'text-red-400'
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] ${color}`}>
      <Icon className="w-3 h-3" />
      {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

export default function ExecutiveSummaryViewport({
  venueId,
  pillars,
  highlights,
  periodDeltas,
  deadZones,
  topZones,
  zoneUtilThresholdPct = 5,
}: ExecutiveSummaryViewportProps) {
  const issueCount = deadZones.length

  return (
    <div className="space-y-3">
      <div className="bg-gray-900/80 rounded-lg border border-gray-700/80 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-700/60">
          <span className="text-xs font-medium text-gray-300">Store Health Overview</span>
          {periodDeltas?.visitorsDeltaPct != null && (
            <span className="text-[10px] text-gray-500">
              vs prior period · visitors <DeltaBadge delta={periodDeltas.visitorsDeltaPct} />
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 p-2">
          {pillars.map(pillar => {
            const Icon = PILLAR_ICON[pillar.id] || Minus
            const accent = PILLAR_COLOR[pillar.id] || '#6b7280'
            return (
              <div
                key={pillar.id}
                className={`rounded-lg border bg-gray-800/50 p-2.5 ${STATUS_BORDER[pillar.status]}`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                    {pillar.label}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 truncate mb-0.5">{pillar.metric}</div>
                <div className={`text-lg font-semibold tabular-nums leading-tight ${STATUS_TEXT[pillar.status]}`}>
                  {formatPillarValue(pillar.value, pillar.format)}
                </div>
                {pillar.detail && (
                  <p className="text-[10px] text-gray-500 mt-1 truncate">{pillar.detail}</p>
                )}
                {pillar.id === 'traffic' && periodDeltas?.visitorsDeltaPct != null && (
                  <div className="mt-1">
                    <DeltaBadge delta={periodDeltas.visitorsDeltaPct} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {highlights.topZone && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2">
            <div className="text-[10px] text-green-400/80 mb-0.5">Best zone</div>
            <div className="text-xs text-gray-200 truncate">{highlights.topZone.name}</div>
            <div className="text-[10px] text-gray-500">{highlights.topZone.utilization}% engagement</div>
          </div>
        )}
        {highlights.topCategory && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <div className="text-[10px] text-amber-400/80 mb-0.5">Top category</div>
            <div className="text-xs text-gray-200 truncate">{highlights.topCategory.category}</div>
            <div className="text-[10px] text-gray-500">{highlights.topCategory.engagementRate}% engagement</div>
          </div>
        )}
        {highlights.topCampaign && (
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 px-3 py-2">
            <div className="text-[10px] text-purple-400/80 mb-0.5">Top campaign</div>
            <div className="text-xs text-gray-200 truncate">{highlights.topCampaign.name}</div>
            <div className="text-[10px] text-gray-500">CES {highlights.topCampaign.ces} · EAL {highlights.topCampaign.eal}%</div>
          </div>
        )}
        {issueCount > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
            <div className="text-[10px] text-red-400/80 mb-0.5">Shelf issues</div>
            <div className="text-xs text-gray-200">{issueCount} underperforming zones</div>
            {highlights.worstZone && (
              <div className="text-[10px] text-gray-500 truncate">{highlights.worstZone.name}</div>
            )}
          </div>
        )}
      </div>

      {(deadZones.length > 0 || topZones.length > 0) && (
        <ZonePerformanceViewport
          venueId={venueId}
          deadZones={deadZones}
          topZones={topZones}
          zoneUtilThresholdPct={zoneUtilThresholdPct}
          initialTab="topPerformers"
        />
      )}
    </div>
  )
}
