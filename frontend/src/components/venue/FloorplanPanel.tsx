import { useState, useEffect } from 'react'
import { 
  Map as MapIcon, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  Loader2, 
  Plus,
  Settings,
  Save,
  ChevronDown,
  ChevronUp,
  Trash2,
  Radio
} from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'
import { useToast } from '../../context/ToastContext'
import { LidarPlacement } from '../../types'
import VenueSettingsPanel from './VenueSettingsPanel'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface DwgImport {
  import_id: string
  filename: string
  created_at: string
  status: string
}

interface LayoutVersion {
  id: string
  import_id: string
  name: string
  is_active: boolean
  created_at: string
  venue_id?: string
}

interface FloorplanItem {
  id: string
  name: string
  type: 'dwg' | 'manual'
  dimensions: { width: number; depth: number; height: number }
  createdAt: string
  layoutId?: string
  venueId?: string
  importId?: string
  dwgFilename?: string
  has3D: boolean
}

interface FloorplanPanelProps {
  onOpenDwgImporter?: () => void
}

export default function FloorplanPanel({ onOpenDwgImporter }: FloorplanPanelProps) {
  const { 
    venue, 
    venueList, 
    updateVenue, 
    saveVenue, 
    createVenue, 
    loadVenue, 
    fetchVenueList, 
    deleteVenue, 
    isLoading: venueLoading 
  } = useVenue()
  const { placements, setPlacements } = useLidar()
  const { addToast } = useToast()
  
  // DWG state
  const [imports, setImports] = useState<DwgImport[]>([])
  const [layouts, setLayouts] = useState<Map<string, LayoutVersion>>(new Map())
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(() => {
    return localStorage.getItem('venueDwg-selectedLayout') || null
  })
  const [isLoadingDwg, setIsLoadingDwg] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // UI state
  const [showSettings, setShowSettings] = useState(false)
  const [showVenueSettingsModal, setShowVenueSettingsModal] = useState(false)
  const [showNewManual, setShowNewManual] = useState(false)
  const [newVenueName, setNewVenueName] = useState('New Venue')
  const [newVenueWidth, setNewVenueWidth] = useState(20)
  const [newVenueDepth, setNewVenueDepth] = useState(15)
  const [newVenueHeight, setNewVenueHeight] = useState(4)

  // Fetch venue list on mount
  useEffect(() => {
    fetchVenueList()
  }, [])

  // Fetch DWG imports
  useEffect(() => {
    const fetchImports = async () => {
      setIsLoadingDwg(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/dwg/imports`)
        if (!res.ok) throw new Error('Failed to fetch imports')
        const data = await res.json()
        setImports(data)
        
        // Fetch layout versions for each import
        const layoutMap = new Map<string, LayoutVersion>()
        for (const imp of data) {
          try {
            const layoutRes = await fetch(`${API_BASE}/api/dwg/import/${imp.import_id}/layouts`)
            if (layoutRes.ok) {
              const layoutData = await layoutRes.json()
              if (layoutData.length > 0) {
                // Get the most recent layout that has a venue_id, or fall back to first
                const layout = layoutData.find((l: LayoutVersion) => l.venue_id) || layoutData[0]
                layoutMap.set(imp.import_id, layout)
              }
            }
          } catch {
            // Ignore individual layout fetch errors
          }
        }
        setLayouts(layoutMap)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setIsLoadingDwg(false)
      }
    }
    fetchImports()
  }, [])

  // Persist selected layout
  useEffect(() => {
    if (selectedLayoutId) {
      localStorage.setItem('venueDwg-selectedLayout', selectedLayoutId)
    } else {
      localStorage.removeItem('venueDwg-selectedLayout')
    }
  }, [selectedLayoutId])

  // Build unified floorplan list - start from venues as source of truth
  const floorplans: FloorplanItem[] = []
  
  // Create a map of venue_id -> layout info for quick lookup
  const venueToLayout = new Map<string, { layout: LayoutVersion; importId: string; filename: string }>()
  imports.forEach(imp => {
    const layout = layouts.get(imp.import_id)
    if (layout?.venue_id) {
      venueToLayout.set(layout.venue_id, { 
        layout, 
        importId: imp.import_id, 
        filename: imp.filename 
      })
    }
  })
  
  // Add all venues, determining type based on DWG linkage
  venueList.forEach(v => {
    const dwgInfo = venueToLayout.get(v.id)
    const isDwgBased = !!dwgInfo
    
    floorplans.push({
      id: v.id,
      name: v.name,
      type: isDwgBased ? 'dwg' : 'manual',
      dimensions: { width: v.width, depth: v.depth, height: 4 },
      createdAt: '',
      layoutId: dwgInfo?.layout.id,
      venueId: v.id,
      importId: dwgInfo?.importId,
      dwgFilename: dwgInfo?.filename,
      has3D: true
    })
  })

  // Get current active floorplan
  const activeFloorplan = floorplans.find(fp => 
    (fp.type === 'dwg' && fp.layoutId === selectedLayoutId) ||
    (fp.type === 'manual' && fp.venueId === venue?.id && !selectedLayoutId)
  )

  const handleSelectFloorplan = async (fp: FloorplanItem) => {
    if (fp.type === 'dwg' && fp.layoutId) {
      setSelectedLayoutId(fp.layoutId)
      if (fp.venueId) {
        await loadVenue(fp.venueId)
      }
      window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: fp.layoutId } }))
    } else if (fp.type === 'manual' && fp.venueId) {
      setSelectedLayoutId(null)
      await loadVenue(fp.venueId, (loadedPlacements) => {
        setPlacements(loadedPlacements as LidarPlacement[])
      })
    }
  }

  const handleSave = () => {
    saveVenue(placements)
    addToast('success', 'Venue saved')
  }

  const handleCreateManual = () => {
    createVenue(newVenueName, newVenueWidth, newVenueDepth, newVenueHeight, 1)
    setShowNewManual(false)
    setNewVenueName('New Venue')
    setNewVenueWidth(20)
    setNewVenueDepth(15)
    setNewVenueHeight(4)
    setSelectedLayoutId(null) // Clear DWG selection for manual venue
  }

  const handleDeleteFloorplan = async (e: React.MouseEvent, fp: FloorplanItem) => {
    e.stopPropagation()
    if (!confirm(`Delete "${fp.name}"? This cannot be undone.`)) return
    
    if (fp.venueId) {
      await deleteVenue(fp.venueId)
    }
  }

  const handleRefresh = () => {
    window.location.reload()
  }

  const isLoading = isLoadingDwg || venueLoading

  return (
    <div className="p-4 space-y-4">
      {/* Section 1: Current Floorplan */}
      <div className="bg-card-bg border border-border-dark rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-highlight" />
            Current Floorplan
          </h2>
          <button
            onClick={handleRefresh}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : venue ? (
          <div className="space-y-3">
            {/* Active Floorplan Card */}
            <div className="bg-highlight/5 border border-highlight/30 rounded-lg p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="w-4 h-4 text-highlight flex-shrink-0" />
                    <span className="text-sm font-medium text-white truncate">{venue.name}</span>
                    {activeFloorplan?.type === 'dwg' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">DWG</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {venue.width}m × {venue.depth}m × {venue.height}m
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowVenueSettingsModal(true)}
                className="flex-1 py-2 bg-panel-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2 text-xs whitespace-nowrap"
                title="Capacity & Thresholds"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={handleSave}
                disabled={venueLoading}
                className="flex-1 py-2 bg-highlight text-white rounded-lg hover:bg-highlight-hover transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {venueLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">No floorplan active</p>
            <p className="text-xs text-gray-600 mt-1">Select one from the library below</p>
          </div>
        )}
      </div>

      {/* Section 2: Settings (Collapsible) */}
      {venue && (
        <div className="bg-card-bg border border-border-dark rounded-lg overflow-hidden">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-300 hover:bg-panel-bg transition-colors"
          >
            <span className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Dimensions
            </span>
            {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          
          {showSettings && (
            <div className="p-4 pt-0 space-y-3 border-t border-border-dark">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={venue.name}
                  onChange={e => updateVenue({ name: e.target.value })}
                  className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Width (m)</label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={venue.width}
                    onChange={e => updateVenue({ width: parseFloat(e.target.value) || 20 })}
                    className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Depth (m)</label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={venue.depth}
                    onChange={e => updateVenue({ depth: parseFloat(e.target.value) || 15 })}
                    className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Height (m)</label>
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={venue.height}
                    onChange={e => updateVenue({ height: parseFloat(e.target.value) || 4 })}
                    className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Grid Size</label>
                <select
                  value={venue.tileSize}
                  onChange={e => updateVenue({ tileSize: parseFloat(e.target.value) })}
                  className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                >
                  <option value="0.5">0.5m</option>
                  <option value="1">1m</option>
                  <option value="2">2m</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section 3: Floorplan Library */}
      <div className="bg-card-bg border border-border-dark rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Radio className="w-4 h-4" />
          Floorplan Library
        </h3>

        {error && (
          <div className="p-2 mb-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {floorplans.length === 0 ? (
          <div className="text-center py-6">
            <MapIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No floorplans yet</p>
            <p className="text-xs text-gray-600 mt-1">Import a DWG or create a manual venue</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {floorplans.map(fp => {
              const isActive = 
                (fp.type === 'dwg' && fp.layoutId === selectedLayoutId) ||
                (fp.type === 'manual' && fp.venueId === venue?.id && !selectedLayoutId)
              
              return (
                <button
                  key={fp.id}
                  onClick={() => fp.has3D && handleSelectFloorplan(fp)}
                  disabled={!fp.has3D}
                  className={`w-full text-left p-3 rounded-lg border transition-colors group ${
                    isActive
                      ? 'bg-highlight/10 border-highlight text-white'
                      : fp.has3D
                      ? 'bg-panel-bg border-border-dark hover:border-gray-600 text-gray-300'
                      : 'bg-panel-bg/50 border-border-dark/50 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isActive ? (
                          <div className="w-3 h-3 rounded-full bg-highlight flex-shrink-0" />
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-gray-600 flex-shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate">{fp.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          fp.type === 'dwg' 
                            ? 'bg-blue-500/20 text-blue-400' 
                            : 'bg-purple-500/20 text-purple-400'
                        }`}>
                          {fp.type === 'dwg' ? 'DWG' : 'Manual'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 ml-5">
                        {fp.dimensions.width}m × {fp.dimensions.depth}m
                        {fp.dwgFilename && (
                          <span className="ml-2 text-gray-600">· {fp.dwgFilename}</span>
                        )}
                      </div>
                    </div>
                    {fp.venueId && (
                      <button
                        onClick={(e) => handleDeleteFloorplan(e, fp)}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Create Actions */}
        <div className="flex gap-2 mt-3 pt-3 border-t border-border-dark">
          {onOpenDwgImporter && (
            <button
              onClick={onOpenDwgImporter}
              className="flex-1 py-2 px-3 bg-highlight/10 border border-highlight/30 text-highlight rounded-lg hover:bg-highlight/20 transition-colors flex items-center justify-center gap-1.5 text-xs whitespace-nowrap"
              title="Import DWG/DXF file"
            >
              <Plus className="w-3.5 h-3.5" />
              DWG
            </button>
          )}
          <button
            onClick={() => setShowNewManual(true)}
            className="flex-1 py-2 px-3 bg-panel-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-1.5 text-xs whitespace-nowrap"
            title="Create manual venue"
          >
            <Plus className="w-3.5 h-3.5" />
            Manual
          </button>
        </div>
      </div>

      {/* New Manual Venue Modal */}
      {showNewManual && (
        <div className="bg-card-bg border border-highlight rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">Create Manual Venue</h3>
          <p className="text-xs text-gray-400">
            Create a simple rectangular venue without a DWG file.
          </p>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Venue Name</label>
            <input
              type="text"
              value={newVenueName}
              onChange={e => setNewVenueName(e.target.value)}
              placeholder="My Store"
              className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Width (m)</label>
              <input
                type="number"
                min="5"
                max="100"
                value={newVenueWidth}
                onChange={e => setNewVenueWidth(parseFloat(e.target.value) || 20)}
                className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Depth (m)</label>
              <input
                type="number"
                min="5"
                max="100"
                value={newVenueDepth}
                onChange={e => setNewVenueDepth(parseFloat(e.target.value) || 15)}
                className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Height (m)</label>
              <input
                type="number"
                min="2"
                max="20"
                value={newVenueHeight}
                onChange={e => setNewVenueHeight(parseFloat(e.target.value) || 4)}
                className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateManual}
              className="flex-1 py-2 bg-highlight text-white rounded hover:bg-highlight-hover transition-colors text-sm"
            >
              Create
            </button>
            <button
              onClick={() => setShowNewManual(false)}
              className="flex-1 py-2 bg-border-dark text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Venue Settings Modal */}
      {venue && (
        <VenueSettingsPanel
          venueId={venue.id}
          venueName={venue.name}
          isOpen={showVenueSettingsModal}
          onClose={() => setShowVenueSettingsModal(false)}
        />
      )}
    </div>
  )
}
