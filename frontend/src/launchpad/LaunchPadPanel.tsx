/**
 * LaunchPad Panel — Right-side Drawer
 * 
 * The main orchestration UI. Shows the step cascade,
 * handles deep-linking to existing views, and manages session state.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Rocket, X, RotateCw, Trash2, ChevronDown, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LaunchPadSession, LaunchPadStepId, MapFixturesData, AutopilotContext, DeployHerData, CommissionEdgeData, PairDevicesData, ValidateStreamData } from './launchpadTypes'
import { isLaunchPadEnabled } from './launchpadTypes'
import {
  createSession,
  loadSession,
  saveSession,
  clearSession,
  loadUIState,
  saveUIState,
} from './launchpadStore'
import { checkStep, completeStep, runFullCheck, getStepMeta } from './launchpadSteps'
import * as api from './launchpadApi'
import LaunchPadStepper from './LaunchPadStepper'
import type { DwgImportItem, DwgGeometry } from './LaunchPadStepper'
import type { MiniFixture, MiniRoi, MiniLidar } from './MiniDwgViewport'
import type { AutoPlaceSettings } from './launchpadApi'
import type { SelectDwgData } from './launchpadTypes'
import Lidar3DModal from './Lidar3DModal'
import RoiDrawingModal from './RoiDrawingModal'
import FixtureClassifyModal from './FixtureClassifyModal'
import EdgeCommissioningModal from './EdgeCommissioningModal'
import PairDevicesModal from './PairDevicesModal'
import LaunchPadStage from './LaunchPadStage'
import type { StageMode } from './LaunchPadStage'

interface LaunchPadPanelProps {
  isOpen: boolean
  onClose: () => void
  onDeepLink: (viewMode: string) => void
  venueId?: string
  venueName?: string
  /** Current app ViewMode — used to re-check steps when user returns from a deep-linked view */
  currentViewMode?: string
}

