import { useState } from 'react'
import { Eye, Grid3X3, Box, ArrowUp, Sun, X, Radio, History } from 'lucide-react'
import Sidebar from './Sidebar'
import RightPanel from './RightPanel'
import MainViewport from '../venue/MainViewport'
import TimelineReplay from '../timeline/TimelineReplay'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'
import { useDwg } from '../../context/DwgContext'
import { useAutoSave } from '../../hooks/useAutoSave'

export type SidebarTab = 'venueDwg' | 'venue' | 'objects' | 'lidars' | 'regions'
export type CameraView = 'perspective' | 'top' | 'isometric' | 'front'

export interface LightingSettings {
  ambientIntensity: number
  directionalIntensity: number
  directionalX: number
  directionalY: number
  directionalZ: number
  shadowsEnabled: boolean
}

export interface TrackingSettings {
  trailSeconds: number
  cylinderOpacity: number
}

const defaultLighting: LightingSettings = {
  ambientIntensity: 0.6,
  directionalIntensity: 0.8,
  directionalX: 5,
  directionalY: 10,
  directionalZ: 5,
  shadowsEnabled: true,
}

const defaultTracking: TrackingSettings = {
  trailSeconds: 10,
  cylinderOpacity: 0.5,
}

interface AppShellProps {
  onOpenDwgImporter?: () => void
  onOpenLidarPlanner?: () => void
  onOpenEdgeCommissioning?: () => void
}

