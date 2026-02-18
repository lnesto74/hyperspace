import { useState, useEffect } from 'react'
import { Map as MapIcon, RefreshCw, Check, AlertCircle, Loader2 } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'

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
}

export default function VenueDwgPanel() {
  const { loadVenue } = useVenue()
  const [imports, setImports] = useState<DwgImport[]>([])
  const [layouts, setLayouts] = useState<Map<string, LayoutVersion>>(new Map())
  const [layoutVenueIds, setLayoutVenueIds] = useState<Map<string, string>>(new Map())
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(() => {
    return localStorage.getItem('venueDwg-selectedLayout') || null
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch available DWG imports
  useEffect(() => {
    const fetchImports = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/dwg/imports`)
        if (!res.ok) throw new Error('Failed to fetch imports')
        const data = await res.json()
        setImports(data)
        
        // Fetch layout versions for each import
        const layoutMap = new Map<string, LayoutVersion>()
        const venueIdMap = new Map<string, string>()
        for (const imp of data) {
          try {
            const layoutRes = await fetch(`${API_BASE}/api/dwg/import/${imp.import_id}/layouts`)
            if (layoutRes.ok) {
              const layoutData = await layoutRes.json()
              if (layoutData.length > 0) {
                // Get the most recent layout
                const layout = layoutData[layoutData.length - 1]
                layoutMap.set(imp.import_id, layout)
                // Store venue_id for this layout
                if (layout.venue_id) {
                  venueIdMap.set(layout.id, layout.venue_id)
                }
              }
            }
          } catch {
            // Ignore individual layout fetch errors
          }
        }
        setLayouts(layoutMap)
        setLayoutVenueIds(venueIdMap)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }
    fetchImports()
  }, [])

  // Persist selected layout to localStorage
  useEffect(() => {
    if (selectedLayoutId) {
      localStorage.setItem('venueDwg-selectedLayout', selectedLayoutId)
    } else {
      localStorage.removeItem('venueDwg-selectedLayout')
    }
  }, [selectedLayoutId])

  // On initial load, if there's a stored layout, load its venue
  useEffect(() => {
    if (selectedLayoutId && layoutVenueIds.size > 0) {
      const venueId = layoutVenueIds.get(selectedLayoutId)
      if (venueId) {
        console.log(`[VenueDwgPanel] Auto-loading venue ${venueId} for stored layout ${selectedLayoutId}`)
        loadVenue(venueId)
      }
    }
  }, [selectedLayoutId, layoutVenueIds, loadVenue])

  const handleSelectLayout = async (layoutId: string) => {
    setSelectedLayoutId(layoutId)
    
    // Load the associated venue for this layout
    const venueId = layoutVenueIds.get(layoutId)
    if (venueId) {
      console.log(`[VenueDwgPanel] Loading venue ${venueId} for layout ${layoutId}`)
      await loadVenue(venueId)
    }
    
    // Dispatch custom event so MainViewport can listen
    window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId } }))
  }

  const handleRefresh = () => {
    window.location.reload()
  }

  if (isLoading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <MapIcon className="w-4 h-4" />
          DWG Venue
        </h2>
        <button
          onClick={handleRefresh}
          className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-400">
        Select a DWG import to use as the base for your venue. The 3D scene will load fixtures from the selected floorplan.
      </p>

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Imports List */}
      {imports.length === 0 ? (
        <div className="text-center py-8">
          <MapIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No DWG imports found</p>
          <p className="text-xs text-gray-600 mt-1">
            Import a DWG/DXF floorplan first
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {imports.map(imp => {
            const layout = layouts.get(imp.import_id)
            const isSelected = layout && selectedLayoutId === layout.id
            const hasLayout = !!layout
            
            return (
              <button
                key={imp.import_id}
                onClick={() => hasLayout && handleSelectLayout(layout.id)}
                disabled={!hasLayout}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-highlight/10 border-highlight text-white'
                    : hasLayout
                    ? 'bg-gray-800/50 border-gray-700 hover:border-gray-600 text-gray-300'
                    : 'bg-gray-800/30 border-gray-700/50 text-gray-500 cursor-not-allowed'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isSelected && <Check className="w-4 h-4 text-highlight flex-shrink-0" />}
                      <span className="text-sm font-medium truncate">{imp.filename}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(imp.created_at).toLocaleDateString()}
                      {layout && (
                        <span className="ml-2 text-green-400">• 3D Ready</span>
                      )}
                    </div>
                  </div>
                  {!hasLayout && (
                    <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      No 3D
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Selected Layout Info */}
      {selectedLayoutId && (
        <div className="mt-4 p-3 bg-highlight/5 border border-highlight/20 rounded-lg">
          <div className="flex items-center gap-2 text-highlight text-xs font-medium">
            <Check className="w-4 h-4" />
            Active DWG Layout
          </div>
          <p className="text-xs text-gray-400 mt-1">
            The 3D venue will use fixtures from this DWG import. You can still add, edit, or remove objects.
          </p>
        </div>
      )}

      {/* Help Text */}
      <div className="text-xs text-gray-500 pt-2 border-t border-gray-800">
        <p className="mb-1"><strong>How it works:</strong></p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Select a DWG import above</li>
          <li>3D scene loads with real dimensions</li>
          <li>Edit objects like in manual mode</li>
          <li>LiDARs from planner auto-appear</li>
        </ul>
      </div>
    </div>
  )
}
