import { VenueProvider } from './context/VenueContext'
import { LidarProvider } from './context/LidarContext'
import { TrackingProvider } from './context/TrackingContext'
import { ToastProvider } from './context/ToastContext'
import { RoiProvider, useRoi } from './context/RoiContext'
import { HeatmapProvider } from './context/HeatmapContext'
import { PlanogramProvider, usePlanogram } from './context/PlanogramContext'
import { DwgProvider, useDwg } from './context/DwgContext'
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
import { BarChart3, Bell, Thermometer, Zap, LayoutGrid, ShoppingCart, Monitor, Activity, PieChart } from 'lucide-react'
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
            onOpenLidarPlanner={() => setViewMode('lidarPlanner')}
            onOpenEdgeCommissioning={() => setViewMode('edgeCommissioning')}
            onOpenDoohAnalytics={() => setViewMode('doohAnalytics')}
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
                  <MainApp />
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
