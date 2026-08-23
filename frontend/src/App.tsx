import { VenueProvider } from './context/VenueContext'
import { LidarProvider } from './context/LidarContext'
import { TrackingProvider, useTracking, useTrackingActions } from './context/TrackingContext'
import { ToastProvider } from './context/ToastContext'
import { RoiProvider, useRoi } from './context/RoiContext'
import { HeatmapProvider, useHeatmap } from './context/HeatmapContext'
import { PlanogramProvider, usePlanogram } from './context/PlanogramContext'
import { DwgProvider, useDwg } from './context/DwgContext'
// Legacy Narrator v1 disabled - using Narrator2 (Copilot) only
// import { NarratorProvider } from './context/NarratorContext'
// import { NarratorDrawer, NarratorToggle } from './components/narrator'
import { Narrator2Provider, useNarrator2 } from './context/Narrator2Context'
import Narrator2Drawer from './components/narrator/Narrator2Drawer'
import Narrator2Toggle from './components/narrator/Narrator2Toggle'
import { ReplayInsightProvider, useReplayInsight } from './context/ReplayInsightContext'
import ReplayInsightPanel from './components/replay-insight/ReplayInsightPanel'
import InsightModeOverlay from './components/replay-insight/InsightModeOverlay'
import StoryGridModal from './components/replay-insight/StoryGridModal'
import AppShell from './components/layout/AppShell'
import ZoneKPIPopup from './components/kpi/ZoneKPIPopup'
import ActivityLedger from './components/kpi/ActivityLedger'
import HeatmapViewerModal from './components/heatmap/HeatmapViewerModal'
import CheckoutManagerModal from './components/checkout/CheckoutManagerModal'
import SmartKpiModal from './components/kpi/SmartKpiModal'
import PlanogramBuilder from './components/planogram/PlanogramBuilder'
import { DwgImporterPage } from './components/dwgImporter'
import LidarPlannerPage from './components/lidarPlanner/LidarPlannerPage'
import { EdgeCommissioningPage } from './components/edgeCommissioning'
import { EdgeCommissioningProvider } from './context/EdgeCommissioningContext'
import DoohAnalyticsPage from './components/dooh/DoohAnalyticsPage'
import DoohEffectivenessPage from './components/dooh/DoohEffectivenessPage'
import { BusinessReportingPage } from './features/businessReporting'
import { BenchmarkPage } from './features/benchmark'
import { ProfitRadarPage } from './features/profitRadar'
import { DailyDebriefPage } from './features/dailyDebrief'
import { ProfitRadarProvider } from './context/ProfitRadarContext'
import { LaunchPadPanel, isLaunchPadEnabled, loadSession } from './launchpad'

import { BarChart3, Bell, Thermometer, Zap, ShoppingCart, Monitor, Activity, PieChart, Clapperboard, Crosshair, Building2, LogOut, User, Rocket, FlaskConical, Settings, CalendarCheck, Film } from 'lucide-react'
import { CanvasToolbarButton, CanvasToolbarDivider, CanvasToolbarFlyout } from './components/layout/CanvasToolbar'
import { useState, useEffect, useRef, createContext, useContext, type ReactNode } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useVenue } from './context/VenueContext'
import { API_BASE } from './config/api'
import LoginPage from './components/auth/LoginPage'
import CompaniesPage from './components/admin/CompaniesPage'
import StoryMode from './components/storymode/StoryMode'
import StoryNarrativeLayout from './components/storymode/StoryNarrativeLayout'
import MobileTaskPage from './features/opsDispatch/MobileTaskPage'
import { isDemo, isPublicReportingDemo, getDemoVenueId, isDemoActivated, getPendingDemoToken, activateDemoFromToken, hasDemoIntent, getDemoLinkType } from './config/demo'
import DemoLinksModal from './components/admin/DemoLinksModal'

// App view mode context
type ViewMode = 'main' | 'planogram' | 'dwgImporter' | 'lidarPlanner' | 'edgeCommissioning' | 'doohAnalytics' | 'doohEffectiveness' | 'businessReporting' | 'profitRadar' | 'benchmark' | 'dailyDebrief'
export type FloorViz = 'flow' | 'tracks'
const ViewModeContext = createContext<{
  mode: ViewMode
  setMode: (m: ViewMode) => void
  launchPadOpen: boolean
  setLaunchPadOpen: (open: boolean) => void
  neuralDashboardEnabled: boolean
  setNeuralDashboardEnabled: (enabled: boolean) => void
  floorViz: FloorViz
  setFloorViz: (v: FloorViz) => void
}>({
  mode: 'main',
  setMode: () => {},
  launchPadOpen: false,
  setLaunchPadOpen: () => {},
  neuralDashboardEnabled: false,
  setNeuralDashboardEnabled: () => {},
  floorViz: 'tracks',
  setFloorViz: () => {},
})
export const useViewMode = () => useContext(ViewModeContext)

