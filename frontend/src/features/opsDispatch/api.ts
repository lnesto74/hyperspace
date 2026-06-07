import { API_BASE } from '../../config/api'

const BASE = `${API_BASE}/api/ops-dispatch`

export interface OpsRole { id: string; label: string }

export interface OpsPublicConfig {
  enabled: boolean
  configured: boolean
  hasToken: boolean
  tokenLast4: string
  tokenMasked: string
  tokenSavedAt: string | null
  botUsername: string | null
  appBaseUrl: string
  inviteToken: string | null
  escalation: { reminderSec: number; escalateSec: number; verifySec?: number }
  roles: OpsRole[]
}

export interface OpsSubscriber {
  id: string
  venueId: string
  displayName: string
  role: string
  roleLabel: string
  telegramChatId: string | null
  status: string
  sortOrder: number
  source: string
  telegramLinked: boolean
  createdAt: string
  updatedAt: string
}

export interface OpsPool {
  id: string
  label: string
  count: number
  liveCount: number
  nextPrimaryId: string | null
  nextPrimaryName: string | null
  memberIds: string[]
}

export interface OpsTeamsResponse {
  config: OpsPublicConfig
  inviteLink: string | null
  subscribers: OpsSubscriber[]
  pools: OpsPool[]
  roles: OpsRole[]
}

export interface OpsTaskImpact { min: number; max: number; currency: string }

export interface OpsTaskPayload {
  type?: string
  zoneName?: string
  roiId?: string | null
  suggestedFix?: string
  impact?: OpsTaskImpact
  products?: { name?: string; brand?: string; imageUrl?: string | null; skuCode?: string; category?: string }[]
  instruction?: string
  insightId?: string | null
  coordinates?: { x: number; z: number } | null
  lever?: { id: string; label: string }
  projectedPerWeek?: number
}

export interface OpsTaskProof { note: string | null; photoUrl: string | null; at?: string }
export interface OpsTaskVerification {
  metric: string
  metricLabel: string
  before: number
  after: number
  delta: number
  verdict: 'improved' | 'no_change'
  source: 'measured' | 'projected'
  summary: string
  at: string
}

export type OpsTaskStatus = 'open' | 'notified' | 'acknowledged' | 'completed' | 'verified'

export interface OpsTask {
  token: string
  venueId: string
  role: string
  roleLabel: string
  kind: string
  title: string | null
  body: string | null
  payload: OpsTaskPayload
  status: OpsTaskStatus | string
  assignedSubscriberId: string | null
  assignedName: string | null
  escalationLevel: number
  ledger: { ts: string; step: string; detail: string; actor?: string }[]
  insightId: string | null
  proof: OpsTaskProof | null
  verification: OpsTaskVerification | null
  createdAt: string
  updatedAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  completedAt: string | null
  verifiedAt: string | null
}

export interface OpsSummary {
  total: number
  dispatched: number
  acknowledged: number
  completed: number
  verified: number
  weeklyActioned: number
  currency: string
}

export interface DispatchResult {
  task: OpsTask
  sent: boolean
  assigned: OpsSubscriber | null
  reason?: string
}

export interface TaskSnapshot {
  task: {
    token: string
    role: string
    roleLabel: string
    kind: string
    title: string | null
    body: string | null
    status: OpsTaskStatus | string
    assignedName: string | null
    createdAt: string
    acknowledgedAt: string | null
    completedAt: string | null
    verifiedAt: string | null
    proof: OpsTaskProof | null
    verification: OpsTaskVerification | null
    payload: OpsTaskPayload
  }
  venue: { id: string; name: string }
  map: { objects: any[]; regions: { id: string; name: string; vertices: { x: number; z?: number; y?: number }[] }[]; targetRoiId: string | null }
}

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`)
  return data
}

export async function fetchTeams(venueId: string): Promise<OpsTeamsResponse> {
  return jsonOrThrow(await fetch(`${BASE}/teams?venueId=${encodeURIComponent(venueId)}`))
}

export async function saveConfig(venueId: string, payload: Record<string, any>): Promise<OpsTeamsResponse> {
  return jsonOrThrow(await fetch(`${BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId, ...payload }),
  }))
}

