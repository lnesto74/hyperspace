import { useState, useRef, useEffect } from 'react'
import { Box, Package, Radar, Settings, Hexagon, Map, Play, X, LayoutGrid, ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react'
import { SidebarTab } from './AppShell'
import VenuePanel from '../venue/VenuePanel'
import VenueDwgPanel from '../venue/VenueDwgPanel'
import FloorplanPanel from '../venue/FloorplanPanel'
import ObjectLibrary from '../objects/ObjectLibrary'
import LidarNetworkPanel from '../lidar/LidarNetworkPanel'
import RoiPanel from '../roi/RoiPanel'
import PlanogramPanel from '../planogram/PlanogramPanel'
import WhiteLabelSettings from '../settings/WhiteLabelSettings'
import SimulatorControl from '../settings/SimulatorControl'
import { useVenue } from '../../context/VenueContext'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  onOpenDwgImporter?: () => void
  onOpenEdgeCommissioning?: () => void
  launchPadOpen?: boolean
  onToggleLaunchPad?: () => void
}

const tabs: { id: SidebarTab; icon: typeof Box; label: string }[] = [
  { id: 'floorplan', icon: LayoutGrid, label: 'Floorplan' },
  // { id: 'venueDwg', icon: Map, label: 'DWG' },  // Hidden - replaced by Floorplan
  // { id: 'venue', icon: Box, label: 'Venue' },    // Hidden - replaced by Floorplan
  { id: 'objects', icon: Package, label: 'Objects' },
  { id: 'lidars', icon: Radar, label: 'LiDARs' },
  { id: 'regions', icon: Hexagon, label: 'Regions' },
  { id: 'planogram', icon: BarChart3, label: 'Planogram' },
]

export default function Sidebar({ activeTab, onTabChange, onOpenDwgImporter, onOpenEdgeCommissioning, launchPadOpen, onToggleLaunchPad }: SidebarProps) {
  const { venue } = useVenue()
  const [showWhiteLabel, setShowWhiteLabel] = useState(false)
  const [showSimulator, setShowSimulator] = useState(false)
  
  // Horizontal scroll state for tabs
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  
  // Check scroll position
  const updateScrollIndicators = () => {
    const container = tabsContainerRef.current
    if (!container) return
    setCanScrollLeft(container.scrollLeft > 0)
    setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1)
  }
  
  useEffect(() => {
    updateScrollIndicators()
    window.addEventListener('resize', updateScrollIndicators)
    return () => window.removeEventListener('resize', updateScrollIndicators)
  }, [])
  
  const scrollTabs = (direction: 'left' | 'right') => {
    const container = tabsContainerRef.current
    if (!container) return
    const scrollAmount = 80
    container.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' })
    setTimeout(updateScrollIndicators, 150)
  }

  return (
    <div className="w-80 flex-shrink-0 h-full bg-panel-bg border-r border-border-dark flex flex-col overflow-hidden">
      {/* Header */}
      <style>{`
        @keyframes sidebar-hue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(-360deg); } }
        .sidebar-gradient-text {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 100;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: #f35626;
          background-image: linear-gradient(92deg, #f35626, #feab3a);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: sidebar-hue 10s infinite linear;
        }
      `}</style>
      <div className="h-20 border-b border-border-dark flex items-center px-4">
        <div className="flex items-center gap-3">
          <img src="/hyperspace-logo.png" alt="" className="w-14 h-14 object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/hyperspace.svg'; }} />
          <h1 className="sidebar-gradient-text text-xl">Hyperspace</h1>
        </div>
      </div>

      {/* Tab Navigation - Horizontal Scroll */}
      <div className="relative border-b border-border-dark">
        {/* Left scroll arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scrollTabs('left')}
            className="absolute left-0 top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-gradient-to-r from-panel-bg to-transparent text-gray-400 hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        
        {/* Scrollable tabs container */}
        <div
          ref={tabsContainerRef}
          onScroll={updateScrollIndicators}
          className="flex overflow-x-auto scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex-shrink-0 py-3 px-4 text-xs font-medium transition-colors flex flex-col items-center gap-1 min-w-[64px] ${
                activeTab === tab.id
                  ? 'text-highlight border-b-2 border-highlight bg-highlight/5'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
        
        {/* Right scroll arrow */}
        {canScrollRight && (
          <button
            onClick={() => scrollTabs('right')}
            className="absolute right-0 top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-gradient-to-l from-panel-bg to-transparent text-gray-400 hover:text-white"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'floorplan' && <FloorplanPanel onOpenDwgImporter={onOpenDwgImporter} launchPadOpen={launchPadOpen} onToggleLaunchPad={onToggleLaunchPad} />}
        {activeTab === 'venueDwg' && <VenueDwgPanel onOpenDwgImporter={onOpenDwgImporter} />}
        {activeTab === 'venue' && <VenuePanel />}
        {activeTab === 'objects' && <ObjectLibrary />}
        {activeTab === 'lidars' && <LidarNetworkPanel onOpenEdgeCommissioning={onOpenEdgeCommissioning} />}
        {activeTab === 'regions' && <RoiPanel />}
        {activeTab === 'planogram' && <PlanogramPanel />}
      </div>

      {/* Footer */}
      <div className="h-12 border-t border-border-dark flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => venue?.id && setShowWhiteLabel(true)}
            className="text-gray-400 hover:text-white transition-colors"
            title="White Label Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setShowSimulator(true)}
            className="text-gray-400 hover:text-orange-400 transition-colors"
            title="Edge Simulator Control"
          >
            <Play className="w-4 h-4" />
          </button>
          <img 
            src="/assets/ulisse-logo.png" 
            alt="Ulisse" 
            className="h-10 w-auto opacity-90"
          />
        </div>
        <span className="text-[10px] text-gray-600">v1.0.0</span>
      </div>
      
      {/* White Label Settings Modal */}
      {venue?.id && (
        <WhiteLabelSettings
          venueId={venue.id}
          isOpen={showWhiteLabel}
          onClose={() => setShowWhiteLabel(false)}
        />
      )}
      
      {/* Simulator Control Modal */}
      {showSimulator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="relative max-w-4xl w-full mx-4">
            <button
              onClick={() => setShowSimulator(false)}
              className="absolute -top-2 -right-2 z-10 p-1 bg-gray-700 hover:bg-gray-600 rounded-full text-white"
            >
              <X className="w-4 h-4" />
            </button>
            <SimulatorControl />
          </div>
        </div>
      )}
    </div>
  )
}
