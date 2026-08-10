/**
 * Demo link support.
 *
 * Lets shareable links skip the Google login gate — without a full demo-user system.
 *
 * Tokens are minted by a superadmin from Demo Links / My dashboards Publish and
 * stored in the backend. Opening the app with `?demo=<token>` validates against
 * GET /api/demo-access/validate.
 *
 * Link types:
 * - story (default): auto-starts the guided Story Mode 3D tour
 * - dashboard: opens the Esselunga Executive reporting view for the pinned venue
 * - custom-dashboard: opens a published My-dashboards board (view-only)
 * - mapper: opens the shelf-mapping tool at /m/<token>
 */
import { API_BASE } from './api'
import type { DashboardLayout } from '../features/businessReporting/dashboardBuilder/types'

const DEMO_FLAG_KEY = 'hyperspace_demo'
const DEMO_VENUE_KEY = 'hyperspace_demo_venue'
const DEMO_LINK_TYPE_KEY = 'hyperspace_demo_link_type'
const DEMO_LAYOUT_KEY = 'hyperspace_demo_layout'

export type DemoLinkType = 'story' | 'dashboard' | 'mapper' | 'custom-dashboard'

/** In-memory fallback when sessionStorage is blocked (e.g. strict privacy mode). */
let memoryDemoSession: {
  venueId: string | null
  linkType: DemoLinkType
  layout: DashboardLayout | null
} | null = null

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

function normalizeLinkType(raw: unknown): DemoLinkType {
  if (raw === 'dashboard') return 'dashboard'
  if (raw === 'mapper') return 'mapper'
  if (raw === 'custom-dashboard') return 'custom-dashboard'
  return 'story'
}

/** True if this tab already validated a demo token earlier (survives in-app nav). */
export function isDemoActivated(): boolean {
  if (memoryDemoSession) return true
  try {
    return sessionStorage.getItem(DEMO_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

/** URL has a share token or this tab already validated one — never show login. */
export function hasDemoIntent(): boolean {
  return !!getPendingDemoToken() || isDemoActivated()
}

/** A demo token present in the URL (`?demo=`) awaiting validation, if any. */
export function getPendingDemoToken(): string | null {
  return readParam('demo')
}

export function getDemoLinkType(): DemoLinkType {
  if (memoryDemoSession?.linkType) return memoryDemoSession.linkType
  try {
    return normalizeLinkType(sessionStorage.getItem(DEMO_LINK_TYPE_KEY))
  } catch {
    return 'story'
  }
}

export function isDashboardDemo(): boolean {
  return isDemoActivated() && getDemoLinkType() === 'dashboard'
}

export function isCustomDashboardDemo(): boolean {
  return isDemoActivated() && getDemoLinkType() === 'custom-dashboard'
}

/** Executive or published custom board — both use the public reporting shell. */
export function isPublicReportingDemo(): boolean {
  return isDashboardDemo() || isCustomDashboardDemo()
}

/** Layout snapshot for a published custom board (set during token activate). */
export function getDemoPublishedLayout(): DashboardLayout | null {
  if (memoryDemoSession?.layout) return memoryDemoSession.layout
  try {
    const raw = sessionStorage.getItem(DEMO_LAYOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DashboardLayout
    if (!parsed || !Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Validate the URL token against the backend. On success, persist the demo flag
 * + venue to sessionStorage and strip the query string. Returns whether the tab
 * is now an active demo session.
 */
export async function activateDemoFromToken(): Promise<boolean> {
  const token = getPendingDemoToken()
  if (!token) return false
  try {
    const res = await fetch(`${API_BASE}/api/demo-access/validate?token=${encodeURIComponent(token)}`)
    if (!res.ok) return false
    const data = await res.json().catch(() => null)
    if (!data?.valid) return false

    const venueId = data.venueId || readParam('venue') || null
    const linkType = normalizeLinkType(data.linkType)
    const layout = linkType === 'custom-dashboard' && data.layout && Array.isArray(data.layout.items)
      ? (data.layout as DashboardLayout)
      : null
    if (linkType === 'custom-dashboard' && !layout?.items?.length) return false

    memoryDemoSession = { venueId, linkType, layout }
    try {
      sessionStorage.setItem(DEMO_FLAG_KEY, '1')
      sessionStorage.setItem(DEMO_LINK_TYPE_KEY, linkType)
      if (venueId) sessionStorage.setItem(DEMO_VENUE_KEY, venueId)
      if (layout) sessionStorage.setItem(DEMO_LAYOUT_KEY, JSON.stringify(layout))
      else sessionStorage.removeItem(DEMO_LAYOUT_KEY)
    } catch {
      /* sessionStorage blocked — memoryDemoSession keeps this tab public */
    }
    try {
      window.history.replaceState({}, '', window.location.pathname)
    } catch {
      /* non-fatal */
    }
    return true
  } catch {
    return false
  }
}

/** Sync check used by render-path code (e.g. MainApp bootstrap). */
export function isDemo(): boolean {
  return isDemoActivated()
}

/** The venue to pin for the demo, if any (token venue, `?venue=`, or env fallback). */
export function getDemoVenueId(): string | null {
  if (memoryDemoSession?.venueId) return memoryDemoSession.venueId
  try {
    const stored = sessionStorage.getItem(DEMO_VENUE_KEY)
    if (stored) return stored
  } catch {
    /* ignore */
  }
  return (import.meta.env.VITE_DEMO_VENUE_ID as string | undefined) || null
}
