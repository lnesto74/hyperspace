import { useState, useEffect, useRef } from 'react'
import { Eye, Grid3X3, Box, ArrowUp, Sun, X, Radio, History, Crosshair, LayoutGrid, ChevronLeft, ChevronRight, Compass, Sparkles, FileVideo, Tag, Film, Send, Activity } from 'lucide-react'
import TeamTelegramModal from '../../features/opsDispatch/TeamTelegramModal'
import { HyperspacePulseOverlay } from '../../features/pulse'
import Sidebar from './Sidebar'
import RightPanel from './RightPanel'
import ModeBar from './ModeBar'
import MainViewport from '../venue/MainViewport'
import type { CaptureScreenshotFn } from '../venue/MainViewport'
import TimelineReplay from '../timeline/TimelineReplay'
import LandingExperience from '../landing/LandingExperience'
import FlowFieldEmbed from '../flowfield/FlowFieldEmbed'
import type { FlowFieldHandle } from '../flowfield/FlowFieldEmbed'
import { NeuralDashboard } from '../neuralDashboard'
import MatchingTunerPanel from '../matching/MatchingTunerPanel'
import TrajectoryQualityPanel from '../matching/TrajectoryQualityPanel'
import ReplayPanel from '../replay/ReplayPanel'
import AnnotationPanel from '../replay/AnnotationPanel'
import { TRACK_STORIES_LAUNCH_KEY, type TrackStoriesLaunch } from '../../types/trackStories'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'
import { useDwg } from '../../context/DwgContext'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import IntentFieldOverlay from '../../features/profitRadar/IntentFieldOverlay'
import { useViewMode } from '../../App'
import { useRoi } from '../../context/RoiContext'
import ZoneKPIOverlayPanel from '../kpi/ZoneKPIOverlayPanel'
export type SidebarTab = 'floorplan' | 'venueDwg' | 'venue' | 'objects' | 'lidars' | 'regions' | 'planogram'
export type CameraView = 'perspective' | 'top' | 'isometric' | 'front'

export interface LightingSettings {
  ambientIntensity: number
  directionalIntensity: number
  directionalX: number
  directionalY: number
  directionalZ: number
  shadowsEnabled: boolean
}

export type TrackDisplayMode = 'cylinder' | 'pointcloud'

export interface TrackingSettings {
  trailSeconds: number
  cylinderOpacity: number
  showSkuDebug: boolean
  autoShowSlotHighlight: boolean
  trackDisplayMode: TrackDisplayMode
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
  showSkuDebug: false,
  autoShowSlotHighlight: false,
  trackDisplayMode: 'cylinder',
}

interface AppShellProps {
  onOpenDwgImporter?: () => void
  onOpenEdgeCommissioning?: () => void
  showLanding?: boolean
  onDismissLanding?: () => void
}

