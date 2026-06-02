import type { PerceptionLayer, ReconcilerConfigMetrics } from './types'

export const RECONCILER_CONFIG_OPTIONS = [
  { id: 'GROCERY_V2_MAP', label: 'Grocery — Map-aware v2', recommended: true },
  { id: 'GROCERY_BALANCED', label: 'Grocery — Balanced' },
  { id: 'GROCERY_AGGRESSIVE', label: 'Grocery — Aggressive' },
  { id: 'GROCERY_CONSERVATIVE', label: 'Grocery — Conservative' },
  { id: 'RAJ_v1_BALANCED', label: 'Raj v1 — Balanced' },
  { id: 'RAJ_v1_CONSERVATIVE', label: 'Raj v1 — Conservative' },
  { id: 'BASELINE_DEFAULT', label: 'Baseline default' },
  { id: 'BYPASS_RAW', label: 'Bypass (re-stream raw)' },
] as const

export type ReconcilerConfigId = typeof RECONCILER_CONFIG_OPTIONS[number]['id']

export type CompareDirection = 'lower_better' | 'higher_better' | 'neutral'

export interface RawVsReconciledRow {
  id: string
  label: string
  unit: string
  raw: number | null
  reconciled: number | null
  delta: number | null
  deltaPct: number | null
  direction: CompareDirection
  highlight?: boolean
  note?: string
}

function num(v: number | undefined | null): number | null {
  if (v == null || Number.isNaN(v)) return null
  return v
}

function delta(raw: number | null, rec: number | null): number | null {
  if (raw == null || rec == null) return null
  return rec - raw
}

function deltaPct(raw: number | null, rec: number | null): number | null {
  if (raw == null || rec == null || raw === 0) return null
  return ((rec - raw) / Math.abs(raw)) * 100
}

export function buildRawVsReconciledRows(
  perception: PerceptionLayer | null | undefined,
  reconciled: ReconcilerConfigMetrics | null | undefined,
): RawVsReconciledRow[] {
  const rawIds = num(perception?.unique_perception_ids)
  const stable = num(reconciled?.stable_tracks)
  const rawFrag = num(perception?.fragmentation_factor)
  const recFrag = num(reconciled?.fragmentation_x)

  return [
    {
      id: 'identity_count',
      label: 'Track identities',
      unit: 'count',
      raw: rawIds,
      reconciled: stable,
      delta: delta(rawIds, stable),
      deltaPct: deltaPct(rawIds, stable),
      direction: 'lower_better',
      highlight: true,
      note: 'Raw = perception IDs churned by LiDAR. Reconciled = stable shopper tracks after merge/re-ID.',
    },
    {
      id: 'fragmentation',
      label: 'Fragmentation factor',
      unit: '×',
      raw: rawFrag,
      reconciled: recFrag,
      delta: delta(rawFrag, recFrag),
      deltaPct: deltaPct(rawFrag, recFrag),
      direction: 'lower_better',
      highlight: true,
      note: 'IDs per estimated real shopper — lower is cleaner identity continuity.',
    },
    {
      id: 'fragments_per_shopper',
      label: 'Fragments per real shopper',
      unit: '×',
      raw: num(perception?.fragments_per_shopper),
      reconciled: num(reconciled?.fragments_per_shopper),
      delta: delta(num(perception?.fragments_per_shopper), num(reconciled?.fragments_per_shopper)),
      deltaPct: deltaPct(num(perception?.fragments_per_shopper), num(reconciled?.fragments_per_shopper)),
      direction: 'lower_better',
      highlight: true,
      note: 'HONEST comparison: tracks ÷ people counted at the entrance gate. Same denominator on both sides — target < 20. (Raw and Reconciled use the identical footfall number.)',
    },
    {
      id: 'lifetime',
      label: 'Mean track lifetime',
      unit: 's',
      raw: num(perception?.mean_lifetime_s),
      reconciled: num(reconciled?.mean_lifetime_s),
      delta: delta(num(perception?.mean_lifetime_s), num(reconciled?.mean_lifetime_s)),
      deltaPct: deltaPct(num(perception?.mean_lifetime_s), num(reconciled?.mean_lifetime_s)),
      direction: 'higher_better',
      highlight: true,
    },
    {
      id: 'displacement',
      label: 'Mean path length',
      unit: 'm',
      raw: num(perception?.mean_displacement_m),
      reconciled: num(reconciled?.mean_displacement_m),
      delta: delta(num(perception?.mean_displacement_m), num(reconciled?.mean_displacement_m)),
      deltaPct: deltaPct(num(perception?.mean_displacement_m), num(reconciled?.mean_displacement_m)),
      direction: 'higher_better',
    },
    {
      id: 'teleports',
      label: 'Teleports per 1k msgs',
      unit: '/1k',
      raw: num(perception?.teleports_per_1k),
      reconciled: num(reconciled?.teleports_per_1k),
      delta: delta(num(perception?.teleports_per_1k), num(reconciled?.teleports_per_1k)),
      deltaPct: deltaPct(num(perception?.teleports_per_1k), num(reconciled?.teleports_per_1k)),
      direction: 'lower_better',
      highlight: true,
    },
    {
      id: 'shopper_grade',
      label: 'Shopper-grade tracks (≥30 m)',
      unit: 'count',
      raw: num(perception?.shopper_grade_ge_30m),
      reconciled: num(reconciled?.shopper_grade_ge_30m),
      delta: delta(num(perception?.shopper_grade_ge_30m), num(reconciled?.shopper_grade_ge_30m)),
      deltaPct: deltaPct(num(perception?.shopper_grade_ge_30m), num(reconciled?.shopper_grade_ge_30m)),
      direction: 'higher_better',
      highlight: true,
    },
    {
      id: 'short_ids',
      label: 'IDs under 2 s',
      unit: '%',
      raw: num(perception?.pct_ids_under_2s),
      reconciled: num(reconciled?.ghost_pct),
      delta: delta(num(perception?.pct_ids_under_2s), num(reconciled?.ghost_pct)),
      deltaPct: deltaPct(num(perception?.pct_ids_under_2s), num(reconciled?.ghost_pct)),
      direction: 'lower_better',
      note: 'Raw = % perception IDs under 2 s. Reconciled = ghost filter drop rate (related, not identical).',
    },
    {
      id: 'est_shoppers',
      label: 'Estimated real shoppers',
      unit: 'count',
      raw: num(perception?.estimated_real_shoppers),
      reconciled: stable,
      delta: delta(num(perception?.estimated_real_shoppers), stable),
      deltaPct: deltaPct(num(perception?.estimated_real_shoppers), stable),
      direction: 'neutral',
      note: 'Reconciled stable count should approach estimated shoppers when merge quality is high.',
    },
  ]
}