function KPIPopupWrapper() {
  const { regions, kpiPopupRoiId, closeKPIPopup } = useRoi()
  const { activePlanogram } = usePlanogram()
  
  if (!kpiPopupRoiId) return null
  
  const roi = regions.find(r => r.id === kpiPopupRoiId)
  if (!roi) return null
  
  // Extract shelf data from ROI metadata for product analytics
  const isShelfEngagement = roi.metadata?.template === 'shelf-engagement'
  const shelfId = isShelfEngagement ? roi.metadata?.shelfId : undefined
  const planogramId = isShelfEngagement ? (roi.metadata?.planogramId || activePlanogram?.id) : undefined
  
  return (
    <ZoneKPIPopup
      roiId={roi.id}
      roiName={roi.name}
      roiColor={roi.color}
      onClose={closeKPIPopup}
      shelfId={shelfId}
      planogramId={planogramId}
    />
  )
}

function GlobalHeatmapModal() {
  const { heatmapModalOpen, closeHeatmapModal } = useHeatmap()
  return (
    <HeatmapViewerModal
      isOpen={heatmapModalOpen}
      onClose={closeHeatmapModal}
    />
  )
}

function KPIOverlayToggle() {
  const { showKPIOverlays, toggleKPIOverlays, startDrawing: startRoiDrawing } = useRoi()
  const { venue } = useVenue()
  const { setMode, mode, neuralDashboardEnabled } = useViewMode()
  const { dwgLayoutId } = useDwg()
  const { openStoryGrid, explainKpi, selectEpisode, selectedEpisode } = useReplayInsight()
  const { openNarrator, askQuestion } = useNarrator2()
  const { heatmapModalOpen, openHeatmapModal } = useHeatmap()
  const [showLedger, setShowLedger] = useState(false)
  const [showSmartKpiModal, setShowSmartKpiModal] = useState(false)
  const [showCheckoutManager, setShowCheckoutManager] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  
  // Listen for LaunchPad step activation events (e.g. ROI drawing mode)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.stepId === 'define_rois') {
        console.log('[KPIOverlayToggle] LaunchPad activated ROI drawing mode')
        startRoiDrawing()
      }
    }
    window.addEventListener('launchpad-step-activate', handler)
    return () => window.removeEventListener('launchpad-step-activate', handler)
  }, [startRoiDrawing])
  
  // Fetch unread count for badge
  useEffect(() => {
    if (!venue?.id) return
    
    const fetchUnreadCount = async () => {
      try {
                const res = await fetch(`${API_BASE}/api/venues/${venue.id}/ledger/unacknowledged-count`)
        if (res.ok) {
          const data = await res.json()
          setUnreadCount(data.count)
        }
      } catch (err) {
        // Silently fail
      }
    }
    
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 10000)
    return () => clearInterval(interval)
  }, [venue?.id])
  
  // Handle Narrator2 intent events
  useEffect(() => {
    const handleNarrator2Intent = (e: CustomEvent<{ intent: string; venueId?: string }>) => {
      const { intent } = e.detail
      console.log('[App] Handling Narrator2 intent:', intent)
      
      switch (intent) {
        case 'open_heatmap':
          openHeatmapModal()
          break
        case 'open_zone_analytics':
        case 'open_analytics':
          setShowSmartKpiModal(true)
          break
        case 'open_checkout':
        case 'open_checkout_manager':
          setShowCheckoutManager(true)
          break
        case 'close_checkout':
        case 'close_checkout_manager':
          setShowCheckoutManager(false)
          break
        case 'open_planogram':
        case 'open_planogram_builder':
          setMode('planogram')
          break
        case 'open_ledger':
        case 'open_activity_ledger':
          setShowLedger(true)
          break
        case 'open_dooh':
        case 'open_dooh_effectiveness':
          setMode('doohEffectiveness')
          break
        case 'open_business_reporting':
          setMode('businessReporting')
          break
        case 'open_lidar_planner':
          setMode('lidarPlanner')
          break
        default:
          // Handle replay insight intents
          if (intent.startsWith('show_replay_episodes:')) {
            const episodeType = intent.replace('show_replay_episodes:', '')
            console.log('[App] Show replay episodes:', episodeType)
            openStoryGrid()
          } else if (intent.startsWith('explain_episode:')) {
            const episodeId = intent.replace('explain_episode:', '')
            // First select the episode to get its details
            selectEpisode(episodeId)
            // Open Narrator2 and ask about the episode
            openNarrator()
            // Use selectedEpisode context to ask a question after a small delay
            setTimeout(() => {
              if (selectedEpisode) {
                askQuestion(`Explain this insight: "${selectedEpisode.title}". ${selectedEpisode.business_summary}`)
              }
            }, 500)
          } else {
            console.warn('[App] Unknown Narrator2 intent:', intent)
          }
      }
    }
    
    // Handle replay-insight-explain events (from KPI tiles "Explain Why" button)
    const handleExplainKpi = (e: CustomEvent<{ kpiId: string }>) => {
      explainKpi(e.detail.kpiId)
    }
    
    window.addEventListener('narrator2-intent', handleNarrator2Intent as EventListener)
    window.addEventListener('replay-insight-explain', handleExplainKpi as EventListener)
    return () => {
      window.removeEventListener('narrator2-intent', handleNarrator2Intent as EventListener)
      window.removeEventListener('replay-insight-explain', handleExplainKpi as EventListener)
    }
  }, [setMode, openStoryGrid, explainKpi, selectEpisode, selectedEpisode, openNarrator, askQuestion])
  
  return (
    <>
      {/* Checkout Manager Modal */}
      <CheckoutManagerModal
        isOpen={showCheckoutManager}
        onClose={() => setShowCheckoutManager(false)}
      />
      
      {/* Smart KPI Modal */}
      <SmartKpiModal
        isOpen={showSmartKpiModal}
        onClose={() => setShowSmartKpiModal(false)}
        dwgLayoutId={dwgLayoutId}
      />
      
      {/* Button Group above Footer - hidden in Neural Dashboard mode */}
      {!neuralDashboardEnabled && (
      <div className="fixed bottom-16 right-4 z-30 flex items-center gap-2">
        <CanvasToolbarFlyout
          icon={Settings}
          title="Setup & tools"
          accent="purple"
          active={showSmartKpiModal || mode === 'benchmark'}
          onPrimaryClick={() => setShowSmartKpiModal(true)}
          items={[
            {
              id: 'smart-kpi',
              icon: Zap,
              title: 'Smart KPI Mode — auto-generate zones',
              active: showSmartKpiModal,
              accent: 'purple',
              onClick: () => setShowSmartKpiModal(true),
            },
            {
              id: 'benchmark',
              icon: FlaskConical,
              title: 'Trajectory Benchmark — perception & reconciler scorecards',
              active: mode === 'benchmark',
              accent: 'amber',
              onClick: () => setMode('benchmark'),
            },
          ]}
        />

        <CanvasToolbarButton
          icon={ShoppingCart}
          title="Checkout Manager"
          accent="green"
          active={showCheckoutManager}
          onClick={() => setShowCheckoutManager(true)}
        />

        <CanvasToolbarFlyout
          icon={Monitor}
          title="DOOH Analytics — digital display metrics"
          accent="purple"
          active={mode === 'doohAnalytics' || mode === 'doohEffectiveness'}
          onPrimaryClick={() => setMode('doohAnalytics')}
          items={[
            {
              id: 'peble',
              icon: Activity,
              title: 'PEBLE™ Attribution — DOOH effectiveness',
              active: mode === 'doohEffectiveness',
              accent: 'purple',
              onClick: () => setMode('doohEffectiveness'),
            },
          ]}
        />

        <CanvasToolbarFlyout
          icon={PieChart}
          title="Business Reporting — executive dashboards"
          accent="blue"
          active={mode === 'businessReporting' || mode === 'profitRadar' || heatmapModalOpen}
          onPrimaryClick={() => setMode('businessReporting')}
          items={[
            {
              id: 'profit-radar',
              icon: Crosshair,
              title: 'Profit Radar — shopper intent insights',
              active: mode === 'profitRadar',
              accent: 'emerald',
              onClick: () => setMode('profitRadar'),
            },
            {
              id: 'heatmap',
              icon: Thermometer,
              title: 'Heatmap Viewer',
              active: heatmapModalOpen,
              accent: 'orange',
              onClick: () => openHeatmapModal(),
            },
            {
              id: 'daily-debrief',
              icon: CalendarCheck,
              title: 'End-of-Day Debrief — the day as a ranked plan',
              active: mode === 'dailyDebrief',
              accent: 'indigo',
              onClick: () => setMode('dailyDebrief'),
            },
          ]}
        />

        <CanvasToolbarDivider />

        <CanvasToolbarButton
          icon={Clapperboard}
          title="Replay Insights — behavior episodes"
          accent="indigo"
          onClick={openStoryGrid}
        />

        <Narrator2Toggle />

        <CanvasToolbarButton
          icon={Bell}
          title="Activity Ledger"
          accent="amber"
          active={showLedger}
          onClick={() => setShowLedger(!showLedger)}
        >
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </CanvasToolbarButton>

        {/* KPI Toggle Button */}
        <button
          onClick={toggleKPIOverlays}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg transition-all ${
            showKPIOverlays 
              ? 'bg-amber-600 hover:bg-amber-700 text-white' 
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
          }`}
          title={showKPIOverlays ? 'Hide Zone KPIs' : 'Show Zone KPIs'}
        >
          <BarChart3 className="w-4 h-4" />
          <span className="text-sm font-medium">KPIs</span>
          {showKPIOverlays && (
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          )}
        </button>
        
        {/* User Menu */}
        <UserMenu />
      </div>
      )}
      
      {/* Activity Ledger */}
      {venue && (
        <ActivityLedger
          venueId={venue.id}
          isOpen={showLedger}
          onClose={() => setShowLedger(false)}
        />
      )}
      
      {/* Replay Insight Panel (parallel system — does not modify existing) */}
      <ReplayInsightPanel />
      <InsightModeOverlay />
      <StoryGridModal />
      
      {/* LaunchPad Drawer — now rendered at MainApp level for cross-view visibility */}
      
      {/* AI Narrator2 Drawer (Copilot) */}
      <Narrator2Drawer 
        onExecuteIntent={(intent) => {
          // Handle narrator2 deep link intents
          const route = intent.replace('NAVIGATE:', '')
          switch (route) {
            case '/dashboard/live':
              setMode('main')
              break
            case '/operations/checkout':
              setShowCheckoutManager(true)
              break
            case '/analytics/categories':
            case '/analytics/shelves':
              setMode('planogram')
              break
            case '/analytics/dooh':
              setMode('doohAnalytics')
              break
            case '/analytics/dooh/funnel':
              setMode('doohEffectiveness')
              break
            case '/dashboard/executive':
            case '/analytics/opportunities':
              setMode('businessReporting')
              break
            default:
              console.log('[Narrator2] Unhandled intent:', intent)
          }
        }}
      />
    </>
  )
}

function MainApp() {
  const { venue, loadVenue } = useVenue()
  const { applyLiveTrackDelivery, setInterpolation } = useTrackingActions()
  const [viewMode, setViewModeInternal] = useState<ViewMode>(() =>
    isPublicReportingDemo() ? 'businessReporting' : 'main',
  )
  const [showLanding, setShowLanding] = useState(() => !isDemo())
  const [floorViz, setFloorViz] = useState<FloorViz>('tracks')
  const [launchPadOpen, setLaunchPadOpen] = useState(false)
  const [neuralDashboardEnabled, setNeuralDashboardEnabled] = useState(false)

  // Landing defers live track delivery; after dismiss apply saved preference (default: direct snapshots).
  useEffect(() => {
    if (showLanding) {
      setInterpolation(false)
    } else {
      applyLiveTrackDelivery()
    }
  }, [showLanding, setInterpolation, applyLiveTrackDelivery])

  // ── DEMO LINK BOOTSTRAP ──
  // When the app is opened via a shared demo link (?demo=<token>), skip the
  // cinematic landing and load the demo venue. A second effect then auto-starts
  // Story Mode once the venue (and its 3D scene) is ready. Story Mode itself
  // pulls the existing recording from /api/replay, exactly like the manual
  // footer-button flow — so the demo shows the same guided tour on the same
  // production venue + capture, with no login.
  const demoBootstrappedRef = useRef(false)
  const demoStoryStartedRef = useRef(false)
  useEffect(() => {
    if (!isDemo() || demoBootstrappedRef.current) return
    demoBootstrappedRef.current = true
    setShowLanding(false)

    if (isPublicReportingDemo()) {
      ;(async () => {
        const venueId = getDemoVenueId()
        if (venueId) {
          await loadVenue(venueId).catch(() => {})
        }
        setViewMode('businessReporting')
      })()
      return
    }

    ;(async () => {
      let venueId = getDemoVenueId()
      if (!venueId) {
        try {
          const res = await fetch(`${API_BASE}/api/venues`)
          const data = res.ok ? await res.json() : []
          const list = Array.isArray(data) ? data : (data.venues || [])
          venueId = list[0]?.id || null
        } catch {
          /* no venue available — Story Mode still runs without spatial replay */
        }
      }
      if (venueId) {
        await loadVenue(venueId).catch(() => {})
      }
    })()
  }, [loadVenue])

  // Auto-start Story Mode for story demo links once the venue is loaded.
  useEffect(() => {
    if (!isDemo() || isPublicReportingDemo() || demoStoryStartedRef.current || !venue?.id) return
    demoStoryStartedRef.current = true
    // Keep the DWG wireframe in sync (same as a FloorplanPanel selection) so the
    // Store Awakening intro renders on the real floorplan.
    if (venue.dwg_layout_version_id) {
      try { localStorage.setItem('venueDwg-selectedLayout', venue.dwg_layout_version_id) } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: venue.dwg_layout_version_id } }))
    }
    // Give the 3D scene a beat to mount before triggering the guided tour.
    const id = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('hyperspace:story-mode-toggle'))
    }, 1400)
    return () => window.clearTimeout(id)
  }, [venue?.id, venue?.dwg_layout_version_id])
  
  // FLOW-DEBUG: Wrap setViewMode to log navigation
  const setViewMode = (newMode: ViewMode) => {
    console.log('%c[FLOW-DEBUG] ══════════════════════════════════════════════════════', 'color:#22d3ee;font-weight:bold')
    console.log('%c[FLOW-DEBUG] VIEW MODE CHANGE', 'color:#22d3ee;font-size:14px;font-weight:bold')
    console.log('%c[FLOW-DEBUG]', 'color:#22d3ee', { from: viewMode, to: newMode, venueId: venue?.id })
    console.log('%c[FLOW-DEBUG] ══════════════════════════════════════════════════════', 'color:#22d3ee;font-weight:bold')
    setViewModeInternal(newMode)
  }
  
  // Handle LaunchPad close — reload venue to sync with FloorplanPanel behavior
  const handleLaunchPadClose = async () => {
    const session = loadSession()
    const sessionVenueId = session?.venueId
    const layoutVersionId = (session?.steps.find(s => s.id === 'select_dwg')?.data as any)?.layoutVersionId
    
    console.log('%c[FLOW-DEBUG] LaunchPad CLOSE', 'color:#f472b6;font-weight:bold', {
      sessionVenueId,
      layoutVersionId,
      currentVenueId: venue?.id,
    })
    
    // If session has a venue, reload it to sync state (same as FloorplanPanel click)
    if (sessionVenueId) {
      if (layoutVersionId) {
        localStorage.setItem('venueDwg-selectedLayout', layoutVersionId)
      }
      await loadVenue(sessionVenueId)
      if (layoutVersionId) {
        window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: layoutVersionId } }))
      }
      // Reset camera to fit the reloaded venue (after a small delay for scene to update)
      setTimeout(() => {
        window.dispatchEvent(new Event('mainviewport-reset-camera'))
      }, 100)
    }
    
    setLaunchPadOpen(false)
  }
  
  const handleDismissLanding = () => {
    setShowLanding(false)
    setFloorViz('flow')
  }
  
  // ── AUTO-RELOAD VENUE WHEN RETURNING FROM DWG IMPORTER ──
  // Track previous viewMode to detect transitions from dwgImporter → main
  // This ensures the 3D view picks up any fixture type changes made in DWG Importer
  const prevViewModeRef = useRef<ViewMode>(viewMode)
  useEffect(() => {
    const prevMode = prevViewModeRef.current
    prevViewModeRef.current = viewMode
    
    // If transitioning FROM dwgImporter TO main, reload the venue to get updated types
    if (prevMode === 'dwgImporter' && viewMode === 'main' && venue?.id) {
      console.log('[App] Returning from DWG Importer → reloading venue to sync fixture types')
      loadVenue(venue.id).catch(err => console.warn('Failed to reload venue:', err))
    }
  }, [viewMode, venue?.id, loadVenue])

  // Listen for LaunchPad go-live event — load venue, start simulator, enable Neural Dashboard
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      console.log('[App] LaunchPad go-live event received', detail)

      // 1. Determine venueId from event or launchpad session
      const session = loadSession()
      const venueId = detail.venueId || session?.venueId
      const layoutVersionId = (session?.steps?.find((s: any) => s.id === 'select_dwg')?.data as any)?.layoutVersionId

      // 2. Load the venue into the 3D scene
      if (venueId) {
        try {
          if (layoutVersionId) localStorage.setItem('venueDwg-selectedLayout', layoutVersionId)
          await loadVenue(venueId)
          if (layoutVersionId) {
            window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: layoutVersionId } }))
          }
          setTimeout(() => window.dispatchEvent(new Event('mainviewport-reset-camera')), 200)
        } catch (err) {
          console.warn('[App] go-live: failed to load venue', err)
        }
      }

      // 3. Configure + start the simulator with 200 agents
      try {
        const venueRes = venueId ? await fetch(`${API_BASE}/api/venues/${venueId}`) : null
        const venueData = venueRes?.ok ? (await venueRes.json()).venue : null

        await fetch(`${API_BASE}/api/edge-simulator/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetPeopleCount: 200,
            avgStayTime: 5,
            frequencyHz: 14,
            simulationMode: 'mixed',
            queueSpawnInterval: 6,
            enableCashiers: true,
            cashierShiftMin: 60,
            cashierBreakProb: 15,
            laneOpenConfirmSec: 120,
            enableIdConfusion: false,
            ...(venueId && { venueId }),
            ...(venueData && { venueWidth: venueData.width, venueDepth: venueData.depth }),
          }),
        })
        await fetch(`${API_BASE}/api/edge-simulator/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        console.log('[App] Simulator started with 200 agents for venue', venueId)
      } catch (err) {
        console.warn('[App] go-live: simulator start failed (non-blocking)', err)
      }

      // 4. Enable Neural Dashboard + switch to main view + close launchpad
      setNeuralDashboardEnabled(true)
      setViewModeInternal('main')
      setLaunchPadOpen(false)
    }
    window.addEventListener('launchpad-go-live', handler)
    return () => window.removeEventListener('launchpad-go-live', handler)
  }, [loadVenue])
  
  return (
    <ViewModeContext.Provider value={{
      mode: viewMode,
      setMode: setViewMode,
      launchPadOpen,
      setLaunchPadOpen,
      neuralDashboardEnabled,
      setNeuralDashboardEnabled,
      floorViz,
      setFloorViz,
    }}>
      <PlanogramProvider>
        <StoryNarrativeLayout>
        <GlobalHeatmapModal />
        {/* DWG Importer View */}
        {viewMode === 'dwgImporter' && (
          <DwgImporterPage 
            onClose={() => setViewMode('main')}
          />
        )}
        {/* LiDAR Planner View */}
        {viewMode === 'lidarPlanner' && (
          <div className="absolute inset-0 z-50 bg-gray-900">
            <div className="h-10 border-b border-gray-700 flex items-center px-4 bg-gray-800">
              <button
                onClick={() => setViewMode('main')}
                className="text-gray-400 hover:text-white text-sm"
              >
                ← Back to Main
              </button>
              <span className="ml-4 text-white font-medium">LiDAR Coverage Planner</span>
            </div>
            <div className="h-[calc(100vh-40px)]">
              <LidarPlannerPage />
            </div>
          </div>
        )}
        {/* Edge Commissioning Portal View */}
        {viewMode === 'edgeCommissioning' && (
          <EdgeCommissioningProvider>
            <EdgeCommissioningPage onClose={() => setViewMode('main')} />
          </EdgeCommissioningProvider>
        )}
        {/* DOOH Analytics View (feature-flagged: FEATURE_DOOH_KPIS) */}
        {viewMode === 'doohAnalytics' && (
          <DoohAnalyticsPage onClose={() => setViewMode('main')} />
        )}
        {/* DOOH Effectiveness / Attribution View (feature-flagged: FEATURE_DOOH_ATTRIBUTION) */}
        {viewMode === 'doohEffectiveness' && (
          <DoohEffectivenessPage onClose={() => setViewMode('main')} />
        )}
        {/* Business Reporting View (feature-flagged: FEATURE_BUSINESS_REPORTING) */}
        {viewMode === 'businessReporting' && (
          <BusinessReportingPage
            onClose={() => setViewMode('main')}
            publicDashboard={isPublicReportingDemo()}
          />
        )}
        {/* Profit Radar View */}
        {viewMode === 'profitRadar' && (
          <ProfitRadarPage onClose={() => setViewMode('main')} />
        )}
        {viewMode === 'benchmark' && (
          <BenchmarkPage onClose={() => setViewMode('main')} />
        )}
        {/* End-of-Day Daily Debrief View */}
        {viewMode === 'dailyDebrief' && (
          <DailyDebriefPage onClose={() => setViewMode('main')} onOpenProfitRadar={() => setViewMode('profitRadar')} />
        )}
        {/* Planogram View */}
        <div style={{ display: viewMode === 'planogram' ? 'block' : 'none' }}>
          <PlanogramBuilder />
        </div>
        {/* Main View */}
        <div style={{ display: viewMode === 'main' ? 'block' : 'none' }}>
          <AppShell 
            onOpenDwgImporter={() => setViewMode('dwgImporter')}
            onOpenEdgeCommissioning={() => setViewMode('edgeCommissioning')}
            showLanding={showLanding}
            onDismissLanding={handleDismissLanding}
          />
          <KPIPopupWrapper />
          <KPIOverlayToggle />
        </div>

        {/* LaunchPad Drawer — rendered at top level so it works across all views */}
        {isLaunchPadEnabled() && (
          <LaunchPadPanel
            isOpen={launchPadOpen}
            onClose={handleLaunchPadClose}
            onDeepLink={(vm) => setViewMode(vm as ViewMode)}
            venueId={venue?.id}
            venueName={venue?.name}
            currentViewMode={viewMode}
          />
        )}

        {/* Floating "Return to LaunchPad" bar — visible on deep-linked views */}
        {isLaunchPadEnabled() && launchPadOpen && viewMode !== 'main' && (
          <button
            onClick={() => setViewMode('main')}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-full shadow-lg shadow-indigo-500/25 transition-all"
          >
            <Rocket className="w-4 h-4" />
            Return to LaunchPad
          </button>
        )}

        </StoryNarrativeLayout>

        {/* Demo storytelling overlay — story links only; never on public dashboard */}
        {!isPublicReportingDemo() && (
          <StoryMode
            viewMode={viewMode}
            setViewMode={setViewMode}
            neuralEnabled={neuralDashboardEnabled}
            setNeuralEnabled={setNeuralDashboardEnabled}
          />
        )}
      </PlanogramProvider>
    </ViewModeContext.Provider>
  )
}

function UserMenu() {
  const { user, logout, isSuperadmin } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [showDemoLinks, setShowDemoLinks] = useState(false)
  
  if (!user) return null
  
  return (
    <div className="relative">
      {showDemoLinks && <DemoLinksModal onClose={() => setShowDemoLinks(false)} />}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600"
        title={user.name || user.email}
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <User className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-full mb-2 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800">
              <p className="text-sm text-white font-medium truncate">{user.name}</p>
              <p className="text-[11px] text-gray-500 truncate">{user.email}</p>
              {isSuperadmin && <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wider bg-blue-500/20 text-blue-400 rounded font-semibold">Superadmin</span>}
            </div>
            {isSuperadmin && (
              <button
                onClick={() => { setOpen(false); navigate('/companies'); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                <Building2 className="w-4 h-4" />
                Companies & Venues
              </button>
            )}
            {isSuperadmin && (
              <button
                onClick={() => { setOpen(false); setShowDemoLinks(true); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                <Film className="w-4 h-4" />
                Demo Links
              </button>
            )}
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function AuthenticatedApp() {
  return (
    <ToastProvider>
      <VenueProvider>
        <LidarProvider>
          <TrackingProvider>
            <RoiProvider>
              <HeatmapProvider>
                <DwgProvider>
                  <Narrator2Provider>
                    <ReplayInsightProvider>
                      <ProfitRadarProvider>
                        <Routes>
                          <Route path="/companies" element={<CompaniesPage onClose={() => window.history.back()} />} />
                          <Route path="/*" element={<MainApp />} />
                        </Routes>
                      </ProfitRadarProvider>
                    </ReplayInsightProvider>
                  </Narrator2Provider>
                </DwgProvider>
              </HeatmapProvider>
            </RoiProvider>
          </TrackingProvider>
        </LidarProvider>
      </VenueProvider>
    </ToastProvider>
  )
}

const AUTH_ENABLED = !!(import.meta.env.VITE_GOOGLE_CLIENT_ID)

// Public, no-login mobile task page (opened from Telegram). Rendered outside the
// auth gate and all app providers so the team can open it on any phone.
const IS_MOBILE_TASK = typeof window !== 'undefined' && window.location.pathname.startsWith('/m/task/')

/** Customer-facing executive dashboard — no Google login, minimal shell. */
function PublicDashboardApp() {
  const { loadVenue } = useVenue()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const venueId = getDemoVenueId()
      if (venueId) {
        await loadVenue(venueId, undefined, { silent: true }).catch(() => {})
      }
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [loadVenue])

  if (!ready) return <LoadingScreen />

  return (
    <>
      <GlobalHeatmapModal />
      <BusinessReportingPage onClose={() => {}} publicDashboard />
    </>
  )
}

function PublicDashboardProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <VenueProvider>
        <RoiProvider>
          <HeatmapProvider>
            {children}
          </HeatmapProvider>
        </RoiProvider>
      </VenueProvider>
    </ToastProvider>
  )
}

function InvalidDemoLinkPage() {
  return (
    <div className="fixed inset-0 bg-gray-950 flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <img
          src="/hyperspace-logo.png"
          alt=""
          className="w-16 h-16 object-contain mx-auto mb-6 opacity-80"
          onError={(e) => { (e.target as HTMLImageElement).src = '/hyperspace.svg' }}
        />
        <h1 className="text-xl font-semibold text-white mb-2">This link is no longer available</h1>
        <p className="text-sm text-gray-400 leading-relaxed">
          The shared dashboard link may have expired or been revoked. Ask your Hyperspace contact for a new public link.
        </p>
      </div>
    </div>
  )
}

/** Validates `?demo=` before any auth UI; routes dashboard tokens to the public shell. */
function DemoLinkGate() {
  const [phase, setPhase] = useState<'checking' | 'invalid' | 'dashboard' | 'story'>('checking')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await activateDemoFromToken()
      if (cancelled) return
      if (!ok) {
        setPhase('invalid')
        return
      }
      setPhase(
        getDemoLinkType() === 'dashboard' || getDemoLinkType() === 'custom-dashboard'
          ? 'dashboard'
          : 'story',
      )
    })()
    return () => { cancelled = true }
  }, [])

  if (phase === 'checking') return <LoadingScreen />
  if (phase === 'invalid') return <InvalidDemoLinkPage />
  if (phase === 'dashboard') {
    return (
      <PublicDashboardProviders>
        <PublicDashboardApp />
      </PublicDashboardProviders>
    )
  }
  return <AuthenticatedApp />
}

function App() {
  if (IS_MOBILE_TASK) {
    return <MobileTaskPage />
  }

  // Public dashboard share — never mount the Google login gate.
  if (getPendingDemoToken()) {
    return <DemoLinkGate />
  }
  if (isPublicReportingDemo()) {
    return (
      <PublicDashboardProviders>
        <PublicDashboardApp />
      </PublicDashboardProviders>
    )
  }

  return <AppGated />
}

// Demo gate — resolves whether this tab is a shared demo session. If a ?demo
// token is present it is validated against the backend (async); an
// already-validated tab resolves synchronously.
type DemoStatus = 'checking' | 'demo' | 'none' | 'rejected'
function useDemoGate(): DemoStatus {
  const [status, setStatus] = useState<DemoStatus>(() => {
    if (isDemoActivated()) return 'demo'
    if (getPendingDemoToken()) return 'checking'
    return 'none'
  })
  useEffect(() => {
    if (status !== 'checking') return
    const hadToken = !!getPendingDemoToken()
    let cancelled = false
    activateDemoFromToken().then((ok) => {
      if (cancelled) return
      if (ok) setStatus('demo')
      else if (hadToken) setStatus('rejected')
      else setStatus('none')
    })
    return () => { cancelled = true }
  }, [status])
  return status
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <img src="/hyperspace-logo.png" alt="" className="w-16 h-16 object-contain animate-pulse" onError={(e) => { (e.target as HTMLImageElement).src = '/hyperspace.svg' }} />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  )
}

function AppGated() {
  const { isAuthenticated, isLoading } = useAuth()
  const demoStatus = useDemoGate()

  // Skip auth gate when Google OAuth is not configured
  if (!AUTH_ENABLED) {
    return <AuthenticatedApp />
  }

  // Shared demo link — a valid ?demo=<token> skips the Google login gate and
  // auto-starts the guided Story Mode tour (see config/demo.ts + MainApp).
  if (demoStatus === 'demo') {
    return <AuthenticatedApp />
  }
  if (demoStatus === 'checking') {
    return <LoadingScreen />
  }
  if (demoStatus === 'rejected') {
    return <InvalidDemoLinkPage />
  }

  // Extra guard: never prompt login when a share session is active
  if (hasDemoIntent() || isPublicReportingDemo()) {
    return <AuthenticatedApp />
  }

  if (isLoading) {
    return <LoadingScreen />
  }
  
  if (!isAuthenticated) {
    return <LoginPage />
  }
  
  return <AuthenticatedApp />
}

export default App