export default function AppShell({ onOpenDwgImporter, onOpenEdgeCommissioning, showLanding = false, onDismissLanding }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('floorplan')
  const [cameraView, setCameraView] = useState<CameraView>('perspective')
  const [showLightingPopup, setShowLightingPopup] = useState(false)
  const [showTrackingPopup, setShowTrackingPopup] = useState(false)
  const [showMatchingTuner, setShowMatchingTuner] = useState(false)
  const [showTrajectoryQuality, setShowTrajectoryQuality] = useState(false)
  const [showReplayPanel, setShowReplayPanel] = useState(false)
  const [showAnnotationPanel, setShowAnnotationPanel] = useState(false)
  const [trackStoriesLaunch, setTrackStoriesLaunch] = useState<TrackStoriesLaunch | null>(null)
  const [lighting, setLighting] = useState<LightingSettings>(defaultLighting)
  const [tracking, setTracking] = useState<TrackingSettings>(defaultTracking)
  const { venue, selectedObjectId, objects } = useVenue()
  const { selectedPlacementId, placements } = useLidar()
  const { dwgLayoutId: selectedDwgLayoutId } = useDwg()
  const { intentFieldEnabled, setIntentFieldEnabled } = useProfitRadar()
  const { launchPadOpen: lpOpen, setLaunchPadOpen: setLpOpen, neuralDashboardEnabled, setNeuralDashboardEnabled, floorViz } = useViewMode()
  const [flowFieldMounted, setFlowFieldMounted] = useState(false)
  const flowFieldRef = useRef<FlowFieldHandle>(null)
  const [flowStoryOn, setFlowStoryOn] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { showKPIOverlays, regions } = useRoi()

  const [storyModeActive, setStoryModeActive] = useState(false)
  const showKpiRail = showKPIOverlays && regions.length > 0 && !selectedObjectId && !neuralDashboardEnabled && !storyModeActive

  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    return () => window.clearTimeout(t)
  }, [showKpiRail])

  // Mount the flow-field iframe only after Enter Workspace (never on landing).
  // Keep it mounted when the customer flips to Live tracks so the splash does not restart.
  useEffect(() => {
    if (!showLanding && floorViz === 'flow') setFlowFieldMounted(true)
  }, [showLanding, floorViz])

  // After Enter Workspace, start with the left tab section folded so the field
  // has the same room as Business Reporting. The chevron stays; they can reopen it.
  useEffect(() => {
    if (!showLanding && floorViz === 'flow') setSidebarCollapsed(true)
    if (floorViz !== 'flow') setFlowStoryOn(false)
  }, [showLanding, floorViz])

  // Opening the workspace sidebar must not stack two fat left rails.
  useEffect(() => {
    if (floorViz === 'flow' && !sidebarCollapsed) {
      flowFieldRef.current?.setControlsCollapsed(true)
    }
  }, [floorViz, sidebarCollapsed])
  
  // Determine if we're in DWG venue mode
  const isDwgMode = activeTab === 'venueDwg' && selectedDwgLayoutId !== null
  
  // Get selected placement for coordinates display
  const selectedPlacement = placements.find(p => p.id === selectedPlacementId)
  const selectedObject = objects.find(o => o.id === selectedObjectId)
  
  // Auto-save venue, objects, and placements after changes
  useAutoSave()

  useEffect(() => {
    const openFromStorage = () => {
      try {
        const raw = sessionStorage.getItem(TRACK_STORIES_LAUNCH_KEY)
        if (!raw) return
        sessionStorage.removeItem(TRACK_STORIES_LAUNCH_KEY)
        const payload = JSON.parse(raw) as TrackStoriesLaunch
        setTrackStoriesLaunch(payload)
        setShowReplayPanel(true)
      } catch { /* ignore */ }
    }
    openFromStorage()
    const onOpen = () => openFromStorage()
    window.addEventListener('hyperspace:open-track-stories', onOpen)
    return () => window.removeEventListener('hyperspace:open-track-stories', onOpen)
  }, [])
  
  // Screenshot capture function from MainViewport
  const [captureScreenshot, setCaptureScreenshot] = useState<CaptureScreenshotFn | null>(null)

  // Timeline replay state
  const [showTimeline, setShowTimeline] = useState(false)
  const [replayTimestamp, setReplayTimestamp] = useState<number | null>(null)

  // Story Mode toggle (lives in the footer for consistency). Listen for the
  // overlay's active state to highlight the toggle and auto-collapse the
  // sidebar while the guided demo runs (restored on exit).
  const [showTeamTelegram, setShowTeamTelegram] = useState(false)
  const [pulseEnabled, setPulseEnabled] = useState(false)

  useEffect(() => {
    if (pulseEnabled) setIntentFieldEnabled(true)
  }, [pulseEnabled, setIntentFieldEnabled])
  const prevSidebarRef = useRef<boolean | null>(null)
  useEffect(() => {
    const onState = (e: Event) => {
      const active = !!(e as CustomEvent<{ active: boolean }>).detail?.active
      setStoryModeActive(active)
      if (active) {
        setSidebarCollapsed(prev => {
          if (prevSidebarRef.current === null) prevSidebarRef.current = prev
          return true
        })
      } else {
        setSidebarCollapsed(prev => {
          const restore = prevSidebarRef.current
          prevSidebarRef.current = null
          return restore === null ? prev : restore
        })
      }
    }
    window.addEventListener('hyperspace:story-mode-state', onState)
    return () => window.removeEventListener('hyperspace:story-mode-state', onState)
  }, [])
  
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
      {/* Left Sidebar with collapse toggle */}
      <div className="relative flex">
        {!sidebarCollapsed && (
          <Sidebar activeTab={activeTab} onTabChange={setActiveTab} onOpenDwgImporter={onOpenDwgImporter} onOpenEdgeCommissioning={onOpenEdgeCommissioning} launchPadOpen={lpOpen} onToggleLaunchPad={() => setLpOpen(!lpOpen)} />
        )}
        {/* Collapse/Expand toggle button */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className={`absolute z-50 flex items-center justify-center w-5 h-10 bg-panel-bg border border-border-dark rounded-r-md hover:bg-gray-700 transition-all ${
            sidebarCollapsed ? 'left-0' : 'left-[280px]'
          } ${
            floorViz === 'flow' && sidebarCollapsed
              ? 'top-2'
              : 'top-1/2 -translate-y-1/2'
          }`}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          )}
        </button>
      </div>
      
      {/* Main Content Area with ModeBar + 3D Viewport */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Mode Bar - Setup/Edit/Live toggle + Venue selector */}
        <ModeBar hideFloorViz={showLanding} />
        
        {/* 3D Viewport + optional KPI focus rail */}
        <div className="flex-1 relative overflow-hidden flex flex-row min-h-0">
        {showKpiRail && <ZoneKPIOverlayPanel />}

        <div className="flex-1 relative overflow-hidden min-w-0 min-h-0">
        <NeuralDashboard 
          enabled={neuralDashboardEnabled}
          leftOffset={sidebarCollapsed ? 16 : 0}
          isReplayMode={isReplayMode}
        >
          <MainViewport 
            cameraView={cameraView} 
            lighting={lighting} 
            tracking={tracking}
            isReplayMode={isReplayMode}
            replayTimestamp={replayTimestamp}
            onCaptureReady={(fn) => setCaptureScreenshot(() => fn)}
          />
        </NeuralDashboard>

        {flowFieldMounted && (
          <div
            className={`absolute inset-0 z-20 ${
              !showLanding && floorViz === 'flow' ? '' : 'invisible pointer-events-none'
            }`}
          >
            <FlowFieldEmbed
              ref={flowFieldRef}
              venueId={venue?.id}
              title="People-flow field"
              startCollapsed
              onStoryChange={setFlowStoryOn}
            />
          </div>
        )}

        {/* Intent Field Overlay (Profit Radar) - only show in default mode */}
        {!neuralDashboardEnabled && <IntentFieldOverlay />}

        {/* Perception Matching live tuner — floating panel on top of 3D venue. */}
        {showMatchingTuner && venue?.id && (
          <MatchingTunerPanel venueId={venue.id} onClose={() => setShowMatchingTuner(false)} />
        )}

        {/* Trajectory Quality panel — reconciler config + live stats. */}
        {showTrajectoryQuality && venue?.id && (
          <TrajectoryQualityPanel venueId={venue.id} onClose={() => setShowTrajectoryQuality(false)} />
        )}

        {/* MQTT capture replay panel */}
        {showReplayPanel && (
          <ReplayPanel
            onClose={() => {
              setShowReplayPanel(false)
              setTrackStoriesLaunch(null)
            }}
            launch={trackStoriesLaunch}
          />
        )}

        {/* Reconciliation merge annotation panel — fully isolated 2D viewer, does not touch the live 3D */}
        {showAnnotationPanel && (
          <AnnotationPanel onClose={() => setShowAnnotationPanel(false)} />
        )}


        {/* Landing Experience - renders inside viewport area, on top of 3D */}
        {showLanding && onDismissLanding && (
          <LandingExperience
            onDismiss={onDismissLanding}
            captureScreenshot={captureScreenshot}
          />
        )}
        
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
                <label className="text-xs text-gray-400 block mb-1.5">Display Mode</label>
                <div className="flex rounded-md overflow-hidden border border-border-dark">
                  <button
                    onClick={() => setTracking(prev => ({ ...prev, trackDisplayMode: 'cylinder' }))}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                      tracking.trackDisplayMode === 'cylinder'
                        ? 'bg-highlight text-white'
                        : 'bg-transparent text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    Cylinder
                  </button>
                  <button
                    onClick={() => setTracking(prev => ({ ...prev, trackDisplayMode: 'pointcloud' }))}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                      tracking.trackDisplayMode === 'pointcloud'
                        ? 'bg-highlight text-white'
                        : 'bg-transparent text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    Point Cloud
                  </button>
                </div>
              </div>
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
              <div className="flex items-center justify-between pt-2 border-t border-border-dark">
                <label className="text-xs text-gray-400">SKU Detection Debug</label>
                <button
                  onClick={() => setTracking(prev => ({ ...prev, showSkuDebug: !prev.showSkuDebug }))}
                  className={`w-10 h-5 rounded-full transition-colors ${
                    tracking.showSkuDebug ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    tracking.showSkuDebug ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                Shows SKU badges when people dwell near shelves
              </p>
              <div className="flex items-center justify-between pt-2 border-t border-border-dark">
                <label className="text-xs text-gray-400">Auto Slot Highlight</label>
                <button
                  onClick={() => setTracking(prev => ({ ...prev, autoShowSlotHighlight: !prev.autoShowSlotHighlight }))}
                  className={`w-10 h-5 rounded-full transition-colors ${
                    tracking.autoShowSlotHighlight ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    tracking.autoShowSlotHighlight ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                Auto-show slot rectangles when person enters zone
              </p>
              <button
                onClick={() => setTracking(defaultTracking)}
                className="w-full py-1.5 text-xs text-gray-400 hover:text-white border border-border-dark rounded hover:bg-gray-700 transition-colors"
              >
                Reset to Default
              </button>
            </div>
          </div>
        )}
        
        {/* Status Bar - always visible */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-panel-bg/90 border-t border-border-dark flex items-center px-4 text-xs text-gray-400 z-20">
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
              onClick={() => setShowMatchingTuner(v => !v)}
              className={`p-1.5 rounded transition-colors ${
                showMatchingTuner
                  ? 'bg-cyan-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Perception ↔ Venue live tuner"
            >
              <Compass className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowTrajectoryQuality(v => !v)}
              className={`p-1.5 rounded transition-colors ${
                showTrajectoryQuality
                  ? 'bg-emerald-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Trajectory Quality (reconciler & ghost filter)"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowReplayPanel(v => !v)}
              className={`p-1.5 rounded transition-colors ${
                showReplayPanel
                  ? 'bg-amber-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Replay a recorded MQTT capture"
            >
              <FileVideo className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowAnnotationPanel(v => !v)}
              className={`p-1.5 rounded transition-colors ${
                showAnnotationPanel
                  ? 'bg-sky-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Annotate reconciliation merges (isolated 2D)"
            >
              <Tag className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIntentFieldEnabled(!intentFieldEnabled)}
              className={`p-1.5 rounded transition-colors ${
                intentFieldEnabled 
                  ? 'bg-emerald-600 text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Intent Field (Profit Radar)"
            >
              <Crosshair className="w-3.5 h-3.5" />
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
            <button
              onClick={() => setNeuralDashboardEnabled(!neuralDashboardEnabled)}
              className={`p-1.5 rounded transition-colors ${
                neuralDashboardEnabled 
                  ? 'bg-cyan-600 text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Neural Dashboard (4-Quadrant View)"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (floorViz === 'flow') flowFieldRef.current?.toggleStory()
                else window.dispatchEvent(new CustomEvent('hyperspace:story-mode-toggle'))
              }}
              className={`p-1.5 rounded transition-colors ${
                (floorViz === 'flow' ? flowStoryOn : storyModeActive)
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title={floorViz === 'flow' ? 'Story Mode (people-flow field)' : 'Story Mode (guided demo)'}
            >
              <Film className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPulseEnabled(!pulseEnabled)}
              className={`p-1.5 rounded transition-colors ${
                pulseEnabled
                  ? 'bg-cyan-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Hyperspace Pulse (wireframe live floor)"
            >
              <Activity className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowTeamTelegram(true)}
              className={`p-1.5 rounded transition-colors ${
                showTeamTelegram
                  ? 'bg-sky-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Team & Telegram dispatch"
            >
              <Send className="w-3.5 h-3.5" />
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
        {venue?.id && (
          <TeamTelegramModal venueId={venue.id} isOpen={showTeamTelegram} onClose={() => setShowTeamTelegram(false)} />
        )}
        {pulseEnabled && (
          <HyperspacePulseOverlay onOpenTelegram={() => setShowTeamTelegram(true)} />
        )}
        </div>
        </div>
      </div>
      
      {/* Right Panel (conditional) */}
      {showRightPanel && <RightPanel />}
    </div>
  )
}
