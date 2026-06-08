import type { ProfitRadarInsight, ZoneFieldEntry } from '../../types'
import { TYPE_CONFIG } from '../profitRadar/insightConfig'
import { recoveryForLever } from '../profitRadar/recoveryModel'

export function rankInsights(insights: ProfitRadarInsight[]): ProfitRadarInsight[] {
  return [...insights].sort((a, b) => {
    const scoreA = a.impact.max * a.confidence
    const scoreB = b.impact.max * a.confidence
    return scoreB - scoreA
  })
}

export function insightRoiId(insight: ProfitRadarInsight): string | null {
  return (insight.dataBasis?.roiId as string | undefined) ?? null
}

export function latentDailyTotal(insights: ProfitRadarInsight[]): number {
  return insights.reduce((sum, i) => sum + i.impact.max * i.confidence, 0)
}

export function valueScore(insight: ProfitRadarInsight): number {
  return Math.min(1, (insight.impact.max * insight.confidence) / 120)
}

export function valueByRoi(insights: ProfitRadarInsight[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const ins of insights) {
    const id = insightRoiId(ins)
    if (!id) continue
    out[id] = Math.max(out[id] ?? 0, valueScore(ins))
  }
  return out
}

export function patternLabel(insight: ProfitRadarInsight): string {
  const lever = insight.economics?.recommendedLeverLabel
  if (lever) return lever
  return TYPE_CONFIG[insight.type]?.label || insight.type
}

export function shortTitle(title: string, max = 36): string {
  const dash = title.indexOf(' — ')
  const base = dash > 0 ? title.slice(0, dash).trim() : title
  return base.length > max ? `${base.slice(0, max - 1)}…` : base
}

export function weeklyRecovery(insight: ProfitRadarInsight): number | null {
  const econ = insight.economics
  if (!econ) return null
  const leverId = econ.recommendedLeverId || 'layout'
  return recoveryForLever(econ, leverId, 0.6, 'expected').perWeek
}

export function fingerprintBars(
  insight: ProfitRadarInsight,
  zoneField: ZoneFieldEntry | null,
): { key: string; label: string; value: number }[] {
  const db = insight.dataBasis || {}
  const means = zoneField?.means
  const pick = (key: string, label: string, altKey?: string) => ({
    key,
    label,
    value: Math.max(0, Math.min(1, Number(
      db[key] ?? (altKey ? db[altKey] : undefined) ?? means?.[key as keyof typeof means] ?? 0,
    ))),
  })
  return [
    pick('avoidance', 'avoid'),
    pick('engagement', 'engage'),
    pick('hesitation', 'hesitate'),
    pick('commitment', 'commit'),
    pick('waiting_queueing', 'queue', 'queueScore'),
  ]
}

export function dominantSignal(insight: ProfitRadarInsight, zoneField: ZoneFieldEntry | null): string {
  if (zoneField?.dominant) {
    return zoneField.dominant.replace(/_/g, ' ')
  }
  const db = insight.dataBasis || {}
  const entries = Object.entries(db).filter(([k, v]) => typeof v === 'number' && !['trackCount', 'score'].includes(k))
  if (entries.length === 0) return patternLabel(insight).toLowerCase()
  entries.sort((a, b) => (b[1] as number) - (a[1] as number))
  return String(entries[0][0]).replace(/_/g, ' ')
}
