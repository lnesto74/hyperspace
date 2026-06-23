import type { ProfitRadarInsight } from '../../types'
import { dispatchTask, fetchShelfProducts, type DispatchResult } from '../opsDispatch/api'
import { LEVER_BY_ID, legacyRoleForType } from './pulseDispatch'
import { weeklyRecovery } from './pulseUtils'

export interface DeployInsightInput {
  insight: ProfitRadarInsight
  venueId: string
}

export async function deployInsight({ insight, venueId }: DeployInsightInput): Promise<DispatchResult> {
  const roiId = (insight.dataBasis?.roiId as string | undefined) ?? null
  const econ = insight.economics
  const leverId = econ?.recommendedLeverId || 'layout'
  const lever = LEVER_BY_ID[leverId]
  const role = lever?.role || legacyRoleForType(insight.type)
  const weekEur = weeklyRecovery(insight)
  const products = role === 'merchandiser' && roiId ? await fetchShelfProducts(roiId) : []

  return dispatchTask({
    venueId,
    role,
    kind: role === 'cashier' ? 'checkout' : 'merchandising',
    title: insight.title,
    body: insight.suggestedFix,
    payload: {
      type: insight.type,
      zoneName: (insight.dataBasis?.zone as string) || insight.title,
      roiId,
      suggestedFix: insight.suggestedFix,
      impact: insight.impact,
      lever: lever ? { id: lever.id, label: lever.label } : undefined,
      projectedPerWeek: weekEur ?? undefined,
      products,
      insightId: insight.id,
    },
  })
}

export function insightDailyValue(insight: ProfitRadarInsight): number {
  const week = weeklyRecovery(insight)
  if (week != null && week > 0) return week / 7
  return insight.impact.max * insight.confidence
}