export async function reorderPool(venueId: string, role: string, memberIds: string[]): Promise<OpsTeamsResponse> {
  return jsonOrThrow(await fetch(`${BASE}/pools`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId, role, memberIds }),
  }))
}

export async function removeSubscriber(venueId: string, id: string): Promise<OpsTeamsResponse> {
  return jsonOrThrow(await fetch(`${BASE}/subscribers/${id}?venueId=${encodeURIComponent(venueId)}`, { method: 'DELETE' }))
}

export async function sendTest(venueId: string): Promise<DispatchResult> {
  return jsonOrThrow(await fetch(`${BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId }),
  }))
}

export async function dispatchTask(input: {
  venueId: string
  role?: string
  kind?: string
  title?: string
  body?: string
  payload?: OpsTaskPayload
}): Promise<DispatchResult> {
  return jsonOrThrow(await fetch(`${BASE}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function fetchFeed(venueId: string): Promise<{ tasks: OpsTask[]; summary: OpsSummary }> {
  return jsonOrThrow(await fetch(`${BASE}/feed?venueId=${encodeURIComponent(venueId)}`))
}

export async function fetchSummary(venueId: string): Promise<OpsSummary> {
  return jsonOrThrow(await fetch(`${BASE}/summary?venueId=${encodeURIComponent(venueId)}`))
}

/** Submit a completion proof (optional photo + note). Marks the task done. */
export async function submitProof(token: string, opts: { note?: string; file?: File | null }): Promise<{ ok: boolean }> {
  const fd = new FormData()
  if (opts.note) fd.append('note', opts.note)
  if (opts.file) fd.append('photo', opts.file)
  const res = await fetch(`${BASE}/public/task/${token}/proof`, { method: 'POST', body: fd })
  return jsonOrThrow(res)
}

export async function fetchTaskSnapshot(token: string): Promise<TaskSnapshot> {
  return jsonOrThrow(await fetch(`${BASE}/public/task/${token}`))
}

export async function ackTask(token: string): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${BASE}/public/task/${token}/ack`, { method: 'POST' }))
}

/**
 * Resolve the products on a shelf (for a merchandiser task) via the existing
 * shelf-info + planogram export APIs. Returns a compact list (name/brand/image).
 */
export async function fetchShelfProducts(roiId: string): Promise<OpsTaskPayload['products']> {
  try {
    const infoRes = await fetch(`${API_BASE}/api/roi/${roiId}/shelf-info`)
    const info = infoRes.ok ? await infoRes.json() : null
    if (!info?.shelfId || !info?.planogramId) return []
    const expRes = await fetch(`${API_BASE}/api/planogram/planograms/${info.planogramId}/export`)
    const exp = expRes.ok ? await expRes.json() : null
    const shelf = (exp?.shelves || []).find((s: { shelfId?: string }) => s.shelfId === info.shelfId)
    const skuDetails = exp?.skuDetails || {}
    const seen = new Set<string>()
    const out: NonNullable<OpsTaskPayload['products']> = []
    shelf?.slots?.levels?.forEach((lvl: { slots?: { skuItemId?: string }[] }) => {
      lvl?.slots?.forEach((slot) => {
        const id = slot?.skuItemId
        if (!id || seen.has(id)) return
        seen.add(id)
        const sku = skuDetails[id]
        if (!sku) return
        out.push({
          name: sku.name,
          brand: sku.brand,
          category: sku.category,
          skuCode: sku.skuCode || sku.sku_code,
          imageUrl: sku.imageUrl || sku.image_url,
        })
      })
    })
    return out.slice(0, 12)
  } catch {
    return []
  }
}

export async function resolveTaskPublic(token: string): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${BASE}/public/task/${token}/resolve`, { method: 'POST' }))
}
