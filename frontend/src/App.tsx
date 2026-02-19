import { VenueProvider } from './context/VenueContext'
import { LidarProvider } from './context/LidarContext'
import { TrackingProvider } from './context/TrackingContext'
import { ToastProvider } from './context/ToastContext'
import { RoiProvider, useRoi } from './context/RoiContext'
import { HeatmapProvider } from './context/HeatmapContext'
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
import ZoneKPIOverlayPanel from './components/kpi/ZoneKPIOverlayPanel'
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
import { BarChart3, Bell, Thermometer, Zap, LayoutGrid, ShoppingCart, Monitor, Activity, PieChart, Clapperboard } from 'lucide-react'
import { useState, useEffect, createContext, useContext } from 'react'
import { useVenue } from './context/VenueContext'

// App view mode context
type ViewMode = 'main' | 'planogram' | 'dwgImporter' | 'lidarPlanner' | 'edgeCommissioning' | 'doohAnalytics' | 'doohEffectiveness' | 'businessReporting'
const ViewModeContext = createContext<{ mode: ViewMode; setMode: (m: ViewMode) => void }>({ mode: 'main', setMode: () => {} })
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

function KPIOverlayToggle() {
  const { showKPIOverlays, toggleKPIOverlays } = useRoi()
  const { venue } = useVenue()
  const { setMode } = useViewMode()
  const { dwgLayoutId } = useDwg()
  const { openStoryGrid, explainKpi, selectEpisode, selectedEpisode } = useReplayInsight()
  const { openNarrator, askQuestion } = useNarrator2()
  const [showLedger, setShowLedger] = useState(false)
  const [showHeatmapModal, setShowHeatmapModal] = useState(false)
  const [showSmartKpiModal, setShowSmartKpiModal] = useState(false)
  const [showCheckoutManager, setShowCheckoutManager] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  
  // Debug: log dwgLayoutId
  useEffect(() => {
    console.log(`[KPIOverlayToggle] dwgLayoutId from context: ${dwgLayoutId}`)
  }, [dwgLayoutId])
  
  // Fetch unread count for badge
  useEffect(() => {
    if (!venue?.id) return
    
    const fetchUnreadCount = async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
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
          setShowHeatmapModal(true)
          break
        case 'open_zone_analytics':
        case 'open_analytics':
          setShowSmartKpiModal(true)
          break
        case 'open_checkout':
        case 'open_checkout_manager':
          setShowCheckoutManager(true)
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
      {/* Heatmap Viewer Modal */}
      <HeatmapViewerModal 
        isOpen={showHeatmapModal} 
        onClose={() => setShowHeatmapModal(false)} 
      />
      
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
      
      {/* Button Group above Footer */}
      <div className="fixed bottom-16 right-4 z-30 flex items-center gap-2">
        {/* Planogram Builder Button */}
        <button
          onClick={() => setMode('planogram')}
          className="flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600"
          title="Planogram Builder"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        
        {/* Smart KPI Button */}
        <button
          onClick={() => setShowSmartKpiModal(true)}
          className={`flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all ${
            showSmartKpiModal 
              ? 'bg-purple-600 hover:bg-purple-700 text-white' 
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
          }`}
          title="Smart KPI Mode - Auto-generate zones"
        >
          <Zap className="w-4 h-4" />
        </button>
        
        {/* Heatmap Viewer Button */}
        <button
          onClick={() => setShowHeatmapModal(true)}
          className={`flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all ${
            showHeatmapModal 
              ? 'bg-orange-600 hover:bg-orange-700 text-white' 
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
          }`}
          title="Open Heatmap Viewer"
        >
          <Thermometer className="w-4 h-4" />
        </button>
        
        {/* Checkout Manager Button */}
        <button
          onClick={() => setShowCheckoutManager(true)}
          className={`flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all ${
            showCheckoutManager 
              ? 'bg-green-600 hover:bg-green-700 text-white' 
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
          }`}
          title="Checkout Manager"
        >
          <ShoppingCart className="w-4 h-4" />
        </button>
        
        {/* DOOH Analytics Button */}
        <button
          onClick={() => setMode('doohAnalytics')}
          className="flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all bg-gray-800 hover:bg-purple-600 text-gray-300 hover:text-white border border-gray-600 hover:border-purple-500"
          title="DOOH Analytics - Digital Display Metrics"
        >
          <Monitor className="w-4 h-4" />
        </button>
        
        {/* PEBLE™ DOOH Attribution Button */}
        <button
          onClick={() => setMode('doohEffectiveness')}
          className="flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all bg-gray-800 hover:bg-purple-600 text-gray-300 hover:text-white border border-gray-600 hover:border-purple-500"
          title="PEBLE™ Attribution - DOOH Effectiveness"
        >
          <Activity className="w-4 h-4" />
        </button>
        
        {/* Business Reporting Button (feature-flagged) */}
        <button
          onClick={() => setMode('businessReporting')}
          className="flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all bg-gray-800 hover:bg-blue-600 text-gray-300 hover:text-white border border-gray-600 hover:border-blue-500"
          title="Business Reporting - Executive Dashboards"
        >
          <PieChart className="w-4 h-4" />
        </button>
        
        {/* Replay Insights Button */}
        <button
          onClick={openStoryGrid}
          className="flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all bg-gray-800 hover:bg-indigo-600 text-gray-300 hover:text-white border border-gray-600 hover:border-indigo-500"
          title="Replay Insights - Behavior Episodes"
        >
          <Clapperboard className="w-4 h-4" />
        </button>
        
        {/* AI Narrator2 Button (Copilot) */}
        <Narrator2Toggle />
        
        {/* Activity Ledger Button */}
        <button
          onClick={() => setShowLedger(!showLedger)}
          className={`relative flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all ${
            showLedger 
              ? 'bg-amber-600 hover:bg-amber-700 text-white' 
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
          }`}
          title="Activity Ledger"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        
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
      </div>
      
      {/* Activity Ledger */}
      {venue && (
        <ActivityLedger
          venueId={venue.id}
          isOpen={showLedger}
          onClose={() => setShowLedger(false)}
        />
      )}
      
      {/* KPI Overlay Panel */}
      <ZoneKPIOverlayPanel />
      
      {/* Replay Insight Panel (parallel system — does not modify existing) */}
      <ReplayInsightPanel />
      <InsightModeOverlay />
      <StoryGridModal />
      
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
  const [viewMode, setViewMode] = useState<ViewMode>('main')
  
  return (
    <ViewModeContext.Provider value={{ mode: viewMode, setMode: setViewMode }}>
      <PlanogramProvider>
        {/* DWG Importer View */}
        {viewMode === 'dwgImporter' && (
          <DwgImporterPage 
            onClose={() => setViewMode('main')}
          />
        )}
        {/* LiDAR Planner View */}
        {viewMode === 'lidarPlanner' && (
          <div className="fixed inset-0 z-50 bg-gray-900">
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
          <BusinessReportingPage onClose={() => setViewMode('main')} />
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
          />
          <KPIPopupWrapper />
          <KPIOverlayToggle />
        </div>
      </PlanogramProvider>
    </ViewModeContext.Provider>
  )
}

function App() {
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
                      <MainApp />
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

export default App
