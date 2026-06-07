/**
 * recoveryModel (frontend) — live, interactive twin of the backend model
 * (backend/services/profit-radar/recoveryModel.js). The backend attaches the
 * grounded inputs (exposed/day, gap, winnable, real €/unit margin, fingerprint
 * axes) on insight.economics; this recomputes € as the user drags the effort
 * slider or switches the lever, with no round-trip.
 *
 * Keep the lever table and formula in sync with the backend.
 */
import type { InsightEconomics } from '../../types'

export const CAPTURE_CEILING = 0.6
const MATCH_FLOOR = 0.15

export interface Lever {
  id: string
  label: string
  role: 'merchandiser' | 'cashier'
  targetAxis: string
  base: number
  blurb: string
}

export const LEVERS: Lever[] = [
  { id: 'layout', label: 'Reposition / speed-bump', role: 'merchandiser', targetAxis: 'avoidance', base: 0.35, blurb: 'Interrupt the flow so shoppers stop' },
  { id: 'pricing', label: 'Price / retail-media promo', role: 'merchandiser', targetAxis: '__low_commitment', base: 0.32, blurb: 'Convert shoppers who look but don\u2019t buy' },
  { id: 'wayfinding', label: 'Signage / wayfinding', role: 'merchandiser', targetAxis: 'confusion', base: 0.30, blurb: 'Help shoppers find & decide' },
  { id: 'crossmerch', label: 'Cross-merch / bundle', role: 'merchandiser', targetAxis: 'hesitation', base: 0.30, blurb: 'Bundle to push hesitating shoppers over the line' },
  { id: 'staffing', label: 'Extra lane / staff', role: 'cashier', targetAxis: 'waiting_queueing', base: 0.40, blurb: 'Recover abandoned baskets at the queue' },
]

export const LEVER_BY_ID: Record<string, Lever> = Object.fromEntries(LEVERS.map(l => [l.id, l]))

const MODE_FACTOR: Record<string, number> = { conservative: 0.6, expected: 1.0, aggressive: 1.4 }

function clamp01(v: number): number { return Math.max(0, Math.min(1, Number(v) || 0)) }

export function leverMatch(lever: Lever, axes: Record<string, number>, engagement: number, commitment: number | null): number {
  const a = axes || {}
  if (lever.targetAxis === '__low_commitment') {
    const eng = engagement != null ? engagement : (a.engagement_with_POI || 0)
    const com = commitment != null ? commitment : (a.commitment || 0)
    return clamp01(eng * (1 - com) * 2)
  }
  return clamp01(a[lever.targetAxis])
}

export interface LeverResult {
  leverId: string
  label: string
  role: 'merchandiser' | 'cashier'
  match: number
  capture: number
  perDay: number
  perWeek: number
  perYear: number
}

/** € recovery for one lever at a given effort (0..1) and risk mode. */
export function recoveryForLever(
  econ: InsightEconomics,
  leverId: string,
  effort: number,
  mode: 'conservative' | 'expected' | 'aggressive' = 'expected',
): LeverResult {
  const lever = LEVER_BY_ID[leverId] || LEVER_BY_ID.layout
  const e = clamp01(effort)
  const modeF = MODE_FACTOR[mode] || 1
  const match = leverMatch(lever, econ.axes, econ.engagement, econ.commitment)
  const conv = econ.conversionRate != null
    ? econ.conversionRate
    : (econ.commitment != null ? econ.commitment : econ.engagement * 0.6)
  const gap = Math.max(0, econ.benchmark - conv)

  const capture = Math.min(CAPTURE_CEILING, lever.base * modeF * e * (MATCH_FLOOR + (1 - MATCH_FLOOR) * match))
  const newConverters = econ.exposedPerDay * gap * capture * econ.winnable
  const perDay = newConverters * econ.baseAttachRate * econ.marginPerUnit

  return {
    leverId: lever.id,
    label: lever.label,
    role: lever.role,
    match: +match.toFixed(2),
    capture: +capture.toFixed(3),
    perDay: Math.round(perDay),
    perWeek: Math.round(perDay * econ.tradingDaysPerWeek),
    perYear: Math.round(perDay * econ.tradingDaysPerWeek * 52),
  }
}

/** Levers applicable to this insight (queue → staffing only). */
export function applicableLevers(econ: InsightEconomics): Lever[] {
  if (econ.isQueue) return [LEVER_BY_ID.staffing]
  return LEVERS.filter(l => l.id !== 'staffing')
}

/** Recoverable conversion gap (benchmark − today's buyers) as a 0..1 fraction. */
export function conversionGap(econ: InsightEconomics): number {
  const conv = econ.conversionRate != null
    ? econ.conversionRate
    : (econ.commitment != null ? econ.commitment : econ.engagement * 0.6)
  return Math.max(0, econ.benchmark - conv)
}

export function formatCurrency(currency: string, value: number): string {
  const sym = currency === 'EUR' ? '€' : currency
  return `${sym}${Math.round(value).toLocaleString()}`
}
