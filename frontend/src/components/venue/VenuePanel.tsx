import { useState, useEffect } from 'react'
import { Save, Download, Upload, Plus, RefreshCw, FolderOpen, Trash2, FileUp, Loader2 } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'
import { useToast } from '../../context/ToastContext'
import { LidarPlacement } from '../../types'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface DwgLayoutOption {
  id: string
  layout_version_id: string
  import_id: string
  name: string
  created_at: string
}

export default function VenuePanel() {
  const { venue, venueList, updateVenue, saveVenue, exportVenue, importVenue, createVenue, createVenueFromDwg, loadVenue, fetchVenueList, deleteVenue, isLoading } = useVenue()
  const { placements, setPlacements } = useLidar()
  const { addToast } = useToast()
  const [showNewVenue, setShowNewVenue] = useState(false)
  const [showDwgImport, setShowDwgImport] = useState(false)
  const [dwgLayouts, setDwgLayouts] = useState<DwgLayoutOption[]>([])
  const [selectedDwgLayout, setSelectedDwgLayout] = useState<string>('')
  const [dwgVenueName, setDwgVenueName] = useState('DWG Venue')
  const [loadingDwgLayouts, setLoadingDwgLayouts] = useState(false)
  const [newVenueName, setNewVenueName] = useState('New Venue')

  useEffect(() => {
    fetchVenueList()
  }, [])

  // Fetch DWG layouts when DWG import panel is shown
  useEffect(() => {
    if (showDwgImport) {
      const fetchDwgLayouts = async () => {
        setLoadingDwgLayouts(true)
        try {
          const res = await fetch(`${API_BASE}/api/dwg/layouts`)
          if (res.ok) {
            const layouts = await res.json()
            setDwgLayouts(layouts)
            if (layouts.length > 0 && !selectedDwgLayout) {
              setSelectedDwgLayout(layouts[0].id)
            }
          }
        } catch (err) {
          console.error('Failed to fetch DWG layouts:', err)
        } finally {
          setLoadingDwgLayouts(false)
        }
      }
      fetchDwgLayouts()
    }
  }, [showDwgImport, selectedDwgLayout])

  const handleSave = () => {
    saveVenue(placements)
  }

  const handleExport = () => {
    const json = exportVenue(placements)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${venue?.name || 'venue'}.json`
    a.click()
    URL.revokeObjectURL(url)
    addToast('success', 'Venue exported')
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const json = ev.target?.result as string
        importVenue(json)
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleCreate = () => {
    createVenue(newVenueName, 20, 15, 4, 1)
    setShowNewVenue(false)
    setNewVenueName('New Venue')
  }

  const handleCreateFromDwg = async () => {
    if (!selectedDwgLayout) {
      addToast('error', 'Please select a DWG layout')
      return
    }
    
    // Get scaleCorrection from localStorage (same key pattern as DwgImporterPage uses)
    // Try to find it from any stored autoplace settings
    let scaleCorrection = 1.0
    try {
      // Find the layout to get the import filename
      const selectedLayout = dwgLayouts.find(l => l.id === selectedDwgLayout)
      if (selectedLayout?.name) {
        const autoplaceKey = `dwg-autoplace-settings-${selectedLayout.name}`
        const saved = localStorage.getItem(autoplaceKey)
        if (saved) {
          const parsed = JSON.parse(saved)
          scaleCorrection = parsed.scaleCorrection || 1.0
        }
      }
    } catch (err) {
      console.log('Could not read scaleCorrection from localStorage, using default 1.0')
    }
    
    await createVenueFromDwg(
      selectedDwgLayout,
      dwgVenueName,
      scaleCorrection,
      (lidars) => {
        // Convert LiDAR draft to LidarPlacement format and set
        setPlacements(lidars as LidarPlacement[])
      }
    )
    
    setShowDwgImport(false)
    setDwgVenueName('DWG Venue')
    setSelectedDwgLayout('')
  }

  const handleLoadVenue = (id: string) => {
    loadVenue(id, (loadedPlacements) => {
      setPlacements(loadedPlacements as LidarPlacement[])
    })
  }

  const handleDeleteVenue = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (confirm('Delete this venue and all its objects?')) {
      deleteVenue(id)
    }
  }

  if (!venue) {
    return (
      <div className="p-4 space-y-4">
        {/* Saved Venues List */}
        {venueList.length > 0 && (
          <div className="bg-card-bg border border-border-dark rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Saved Venues
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {venueList.map(v => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 p-2 bg-panel-bg border border-border-dark rounded hover:border-highlight transition-colors group"
                >
                  <button
                    onClick={() => handleLoadVenue(v.id)}
                    className="flex-1 text-left"
                  >
                    <div className="text-sm text-white font-medium">{v.name}</div>
                    <div className="text-xs text-gray-500">{v.width}m × {v.depth}m</div>
                  </button>
                  <button
                    onClick={(e) => handleDeleteVenue(e, v.id)}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete venue"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* New Venue Form */}
        {showNewVenue ? (
          <div className="bg-card-bg border border-border-dark rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-white">New Venue (Manual)</h3>
            <input
              type="text"
              value={newVenueName}
              onChange={e => setNewVenueName(e.target.value)}
              placeholder="Venue name"
              className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="flex-1 py-2 bg-highlight text-white rounded hover:bg-highlight-hover transition-colors text-sm"
              >
                Create
              </button>
              <button
                onClick={() => setShowNewVenue(false)}
                className="flex-1 py-2 bg-border-dark text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : showDwgImport ? (
          <div className="bg-card-bg border border-border-dark rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              Create from DWG
            </h3>
            <p className="text-xs text-gray-400">
              Import fixtures from a DWG layout as the starting point for your venue.
            </p>
            
            {loadingDwgLayouts ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : dwgLayouts.length === 0 ? (
              <div className="text-xs text-gray-500 py-2">
                No DWG layouts available. Import a DWG file first in the DWG tab.
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Select DWG Layout</label>
                  <select
                    value={selectedDwgLayout}
                    onChange={e => setSelectedDwgLayout(e.target.value)}
                    className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
                  >
                    {dwgLayouts.map(layout => (
                      <option key={layout.id} value={layout.id}>
                        {layout.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Venue Name</label>
                  <input
                    type="text"
                    value={dwgVenueName}
                    onChange={e => setDwgVenueName(e.target.value)}
                    placeholder="Venue name"
                    className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
              </>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={handleCreateFromDwg}
                disabled={isLoading || dwgLayouts.length === 0 || !selectedDwgLayout}
                className="flex-1 py-2 bg-highlight text-white rounded hover:bg-highlight-hover transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create from DWG
              </button>
              <button
                onClick={() => setShowDwgImport(false)}
                className="flex-1 py-2 bg-border-dark text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => setShowNewVenue(true)}
              className="w-full py-3 bg-card-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Venue (Draw)
            </button>
            <button
              onClick={() => setShowDwgImport(true)}
              className="w-full py-3 bg-card-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2"
            >
              <FileUp className="w-4 h-4" />
              Create from DWG Import
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* New Venue Modal */}
      {showNewVenue && (
        <div className="bg-card-bg border border-border-dark rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">New Venue</h3>
          <input
            type="text"
            value={newVenueName}
            onChange={e => setNewVenueName(e.target.value)}
            placeholder="Venue name"
            className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="flex-1 py-2 bg-highlight text-white rounded hover:bg-highlight-hover transition-colors text-sm"
            >
              Create
            </button>
            <button
              onClick={() => setShowNewVenue(false)}
              className="flex-1 py-2 bg-border-dark text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Venue Info */}
      <div className="bg-card-bg border border-border-dark rounded-lg p-4">
        <label className="block text-xs text-gray-400 mb-1">Venue Name</label>
        <input
          type="text"
          value={venue.name}
          onChange={e => updateVenue({ name: e.target.value })}
          className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
        />
      </div>

      {/* Dimensions */}
      <div className="bg-card-bg border border-border-dark rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide">Dimensions</h3>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Width (m)</label>
            <input
              type="number"
              min="5"
              max="100"
              step="1"
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
              step="1"
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
              step="0.5"
              value={venue.height}
              onChange={e => updateVenue({ height: parseFloat(e.target.value) || 4 })}
              className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Tile Size (m)</label>
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
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={handleSave}
          disabled={isLoading}
          className="w-full py-2 bg-highlight text-white rounded-lg hover:bg-highlight-hover transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
        >
          {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Venue
        </button>
        
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex-1 py-2 bg-card-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={handleImport}
            className="flex-1 py-2 bg-card-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Upload className="w-4 h-4" />
            Import
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowNewVenue(true)}
            className="flex-1 py-2 bg-card-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            New Venue
          </button>
          <button
            onClick={() => setShowDwgImport(true)}
            className="flex-1 py-2 bg-card-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <FileUp className="w-4 h-4" />
            From DWG
          </button>
        </div>

        {/* DWG Import Modal */}
        {showDwgImport && (
          <div className="bg-card-bg border border-highlight rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              Create from DWG
            </h3>
            <p className="text-xs text-gray-400">
              Import fixtures from a DWG layout as the starting point for your venue.
            </p>
            
            {loadingDwgLayouts ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : dwgLayouts.length === 0 ? (
              <div className="text-xs text-gray-500 py-2">
                No DWG layouts available. Import a DWG file first in the DWG tab.
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Select DWG Layout</label>
                  <select
                    value={selectedDwgLayout}
                    onChange={e => setSelectedDwgLayout(e.target.value)}
                    className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
                  >
                    {dwgLayouts.map(layout => (
                      <option key={layout.id} value={layout.id}>
                        {layout.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Venue Name</label>
                  <input
                    type="text"
                    value={dwgVenueName}
                    onChange={e => setDwgVenueName(e.target.value)}
                    placeholder="Venue name"
                    className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
              </>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={handleCreateFromDwg}
                disabled={isLoading || dwgLayouts.length === 0 || !selectedDwgLayout}
                className="flex-1 py-2 bg-highlight text-white rounded hover:bg-highlight-hover transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create
              </button>
              <button
                onClick={() => setShowDwgImport(false)}
                className="flex-1 py-2 bg-border-dark text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Switch Venue */}
        {venueList.length > 1 && (
          <div className="pt-2 border-t border-border-dark">
            <label className="block text-xs text-gray-400 mb-1">
              <FolderOpen className="w-3 h-3 inline mr-1" />
              Switch Venue
            </label>
            <select
              value={venue.id}
              onChange={e => handleLoadVenue(e.target.value)}
              className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
            >
              {venueList.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}
