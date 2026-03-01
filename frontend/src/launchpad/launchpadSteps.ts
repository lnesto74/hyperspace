/**
 * LaunchPad Step Definitions & State Machine
 * 
 * Each step defines: preconditions, run logic, validation, deep-link target.
 * The state machine drives the cascade — executing steps in order,
 * advancing only when validation passes.
 */

import type {
  LaunchPadSession,
  LaunchPadStepId,
  StepStatus,
  SelectDwgData,
  MapFixturesData,
  DefineRoisData,
  PlaceLidarsData,
  CommissionEdgeData,
  PairDevicesData,
  ValidateStreamData,
  GoLiveData,
} from './launchpadTypes'
import {
  getStep,
  isStepDone,
  getNextStepId,
  updateStepStatus,
  advanceToStep,
  addLogEntry,
  markComplete,
  saveSession,
} from './launchpadStore'
import * as api from './launchpadApi'

// ─── Step Metadata ──────────────────────────────────────────────

export interface StepMeta {
  id: LaunchPadStepId
  label: string
  description: string
  icon: string
  /** ViewMode to deep-link when user clicks "Open" */
  deepLinkViewMode: string | null
  /** Whether step can be skipped */
  optional: boolean
}

export const STEP_METAS: StepMeta[] = [
  {
    id: 'select_dwg',
    label: 'Select or Upload DWG',
    description: 'Upload a DWG/DXF floor plan or select an existing layout.',
    icon: 'FileUp',
    deepLinkViewMode: 'dwgImporter',
    optional: false,
  },
  {
    id: 'map_fixtures',
    label: 'Map Fixtures',
    description: 'Classify detected fixture groups (shelves, walls, checkouts, etc.).',
    icon: 'Boxes',
    deepLinkViewMode: 'dwgImporter',
    optional: false,
  },
  {
    id: 'define_rois',
    label: 'Define ROIs',
    description: 'Confirm or draw Regions of Interest for analytics zones.',
    icon: 'SquareDashedBottom',
    deepLinkViewMode: 'main',
    optional: true,
  },
  {
    id: 'place_lidars',
    label: 'Auto-Place LiDARs',
    description: 'Run the solver to compute optimal sensor positions for coverage.',
    icon: 'Radar',
    deepLinkViewMode: 'lidarPlanner',
    optional: false,
  },
  {
    id: 'commission_edge',
    label: 'Commission Edge',
    description: 'Scan Tailscale network, select edge device, scan & commission LiDARs.',
    icon: 'Server',
    deepLinkViewMode: 'edgeCommissioning',
    optional: false,
  },
  {
    id: 'pair_devices',
    label: 'Pair Devices',
    description: 'Pair each LiDAR placement with a physical device on the edge.',
    icon: 'Link',
    deepLinkViewMode: 'edgeCommissioning',
    optional: false,
  },
  {
    id: 'validate_stream',
    label: 'Validate Stream',
    description: 'Check MQTT connectivity and LiDAR point cloud health.',
    icon: 'Activity',
    deepLinkViewMode: 'edgeCommissioning',
    optional: false,
  },
  {
    id: 'go_live',
    label: 'Go Live',
    description: 'Deploy configuration and start real-time tracking.',
    icon: 'Rocket',
    deepLinkViewMode: 'main',
    optional: false,
  },
]

export function getStepMeta(stepId: LaunchPadStepId): StepMeta {
  return STEP_METAS.find(s => s.id === stepId)!
}

// ─── Precondition Checks ────────────────────────────────────────

export function canStartStep(session: LaunchPadSession, stepId: LaunchPadStepId): { ok: boolean; reason?: string } {
  switch (stepId) {
    case 'select_dwg':
      return { ok: true }

    case 'map_fixtures': {
      const dwg = getStep(session, 'select_dwg')
      if (!isStepDone(session, 'select_dwg')) return { ok: false, reason: 'Upload or select a DWG first' }
      const dwgData = dwg?.data as SelectDwgData | null
      if (!dwgData?.importId) return { ok: false, reason: 'No import ID available' }
      return { ok: true }
    }

    case 'define_rois': {
      if (!isStepDone(session, 'map_fixtures')) return { ok: false, reason: 'Map fixtures first' }
      return { ok: true }
    }

    case 'place_lidars': {
      if (!isStepDone(session, 'select_dwg')) return { ok: false, reason: 'Select a DWG layout first' }
      return { ok: true }
    }

    case 'commission_edge': {
      if (!isStepDone(session, 'place_lidars')) return { ok: false, reason: 'Place LiDARs first' }
      return { ok: true }
    }

    case 'pair_devices': {
      if (!isStepDone(session, 'commission_edge')) return { ok: false, reason: 'Commission an edge device first' }
      return { ok: true }
    }

    case 'validate_stream': {
      if (!isStepDone(session, 'pair_devices')) return { ok: false, reason: 'Pair all devices first' }
      return { ok: true }
    }

    case 'go_live': {
      if (!isStepDone(session, 'validate_stream')) return { ok: false, reason: 'Validate stream first' }
      return { ok: true }
    }

    default:
      return { ok: false, reason: 'Unknown step' }
  }
}

