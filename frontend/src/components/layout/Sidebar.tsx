import { useState } from 'react'
import { Box, Package, Radar, Settings, Hexagon, FileUp, Target, Map } from 'lucide-react'
import { SidebarTab } from './AppShell'
import VenuePanel from '../venue/VenuePanel'
import VenueDwgPanel from '../venue/VenueDwgPanel'
import ObjectLibrary from '../objects/ObjectLibrary'
import LidarNetworkPanel from '../lidar/LidarNetworkPanel'
import RoiPanel from '../roi/RoiPanel'
import WhiteLabelSettings from '../settings/WhiteLabelSettings'
import { useVenue } from '../../context/VenueContext'

interface SidebarProps {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  onOpenDwgImporter?: () => void
  onOpenLidarPlanner?: () => void
}

const tabs: { id: SidebarTab; icon: typeof Box; label: string }[] = [
  { id: 'venueDwg', icon: Map, label: 'DWG' },
  { id: 'venue', icon: Box, label: 'Venue' },
  { id: 'objects', icon: Package, label: 'Objects' },
  { id: 'lidars', icon: Radar, label: 'LiDARs' },
  { id: 'regions', icon: Hexagon, label: 'Regions' },
]

export default function Sidebar({ activeTab, onTabChange, onOpenDwgImporter, onOpenLidarPlanner }: SidebarProps) {
  const { venue } = useVenue()
  const [showWhiteLabel, setShowWhiteLabel] = useState(false)

  return (
    <div className="w-72 flex-shrink-0 h-full bg-panel-bg border-r border-border-dark flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border-dark flex items-center px-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Radar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">Hyperspace</h1>
            <p className="text-[10px] text-gray-500">LiDAR Configurator</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-border-dark">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 py-3 px-2 text-xs font-medium transition-colors flex flex-col items-center gap-1 ${
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

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'venueDwg' && <VenueDwgPanel />}
        {activeTab === 'venue' && <VenuePanel />}
        {activeTab === 'objects' && <ObjectLibrary />}
        {activeTab === 'lidars' && <LidarNetworkPanel />}
        {activeTab === 'regions' && <RoiPanel />}
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
          {onOpenDwgImporter && (
            <button 
              onClick={onOpenDwgImporter}
              className="text-gray-400 hover:text-highlight transition-colors"
              title="Import DWG/DXF Floorplan"
            >
              <FileUp className="w-4 h-4" />
            </button>
          )}
          {onOpenLidarPlanner && (
            <button 
              onClick={onOpenLidarPlanner}
              className="text-gray-400 hover:text-green-400 transition-colors"
              title="LiDAR Coverage Planner"
            >
              <Target className="w-4 h-4" />
            </button>
          )}
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
    </div>
  )
}