export default function AppShell({ onOpenDwgImporter, onOpenLidarPlanner, onOpenEdgeCommissioning }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('venue')
  const [cameraView, setCameraView] = useState<CameraView>('perspective')
  const [showLightingPopup, setShowLightingPopup] = useState(false)
  const [showTrackingPopup, setShowTrackingPopup] = useState(false)
  const [lighting, setLighting] = useState<LightingSettings>(defaultLighting)
  const [tracking, setTracking] = useState<TrackingSettings>(defaultTracking)
  const { venue, selectedObjectId, objects } = useVenue()
  const { selectedPlacementId, placements } = useLidar()
  const { dwgLayoutId: selectedDwgLayoutId } = useDwg()
  
  // Determine if we're in DWG venue mode
  const isDwgMode = activeTab === 'venueDwg' && selectedDwgLayoutId !== null
  
  // Get selected placement for coordinates display
  const selectedPlacement = placements.find(p => p.id === selectedPlacementId)
  const selectedObject = objects.find(o => o.id === selectedObjectId)
  
  // Auto-save venue, objects, and placements after changes
  useAutoSave()
  
  // Timeline replay state
  const [showTimeline, setShowTimeline] = useState(false)
  const [replayTimestamp, setReplayTimestamp] = useState<number | null>(null)
  
  // When timeline is shown, we're in replay mode
  const isReplayMode = showTimeline && replayTimestamp !== null

  const showRightPanel = selectedObjectId !== null || selectedPlacementId !== null

  const viewButtons: { view: CameraView; icon: typeof Eye; label: string }[] = [
    { view: 'perspective', icon: Box, label: 'Perspective' },
    { view: 'top', icon: Grid3X3, label: 'Top Down' },
    { view: 'isometric', icon: Eye, label: 'Isometric' },
    { view: 'front', icon: ArrowUp, label: 'Front' },
  ]

  const updateLighting = (key: keyof LightingSettings, value: number | boolean) => {
    setLighting(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="h-screen w-screen flex bg-app-bg overflow-hidden">
      {/* Left Sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} onOpenDwgImporter={onOpenDwgImporter} onOpenLidarPlanner={onOpenLidarPlanner} onOpenEdgeCommissioning={onOpenEdgeCommissioning} />
      
      {/* Main 3D Viewport - flex-1 min-w-0 ensures it shrinks when panels open */}
      <div className="flex-1 min-w-0 relative overflow-hidden">
        <MainViewport 
          cameraView={cameraView} 
          lighting={lighting} 
          tracking={tracking}
          isReplayMode={isReplayMode}
          replayTimestamp={replayTimestamp}
        />
        
        {/* Lighting Popup */}
        {showLightingPopup && (
          <div className="absolute bottom-12 right-4 w-72 bg-panel-bg border border-border-dark rounded-lg shadow-xl z-50">
            <div className="flex items-center justify-between p-3 border-b border-border-dark">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <Sun className="w-4 h-4" />
                Lighting Settings
              </h3>
              <button
                onClick={() => setShowLightingPopup(false)}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ambient Light</label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={lighting.ambientIntensity}
                  onChange={(e) => updateLighting('ambientIntensity', parseFloat(e.target.value))}
                  className="w-full accent-highlight"
                />
                <span className="text-xs text-gray-500">{lighting.ambientIntensity.toFixed(1)}</span>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Directional Light</label>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="0.1"
                  value={lighting.directionalIntensity}
                  onChange={(e) => updateLighting('directionalIntensity', parseFloat(e.target.value))}
                  className="w-full accent-highlight"
                />
                <span className="text-xs text-gray-500">{lighting.directionalIntensity.toFixed(1)}</span>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Light Position X</label>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="1"
                  value={lighting.directionalX}
                  onChange={(e) => updateLighting('directionalX', parseFloat(e.target.value))}
                  className="w-full accent-highlight"
                />
                <span className="text-xs text-gray-500">{lighting.directionalX}</span>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Light Position Y (Height)</label>
                <input
                  type="range"
                  min="1"
                  max="30"
                  step="1"
                  value={lighting.directionalY}
                  onChange={(e) => updateLighting('directionalY', parseFloat(e.target.value))}
                  className="w-full accent-highlight"
                />
                <span className="text-xs text-gray-500">{lighting.directionalY}</span>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Light Position Z</label>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="1"
                  value={lighting.directionalZ}
                  onChange={(e) => updateLighting('directionalZ', parseFloat(e.target.value))}
                  className="w-full accent-highlight"
                />
                <span className="text-xs text-gray-500">{lighting.directionalZ}</span>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">Shadows</label>
                <button
                  onClick={() => updateLighting('shadowsEnabled', !lighting.shadowsEnabled)}
                  className={`w-10 h-5 rounded-full transition-colors ${
                    lighting.shadowsEnabled ? 'bg-highlight' : 'bg-gray-600'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    lighting.shadowsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              <button
                onClick={() => setLighting(defaultLighting)}
                className="w-full py-1.5 text-xs text-gray-400 hover:text-white border border-border-dark rounded hover:bg-gray-700 transition-colors"
              >
                Reset to Default
              </button>
            </div>
          </div>
        )}
        
        {/* Tracking Settings Popup */}
        {showTrackingPopup && (
          <div className="absolute bottom-12 right-20 w-64 bg-panel-bg border border-border-dark rounded-lg shadow-xl z-50">
            <div className="flex items-center justify-between p-3 border-b border-border-dark">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <Radio className="w-4 h-4" />
                Tracking Settings
              </h3>
              <button
                onClick={() => setShowTrackingPopup(false)}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Trail Duration (seconds)</label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={tracking.trailSeconds}
                  onChange={(e) => setTracking(prev => ({ ...prev, trailSeconds: parseFloat(e.target.value) }))}
                  className="w-full accent-highlight"
                />
                <span className="text-xs text-gray-500">{tracking.trailSeconds}s</span>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Cylinder Opacity</label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={tracking.cylinderOpacity}
                  onChange={(e) => setTracking(prev => ({ ...prev, cylinderOpacity: parseFloat(e.target.value) }))}
                  className="w-full accent-highlight"
                />
                <span className="text-xs text-gray-500">{(tracking.cylinderOpacity * 100).toFixed(0)}%</span>
              </div>
              <button
                onClick={() => setTracking(defaultTracking)}
                className="w-full py-1.5 text-xs text-gray-400 hover:text-white border border-border-dark rounded hover:bg-gray-700 transition-colors"
              >
                Reset to Default
              </button>
            </div>
          </div>
        )}
        
        {/* Status Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-panel-bg/90 border-t border-border-dark flex items-center px-4 text-xs text-gray-400">
          <span className="mr-4">
            <span className="text-gray-500">Venue:</span>{' '}
            <span className="text-gray-300">{venue?.name || 'None'}</span>
          </span>
          <span className="mr-4">
            <span className="text-gray-500">Size:</span>{' '}
            <span className="text-gray-300">{venue?.width}m × {venue?.depth}m</span>
          </span>
          <span className="mr-4">
            <span className="text-gray-500">Grid:</span>{' '}
            <span className="text-gray-300">{venue?.tileSize}m</span>
          </span>
          
          {/* Camera View Buttons */}
          <div className="flex items-center gap-1 mr-4 ml-2 border-l border-border-dark pl-3">
            <span className="text-gray-500 mr-2">View:</span>
            {viewButtons.map(({ view, icon: Icon, label }) => (
              <button
                key={view}
                onClick={() => setCameraView(view)}
                className={`p-1.5 rounded transition-colors ${
                  cameraView === view 
                    ? 'bg-highlight text-white' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
                title={label}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
          
          {/* Lighting Button */}
          <div className="flex items-center gap-1 mr-2 border-l border-border-dark pl-3">
            <button
              onClick={() => { setShowLightingPopup(!showLightingPopup); setShowTrackingPopup(false); }}
              className={`p-1.5 rounded transition-colors ${
                showLightingPopup 
                  ? 'bg-highlight text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Lighting Settings"
            >
              <Sun className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setShowTrackingPopup(!showTrackingPopup); setShowLightingPopup(false); }}
              className={`p-1.5 rounded transition-colors ${
                showTrackingPopup 
                  ? 'bg-highlight text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Tracking Settings"
            >
              <Radio className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowTimeline(!showTimeline)}
              className={`p-1.5 rounded transition-colors ${
                showTimeline 
                  ? 'bg-amber-600 text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Timeline Replay"
            >
              <History className="w-3.5 h-3.5" />
            </button>
          </div>
          
          {/* Coordinates Display */}
          {selectedPlacement && (
            <div className="flex items-center gap-2 mr-4 border-l border-border-dark pl-3">
              <span className="text-red-500 font-medium">●</span>
              <span className="text-gray-400">
                <span className="text-gray-500">X:</span>{' '}
                <span className="text-white font-mono">{selectedPlacement.position.x.toFixed(2)}m</span>
              </span>
              <span className="text-gray-400">
                <span className="text-gray-500">Z:</span>{' '}
                <span className="text-white font-mono">{selectedPlacement.position.z.toFixed(2)}m</span>
              </span>
              <span className="text-gray-400">
                <span className="text-gray-500">H:</span>{' '}
                <span className="text-white font-mono">{selectedPlacement.mountHeight.toFixed(2)}m</span>
              </span>
            </div>
          )}
          {selectedObject && !selectedPlacement && (
            <div className="flex items-center gap-2 mr-4 border-l border-border-dark pl-3">
              <span className="text-blue-500 font-medium">■</span>
              <span className="text-gray-400">
                <span className="text-gray-500">X:</span>{' '}
                <span className="text-white font-mono">{selectedObject.position.x.toFixed(2)}m</span>
              </span>
              <span className="text-gray-400">
                <span className="text-gray-500">Z:</span>{' '}
                <span className="text-white font-mono">{selectedObject.position.z.toFixed(2)}m</span>
              </span>
            </div>
          )}
          
          <div className="flex-1" />
          <span className="text-gray-500">
            Click objects to select • Drag to move • Right-click to rotate
          </span>
        </div>
        
        {/* Timeline Replay */}
        {venue?.id && (
          <TimelineReplay
            venueId={venue.id}
            isOpen={showTimeline}
            onTimeChange={setReplayTimestamp}
          />
        )}
      </div>
      
      {/* Right Panel (conditional) */}
      {showRightPanel && <RightPanel />}
    </div>
  )
}