// ─── Step Validators ────────────────────────────────────────────

export function validateStep(session: LaunchPadSession, stepId: LaunchPadStepId): {
  valid: boolean
  warnings: string[]
  error?: string
} {
  const step = getStep(session, stepId)
  if (!step?.data) return { valid: false, warnings: [], error: 'No data for this step' }

  switch (stepId) {
    case 'select_dwg': {
      const d = step.data as SelectDwgData
      if (!d.layoutVersionId) return { valid: false, warnings: [], error: 'No layout version selected' }
      if (d.fixtureCount === 0) return { valid: false, warnings: ['No fixtures detected in DWG'], error: 'No fixtures found' }
      return { valid: true, warnings: [] }
    }

    case 'map_fixtures': {
      const d = step.data as MapFixturesData
      if (d.mappedGroups === 0) return { valid: false, warnings: [], error: 'No groups mapped' }
      const warnings: string[] = []
      const unmapped = d.totalGroups - d.mappedGroups
      if (unmapped > 0) warnings.push(`${unmapped} group(s) still unmapped`)
      const lowConf = d.classifications.filter(c => c.confidence < 0.6 && c.accepted)
      if (lowConf.length > 0) warnings.push(`${lowConf.length} group(s) accepted with low confidence`)
      return { valid: true, warnings }
    }

    case 'define_rois': {
      const d = step.data as DefineRoisData
      const warnings: string[] = []
      if (d.roiCount === 0) warnings.push('No ROIs defined — analytics zones will be limited')
      return { valid: true, warnings }
    }

    case 'place_lidars': {
      const d = step.data as PlaceLidarsData
      if (d.sensorCount === 0) return { valid: false, warnings: [], error: 'No LiDARs placed' }
      const warnings: string[] = []
      if (!d.meetsCoverage) warnings.push(`Coverage ${(d.coveragePct * 100).toFixed(1)}% below target ${(d.coverageTarget * 100).toFixed(0)}%`)
      return { valid: true, warnings }
    }

    case 'commission_edge': {
      const d = step.data as CommissionEdgeData
      if (!d.edgeId) return { valid: false, warnings: [], error: 'No edge device selected' }
      if (!d.edgeOnline) return { valid: false, warnings: [], error: 'Edge device is offline' }
      const warnings: string[] = []
      if (d.missingLidars) {
        warnings.push(`Found ${d.scannedLidarCount} LiDARs but need ${d.neededLidarCount}. Connect & commission additional LiDARs.`)
      }
      return { valid: true, warnings }
    }

    case 'pair_devices': {
      const d = step.data as PairDevicesData
      if (d.totalPlacements === 0) return { valid: false, warnings: [], error: 'No placements found' }
      if (!d.allPaired) return { valid: false, warnings: [`${d.unpaired.length} placement(s) still unpaired`], error: 'Not all devices paired' }
      return { valid: true, warnings: [] }
    }

    case 'validate_stream': {
      const d = step.data as ValidateStreamData
      if (!d.mqttConnected) return { valid: false, warnings: [], error: 'MQTT broker not connected' }
      const disconnected = d.lidarStatuses.filter(l => !l.connected)
      if (disconnected.length > 0) {
        return { valid: false, warnings: [], error: `${disconnected.length} LiDAR(s) not connected` }
      }
      return { valid: true, warnings: d.overallHealthy ? [] : ['Stream health degraded'] }
    }

    case 'go_live': {
      const d = step.data as GoLiveData
      if (!d.trackingSubscribed) return { valid: false, warnings: [], error: 'Tracking not subscribed' }
      const warnings: string[] = []
      if (d.activeTrackCount === 0) warnings.push('No active tracks detected — is someone in the venue?')
      return { valid: true, warnings }
    }

    default:
      return { valid: false, warnings: [], error: 'Unknown step' }
  }
}

// ─── Step Execution Engine ──────────────────────────────────────

export type StepRunResult = {
  session: LaunchPadSession
  status: StepStatus
  message: string
}

