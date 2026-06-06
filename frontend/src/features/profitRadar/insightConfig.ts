import { AlertTriangle, TrendingDown, Users, LayoutDashboard } from 'lucide-react'
import type { IntentAxes, IntentAxisName, InsightType, ProfitRadarInsight } from '../../types'
import type { BenchmarkBarItem } from './components/BenchmarkBars'

export const TYPE_CONFIG: Record<InsightType, { icon: typeof AlertTriangle; color: string; bgColor: string; label: string; hex: string }> = {
  lost_sales: { icon: AlertTriangle, color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/30', label: 'Lost Sales', hex: '#f87171' },
  underperforming_zone: { icon: TrendingDown, color: 'text-amber-400', bgColor: 'bg-amber-500/10 border-amber-500/30', label: 'Underperforming Zone', hex: '#f59e0b' },
  staff_misallocation: { icon: Users, color: 'text-blue-400', bgColor: 'bg-blue-500/10 border-blue-500/30', label: 'Staff Misallocation', hex: '#60a5fa' },
  layout_friction: { icon: LayoutDashboard, color: 'text-purple-400', bgColor: 'bg-purple-500/10 border-purple-500/30', label: 'Layout Friction', hex: '#a78bfa' },
}

export const SEVERITY_BADGE: Record<string, string> = {
  high: 'bg-red-600 text-white',
  medium: 'bg-amber-600 text-white',
  low: 'bg-gray-600 text-gray-200',
}

export function buildBenchmarkBars(insight: ProfitRadarInsight, avg: IntentAxes | null): BenchmarkBarItem[] {
  const db = insight.dataBasis || {}
  const items: BenchmarkBarItem[] = []
  const push = (key: string, label: string, tone: BenchmarkBarItem['tone'], benchAxis: IntentAxisName) => {
    if (typeof db[key] === 'number') items.push({ label, value: db[key], tone, benchmark: avg?.[benchAxis] })
  }
  push('engagement', 'Engagement', 'neutral', 'engagement_with_POI')
  push('avoidance', 'Avoidance', 'bad', 'avoidance')
  push('hesitation', 'Hesitation', 'bad', 'hesitation')
  push('commitment', 'Commitment', 'neutral', 'commitment')
  push('queueScore', 'Queue / wait', 'bad', 'waiting_queueing')
  push('score', 'Friction', 'bad', 'friction')
  return items
}
