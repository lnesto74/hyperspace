/**
 * LaunchPad Store — Session Persistence
 * 
 * Primary: localStorage (instant, offline-safe)
 * Secondary: Backend /api/launchpad/sessions (optional, for cross-device)
 * 
 * The backend uses a SEPARATE SQLite database (launchpad_sessions.db)
 * to guarantee zero impact on the core hyperspace.db.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  LaunchPadSession,
  LaunchPadStep,
  LaunchPadStepId,
  LaunchPadLogEntry,
  StepStatus,
  StepData,
} from './launchpadTypes'
import { API_BASE } from '../config/api'

// ─── Constants ──────────────────────────────────────────────────

const STORAGE_KEY = 'hyperspace_launchpad_session'
const STORAGE_UI_KEY = 'hyperspace_launchpad_ui'

// ─── Default Step Definitions ───────────────────────────────────

const DEFAULT_STEPS: Omit<LaunchPadStep, 'status'>[] = [
  {
    id: 'select_dwg',
    index: 0,
    label: 'Select or Upload DWG',
    description: 'Upload a DWG/DXF floor plan or select an existing layout.',
    icon: 'FileUp',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'map_fixtures',
    index: 1,
    label: 'Map Fixtures',
    description: 'Classify detected fixture groups (shelves, walls, checkouts, etc.).',
    icon: 'Boxes',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'define_rois',
    index: 2,
    label: 'Define ROIs',
    description: 'Confirm or draw Regions of Interest for analytics zones.',
    icon: 'SquareDashedBottom',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'place_lidars',
    index: 3,
    label: 'Auto-Place LiDARs',
    description: 'Run the solver to compute optimal sensor positions for coverage.',
    icon: 'Radar',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'commission_edge',
    index: 4,
    label: 'Commission Edge',
    description: 'Scan Tailscale network, select edge device, scan LiDARs on LAN.',
    icon: 'Server',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'pair_devices',
    index: 5,
    label: 'Pair Devices',
    description: 'Pair each LiDAR placement with a physical device on the edge.',
    icon: 'Link',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'deploy_her',
    index: 6,
    label: 'Deploy HER',
    description: 'Deploy algorithm provider (HER) with venue geometry and LiDAR config.',
    icon: 'Cpu',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'validate_stream',
    index: 7,
    label: 'Validate Stream',
    description: 'Run full pipeline check: LiDAR → HER → MQTT → Backend → WebSocket.',
    icon: 'Activity',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
  {
    id: 'go_live',
    index: 8,
    label: 'Go Live',
    description: 'Deploy configuration and start real-time tracking.',
    icon: 'Rocket',
    data: null,
    startedAt: null,
    completedAt: null,
    error: null,
    warnings: [],
  },
]

// ─── Session Factory ────────────────────────────────────────────

export function createSession(venueId?: string, venueName?: string): LaunchPadSession {
  const now = new Date().toISOString()
  return {
    id: uuidv4(),
    venueId: venueId || null,
    venueName: venueName || null,
    createdAt: now,
    updatedAt: now,
    currentStepId: 'select_dwg',
    steps: DEFAULT_STEPS.map((s, i) => ({
      ...s,
      status: (i === 0 ? 'ready' : 'locked') as StepStatus,
    })),
    log: [{
      timestamp: now,
      stepId: 'select_dwg',
      action: 'start',
      message: 'LaunchPad session started',
    }],
    isComplete: false,
  }
}

// ─── localStorage Persistence ───────────────────────────────────

export function loadSession(): LaunchPadSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as LaunchPadSession
    
    // Migrate: add any missing steps and fix indices to match DEFAULT_STEPS order
    const existingById = new Map(session.steps.map(s => [s.id, s]))
    const missingSteps = DEFAULT_STEPS.filter(ds => !existingById.has(ds.id))
    
    // Build new steps array in correct order from DEFAULT_STEPS
    const migratedSteps = DEFAULT_STEPS.map((ds, idx) => {
      const existing = existingById.get(ds.id)
      if (existing) {
        // Update index to match DEFAULT_STEPS order
        return { ...existing, index: idx }
      } else {
        // New step - add with locked status
        return { ...ds, index: idx, status: 'locked' as StepStatus }
      }
    })
    
    // Check if any step has wrong index (needs reorder)
    const needsReorder = session.steps.some(s => {
      const expected = DEFAULT_STEPS.find(ds => ds.id === s.id)
      return expected && s.index !== expected.index
    })
    
    if (missingSteps.length > 0 || session.steps.length !== migratedSteps.length || needsReorder) {
      session.steps = migratedSteps
      saveSession(session)
      console.log(`[LaunchPad] Migrated session: added ${missingSteps.map(s => s.id).join(', ') || 'none'}, reordered: ${needsReorder}`)
    }
    
    return session
  } catch {
    return null
  }
}

export function saveSession(session: LaunchPadSession): void {
  try {
    session.updatedAt = new Date().toISOString()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch (e) {
    console.warn('[LaunchPad] Failed to save session to localStorage:', e)
  }
  // Fire-and-forget backend sync
  syncToBackend(session).catch(() => {})
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function loadUIState(): { isOpen: boolean; expandedStepId: string | null; isMinimized: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_UI_KEY)
    if (!raw) return { isOpen: false, expandedStepId: null, isMinimized: false }
    return JSON.parse(raw)
  } catch {
    return { isOpen: false, expandedStepId: null, isMinimized: false }
  }
}

export function saveUIState(state: { isOpen: boolean; expandedStepId: string | null; isMinimized: boolean }): void {
  try {
    localStorage.setItem(STORAGE_UI_KEY, JSON.stringify(state))
  } catch {}
}

// ─── Session Mutation Helpers ───────────────────────────────────

export function updateStepStatus(
  session: LaunchPadSession,
  stepId: LaunchPadStepId,
  status: StepStatus,
  data?: Partial<StepData>,
  error?: string,
  warnings?: string[]
): LaunchPadSession {
  const now = new Date().toISOString()
  const updated = { ...session }
  updated.steps = session.steps.map(s => {
    if (s.id !== stepId) return s
    return {
      ...s,
      status,
      data: data ? { ...s.data, ...data } as StepData : s.data,
      error: error !== undefined ? error : (status === 'error' ? s.error : null),
      warnings: warnings !== undefined ? warnings : (status === 'warning' ? s.warnings : []),
      startedAt: status === 'running' ? now : s.startedAt,
      completedAt: (status === 'done' || status === 'warning') ? now : s.completedAt,
    }
  })
  updated.updatedAt = now
  return updated
}

export function advanceToStep(
  session: LaunchPadSession,
  nextStepId: LaunchPadStepId
): LaunchPadSession {
  const updated = { ...session, currentStepId: nextStepId, updatedAt: new Date().toISOString() }
  // Unlock the next step
  updated.steps = session.steps.map(s => {
    if (s.id === nextStepId && s.status === 'locked') {
      return { ...s, status: 'ready' as StepStatus }
    }
    return s
  })
  return updated
}

export function addLogEntry(
  session: LaunchPadSession,
  entry: Omit<LaunchPadLogEntry, 'timestamp'>
): LaunchPadSession {
  return {
    ...session,
    log: [
      ...session.log,
      { ...entry, timestamp: new Date().toISOString() },
    ],
    updatedAt: new Date().toISOString(),
  }
}

export function markComplete(session: LaunchPadSession): LaunchPadSession {
  return {
    ...session,
    isComplete: true,
    updatedAt: new Date().toISOString(),
  }
}

// ─── Step Navigation Helpers ────────────────────────────────────

const STEP_ORDER: LaunchPadStepId[] = [
  'select_dwg',
  'map_fixtures',
  'define_rois',
  'place_lidars',
  'commission_edge',
  'pair_devices',
  'validate_stream',
  'go_live',
]

export function getNextStepId(currentId: LaunchPadStepId): LaunchPadStepId | null {
  const idx = STEP_ORDER.indexOf(currentId)
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null
  return STEP_ORDER[idx + 1]
}

export function getPrevStepId(currentId: LaunchPadStepId): LaunchPadStepId | null {
  const idx = STEP_ORDER.indexOf(currentId)
  if (idx <= 0) return null
  return STEP_ORDER[idx - 1]
}

export function getStepIndex(stepId: LaunchPadStepId): number {
  return STEP_ORDER.indexOf(stepId)
}

export function getStep(session: LaunchPadSession, stepId: LaunchPadStepId): LaunchPadStep | undefined {
  return session.steps.find(s => s.id === stepId)
}

export function isStepDone(session: LaunchPadSession, stepId: LaunchPadStepId): boolean {
  const step = getStep(session, stepId)
  return step?.status === 'done' || step?.status === 'warning'
}

// ─── Backend Sync (Optional — fire-and-forget) ─────────────────

async function syncToBackend(session: LaunchPadSession): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/launchpad/sessions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    })
  } catch {
    // Backend sync is best-effort — localStorage is primary
  }
}

export async function loadSessionFromBackend(sessionId: string): Promise<LaunchPadSession | null> {
  try {
    const res = await fetch(`${API_BASE}/api/launchpad/sessions/${sessionId}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
