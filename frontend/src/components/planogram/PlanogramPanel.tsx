import { useMemo, useEffect, useRef } from 'react'
import { BarChart3, ExternalLink, Package, Layers, Clock } from 'lucide-react'
import { usePlanogram } from '../../context/PlanogramContext'
import { useVenue } from '../../context/VenueContext'
import { useViewMode } from '../../App'

export default function PlanogramPanel() {
  const { planograms, activePlanogram, loading, loadPlanograms, loadPlanogram } = usePlanogram()
  const { venue, objects } = useVenue()
  const { mode, setMode } = useViewMode()
  
  // Track previous mode to detect return from planogram editor
  const prevModeRef = useRef(mode)
  
  // Reload planogram data when returning from full-screen editor
  useEffect(() => {
    if (prevModeRef.current === 'planogram' && mode === 'main') {
      // Returned from planogram editor - refresh data
      loadPlanograms().then(() => {
        if (activePlanogram?.id) {
          loadPlanogram(activePlanogram.id)
        }
      })
    }
    prevModeRef.current = mode
  }, [mode, loadPlanograms, loadPlanogram, activePlanogram?.id])
  
  // Get shelves from venue objects
  const shelves = useMemo(() => {
    return objects.filter(obj => obj.type === 'shelf')
  }, [objects])
  
  // Count SKUs in active planogram
  const skuCount = useMemo(() => {
    if (!activePlanogram) return 0
    let count = 0
    activePlanogram.shelves.forEach(shelf => {
      shelf.slots.levels.forEach(level => {
        level.slots.forEach(slot => {
          if (slot.skuItemId) count++
        })
      })
    })
    return count
  }, [activePlanogram])
  
  // Get last updated time
  const lastUpdated = useMemo(() => {
    if (!activePlanogram) return null
    const date = new Date(activePlanogram.updatedAt)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)
    
    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    return 'Just now'
  }, [activePlanogram])

  const handleOpenFullEditor = () => {
    setMode('planogram')
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-gray-300">
        <BarChart3 className="w-5 h-5 text-highlight" />
        <h2 className="text-sm font-medium">Planogram Overview</h2>
      </div>
      
      {/* No venue warning */}
      {!venue && (
        <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 text-center">
          <p className="text-xs text-gray-400">Select a venue to manage planograms</p>
        </div>
      )}
      
      {/* Active Planogram Card */}
      {venue && activePlanogram && (
        <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">{activePlanogram.name}</h3>
              <p className="text-xs text-gray-500">v{activePlanogram.version}</p>
            </div>
            <span className={`px-2 py-0.5 text-[10px] font-medium rounded ${
              activePlanogram.status === 'active' 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              {activePlanogram.status}
            </span>
          </div>
          
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-gray-900/50 rounded">
              <Package className="w-3 h-3 mx-auto mb-1 text-gray-500" />
              <p className="text-sm font-medium text-white">{skuCount}</p>
              <p className="text-[10px] text-gray-500">SKUs</p>
            </div>
            <div className="p-2 bg-gray-900/50 rounded">
              <Layers className="w-3 h-3 mx-auto mb-1 text-gray-500" />
              <p className="text-sm font-medium text-white">{activePlanogram.shelves.length}</p>
              <p className="text-[10px] text-gray-500">Shelves</p>
            </div>
            <div className="p-2 bg-gray-900/50 rounded">
              <Clock className="w-3 h-3 mx-auto mb-1 text-gray-500" />
              <p className="text-sm font-medium text-white">{lastUpdated}</p>
              <p className="text-[10px] text-gray-500">Updated</p>
            </div>
          </div>
          
          {/* Mini preview placeholder */}
          <div className="h-16 bg-gray-900/50 rounded border border-gray-700 flex items-center justify-center">
            <div className="flex gap-1">
              {activePlanogram.shelves.slice(0, 5).map((shelf, i) => (
                <div 
                  key={shelf.shelfId} 
                  className="w-8 h-10 bg-gray-700 rounded-sm flex flex-col justify-end p-0.5 gap-0.5"
                >
                  {Array.from({ length: Math.min(shelf.numLevels, 4) }).map((_, j) => (
                    <div key={j} className="h-1.5 bg-highlight/30 rounded-sm" />
                  ))}
                </div>
              ))}
              {activePlanogram.shelves.length > 5 && (
                <div className="w-8 h-10 bg-gray-700/50 rounded-sm flex items-center justify-center text-[10px] text-gray-500">
                  +{activePlanogram.shelves.length - 5}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* No planogram state */}
      {venue && !activePlanogram && !loading && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 text-center space-y-2">
          <BarChart3 className="w-8 h-8 mx-auto text-gray-600" />
          <p className="text-xs text-gray-400">No planogram configured</p>
          <p className="text-[10px] text-gray-500">
            {shelves.length > 0 
              ? `${shelves.length} shelf${shelves.length !== 1 ? 'ves' : ''} available`
              : 'Add shelves to create a planogram'
            }
          </p>
        </div>
      )}
      
      {/* Loading state */}
      {loading && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 text-center">
          <div className="w-5 h-5 border-2 border-highlight border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-gray-400 mt-2">Loading...</p>
        </div>
      )}
      
      {/* Open Full Editor Button */}
      {venue && (
        <button
          onClick={handleOpenFullEditor}
          className="w-full py-3 px-4 bg-highlight hover:bg-highlight/90 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Open Full Editor
        </button>
      )}
      
      {/* All Planograms List */}
      {venue && planograms.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">All Planograms</h3>
          <div className="space-y-1">
            {planograms.map(p => (
              <div 
                key={p.id}
                className={`p-2 rounded-lg border text-xs flex items-center justify-between ${
                  p.id === activePlanogram?.id
                    ? 'bg-highlight/10 border-highlight/30 text-highlight'
                    : 'bg-gray-800/30 border-gray-700 text-gray-400 hover:bg-gray-800/50'
                }`}
              >
                <span>{p.name}</span>
                {p.id === activePlanogram?.id && (
                  <span className="text-[10px] bg-highlight/20 px-1.5 py-0.5 rounded">Active</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Help text */}
      <p className="text-[10px] text-gray-600 text-center">
        Use the full editor to assign SKUs to shelf slots
      </p>
    </div>
  )
}