/**
 * Execute the "check" phase of a step — fetches current state from APIs
 * and determines whether the step is already satisfied.
 */
export async function checkStep(
  session: LaunchPadSession,
  stepId: LaunchPadStepId,
): Promise<StepRunResult> {
  let updated = { ...session }

  try {
    updated = updateStepStatus(updated, stepId, 'running')

    switch (stepId) {
      case 'select_dwg': {
        // Priority 1: Explicit layout selected (from DwgContext or DwgImporter)
        const dwgLayoutId = localStorage.getItem('venueDwg-selectedLayout')
        if (dwgLayoutId) {
          try {
            const data = await api.buildSelectDwgData(dwgLayoutId)
            updated = updateStepStatus(updated, stepId, 'done', data as any)
            updated = addLogEntry(updated, { stepId, action: 'complete', message: `DWG layout found: ${data.filename}` })
            return { session: updated, status: 'done', message: `Layout loaded: ${data.filename}` }
          } catch {
            // Layout ID in localStorage is stale/invalid — clear it and continue
            localStorage.removeItem('venueDwg-selectedLayout')
          }
        }
        // Priority 2: User selected an import in DwgImporter (may or may not have a layout)
        const activeImportId = localStorage.getItem('launchpad-activeImportId')
        if (activeImportId) {
          try {
            const importLayouts = await api.listImportLayouts(activeImportId)
            if (importLayouts.length > 0) {
              const best = importLayouts.find(l => l.is_active) || importLayouts[0]
              // Sync to venueDwg-selectedLayout so next check is faster
              localStorage.setItem('venueDwg-selectedLayout', best.id)
              const data = await api.buildSelectDwgData(best.id)
              updated = updateStepStatus(updated, stepId, 'done', data as any)
              return { session: updated, status: 'done', message: `Layout loaded: ${data.filename}` }
            }
            // Import exists but no layout generated yet — auto-generate one
            console.log('[LaunchPad] Import has no layout, auto-generating...')
            try {
              const genResult = await api.generateLayout(activeImportId, updated.venueId || undefined)
              localStorage.setItem('venueDwg-selectedLayout', genResult.layout_version_id)
              const data = await api.buildSelectDwgData(genResult.layout_version_id)
              updated = updateStepStatus(updated, stepId, 'done', data as any)
              updated = addLogEntry(updated, { stepId, action: 'complete', message: `Auto-generated layout: ${data.filename}` })
              return { session: updated, status: 'done', message: `Layout auto-generated: ${data.filename}` }
            } catch (genErr: any) {
              // Generation failed — fall back to showing import info
              console.warn('[LaunchPad] Auto-generate failed:', genErr.message)
              const imp = await api.getImportDetails(activeImportId)
              const partialData = {
                importId: activeImportId,
                layoutVersionId: '',
                filename: imp.filename,
                fixtureCount: imp.fixtures?.length || 0,
                groupCount: imp.groups?.length || 0,
              }
              updated = updateStepStatus(updated, stepId, 'warning', partialData as any)
              return { session: updated, status: 'warning', message: `${imp.filename} loaded but layout generation failed: ${genErr.message}` }
            }
          } catch { /* fall through */ }
        }
        // Priority 3: Fall back to latest layout in the system
        const layouts = await api.listDwgLayouts()
        if (layouts.length > 0) {
          const latest = layouts[0]
          const data = await api.buildSelectDwgData(latest.id)
          localStorage.setItem('venueDwg-selectedLayout', latest.id)
          updated = updateStepStatus(updated, stepId, 'done', data as any)
          return { session: updated, status: 'done', message: `Latest layout: ${data.filename}` }
        }
        // No layout found — needs user action
        updated = updateStepStatus(updated, stepId, 'ready')
        return { session: updated, status: 'ready', message: 'Upload or select a DWG floor plan' }
      }

      case 'map_fixtures': {
        const dwgStep = getStep(updated, 'select_dwg')
        const dwgData = dwgStep?.data as SelectDwgData | null
        if (!dwgData?.importId) {
          updated = updateStepStatus(updated, stepId, 'locked')
          return { session: updated, status: 'locked', message: 'Select DWG first' }
        }
        const data = await api.buildMapFixturesData(dwgData.importId)
        if (data.mappedGroups === data.totalGroups && data.totalGroups > 0) {
          updated = updateStepStatus(updated, stepId, 'done', data as any)
          return { session: updated, status: 'done', message: `All ${data.totalGroups} groups mapped` }
        }
        // Run auto-classification
        updated = updateStepStatus(updated, stepId, 'ready', data as any)
        return { session: updated, status: 'ready', message: `${data.mappedGroups}/${data.totalGroups} groups mapped` }
      }

      case 'define_rois': {
        if (!updated.venueId) {
          updated = updateStepStatus(updated, stepId, 'ready')
          return { session: updated, status: 'ready', message: 'Define analytics zones' }
        }
        const dwgStep = getStep(updated, 'select_dwg')
        const dwgData = dwgStep?.data as SelectDwgData | null
        const data = await api.buildDefineRoisData(updated.venueId, dwgData?.layoutVersionId || undefined)
        if (data.roiCount > 0) {
          updated = updateStepStatus(updated, stepId, 'done', data as any)
          return { session: updated, status: 'done', message: `${data.roiCount} ROI(s) defined` }
        }
        updated = updateStepStatus(updated, stepId, 'ready', data as any)
        return { session: updated, status: 'ready', message: 'No ROIs yet — draw analytics zones' }
      }

      case 'place_lidars': {
        const dwgStep = getStep(updated, 'select_dwg')
        const dwgData = dwgStep?.data as SelectDwgData | null
        if (!dwgData?.layoutVersionId) {
          updated = updateStepStatus(updated, stepId, 'locked')
          return { session: updated, status: 'locked', message: 'Select DWG first' }
        }
        const data = await api.buildPlaceLidarsData(dwgData.layoutVersionId)
        if (data.sensorCount > 0) {
          const status: StepStatus = data.meetsCoverage ? 'done' : 'warning'
          updated = updateStepStatus(updated, stepId, status, data as any)
          const msg = `${data.sensorCount} LiDARs, ${(data.coveragePct * 100).toFixed(1)}% coverage`
          return { session: updated, status, message: msg }
        }
        updated = updateStepStatus(updated, stepId, 'ready', data as any)
        return { session: updated, status: 'ready', message: 'Run auto-placement' }
      }

      case 'commission_edge': {
        // We need to know how many LiDARs are needed from the previous step
        const lidarStep = getStep(updated, 'place_lidars')
        const lidarData = lidarStep?.data as PlaceLidarsData | null
        const neededCount = lidarData?.sensorCount || 0

        // Try to find the edge: from step data first, then from existing pairings
        let edgeId: string | null = null
        const edgeStep = getStep(updated, 'commission_edge')
        const prevData = edgeStep?.data as CommissionEdgeData | null
        if (prevData?.edgeId) {
          edgeId = prevData.edgeId
        } else if (updated.venueId) {
          // Discover edge from existing pairings (survives step resets)
          try {
            const pairingsRes = await api.loadPairings(updated.venueId)
            const pairings = pairingsRes.pairings || []
            if (pairings.length > 0) {
              edgeId = pairings[0].edgeId
            }
          } catch { /* no pairings yet */ }
        }

        if (edgeId) {
          try {
            const data = await api.buildCommissionEdgeData(edgeId, neededCount)
            const displayName = data.edgeHostname || edgeId
            if (data.edgeOnline) {
              const status: StepStatus = data.missingLidars ? 'warning' : 'done'
              updated = updateStepStatus(updated, stepId, status, data as any)
              const msg = data.missingLidars
                ? `Edge online but ${data.neededLidarCount - data.scannedLidarCount} LiDAR(s) missing — commission new devices`
                : `Edge ${displayName} ready with ${data.scannedLidarCount} LiDARs`
              return { session: updated, status, message: msg }
            }
            // Edge exists but offline
            updated = updateStepStatus(updated, stepId, 'error', data as any, `Edge ${displayName} is offline`)
            return { session: updated, status: 'error', message: `Edge ${displayName} is offline` }
          } catch (err: any) {
            console.warn('[commission_edge] buildCommissionEdgeData failed:', err.message)
            updated = updateStepStatus(updated, stepId, 'error', undefined, `Edge check failed: ${err.message}`)
            return { session: updated, status: 'error', message: `Edge check failed: ${err.message}` }
          }
        }
        updated = updateStepStatus(updated, stepId, 'ready')
        return { session: updated, status: 'ready', message: 'Scan for edge devices on Tailscale' }
      }

      case 'pair_devices': {
        if (!updated.venueId) {
          updated = updateStepStatus(updated, stepId, 'locked')
          return { session: updated, status: 'locked', message: 'No venue selected' }
        }
        const data = await api.buildPairDevicesData(updated.venueId)
        if (data.allPaired) {
          updated = updateStepStatus(updated, stepId, 'done', data as any)
          return { session: updated, status: 'done', message: `All ${data.pairedCount} devices paired` }
        }
        updated = updateStepStatus(updated, stepId, 'ready', data as any)
        return { session: updated, status: 'ready', message: `${data.pairedCount}/${data.totalPlacements} paired` }
      }

      case 'validate_stream': {
        const edgeStep = getStep(updated, 'commission_edge')
        const edgeData = edgeStep?.data as CommissionEdgeData | null
        if (!edgeData?.edgeId) {
          updated = updateStepStatus(updated, stepId, 'locked')
          return { session: updated, status: 'locked', message: 'Commission edge first' }
        }
        const data = await api.buildValidateStreamData(edgeData.edgeId)
        if (data.overallHealthy) {
          updated = updateStepStatus(updated, stepId, 'done', data as any)
          return { session: updated, status: 'done', message: 'All streams healthy' }
        }
        const status: StepStatus = data.mqttConnected ? 'warning' : 'error'
        updated = updateStepStatus(updated, stepId, status, data as any)
        const msg = data.mqttConnected ? 'Some LiDARs disconnected' : 'MQTT not connected'
        return { session: updated, status, message: msg }
      }

      case 'go_live': {
        // This is mostly a confirmation step — check if deploy has happened
        updated = updateStepStatus(updated, stepId, 'ready')
        return { session: updated, status: 'ready', message: 'Ready to deploy and go live' }
      }

      default:
        return { session: updated, status: 'error', message: 'Unknown step' }
    }
  } catch (err: any) {
    updated = updateStepStatus(updated, stepId, 'error', undefined, err.message)
    updated = addLogEntry(updated, { stepId, action: 'error', message: err.message })
    return { session: updated, status: 'error', message: err.message }
  }
}

