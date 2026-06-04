/**
 * Demo link support.
 *
 * Lets a single shareable link skip the Google login gate and auto-start the
 * guided Story Mode tour on the production venue + recording — without building
 * a full demo-user / role system.
 *
 * Tokens are minted by a superadmin from the UI (Demo Links) and stored in the
 * backend. Opening the app with `?demo=<token>` validates the token against
 * `GET /api/demo-access/validate`; on success the tab is marked as a demo
 * session (persisted in `sessionStorage`), the token is stripped from the URL,
 * and the token's venue (if any) is pinned. The demo gate in App.tsx then skips
 * login and MainApp auto-starts Story Mode.
 *
 * Validation is server-side, so revoking a token in the UI immediately disables
 * its link (the backend rejects it on next open).
 */
import { API_BASE } from './api'

const DEMO_FLAG_KEY = 'hyperspace_demo'
const DEMO_VENUE_KEY = 'hyperspace_demo_venue'

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

/** True if this tab already validated a demo token earlier (survives in-app nav). */
export function isDemoActivated(): boolean {
  try {
    return sessionStorage.getItem(DEMO_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

/** A demo token present in the URL (`?demo=`) awaiting validation, if any. */
export function getPendingDemoToken(): string | null {
  return readParam('demo')
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

    const venueId = data.venueId || readParam('venue')
    try {
      sessionStorage.setItem(DEMO_FLAG_KEY, '1')
      if (venueId) sessionStorage.setItem(DEMO_VENUE_KEY, venueId)
    } catch {
      /* ignore — still active for this load via the return value */
    }
    // Clean the URL (drop token + venue) but keep the path.
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
  try {
    const stored = sessionStorage.getItem(DEMO_VENUE_KEY)
    if (stored) return stored
  } catch {
    /* ignore */
  }
  return (import.meta.env.VITE_DEMO_VENUE_ID as string | undefined) || null
}
