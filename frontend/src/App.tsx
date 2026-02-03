import { VenueProvider } from './context/VenueContext'
import { LidarProvider } from './context/LidarContext'
import { TrackingProvider } from './context/TrackingContext'
import { ToastProvider } from './context/ToastContext'
import { RoiProvider, useRoi } from './context/RoiContext'
import AppShell from './components/layout/AppShell'
import ZoneKPIPopup from './components/kpi/ZoneKPIPopup'
import ZoneKPIOverlayPanel from './components/kpi/ZoneKPIOverlayPanel'
import ActivityLedger from './components/kpi/ActivityLedger'
import { BarChart3, Bell } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useVenue } from './context/VenueContext'

function KPIPopupWrapper() {
  const { regions, kpiPopupRoiId, closeKPIPopup } = useRoi()
  
  if (!kpiPopupRoiId) return null
  
  const roi = regions.find(r => r.id === kpiPopupRoiId)
  if (!roi) return null
  
  return (
    <ZoneKPIPopup
      roiId={roi.id}
      roiName={roi.name}
      roiColor={roi.color}
      onClose={closeKPIPopup}
    />
  )
}

function KPIOverlayToggle() {
  const { showKPIOverlays, toggleKPIOverlays, regions } = useRoi()
  const { venue } = useVenue()
  const [showLedger, setShowLedger] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  
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
  
  if (regions.length === 0) return null
  
  return (
    <>
      {/* Button Group above Footer */}
      <div className="fixed bottom-16 right-4 z-30 flex items-center gap-2">
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

function App() {
  return (
    <ToastProvider>
      <VenueProvider>
        <LidarProvider>
          <TrackingProvider>
            <RoiProvider>
              <AppShell />
              <KPIPopupWrapper />
              <KPIOverlayToggle />
            </RoiProvider>
          </TrackingProvider>
        </LidarProvider>
      </VenueProvider>
    </ToastProvider>
  )
}

export default App