export default function LaunchPadPanel({
  isOpen,
  onClose,
  onDeepLink,
  venueId,
  venueName,
  currentViewMode,
}: LaunchPadPanelProps) {
  const enabled = isLaunchPadEnabled()
  const [session, setSession] = useState<LaunchPadSession | null>(null)
  const [expandedStepId, setExpandedStepId] = useState<LaunchPadStepId | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [availableImports, setAvailableImports] = useState<DwgImportItem[]>([])
  const [geometry, setGeometry] = useState<DwgGeometry | undefined>(undefined)
  const [aiEnhancing, setAiEnhancing] = useState(false)
  const [aiEnhanced, setAiEnhanced] = useState(false)
  const [showRoiModal, setShowRoiModal] = useState(false)
  const [autoPlacing, setAutoPlacing] = useState(false)
  const [showClassifyModal, setShowClassifyModal] = useState(false)
  const [showEdgeModal, setShowEdgeModal] = useState(false)
  const [showPairModal, setShowPairModal] = useState(false)
  const [show3DPreview, setShow3DPreview] = useState(false)
  // HER deployment state
  const [herDeploying, setHerDeploying] = useState(false)
  const [algorithmProviders, setAlgorithmProviders] = useState<Array<{ id: string; name: string; version: string; description?: string }>>([])  
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(undefined)
  const [mqttBrokerUrl, setMqttBrokerUrl] = useState<string>(() => {
    return localStorage.getItem('launchpad-mqttBrokerUrl') || ''
  })
  // Stream validation state
  const [validating, setValidating] = useState(false)
  const [autoPlaceSettings, setAutoPlaceSettings] = useState<AutoPlaceSettings>(() => {
    try {
      const saved = localStorage.getItem('launchpad-autoplace-settings')
      if (saved) return { ...api.DEFAULT_AUTOPLACE_SETTINGS, ...JSON.parse(saved) }
    } catch { /* ignore */ }
    return api.DEFAULT_AUTOPLACE_SETTINGS
  })
  const [lidarModels, setLidarModels] = useState<Array<{ id: string; name: string; range_m: number; dome_mode: boolean }>>([])
  const [showStage, setShowStage] = useState(false)
  const [stageMode, setStageMode] = useState<StageMode>('normal')
  const [cinematicBuildEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('launchpad-cinematicBuild') !== 'false' } catch { return true }
  })
  const [autopilot, setAutopilot] = useState<AutopilotContext>({
    state: 'idle',
    activeStepId: null,
    waitingFor: null,
    stageMessage: null,
    show3DFlythrough: false,
  })
  const autopilotRef = useRef(autopilot)
  autopilotRef.current = autopilot
  const sessionRef = useRef(session)
  sessionRef.current = session
  const initialCheckDone = useRef(false)
  const lastGeometryImportId = useRef<string | null>(null)

  // Load or create session on mount
  useEffect(() => {
    if (!isOpen) return
    
    let s = loadSession()
    if (!s) {
      s = createSession(venueId, venueName)
      saveSession(s)
    } else if (venueId && s.venueId !== venueId) {
      // Venue changed — update session
      s = { ...s, venueId, venueName: venueName || s.venueName }
      saveSession(s)
    }
    setSession(s)

    // Auto-resolve venue if none set (needed for ROI, etc.)
    const effectiveVenueId = s.venueId || venueId
    if (!effectiveVenueId) {
      api.ensureVenueId(null).then(({ venueId: resolvedId, venueName: resolvedName }) => {
        setSession(prev => {
          if (!prev || prev.venueId) return prev
          const updated = { ...prev, venueId: resolvedId, venueName: resolvedName }
          saveSession(updated)
          sessionRef.current = updated
          return updated
        })
      }).catch(err => console.warn('[LaunchPad] Could not auto-resolve venue:', err))
    }

    // Restore UI state
    const ui = loadUIState()
    if (ui.expandedStepId) setExpandedStepId(ui.expandedStepId as LaunchPadStepId)
    if (ui.isMinimized) setIsMinimized(ui.isMinimized)

    // Sync scaleMultiplier from DWG importer's scaleCorrection (ground truth)
    const dwgData = s.steps.find(st => st.id === 'select_dwg')?.data as SelectDwgData | null
    const filename = dwgData?.filename
    if (filename) {
      try {
        const dwgSettings = JSON.parse(localStorage.getItem(`dwg-autoplace-settings-${filename}`) || '{}')
        const sc = dwgSettings.scaleCorrection ?? 1
        setAutoPlaceSettings(prev => prev.scaleMultiplier !== sc ? { ...prev, scaleMultiplier: sc } : prev)
      } catch { /* ignore */ }
    }
  }, [isOpen, venueId, venueName])

  // Fetch available DWG imports when panel opens
  useEffect(() => {
    if (!isOpen) return
    api.listDwgImports().then(async (imports) => {
      const items: DwgImportItem[] = []
      for (const imp of imports) {
        let has_layout = false
        let fixture_count = 0
        let group_count = 0
        try {
          const layouts = await api.listImportLayouts(imp.import_id)
          has_layout = layouts.length > 0
        } catch { /* ignore */ }
        try {
          const details = await api.getImportDetails(imp.import_id)
          fixture_count = details.fixtures?.length || 0
          group_count = details.groups?.length || 0
        } catch { /* ignore */ }
        items.push({
          import_id: imp.import_id,
          filename: imp.filename,
          has_layout,
          created_at: imp.created_at,
          fixture_count,
          group_count,
        })
      }
      setAvailableImports(items)
    }).catch(() => {})

    // Fetch LiDAR models
    api.listLidarModels().then(models => {
      setLidarModels(models)
      // Auto-select first model if none selected and no persisted selection
      setAutoPlaceSettings(prev => {
        // If persisted modelId is still valid, keep it
        if (prev.modelId && models.find(m => m.id === prev.modelId)) return prev
        // Otherwise pick first available
        if (models.length > 0) return { ...prev, modelId: models[0].id }
        return prev
      })
    }).catch(() => {})

    // Fetch algorithm providers for HER deployment
    api.listAlgorithmProviders().then(providers => {
      setAlgorithmProviders(providers)
      if (providers.length > 0 && !selectedProviderId) {
        setSelectedProviderId(providers[0].id)
      }
    }).catch(() => {
      // Fallback to a default provider if endpoint not available
      setAlgorithmProviders([{ id: 'robosense-her', name: 'RoboSense HER', version: '1.0.0' }])
      setSelectedProviderId('robosense-her')
    })
  }, [isOpen])

  // Auto-fetch backend Tailscale IP for MQTT broker default
  useEffect(() => {
    if (!isOpen || mqttBrokerUrl) return // Skip if already set
    api.getBackendTailscaleIp().then(self => {
      if (self.ip) {
        const url = `mqtt://${self.ip}:1883`
        setMqttBrokerUrl(url)
        localStorage.setItem('launchpad-mqttBrokerUrl', url)
      }
    }).catch(() => {})
  }, [isOpen, mqttBrokerUrl])

  // Fetch geometry data when the selected DWG (importId) changes
  useEffect(() => {
    if (!session) return
    const selectDwgStep = session.steps.find(s => s.id === 'select_dwg')
    const dwgData = selectDwgStep?.data as SelectDwgData | null
    const importId = dwgData?.importId
    const layoutVersionId = dwgData?.layoutVersionId
    if (!importId || importId === lastGeometryImportId.current) return
    lastGeometryImportId.current = importId

    // Fetch import details for fixture geometry
    api.getImportDetails(importId).then(async (details) => {
      // Filter out deleted fixtures
      const deletedIds = new Set(await api.getDeletedFixtureIds(importId))
      const fixtures: MiniFixture[] = details.fixtures
        .filter(f => !deletedIds.has(f.id))
        .map(f => ({
          id: f.id,
          x: f.pose2d.x,
          y: f.pose2d.y,
          w: f.footprint.w,
          d: f.footprint.d,
          rot_deg: f.pose2d.rot_deg || 0,
          group_id: f.group_id,
          points: f.footprint.points,
        }))

      const b = details.bounds || {}
      const bounds = (b.minX != null)
        ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
        : undefined

      // Fetch ROIs if we have a venue
      let rois: MiniRoi[] = []
      if (session.venueId) {
        try {
          const roiList = await api.listRois(session.venueId, layoutVersionId || undefined)
          rois = roiList.map(r => {
            let vertices: Array<{ x: number; y: number }> = []
            try {
              const parsed = typeof r.vertices === 'string' ? JSON.parse(r.vertices) : r.vertices
              vertices = Array.isArray(parsed) ? parsed.map((v: any) => ({ x: v.x ?? v[0], y: v.y ?? v.z ?? v[1] })) : []
            } catch { /* bad JSON */ }
            return { name: r.name, color: r.color || '#818cf8', vertices }
          })
        } catch { /* no ROIs */ }
      }

      // Fetch LiDAR instances if we have a layout
      // LiDAR positions are in meters but the SVG viewport is in DXF units — convert back
      // Must use the same effective scale that autoplace used: baseScale × scaleMultiplier
      const baseUnitScale = details.unit_scale_to_m || 0.001
      const effectiveScale = baseUnitScale * (autoPlaceSettings.scaleMultiplier || 1)
      let lidars: MiniLidar[] = []
      if (layoutVersionId) {
        try {
          const instances = await api.listLidarInstances(layoutVersionId)
          const models = await api.listLidarModels()
          lidars = instances.map(inst => {
            const model = models.find(m => m.id === inst.model_id)
            return {
              id: inst.id,
              model_id: inst.model_id,
              x: inst.x_m / effectiveScale,       // meters → DXF units
              z: inst.z_m / effectiveScale,        // meters → DXF units
              range_m: (model?.range_m || 20) / effectiveScale,  // meters → DXF units
            }
          })
        } catch { /* no LiDARs yet */ }
      }

      // Load saved mapping from DB first; fall back to heuristic if none
      let classifications: Array<{ groupId: string; suggestedType: string; confidence: number }> = []
      try {
        const mapping = await api.getMapping(importId)
        const gm = mapping.group_mappings || {}
        if (Object.keys(gm).length > 0) {
          classifications = Object.entries(gm).map(([groupId, m]) => ({
            groupId,
            suggestedType: (m as any).type || 'unknown',
            confidence: 1,
          }))
        }
      } catch { /* no saved mapping yet */ }
      if (classifications.length === 0) {
        const fixturePositions = details.fixtures.map(f => ({
          id: f.id, group_id: f.group_id,
          x: f.pose2d.x, y: f.pose2d.y, rot_deg: f.pose2d.rot_deg || 0,
          w: f.footprint.w, d: f.footprint.d, points: f.footprint.points,
        }))
        const fullClassifications = api.classifyFixtureGroups(details.groups, fixturePositions)
        classifications = fullClassifications.map(c => ({
          groupId: c.groupId, suggestedType: c.suggestedType, confidence: c.confidence,
        }))
      }

      setGeometry({ fixtures, bounds, classifications, rois, lidars })
    }).catch((err) => {
      console.error('[LaunchPad] Geometry fetch failed:', err)
    })
  }, [session])

  // Refresh ROIs + LiDARs whenever session changes (lightweight — no full geometry re-fetch)
  useEffect(() => {
    if (!session || !geometry) return
    const selectDwgStep = session.steps.find(s => s.id === 'select_dwg')
    const dwgData = selectDwgStep?.data as SelectDwgData | null
    const layoutVersionId = dwgData?.layoutVersionId
    const importId = dwgData?.importId
    if (!session.venueId && !layoutVersionId) return

    ;(async () => {
      let rois: MiniRoi[] = []
      if (session.venueId) {
        try {
          // Only fetch ROIs scoped to this DWG layout (LaunchPad coverage zones)
          // Never load venue-level KPI ROIs (Checkout Service/Queue, etc.)
          const roiList = await api.listRois(session.venueId, layoutVersionId || undefined)
          rois = roiList.map(r => {
            let vertices: Array<{ x: number; y: number }> = []
            try {
              const parsed = typeof r.vertices === 'string' ? JSON.parse(r.vertices) : r.vertices
              vertices = Array.isArray(parsed) ? parsed.map((v: any) => ({ x: v.x ?? v[0], y: v.y ?? v.z ?? v[1] })) : []
            } catch { /* bad JSON */ }
            return { name: r.name, color: r.color || '#818cf8', vertices }
          })
        } catch { /* no ROIs */ }
      }

      let lidars: MiniLidar[] = []
      if (layoutVersionId && importId) {
        try {
          const details = await api.getImportDetails(importId)
          const baseUnitScale = details.unit_scale_to_m || 0.001
          const eff = baseUnitScale * (autoPlaceSettings.scaleMultiplier || 1)
          const instances = await api.listLidarInstances(layoutVersionId)
          const models = await api.listLidarModels()
          lidars = instances.map(inst => {
            const model = models.find(m => m.id === inst.model_id)
            return {
              id: inst.id,
              model_id: inst.model_id,
              x: inst.x_m / eff,
              z: inst.z_m / eff,
              range_m: (model?.range_m || 20) / eff,
            }
          })
        } catch { /* no LiDARs */ }
      }

      setGeometry(prev => prev ? { ...prev, rois, lidars } : prev)
    })()
  }, [session?.steps?.find(s => s.id === 'define_rois')?.status, session?.steps?.find(s => s.id === 'place_lidars')?.status])

  // Run initial check cascade when panel opens
  useEffect(() => {
    if (!isOpen || !session || initialCheckDone.current) return
    initialCheckDone.current = true
    
    setIsChecking(true)
    runFullCheck(session).then(updated => {
      setSession(updated)
      // Auto-expand current step
      setExpandedStepId(updated.currentStepId)
      setIsChecking(false)
    }).catch(() => setIsChecking(false))
  }, [isOpen, session])

  // Reset initial check flag when panel closes
  useEffect(() => {
    if (!isOpen) {
      initialCheckDone.current = false
    }
  }, [isOpen])

  // Persist UI state
  useEffect(() => {
    saveUIState({ isOpen, expandedStepId, isMinimized })
  }, [isOpen, expandedStepId, isMinimized])

  // Persist autoplace settings (including selected model)
  useEffect(() => {
    try { localStorage.setItem('launchpad-autoplace-settings', JSON.stringify(autoPlaceSettings)) } catch { /* ignore */ }
    // Also sync scaleMultiplier → DWG importer's scaleCorrection so both viewports match
    if (session && autoPlaceSettings.scaleMultiplier) {
      const dwgData = session.steps.find(s => s.id === 'select_dwg')?.data as SelectDwgData | null
      const filename = dwgData?.filename
      if (filename) {
        const dwgKey = `dwg-autoplace-settings-${filename}`
        try {
          const existing = JSON.parse(localStorage.getItem(dwgKey) || '{}')
          existing.scaleCorrection = autoPlaceSettings.scaleMultiplier
          localStorage.setItem(dwgKey, JSON.stringify(existing))
        } catch { /* ignore */ }
      }
    }
  }, [autoPlaceSettings, session])

  const handleRunStep = useCallback(async (stepId: LaunchPadStepId) => {
    if (!session) return
    
    // For commission_edge and pair_devices: check state first, only open modal if user action is needed
    if (stepId === 'commission_edge' || stepId === 'pair_devices') {
      setIsChecking(true)
      try {
        const result = await completeStep(session, stepId)
        setSession(result.session)
        setExpandedStepId(result.session.currentStepId)
        // If step is already satisfied, no need to open modal
        if (result.status === 'done' || result.status === 'warning') {
          return
        }
        // Step needs user action — open the appropriate modal
        if (stepId === 'commission_edge') setShowEdgeModal(true)
        if (stepId === 'pair_devices') setShowPairModal(true)
      } catch (err) {
        console.error('[LaunchPad] Step check failed:', err)
        // On error, still open modal so user can act
        if (stepId === 'commission_edge') setShowEdgeModal(true)
        if (stepId === 'pair_devices') setShowPairModal(true)
      } finally {
        setIsChecking(false)
      }
      return
    }
    
    // For all other steps: check, validate, and advance if step passes
    setIsChecking(true)
    try {
      const result = await completeStep(session, stepId)
      setSession(result.session)
      // Auto-expand the new current step so user sees where they are
      setExpandedStepId(result.session.currentStepId)
    } catch (err) {
      console.error('[LaunchPad] Step check failed:', err)
    } finally {
      setIsChecking(false)
    }
  }, [session])

  // Re-check ALL steps when user returns from a deep-linked view (cascade)
  const prevViewModeRef = useRef(currentViewMode)
  useEffect(() => {
    const prev = prevViewModeRef.current
    prevViewModeRef.current = currentViewMode
    
    if (!session || !isOpen) return
    // Only trigger when viewMode actually changed
    if (prev === currentViewMode) return
    // Only trigger when returning TO main from a deep-linked view
    if (currentViewMode !== 'main') return
    
    const waitingStep = session.steps.find(s => s.status === 'waiting')
    if (waitingStep) {
      console.log(`[LaunchPad] Returned from ${prev} → main, re-checking ALL steps (trigger: ${waitingStep.id})`)
      // Reset ALL steps so runFullCheck re-evaluates everything from scratch.
      // This is critical because a deep-linked view (e.g. DwgImporter opened from map_fixtures)
      // can change upstream state (e.g. the selected DWG / select_dwg step data).
      const resetSession: LaunchPadSession = {
        ...session,
        steps: session.steps.map(s => ({
          ...s, status: 'ready' as const, data: null, error: null, warnings: []
        })),
      }
      setIsChecking(true)
      runFullCheck(resetSession).then(updated => {
        setSession(updated)
        setExpandedStepId(updated.currentStepId)
        setIsChecking(false)
      }).catch(() => setIsChecking(false))
    }
  }, [currentViewMode, session, isOpen])

  const handleOpenStep = useCallback((stepId: LaunchPadStepId) => {
    const meta = getStepMeta(stepId)
    if (!meta.deepLinkViewMode) return

    // For steps that deep-link to the CURRENT view (e.g. define_rois → 'main'),
    // don't navigate away — just run the check and dispatch an activation event
    if (meta.deepLinkViewMode === currentViewMode || (meta.deepLinkViewMode === 'main' && currentViewMode === 'main')) {
      // Dispatch step-specific activation event (e.g. ROI drawing mode)
      window.dispatchEvent(new CustomEvent('launchpad-step-activate', { detail: { stepId } }))
      // Re-check the step immediately (user may have already done the work)
      if (session) {
        setIsChecking(true)
        checkStep(session, stepId).then(result => {
          setSession(result.session)
          setIsChecking(false)
        }).catch(() => setIsChecking(false))
      }
      return
    }

    // Mark step as "waiting" before deep-linking to another view
    if (session) {
      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === stepId && s.status !== 'locked'
            ? { ...s, status: 'waiting' as const, startedAt: s.startedAt || new Date().toISOString() }
            : s
        ),
      }
      setSession(updated)
      saveSession(updated)
    }
    onDeepLink(meta.deepLinkViewMode)
  }, [session, onDeepLink, currentViewMode])

  // Inline DWG import selection — user picks a DWG right from the drawer
  const handleSelectImport = useCallback(async (importId: string) => {
    if (!session) return
    let updatedSession = session
    setIsChecking(true)
    try {
      // CRITICAL: clear old layout selection FIRST so checkStep doesn't
      // pick the previous DWG via Priority 1 (venueDwg-selectedLayout)
      localStorage.removeItem('venueDwg-selectedLayout')
      localStorage.removeItem('launchpad-awaitUserDwg')
      localStorage.setItem('launchpad-activeImportId', importId)

      // Check if this import has a layout → sync to venueDwg-selectedLayout
      let layouts = await api.listImportLayouts(importId)
      if (layouts.length === 0) {
        // No layout exists — auto-generate one
        console.log('[LaunchPad] No layout for import, auto-generating...')
        try {
          const effectiveVenueId = session.venueId || venueId
          const result = await api.generateLayout(importId, effectiveVenueId || undefined)
          console.log('[LaunchPad] Layout generated:', result.layout_version_id)
          // Re-fetch layouts to get the newly created one
          layouts = await api.listImportLayouts(importId)
        } catch (genErr: any) {
          console.error('[LaunchPad] Auto-generate layout failed:', genErr.message)
        }
      }
      if (layouts.length > 0) {
        const best = layouts.find(l => l.is_active) || layouts[0]
        localStorage.setItem('venueDwg-selectedLayout', best.id)
        window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: best.id } }))

      }

      // Force geometry re-fetch by clearing the cached importId
      lastGeometryImportId.current = null

      // Reset all steps and re-run cascade with fresh data
      const resetSession: LaunchPadSession = {
        ...updatedSession,
        steps: session.steps.map(s => ({
          ...s, status: 'ready' as const, data: null, error: null, warnings: []
        })),
      }
      const updated = await runFullCheck(resetSession)
      setSession(updated)
      setExpandedStepId(updated.currentStepId)
    } catch (err) {
      console.error('[LaunchPad] Import selection failed:', err)
    } finally {
      setIsChecking(false)
    }
  }, [session])

  const handleRefreshAll = useCallback(async () => {
    if (!session) return
    setIsChecking(true)
    initialCheckDone.current = false
    lastGeometryImportId.current = null // force geometry re-fetch
    try {
      const updated = await runFullCheck(session)
      setSession(updated)
      setExpandedStepId(updated.currentStepId)
    } catch (err) {
      console.error('[LaunchPad] Full check failed:', err)
    } finally {
      setIsChecking(false)
    }
  }, [session])

  const handleResetSession = useCallback(() => {
    if (!confirm('Reset LaunchPad? This will clear all progress.')) return
    clearSession()
    // Clear DWG selection keys so select_dwg doesn't auto-complete
    localStorage.removeItem('venueDwg-selectedLayout')
    localStorage.removeItem('launchpad-activeImportId')
    localStorage.setItem('launchpad-awaitUserDwg', 'true')
    const s = createSession(venueId, venueName)
    saveSession(s)
    setSession(s)
    setExpandedStepId('select_dwg')
    initialCheckDone.current = false
    lastGeometryImportId.current = null
    setGeometry(undefined)
    setAiEnhanced(false)
    setAutopilot({ state: 'idle', activeStepId: null, waitingFor: null, stageMessage: null, show3DFlythrough: false })
    setShowStage(false)
    setStageMode('normal')
  }, [venueId, venueName])

  // AI Enhance — call GPT-4o Vision to improve fixture classifications
  const handleAiEnhance = useCallback(async () => {
    if (!session || aiEnhancing) return
    const selectDwgStep = session.steps.find(s => s.id === 'select_dwg')
    const dwgData = selectDwgStep?.data as SelectDwgData | null
    const importId = dwgData?.importId
    if (!importId) {
      console.warn('[LaunchPad] No importId for AI enhance')
      return
    }

    setAiEnhancing(true)
    try {
      console.log('[LaunchPad] Running AI classification for import', importId)
      const aiResult = await api.aiClassifyImport(importId, true)
      console.log('[LaunchPad] AI result:', aiResult.cached ? 'cached' : `${aiResult.latencyMs}ms`, aiResult.classifications?.classifications?.length, 'groups')

      // Merge AI results into the current map_fixtures classifications
      const mapStep = session.steps.find(s => s.id === 'map_fixtures')
      const mapData = mapStep?.data as MapFixturesData | null
      if (mapData?.classifications) {
        const merged = api.mergeAiClassifications(mapData.classifications, aiResult)
        const mappedCount = merged.filter(c => c.accepted).length
        const newData: MapFixturesData = {
          ...mapData,
          classifications: merged,
          mappedGroups: mappedCount,
          allAccepted: mappedCount === merged.length,
        }
        const updatedSession: LaunchPadSession = {
          ...session,
          steps: session.steps.map(s =>
            s.id === 'map_fixtures'
              ? { ...s, data: newData }
              : s
          ),
        }
        setSession(updatedSession)
        saveSession(updatedSession)

        // Also update geometry classifications for the mini viewport
        if (geometry) {
          setGeometry({
            ...geometry,
            classifications: merged.map(c => ({
              groupId: c.groupId,
              suggestedType: c.suggestedType,
              confidence: c.confidence,
            })),
          })
        }

        // Persist merged classifications to dwg_mappings so DWG Importer stays in sync
        try {
          const groupMappings: Record<string, { type: string; catalog_asset_id: string; anchor: string; scale_multiplier: number; rotation_offset_deg: number }> = {}
          for (const c of merged) {
            if (c.suggestedType && !groupMappings[c.groupId]) {
              groupMappings[c.groupId] = {
                type: c.suggestedType,
                catalog_asset_id: c.suggestedType,
                anchor: 'center',
                scale_multiplier: 1,
                rotation_offset_deg: 0,
              }
            }
          }
          await api.saveMapping(importId, { group_mappings: groupMappings })
          console.log(`[LaunchPad] AI classifications saved to dwg_mappings (${Object.keys(groupMappings).length} groups)`)

          // Regenerate layout + refresh venue objects
          const effectiveVenueId = session.venueId || venueId
          if (effectiveVenueId) {
            const refreshResult = await api.refreshVenueFromLayout(importId, effectiveVenueId)
            console.log(`[LaunchPad] Venue refreshed after AI enhance: ${refreshResult.objectCount} objects`)
          }
        } catch (syncErr: any) {
          console.warn('[LaunchPad] AI classification sync failed:', syncErr.message)
        }
      }

      setAiEnhanced(true)
    } catch (err: any) {
      console.error('[LaunchPad] AI enhance failed:', err.message)
      alert(`AI classification failed: ${err.message}`)
    } finally {
      setAiEnhancing(false)
    }
  }, [session, aiEnhancing, geometry])

  // Open Classify by Example modal
  const handleClassifyByExample = useCallback(() => {
    setShowClassifyModal(true)
  }, [])

  // Open ROI drawing modal — resolve venue first if needed
  const handleDrawRois = useCallback(async () => {
    const currentVenueId = sessionRef.current?.venueId || venueId
    if (!currentVenueId) {
      try {
        const { venueId: resolvedId, venueName: resolvedName } = await api.ensureVenueId(null)
        setSession(prev => {
          if (!prev) return prev
          const updated = { ...prev, venueId: resolvedId, venueName: resolvedName }
          saveSession(updated)
          sessionRef.current = updated
          return updated
        })
      } catch (err) {
        console.error('[LaunchPad] Cannot open ROI modal — no venue:', err)
        alert('No venue available. Please select a venue first.')
        return
      }
    }
    setShowRoiModal(true)
  }, [venueId])

  // ROI changed — refresh geometry and re-check step
  const handleRoiChanged = useCallback(() => {
    // Force geometry re-fetch
    lastGeometryImportId.current = null
    // Trigger re-check of session to update step state
    if (session) {
      // Re-fetch geometry inline
      const selectDwgStep = session.steps.find(s => s.id === 'select_dwg')
      const dwgData = selectDwgStep?.data as SelectDwgData | null
      const importId = dwgData?.importId
      const layoutVersionId = dwgData?.layoutVersionId
      if (importId) {
        api.getImportDetails(importId).then(async (details) => {
          // Filter out deleted fixtures
          const deletedIds = new Set(await api.getDeletedFixtureIds(importId))
          const fixtures: MiniFixture[] = details.fixtures
            .filter((f: any) => !deletedIds.has(f.id))
            .map((f: any) => ({
              id: f.id, x: f.pose2d.x, y: f.pose2d.y,
              w: f.footprint.w, d: f.footprint.d,
              rot_deg: f.pose2d.rot_deg || 0, group_id: f.group_id, points: f.footprint.points,
            }))
          const b = details.bounds || {} as any
          const bounds = (b.minX != null) ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : undefined
          let rois: MiniRoi[] = []
          if (session.venueId) {
            try {
              const roiList = await api.listRois(session.venueId, layoutVersionId || undefined)
              rois = roiList.map((r: any) => {
                let vertices: Array<{ x: number; y: number }> = []
                try {
                  const parsed = typeof r.vertices === 'string' ? JSON.parse(r.vertices) : r.vertices
                  vertices = Array.isArray(parsed) ? parsed.map((v: any) => ({ x: v.x ?? v[0], y: v.y ?? v.z ?? v[1] })) : []
                } catch { /* bad JSON */ }
                return { name: r.name, color: r.color || '#818cf8', vertices }
              })
            } catch { /* no ROIs */ }
          }
          // Fetch LiDAR instances (convert meters → DXF units)
          // Must use the same effective scale that autoplace used: baseScale × scaleMultiplier
          const bus = details.unit_scale_to_m || 0.001
          const eff = bus * (autoPlaceSettings.scaleMultiplier || 1)
          let lidars: MiniLidar[] = []
          if (layoutVersionId) {
            try {
              const instances = await api.listLidarInstances(layoutVersionId)
              const models = await api.listLidarModels()
              lidars = instances.map(inst => {
                const model = models.find(m => m.id === inst.model_id)
                return {
                  id: inst.id,
                  model_id: inst.model_id,
                  x: inst.x_m / eff,
                  z: inst.z_m / eff,
                  range_m: (model?.range_m || 20) / eff,
                }
              })
            } catch { /* no LiDARs yet */ }
          }
          // Load saved mapping from DB; fall back to heuristic
          let classifications: Array<{ groupId: string; suggestedType: string; confidence: number }> = []
          try {
            const mapping = await api.getMapping(importId)
            const gm = mapping.group_mappings || {}
            if (Object.keys(gm).length > 0) {
              classifications = Object.entries(gm).map(([groupId, m]) => ({
                groupId, suggestedType: (m as any).type || 'unknown', confidence: 1,
              }))
            }
          } catch { /* no saved mapping */ }
          if (classifications.length === 0) {
            const fp = details.fixtures.map((f: any) => ({
              id: f.id, group_id: f.group_id, x: f.pose2d.x, y: f.pose2d.y,
              rot_deg: f.pose2d.rot_deg || 0, w: f.footprint.w, d: f.footprint.d, points: f.footprint.points,
            }))
            classifications = api.classifyFixtureGroups(details.groups, fp).map(c => ({
              groupId: c.groupId, suggestedType: c.suggestedType, confidence: c.confidence,
            }))
          }
          setGeometry(prev => prev ? { ...prev, rois, fixtures, bounds, lidars, classifications } : { fixtures, bounds, rois, lidars, classifications })
          lastGeometryImportId.current = importId
        }).catch(() => {})
      }
      // Re-check define_rois step
      setIsChecking(true)
      checkStep(session, 'define_rois').then(result => {
        setSession(result.session)
        saveSession(result.session)
        setIsChecking(false)
      }).catch(() => setIsChecking(false))
    }
  }, [session])

  // LiDAR interaction — update position (DXF coords → meters via effectiveScale)
  const getEffectiveScale = useCallback(() => {
    if (!session) return 0.001
    // Cache the scale so we don't need to refetch every time
    const stored = localStorage.getItem('launchpad-autoplace-settings')
    const settings = stored ? JSON.parse(stored) : {}
    return (settings.scaleMultiplier || 1) * 0.001 // default unit_scale_to_m for mm
  }, [session])

  const handleLidarUpdate = useCallback(async (id: string, dxfX: number, dxfZ: number) => {
    try {
      const eff = getEffectiveScale()
      await api.updateLidarInstance(id, { x_m: dxfX * eff, z_m: dxfZ * eff })
      // Refresh geometry to reflect new positions
      lastGeometryImportId.current = null
      handleRoiChanged()
    } catch (err) { console.error('[LaunchPad] LiDAR update failed:', err) }
  }, [getEffectiveScale, handleRoiChanged])

  const handleLidarAdd = useCallback(async (dxfX: number, dxfZ: number) => {
    if (!session) return
    const dwgData = session.steps.find(s => s.id === 'select_dwg')?.data as SelectDwgData | null
    if (!dwgData?.layoutVersionId) return
    try {
      const eff = getEffectiveScale()
      await api.createLidarInstance({
        layout_version_id: dwgData.layoutVersionId,
        model_id: autoPlaceSettings.modelId,
        x_m: dxfX * eff,
        z_m: dxfZ * eff,
        mount_y_m: 3,
      })
      lastGeometryImportId.current = null
      handleRoiChanged()
    } catch (err) { console.error('[LaunchPad] LiDAR add failed:', err) }
  }, [session, getEffectiveScale, autoPlaceSettings.modelId, handleRoiChanged])

  const handleLidarDelete = useCallback(async (id: string) => {
    try {
      await api.deleteLidarInstance(id)
      lastGeometryImportId.current = null
      handleRoiChanged()
    } catch (err) { console.error('[LaunchPad] LiDAR delete failed:', err) }
  }, [handleRoiChanged])

  // Auto-place LiDARs using ROIs
  const handleAutoPlace = useCallback(async () => {
    if (!session || autoPlacing) return
    const dwgStep = session.steps.find(s => s.id === 'select_dwg')
    const dwgData = dwgStep?.data as SelectDwgData | null
    const effectiveVenueId = session.venueId || venueId
    console.log('%c[FLOW-DEBUG] ══════════════════════════════════════════════════════', 'color:#ff6b6b;font-weight:bold')
    console.log('%c[FLOW-DEBUG] AUTO-PLACE TRIGGERED', 'color:#ff6b6b;font-size:14px;font-weight:bold')
    console.log('%c[FLOW-DEBUG] Input:', 'color:#ff6b6b', {
      layoutVersionId: dwgData?.layoutVersionId,
      venueId: effectiveVenueId,
      importId: dwgData?.importId,
      settings: autoPlaceSettings,
    })
    if (!dwgData?.layoutVersionId) {
      console.error('[LaunchPad AutoPlace] No layoutVersionId — generate a layout first')
      alert('No layout generated yet for this DWG. Please generate a layout in the DWG Importer first, or select a DWG with an existing layout.')
      return
    }
    if (!effectiveVenueId) {
      console.error('[LaunchPad AutoPlace] No venueId — select a venue first')
      alert('No venue selected. Please select a venue first.')
      return
    }

    setAutoPlacing(true)
    try {
      console.log('%c[FLOW-DEBUG] Calling api.autoPlaceWithRois...', 'color:#ff6b6b')
      const placeLidarsData = await api.autoPlaceWithRois(
        dwgData.layoutVersionId,
        effectiveVenueId,
        dwgData.layoutVersionId || undefined,
        autoPlaceSettings,
      )
      console.log('%c[FLOW-DEBUG] AutoPlace RESULT:', 'color:#22c55e;font-weight:bold', {
        sensorCount: placeLidarsData.sensorCount,
        coveragePct: (placeLidarsData.coveragePct * 100).toFixed(1) + '%',
        meetsCoverage: placeLidarsData.meetsCoverage,
      })
      console.log('%c[FLOW-DEBUG] ══════════════════════════════════════════════════════', 'color:#22c55e;font-weight:bold')
      // Update step with new data
      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'place_lidars'
            ? { ...s, status: (placeLidarsData.meetsCoverage ? 'done' : 'warning') as any, data: placeLidarsData }
            : s
        ),
      }
      setSession(updated)
      saveSession(updated)

      // Refresh geometry to show new LiDAR positions
      lastGeometryImportId.current = null
      handleRoiChanged()
    } catch (err: any) {
      console.error('[LaunchPad] Auto-place failed:', err)
      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'place_lidars'
            ? { ...s, status: 'error' as any, error: err.message || 'Auto-place failed' }
            : s
        ),
      }
      setSession(updated)
      saveSession(updated)
    } finally {
      setAutoPlacing(false)
    }
  }, [session, autoPlacing, venueId, autoPlaceSettings])

  // HER deployment handler
  const handleDeployHer = useCallback(async () => {
    if (!session || herDeploying) return
    const edgeStep = session.steps.find(s => s.id === 'commission_edge')
    const edgeData = edgeStep?.data as CommissionEdgeData | null
    const dwgStep = session.steps.find(s => s.id === 'select_dwg')
    const dwgData = dwgStep?.data as SelectDwgData | null
    const effectiveVenueId = session.venueId || venueId

    // Use Tailscale IP as the edge identifier - it's the most reliable from commission_edge step
    const edgeIdentifier = edgeData?.edgeTailscaleIp || edgeData?.edgeId
    if (!edgeIdentifier || !effectiveVenueId || !dwgData?.layoutVersionId) {
      console.warn('[LaunchPad] Missing edge/venue/layout — using simulation mode for HER deploy')
      const simData: DeployHerData = {
        edgeId: edgeIdentifier || null,
        providerId: null,
        providerName: 'Simulator',
        status: 'ready',
        tailscaleInstalled: false,
        dockerAvailable: false,
        pairedLidarCount: 0,
        deployedAt: null,
        lastError: null,
        deploymentLogs: ['Simulation mode — no real edge/venue/layout available'],
      }
      const simWarnings: string[] = []
      if (!edgeIdentifier) simWarnings.push('No edge device')
      if (!effectiveVenueId) simWarnings.push('No venue selected')
      if (!dwgData?.layoutVersionId) simWarnings.push('No layout version')
      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'deploy_her' ? { ...s, status: 'warning' as const, data: simData, error: null, warnings: simWarnings } : s
        ),
      }
      setSession(updated)
      saveSession(updated)
      return
    }

    setHerDeploying(true)
    try {
      // Update step to deploying status - clear old errors and logs
      const deployingData: DeployHerData = {
        edgeId: edgeIdentifier,
        providerId: selectedProviderId || null,
        providerName: algorithmProviders.find(p => p.id === selectedProviderId)?.name || null,
        status: 'deploying',
        tailscaleInstalled: true,
        dockerAvailable: true,
        pairedLidarCount: (session.steps.find(s => s.id === 'pair_devices')?.data as PairDevicesData | null)?.pairedCount || 0,
        deployedAt: null,
        lastError: null,
        containerStatus: 'starting',
        deploymentLogs: [], // Clear old logs when starting new deployment
      }
      let updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'deploy_her' ? { ...s, status: 'running' as const, data: deployingData, error: null } : s
        ),
      }
      setSession(updated)

      // Build initial deployment logs
      const provider = algorithmProviders.find(p => p.id === selectedProviderId)
      const logs: string[] = [
        `Starting HER deployment...`,
        `Provider: ${provider?.name || 'Unknown'} v${provider?.version || '?'}`,
        `Edge: ${edgeData.edgeHostname || edgeData.edgeId}`,
        `Sending deploy request to backend...`,
      ]

      // Call the deploy API using Tailscale IP as edge identifier
      const result = await api.deployHer(
        edgeIdentifier,
        effectiveVenueId,
        selectedProviderId || 'robosense-her',
        mqttBrokerUrl || undefined
      )

      if (result.ok) {
        // Add success logs
        logs.push(`✅ Deploy request sent successfully`)
        if (result.deploymentId) logs.push(`Deployment ID: ${result.deploymentId}`)
        if (result.containerId) logs.push(`Container ID: ${result.containerId.substring(0, 12)}`)
        if (result.imagePulled !== undefined) logs.push(`Image Pulled: ${result.imagePulled ? 'Yes' : 'No'}`)
        if (result.containerRunning !== undefined) logs.push(`Container Running: ${result.containerRunning ? 'Yes' : 'No'}`)
        logs.push(`✅ HER deployment complete!`)

        const runningData: DeployHerData = {
          ...deployingData,
          status: 'running',
          providerName: result.moduleStatus?.provider || deployingData.providerName,
          deployedAt: new Date().toISOString(),
          containerStatus: 'running',
          deploymentLogs: logs,
          deploymentId: result.deploymentId,
          containerId: result.containerId,
          imagePulled: result.imagePulled,
        }
        updated = {
          ...session,
          steps: session.steps.map(s =>
            s.id === 'deploy_her' ? { ...s, status: 'done' as const, data: runningData, error: null } : s
          ),
        }
        setSession(updated)
        saveSession(updated)
        console.log('[LaunchPad] HER deployed successfully:', result.moduleStatus)
      } else {
        logs.push(`⚠ Deployment issue: ${result.error || result.message}`)
        logs.push(`Continuing in simulation mode...`)
        const warnData: DeployHerData = {
          ...deployingData,
          status: 'ready',
          lastError: result.error || result.message || 'Deployment failed',
          containerStatus: undefined,
          deploymentLogs: logs,
        }
        updated = {
          ...session,
          steps: session.steps.map(s =>
            s.id === 'deploy_her' ? { ...s, status: 'warning' as const, data: warnData, error: null, warnings: [result.error || result.message || 'Deploy failed — simulation mode'] } : s
          ),
        }
        setSession(updated)
        saveSession(updated)
      }
    } catch (err: any) {
      console.error('[LaunchPad] HER deploy failed:', err)
      const warnData: DeployHerData = {
        edgeId: edgeData?.edgeId || null,
        providerId: selectedProviderId || null,
        providerName: null,
        status: 'ready',
        tailscaleInstalled: true,
        dockerAvailable: true,
        pairedLidarCount: 0,
        deployedAt: null,
        lastError: err.message || 'Deployment failed',
        deploymentLogs: [`⚠ ${err.message || 'Deployment failed'}`, 'Continuing in simulation mode...'],
      }
      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'deploy_her' ? { ...s, status: 'warning' as const, data: warnData, error: null, warnings: [err.message || 'Deploy failed — simulation mode'] } : s
        ),
      }
      setSession(updated)
      saveSession(updated)
    } finally {
      setHerDeploying(false)
    }
  }, [session, herDeploying, venueId, selectedProviderId, algorithmProviders])

  // Stop HER handler
  const handleStopHer = useCallback(async () => {
    if (!session) return
    const edgeStep = session.steps.find(s => s.id === 'commission_edge')
    const edgeData = edgeStep?.data as CommissionEdgeData | null
    if (!edgeData?.edgeId) return

    try {
      await api.stopHer(edgeData.edgeId)
      // Update step to ready status
      const herStep = session.steps.find(s => s.id === 'deploy_her')
      const herData = herStep?.data as DeployHerData | null
      const stoppedData: DeployHerData = {
        edgeId: edgeData.edgeId,
        providerId: herData?.providerId || null,
        providerName: herData?.providerName || null,
        status: 'stopped',
        tailscaleInstalled: true,
        dockerAvailable: true,
        pairedLidarCount: herData?.pairedLidarCount || 0,
        deployedAt: null,
        lastError: null,
      }
      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'deploy_her' ? { ...s, status: 'ready' as const, data: stoppedData } : s
        ),
      }
      setSession(updated)
      saveSession(updated)
    } catch (err: any) {
      console.error('[LaunchPad] HER stop failed:', err)
    }
  }, [session])

  // Stream validation handler
  const handleRunValidation = useCallback(async () => {
    if (!session || validating) return
    const edgeStep = session.steps.find(s => s.id === 'commission_edge')
    const edgeData = edgeStep?.data as CommissionEdgeData | null
    const effectiveVenueId = session.venueId || venueId

    setValidating(true)
    try {
      let validationData: ValidateStreamData
      let stepStatus: 'done' | 'warning' | 'error'

      if (edgeData?.edgeId) {
        validationData = await api.runStreamValidation(edgeData.edgeId, effectiveVenueId || undefined)
        stepStatus = validationData.overallHealthy && validationData.stage === 'complete'
          ? 'done'
          : validationData.checks.some(c => c.status === 'fail')
            ? 'warning'
            : 'warning'
      } else {
        // Simulation mode — no edge device
        validationData = {
          checks: [],
          stage: 'complete',
          lidarStatuses: [],
          mqttConnected: false,
          overallHealthy: false,
        }
        stepStatus = 'warning'
      }

      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'validate_stream'
            ? { ...s, status: stepStatus, data: validationData, error: null }
            : s
        ),
      }
      setSession(updated)
      saveSession(updated)
    } catch (err: any) {
      console.error('[LaunchPad] Validation failed:', err)
      // Even on failure, mark as warning so autopilot can proceed
      const simData: ValidateStreamData = {
        checks: [],
        stage: 'complete',
        lidarStatuses: [],
        mqttConnected: false,
        overallHealthy: false,
      }
      const updated = {
        ...session,
        steps: session.steps.map(s =>
          s.id === 'validate_stream'
            ? { ...s, status: 'warning' as const, data: simData, error: null, warnings: [`Validation error: ${err.message}`] }
            : s
        ),
      }
      setSession(updated)
      saveSession(updated)
    } finally {
      setValidating(false)
    }
  }, [session, validating, venueId])

  // ─── Autopilot: auto-advance loop ───────────────────────────────
  const STEP_ORDER: LaunchPadStepId[] = [
    'select_dwg', 'map_fixtures', 'define_rois', 'place_lidars',
    'commission_edge', 'pair_devices', 'deploy_her', 'validate_stream', 'go_live',
  ]

  const advanceAutopilot = useCallback(async (fromStepId?: LaunchPadStepId) => {
    const s = sessionRef.current
    if (!s || autopilotRef.current.state !== 'running') return

    // Find next step to process
    const startIdx = fromStepId ? STEP_ORDER.indexOf(fromStepId) : 0
    for (let i = startIdx; i < STEP_ORDER.length; i++) {
      const stepId = STEP_ORDER[i]
      const step = s.steps.find(st => st.id === stepId)
      if (!step) continue

      // Skip already-done steps
      if (step.status === 'done' || step.status === 'warning') continue

      setAutopilot(prev => ({ ...prev, activeStepId: stepId, stageMessage: `Processing ${stepId.replace(/_/g, ' ')}...` }))
      setExpandedStepId(stepId)

      // Run the check
      try {
        const result = await checkStep(s, stepId)
        const updatedSession = result.session
        setSession(updatedSession)
        saveSession(updatedSession)
        sessionRef.current = updatedSession

        const updatedStep = updatedSession.steps.find(st => st.id === stepId)

        // Step completed — brief pause then advance
        if (updatedStep?.status === 'done' || updatedStep?.status === 'warning') {
          // Special: after place_lidars done, show 3D flythrough
          if (stepId === 'place_lidars') {
            setAutopilot(prev => ({
              ...prev,
              state: 'waiting_input',
              activeStepId: stepId,
              stageMessage: null,
              show3DFlythrough: false, // will show after accept
              waitingFor: 'manual',
            }))
            return
          }

          setAutopilot(prev => ({ ...prev, stageMessage: `${stepId.replace(/_/g, ' ')} ✓` }))
          await new Promise(r => setTimeout(r, 600))
          continue // next step
        }

        // Step needs action — determine what kind
        if (stepId === 'select_dwg' && updatedStep?.status === 'ready') {
          setAutopilot(prev => ({ ...prev, state: 'waiting_input', waitingFor: 'dwg_upload', stageMessage: null }))
          return
        }
        if (stepId === 'map_fixtures') {
          // Auto-open the existing classify-by-example modal
          setAutopilot(prev => ({ ...prev, state: 'waiting_input', waitingFor: 'classification_review', stageMessage: null }))
          setShowClassifyModal(true)
          return
        }
        if (stepId === 'define_rois') {
          // Auto-open the existing ROI drawing modal (handleDrawRois resolves venue first)
          setAutopilot(prev => ({ ...prev, state: 'waiting_input', waitingFor: 'roi_drawing', stageMessage: null }))
          await handleDrawRois()
          return
        }
        if (stepId === 'place_lidars' && updatedStep?.status === 'ready') {
          // Auto-trigger autoplace
          setAutopilot(prev => ({ ...prev, stageMessage: 'Running auto-placement...' }))
          // Trigger autoplace then come back
          handleAutoPlace()
          return
        }
        if (stepId === 'commission_edge') {
          setAutopilot(prev => ({ ...prev, state: 'waiting_input', waitingFor: 'edge_connect', stageMessage: null }))
          setShowEdgeModal(true)
          return
        }
        if (stepId === 'pair_devices') {
          setAutopilot(prev => ({ ...prev, state: 'waiting_input', waitingFor: 'manual', stageMessage: null }))
          setShowPairModal(true)
          return
        }
        if (stepId === 'deploy_her' && updatedStep?.status === 'ready') {
          // Auto-trigger HER deployment
          setAutopilot(prev => ({ ...prev, stageMessage: 'Deploying HER...' }))
          handleDeployHer()
          return
        }
        if (stepId === 'validate_stream' && updatedStep?.status === 'ready') {
          // Auto-trigger stream validation
          setAutopilot(prev => ({ ...prev, stageMessage: 'Validating stream...' }))
          handleRunValidation()
          return
        }
        if (stepId === 'go_live') {
          // Go live completes the flow — dispatch event to launch Neural Dashboard
          window.dispatchEvent(new CustomEvent('launchpad-go-live', { detail: { venueId: s.venueId, venueName: s.venueName } }))
          setAutopilot(prev => ({ ...prev, state: 'complete', stageMessage: null, activeStepId: null }))
          return
        }

        // Generic wait
        setAutopilot(prev => ({ ...prev, state: 'waiting_input', waitingFor: 'manual', stageMessage: null }))
        return
      } catch (err) {
        console.error('[Autopilot] Step failed:', stepId, err)
        setAutopilot(prev => ({ ...prev, state: 'waiting_input', waitingFor: 'manual', stageMessage: null }))
        return
      }
    }

    // All steps done
    setAutopilot(prev => ({ ...prev, state: 'complete', stageMessage: null, activeStepId: null }))
  }, [handleAutoPlace, handleDeployHer, handleRunValidation])

  const handlePlayPause = useCallback(() => {
    if (autopilot.state === 'running') {
      setAutopilot(prev => ({ ...prev, state: 'paused', stageMessage: null }))
    } else {
      setShowStage(true)
      setAutopilot(prev => ({
        ...prev,
        state: 'running',
        show3DFlythrough: false,
        waitingFor: null,
        stageMessage: 'Starting...',
      }))
      // Start from current step
      const firstIncomplete = session?.steps.find(s =>
        s.status !== 'done' && s.status !== 'warning' && s.status !== 'locked'
      )
      setTimeout(() => advanceAutopilot(firstIncomplete?.id || 'select_dwg'), 300)
    }
  }, [autopilot.state, session, advanceAutopilot])

  // Stage callbacks
  const handleStageDwgUploaded = useCallback(async (importId: string) => {
    if (!session) return
    let updatedSession = session
    try {
      // Register the new import so checkStep can find it
      localStorage.setItem('launchpad-activeImportId', importId)
      localStorage.removeItem('launchpad-awaitUserDwg')

      // Auto-generate a layout for this import (needed for select_dwg to complete)
      const effectiveVenueId = session.venueId || venueId
      try {
        const result = await api.generateLayout(importId, effectiveVenueId || undefined)
        localStorage.setItem('venueDwg-selectedLayout', result.layout_version_id)
        window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: result.layout_version_id } }))

        // Create a NEW venue from this layout (no company = Unassigned Venues)
        // NEVER pass an existing venueId — always a fresh venue for a fresh DWG upload
        try {
          const bootstrapped = await api.bootstrapVenueFromLayout(result.layout_version_id)
          updatedSession = { ...updatedSession, venueId: bootstrapped.venueId, venueName: bootstrapped.venueName }
          console.log(`[LaunchPad] Created new venue: ${bootstrapped.venueName} (${bootstrapped.venueId}) with ${bootstrapped.objectCount} objects`)
          // Notify ModeBar and other components about the new venue
          window.dispatchEvent(new CustomEvent('launchpad-venue-created', { detail: { venueId: bootstrapped.venueId, venueName: bootstrapped.venueName } }))
        } catch (bErr: any) {
          console.warn('[LaunchPad] Venue creation failed (non-fatal):', bErr.message)
        }
      } catch (err) {
        console.warn('[LaunchPad] Auto-generate layout after upload failed:', err)
      }

      // Force geometry re-fetch and run full check
      lastGeometryImportId.current = null
      initialCheckDone.current = false
      const updated = await runFullCheck(updatedSession)
      setSession(updated)
      saveSession(updated)
      sessionRef.current = updated

      // Also refresh available imports list
      api.listDwgImports().then(imports => {
        setAvailableImports(imports.map(imp => ({
          import_id: imp.import_id, venue_id: imp.venue_id, filename: imp.filename,
          units: imp.units, status: imp.status, created_at: imp.created_at,
          fixture_count: 0, group_count: 0, has_layout: false,
        })))
      }).catch(() => {})

      // Resume autopilot
      setAutopilot(prev => ({ ...prev, state: 'running', waitingFor: null, stageMessage: 'DWG loaded, advancing...' }))
      setTimeout(() => advanceAutopilot('map_fixtures'), 500)
    } catch (err) {
      console.error('[LaunchPad] Stage DWG upload handling failed:', err)
    }
  }, [session, venueId, advanceAutopilot])

  const handleStageAcceptClassification = useCallback(() => {
    setAutopilot(prev => ({ ...prev, state: 'running', waitingFor: null, stageMessage: 'Classification accepted' }))
    setTimeout(() => advanceAutopilot('define_rois'), 500)
  }, [advanceAutopilot])

  const handleStageRejectClassification = useCallback(() => {
    setShowClassifyModal(true)
  }, [])

  const handleStageAcceptRois = useCallback(() => {
    setAutopilot(prev => ({ ...prev, state: 'running', waitingFor: null, stageMessage: 'ROIs accepted' }))
    setTimeout(() => advanceAutopilot('place_lidars'), 500)
  }, [advanceAutopilot])

  const handleStageAcceptLidars = useCallback(() => {
    if (cinematicBuildEnabled) {
      // Show cinematic build animation first, then transition to 3D preview
      setStageMode('cinematic_build')
      setAutopilot(prev => ({
        ...prev,
        state: 'paused',
        show3DFlythrough: true,
        waitingFor: null,
        stageMessage: null,
      }))
    } else {
      // Skip cinematic, go straight to 3D preview
      setStageMode('lidar_3d_preview')
      setAutopilot(prev => ({
        ...prev,
        state: 'waiting_input',
        show3DFlythrough: true,
        waitingFor: 'manual',
        stageMessage: null,
      }))
    }
  }, [cinematicBuildEnabled])

  const handleSetStageMode = useCallback((mode: StageMode) => {
    setStageMode(mode)
    // When switching to 3D preview, ensure autopilot is in the right state
    if (mode === 'lidar_3d_preview') {
      setAutopilot(prev => ({
        ...prev,
        state: 'waiting_input',
        show3DFlythrough: true,
        waitingFor: 'manual',
        stageMessage: null,
      }))
    }
  }, [])

  const handleStageContinue = useCallback(() => {
    const currentIdx = STEP_ORDER.indexOf(autopilot.activeStepId || 'select_dwg')
    const nextStepId = STEP_ORDER[currentIdx + 1]
    setStageMode('normal')
    if (nextStepId) {
      setAutopilot(prev => ({
        ...prev,
        state: 'running',
        show3DFlythrough: false,
        waitingFor: null,
        stageMessage: 'Continuing...',
      }))
      setTimeout(() => advanceAutopilot(nextStepId), 300)
    } else {
      setAutopilot(prev => ({ ...prev, state: 'complete' }))
    }
  }, [autopilot.activeStepId, advanceAutopilot])

  // Resume autopilot after autoplace completes
  useEffect(() => {
    if (autopilotRef.current.state === 'running' && autopilotRef.current.activeStepId === 'place_lidars' && !autoPlacing) {
      const step = session?.steps.find(s => s.id === 'place_lidars')
      if (step?.status === 'done' || step?.status === 'warning') {
        setAutopilot(prev => ({
          ...prev,
          state: 'waiting_input',
          waitingFor: 'manual',
          stageMessage: null,
        }))
      }
    }
  }, [autoPlacing, session])

  // Resume autopilot after HER deploy completes
  useEffect(() => {
    if (autopilotRef.current.state === 'running' && autopilotRef.current.activeStepId === 'deploy_her' && !herDeploying) {
      const step = session?.steps.find(s => s.id === 'deploy_her')
      if (step?.status === 'done' || step?.status === 'warning') {
        setTimeout(() => advanceAutopilot('validate_stream'), 500)
      }
    }
  }, [herDeploying, session, advanceAutopilot])

  // Resume autopilot after stream validation completes
  useEffect(() => {
    if (autopilotRef.current.state === 'running' && autopilotRef.current.activeStepId === 'validate_stream' && !validating) {
      const step = session?.steps.find(s => s.id === 'validate_stream')
      if (step?.status === 'done' || step?.status === 'warning') {
        setTimeout(() => advanceAutopilot('go_live'), 500)
      }
    }
  }, [validating, session, advanceAutopilot])

  if (!enabled || !isOpen || !session) return null

  const completedSteps = session.steps.filter(s => s.status === 'done' || s.status === 'warning').length
  const totalSteps = session.steps.length
  const progressPct = (completedSteps / totalSteps) * 100

  const drawerWidth = isMinimized ? 56 : 360

  return (
    <>
      {/* ─── Stage Area (left of drawer) ─── */}
      {showStage && !isMinimized && autopilot.state !== 'idle' && (
        <div
          className="fixed top-0 h-full z-[39] transition-all duration-500 ease-in-out"
          style={{
            right: `${drawerWidth}px`,
            width: `calc(100vw - 320px - ${drawerWidth}px)`, // 320px = sidebar width
            minWidth: 400,
          }}
        >
          <LaunchPadStage
            session={session}
            autopilot={autopilot}
            geometry={geometry}
            stageMode={stageMode}
            onDwgUploaded={handleStageDwgUploaded}
            onAcceptClassification={handleStageAcceptClassification}
            onRejectClassification={handleStageRejectClassification}
            onAcceptRois={handleStageAcceptRois}
            onDrawRois={handleDrawRois}
            onAcceptLidars={handleStageAcceptLidars}
            onContinue={handleStageContinue}
            onSetStageMode={handleSetStageMode}
          />
        </div>
      )}

      {/* ─── Drawer Panel ─── */}
      <div
        className={`fixed top-0 right-0 h-full z-40 flex flex-col bg-gray-900 border-l border-gray-700/80 shadow-2xl transition-all duration-300 ${
          isMinimized ? 'w-14' : 'w-[360px]'
        }`}
      >
      {/* Collapse/expand tab on left edge */}
      {!isMinimized && (
        <button
          onClick={onClose}
          className="absolute -left-5 top-1/2 -translate-y-1/2 w-5 h-12 bg-gray-800 border border-gray-700 border-r-0 rounded-l-md flex items-center justify-center text-gray-500 hover:text-indigo-400 hover:bg-gray-750 transition-colors z-50"
          title="Close drawer"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-700/80 bg-gray-850 shrink-0">
        {isMinimized ? (
          <button
            onClick={() => setIsMinimized(false)}
            className="w-8 h-8 flex items-center justify-center text-indigo-400 hover:text-indigo-300"
            title="Expand LaunchPad"
          >
            <Rocket className="w-5 h-5" />
          </button>
        ) : (
          <>
            <Rocket className="w-4 h-4 text-indigo-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">LaunchPad</h2>
              <p className="text-[10px] text-gray-500 truncate">
                {session.isComplete
                  ? '✅ Commissioning complete'
                  : `Step ${completedSteps + 1} of ${totalSteps}`}
              </p>
            </div>

            {/* Header buttons */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Play/Pause autopilot */}
              <button
                onClick={handlePlayPause}
                className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                  autopilot.state === 'running'
                    ? 'text-amber-400 hover:text-amber-300 bg-amber-500/10'
                    : autopilot.state === 'complete'
                      ? 'text-green-400 hover:text-green-300'
                      : 'text-indigo-400 hover:text-indigo-300'
                }`}
                title={autopilot.state === 'running' ? 'Pause autopilot' : 'Start autopilot'}
              >
                {autopilot.state === 'running' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              {/* Toggle stage visibility */}
              {showStage && (
                <button
                  onClick={() => setShowStage(false)}
                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded transition-colors"
                  title="Hide stage"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
              {!showStage && autopilot.state !== 'idle' && (
                <button
                  onClick={() => setShowStage(true)}
                  className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded transition-colors"
                  title="Show stage"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleRefreshAll}
                disabled={isChecking}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50"
                title="Re-check all steps"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={handleResetSession}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-400 rounded transition-colors"
                title="Reset session"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsMinimized(true)}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded transition-colors"
                title="Minimize"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded transition-colors"
                title="Close LaunchPad"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Progress bar */}
      {!isMinimized && (
        <div className="h-1 bg-gray-800 shrink-0">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-green-500 transition-all duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Minimized: vertical step dots */}
      {isMinimized && (
        <div className="flex-1 flex flex-col items-center py-4 gap-2 overflow-y-auto">
          {session.steps.map(step => {
            const isDone = step.status === 'done' || step.status === 'warning'
            const isCurrent = step.id === session.currentStepId
            return (
              <button
                key={step.id}
                onClick={() => {
                  setIsMinimized(false)
                  setExpandedStepId(step.id)
                }}
                className={`w-6 h-6 rounded-full border-2 transition-colors ${
                  isDone
                    ? 'bg-green-500/20 border-green-500/60'
                    : isCurrent
                      ? 'bg-indigo-500/20 border-indigo-500/60 animate-pulse'
                      : step.status === 'error'
                        ? 'bg-red-500/20 border-red-500/60'
                        : 'bg-gray-800 border-gray-700'
                }`}
                title={step.label}
              />
            )
          })}
        </div>
      )}

      {/* Step list */}
      {!isMinimized && (
        <div className="flex-1 overflow-y-auto py-2 scrollbar-thin scrollbar-thumb-gray-700">
          {isChecking && (
            <div className="px-4 py-2 mb-2">
              <div className="flex items-center gap-2 text-xs text-indigo-400">
                <RotateCw className="w-3 h-3 animate-spin" />
                Checking steps...
              </div>
            </div>
          )}

          <LaunchPadStepper
            steps={session.steps}
            currentStepId={session.currentStepId}
            expandedStepId={expandedStepId}
            onExpandStep={setExpandedStepId}
            onRunStep={handleRunStep}
            onOpenStep={handleOpenStep}
            availableImports={availableImports}
            onSelectImport={handleSelectImport}
            geometry={geometry}
            onAiEnhance={handleAiEnhance}
            aiEnhancing={aiEnhancing}
            aiEnhanced={aiEnhanced}
            onDrawRois={handleDrawRois}
            onAutoPlace={handleAutoPlace}
            autoPlacing={autoPlacing}
            autoPlaceSettings={autoPlaceSettings}
            onAutoPlaceSettingsChange={setAutoPlaceSettings}
            lidarModels={lidarModels}
            onClassifyByExample={handleClassifyByExample}
            onLidarUpdate={handleLidarUpdate}
            onLidarAdd={handleLidarAdd}
            onLidarDelete={handleLidarDelete}
            onOpen3DPreview={() => setShow3DPreview(true)}
            dwgLayoutId={(() => {
              const dwgStep = session.steps.find(s => s.id === 'select_dwg')
              const dwgData = dwgStep?.data as SelectDwgData | null
              return dwgData?.layoutVersionId || undefined
            })()}
            unitScaleToM={(() => {
              const stored = localStorage.getItem('launchpad-autoplace-settings')
              const settings = stored ? JSON.parse(stored) : {}
              return (settings.scaleMultiplier || 1) * 0.001
            })()}
            // HER deployment props
            onDeployHer={handleDeployHer}
            onStopHer={handleStopHer}
            herDeploying={herDeploying}
            algorithmProviders={algorithmProviders}
            selectedProviderId={selectedProviderId}
            onSelectProvider={setSelectedProviderId}
            mqttBrokerUrl={mqttBrokerUrl}
            onMqttBrokerUrlChange={(url) => {
              setMqttBrokerUrl(url)
              localStorage.setItem('launchpad-mqttBrokerUrl', url)
            }}
            // Stream validation props
            onRunValidation={handleRunValidation}
            validating={validating}
          />
        </div>
      )}

      {/* Completion summary */}
      {!isMinimized && session.isComplete && (
        <div className="px-3 py-3 border-t border-gray-700/80 bg-green-500/5 shrink-0">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium mb-2">
            <Rocket className="w-4 h-4" />
            Commissioning Complete!
          </div>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('launchpad-go-live', { detail: { venueId: session.venueId, venueName: session.venueName } }))
              onDeepLink('main')
            }}
            className="w-full py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Launch Neural Dashboard
          </button>
        </div>
      )}

      {/* Footer: venue info */}
      {!isMinimized && (
        <div className="px-3 py-2 border-t border-gray-700/50 text-[10px] text-gray-600 shrink-0">
          {session.venueName || 'No venue'} · Session {session.id.slice(0, 8)}
        </div>
      )}

      {/* Classify by Example Modal */}
      {showClassifyModal && (() => {
        if (!geometry || geometry.fixtures.length === 0) {
          console.warn('[LaunchPad] Classify modal: no geometry/fixtures, cannot open')
          return null
        }
        const dwgStep = session.steps.find(s => s.id === 'select_dwg')
        const dwgData = dwgStep?.data as SelectDwgData | null
        const importId = dwgData?.importId || localStorage.getItem('launchpad-activeImportId')
        if (!importId) {
          console.warn('[LaunchPad] Classify modal: no importId available, cannot open')
          return null
        }
        return (
          <FixtureClassifyModal
            fixtures={geometry.fixtures}
            importId={importId}
            existingClassifications={geometry.classifications}
            onClose={() => setShowClassifyModal(false)}
            onSave={async (classifications) => {
              setShowClassifyModal(false)
              // Update geometry with new classifications
              setGeometry(prev => prev ? { ...prev, classifications } : prev)

              // Regenerate layout + refresh venue objects so MainViewport matches LaunchPad 3D
              const effectiveVenueId = session?.venueId || venueId
              if (importId && effectiveVenueId) {
                try {
                  const result = await api.refreshVenueFromLayout(importId, effectiveVenueId)
                  console.log(`[LaunchPad] Venue refreshed after classification: ${result.objectCount} objects`)
                } catch (err: any) {
                  console.warn('[LaunchPad] Venue refresh after classification failed:', err.message)
                }
              }

              // Re-check map_fixtures step
              if (session) {
                setIsChecking(true)
                checkStep(session, 'map_fixtures').then(result => {
                  setSession(result.session)
                  saveSession(result.session)
                  setIsChecking(false)
                }).catch(() => setIsChecking(false))
              }
            }}
          />
        )
      })()}

      {/* ROI Drawing Modal */}
      {showRoiModal && (() => {
        const effectiveVenueId = session.venueId || venueId
        if (!effectiveVenueId) {
          console.warn('[LaunchPad] ROI modal: no venueId available, cannot open')
          return null
        }
        return (
          <RoiDrawingModal
            onClose={() => setShowRoiModal(false)}
            fixtures={geometry?.fixtures || []}
            bounds={geometry?.bounds}
            classifications={geometry?.classifications}
            existingRois={[]}
            venueId={effectiveVenueId}
            dwgLayoutId={(() => {
              const dwgStep = session.steps.find(s => s.id === 'select_dwg')
              const dwgData = dwgStep?.data as SelectDwgData | null
              return dwgData?.layoutVersionId || undefined
            })()}
            onRoiChanged={handleRoiChanged}
            unitScaleToM={(() => {
              const stored = localStorage.getItem('launchpad-autoplace-settings')
              const settings = stored ? JSON.parse(stored) : {}
              return (settings.scaleMultiplier || 1) * 0.001
            })()}
          />
        )
      })()}

      {/* 3D Preview Modal */}
      {show3DPreview && (() => {
        const dwgStep = session.steps.find(s => s.id === 'select_dwg')
        const dwgData = dwgStep?.data as SelectDwgData | null
        if (!dwgData?.layoutVersionId) return null
        return (
          <Lidar3DModal
            layoutVersionId={dwgData.layoutVersionId}
            importId={dwgData.importId || undefined}
            onClose={() => setShow3DPreview(false)}
            rois={geometry?.rois}
            classifications={geometry?.classifications}
          />
        )
      })()}

      {/* Edge Commissioning Modal */}
      {showEdgeModal && (() => {
        const effectiveVenueId = session.venueId || venueId
        if (!effectiveVenueId) {
          console.warn('[LaunchPad] Edge modal: no venueId available, cannot open')
          return null
        }
        const dwgStep = session.steps.find(s => s.id === 'select_dwg')
        const dwgData = dwgStep?.data as SelectDwgData | null
        const placeLidarsStep = session.steps.find(s => s.id === 'place_lidars')
        const placeLidarsData = placeLidarsStep?.data as { sensorCount?: number } | null
        const neededLidars = placeLidarsData?.sensorCount || 0
        return (
          <EdgeCommissioningModal
            venueId={effectiveVenueId}
            layoutVersionId={dwgData?.layoutVersionId || undefined}
            onClose={() => setShowEdgeModal(false)}
            onCommissioned={(edgeId, edgeHostname, edgeTailscaleIp, lidarCount) => {
              setShowEdgeModal(false)
              // Update step with commissioned edge data matching CommissionEdgeData interface
              const commissionData = {
                edgeId,
                edgeHostname,
                edgeTailscaleIp,
                edgeOnline: true,
                scannedLidarCount: lidarCount,
                neededLidarCount: neededLidars,
                missingLidars: lidarCount < neededLidars,
              }
              const stepStatus = lidarCount >= neededLidars ? 'done' : 'warning'
              const updated = {
                ...session,
                steps: session.steps.map(s =>
                  s.id === 'commission_edge'
                    ? { ...s, status: stepStatus as 'done' | 'warning', data: commissionData }
                    : s
                ),
              }
              setSession(updated)
              saveSession(updated)
              // If autopilot running, continue to next step
              if (autopilotRef.current.state === 'waiting_input') {
                setAutopilot(prev => ({ ...prev, state: 'running', waitingFor: null }))
                setTimeout(() => advanceAutopilot('pair_devices'), 300)
              }
            }}
          />
        )
      })()}

      {/* Pair Devices Modal */}
      {showPairModal && (() => {
        const effectiveVenueId = session.venueId || venueId
        const commissionStep = session.steps.find(s => s.id === 'commission_edge')
        const commissionData = commissionStep?.data as { edgeId?: string; edgeTailscaleIp?: string } | null

        if (!effectiveVenueId || !commissionData?.edgeId || !commissionData?.edgeTailscaleIp) {
          const closePairNoEdge = () => {
            setShowPairModal(false)
            // Mark pair_devices as warning (simulation mode) and let flow continue
            const pairData: PairDevicesData = { pairedCount: 0, totalPlacements: 0, unpaired: [], allPaired: false }
            const updated: LaunchPadSession = {
              ...session,
              steps: session.steps.map(s =>
                s.id === 'pair_devices'
                  ? { ...s, status: 'warning' as const, data: pairData, warnings: ['No edge — simulation mode'] }
                  : s
              ),
            }
            setSession(updated)
            saveSession(updated)
            if (autopilotRef.current.state === 'waiting_input') {
              setAutopilot(prev => ({ ...prev, state: 'running', waitingFor: null }))
              setTimeout(() => advanceAutopilot('deploy_her'), 300)
            }
          }
          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={closePairNoEdge}>
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm text-center" onClick={e => e.stopPropagation()}>
                <div className="text-amber-400 text-sm font-medium mb-2">No Edge Commissioned</div>
                <div className="text-gray-400 text-xs mb-4">Proceeding in simulation mode — no real devices will be paired.</div>
                <button onClick={closePairNoEdge} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg">Continue (Simulation)</button>
              </div>
            </div>
          )
        }
        return (
          <PairDevicesModal
            venueId={effectiveVenueId}
            edgeId={commissionData.edgeId}
            edgeTailscaleIp={commissionData.edgeTailscaleIp}
            onClose={() => setShowPairModal(false)}
            onPairingComplete={(pairedCount, totalPlacements) => {
              setShowPairModal(false)
              const stepStatus = pairedCount === totalPlacements && pairedCount > 0 ? 'done' : 'warning'
              const pairData: PairDevicesData = {
                pairedCount,
                totalPlacements,
                unpaired: [],
                allPaired: pairedCount === totalPlacements && totalPlacements > 0,
              }
              const warnings = pairedCount === 0
                ? ['No devices paired — simulation mode']
                : pairedCount < totalPlacements
                  ? [`${totalPlacements - pairedCount} placement(s) still unpaired`]
                  : []
              const updated: LaunchPadSession = {
                ...session,
                steps: session.steps.map(s =>
                  s.id === 'pair_devices'
                    ? { ...s, status: stepStatus as 'done' | 'warning', data: pairData, warnings }
                    : s
                ),
              }
              setSession(updated)
              saveSession(updated)
              if (autopilotRef.current.state === 'waiting_input') {
                setAutopilot(prev => ({ ...prev, state: 'running', waitingFor: null }))
                setTimeout(() => advanceAutopilot('deploy_her'), 300)
              }
            }}
          />
        )
      })()}
      </div>
    </>
  )
}