export function summarizeComparison(rows: RawVsReconciledRow[]) {
  const frag = rows.find(r => r.id === 'fragmentation')
  // Honest, shared-denominator metric (tracks ÷ real shoppers at the gate). This
  // is what the headline should report — the per-engine `fragmentation` row uses
  // a different denominator on each side and is misleading.
  const fps = rows.find(r => r.id === 'fragments_per_shopper')
  const ids = rows.find(r => r.id === 'identity_count')
  const lifetime = rows.find(r => r.id === 'lifetime')
  const shopper = rows.find(r => r.id === 'shopper_grade')

  // Prefer the honest fragments-per-shopper reduction; fall back to the old
  // factor only when footfall is unavailable.
  const headline = fps?.raw != null && fps.reconciled != null ? fps : frag
  const fragReduction =
    headline?.raw != null && headline.reconciled != null && headline.raw > 0
      ? (1 - headline.reconciled / headline.raw) * 100
      : null

  const idReduction =
    ids?.raw != null && ids.reconciled != null && ids.raw > 0
      ? (1 - ids.reconciled / ids.raw) * 100
      : null

  return { fragReduction, idReduction, lifetime, shopper, frag, fps, headline, ids }
}

export function formatDelta(
  value: number | null,
  direction: CompareDirection,
  unit: string,
): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (value == null || Number.isNaN(value)) return { text: '—', tone: 'neutral' }
  const sign = value > 0 ? '+' : ''
  const text = `${sign}${value.toFixed(unit === '%' ? 1 : 2)}${unit === '×' || unit === '/1k' ? unit : unit === 's' || unit === 'm' ? unit : ''}`
  if (direction === 'neutral') return { text, tone: 'neutral' }
  const improved = direction === 'lower_better' ? value < 0 : value > 0
  return { text, tone: improved ? 'good' : value === 0 ? 'neutral' : 'bad' }
}

export function formatDeltaPct(value: number | null, direction: CompareDirection) {
  if (value == null || Number.isNaN(value)) return { text: '—', tone: 'neutral' as const }
  const sign = value > 0 ? '+' : ''
  const text = `${sign}${value.toFixed(1)}%`
  if (direction === 'neutral') return { text, tone: 'neutral' as const }
  const improved = direction === 'lower_better' ? value < 0 : value > 0
  return { text, tone: improved ? 'good' as const : value === 0 ? 'neutral' as const : 'bad' as const }
}