/**
 * Run the full check cascade — evaluate all steps starting from
 * the first incomplete one. Useful on initial load to sync state.
 */
export async function runFullCheck(session: LaunchPadSession): Promise<LaunchPadSession> {
  let current = { ...session }

  for (const meta of STEP_METAS) {
    const step = getStep(current, meta.id)
    if (!step) continue

    // Check preconditions
    const canStart = canStartStep(current, meta.id)
    if (!canStart.ok) {
      current = updateStepStatus(current, meta.id, 'locked')
      continue
    }

    // Re-check step — but preserve done status on transient network errors
    const prevStatus = step.status
    const result = await checkStep(current, meta.id)
    if (result.status === 'error' && (prevStatus === 'done' || prevStatus === 'warning')) {
      console.warn(`[LaunchPad] Step "${meta.id}" re-check failed but was ${prevStatus} — keeping`)
    } else {
      current = result.session
    }

    const stepNow = getStep(current, meta.id)
    if (stepNow?.status === 'done' || stepNow?.status === 'warning') {
      // Advance to next step
      const nextId = getNextStepId(meta.id)
      if (nextId) {
        current = advanceToStep(current, nextId)
      } else {
        // All steps done!
        current = markComplete(current)
      }
    } else {
      // Stop cascade here — user needs to act on this step
      current = { ...current, currentStepId: meta.id }
      break
    }
  }

  // Second pass: unlock any remaining steps whose preconditions are met
  // (lightweight — no API calls, just check canStartStep)
  for (const meta of STEP_METAS) {
    const step = getStep(current, meta.id)
    if (!step || step.status !== 'locked') continue
    const canStart = canStartStep(current, meta.id)
    if (canStart.ok) {
      current = updateStepStatus(current, meta.id, 'ready')
    }
  }

  saveSession(current)
  return current
}

/**
 * Complete a step manually (after user returns from deep-linked view).
 * Re-validates and advances if valid.
 */
export async function completeStep(
  session: LaunchPadSession,
  stepId: LaunchPadStepId,
): Promise<StepRunResult> {
  const result = await checkStep(session, stepId)
  let updated = result.session

  if (result.status === 'done' || result.status === 'warning') {
    const validation = validateStep(updated, stepId)
    if (validation.valid) {
      updated = updateStepStatus(
        updated,
        stepId,
        validation.warnings.length > 0 ? 'warning' : 'done',
        undefined,
        undefined,
        validation.warnings,
      )
      updated = addLogEntry(updated, {
        stepId,
        action: 'complete',
        message: result.message,
        data: { warnings: validation.warnings },
      })

      // Auto-advance to next step
      const nextId = getNextStepId(stepId)
      if (nextId) {
        updated = advanceToStep(updated, nextId)
      } else {
        updated = markComplete(updated)
      }
    }
  }

  saveSession(updated)
  return { session: updated, status: result.status, message: result.message }
}
