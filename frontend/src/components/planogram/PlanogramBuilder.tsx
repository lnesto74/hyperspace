import { useState, useEffect } from 'react'
import { Plus, Copy, Trash2, FileDown, LayoutGrid, ArrowLeft, X } from 'lucide-react'
import { usePlanogram } from '../../context/PlanogramContext'
import { useVenue } from '../../context/VenueContext'
import { useViewMode } from '../../App'
import SkuLibraryPanel from './SkuLibraryPanel'
import ShelfInspectorPanel from './ShelfInspectorPanel'
import PlanogramViewport from './PlanogramViewport'

export default function PlanogramBuilder() {
  const { venue } = useVenue()
  const { setMode } = useViewMode()
  const {
    planograms,
    activePlanogram,
    loadPlanogram,
    createPlanogram,
    deletePlanogram,
    duplicatePlanogram,
  } = usePlanogram()
  
  const [showPlanogramList, setShowPlanogramList] = useState(!activePlanogram)
  const [newPlanogramName, setNewPlanogramName] = useState('')
  
  // Show list if no active planogram
  useEffect(() => {
    if (!activePlanogram) {
      setShowPlanogramList(true)
    }
  }, [activePlanogram])
  
  const handleCreatePlanogram = async () => {
    if (!newPlanogramName.trim()) return
    const planogram = await createPlanogram(newPlanogramName.trim())
    await loadPlanogram(planogram.id)
    setNewPlanogramName('')
    setShowPlanogramList(false)
  }
  
  const handleSelectPlanogram = async (id: string) => {
    await loadPlanogram(id)
    setShowPlanogramList(false)
  }
  
  const handleExportPlanogram = async (id: string) => {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${API_BASE}/api/planogram/planograms/${id}/export`)
    const data = await res.json()
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `planogram-${data.planogram.name}-v${data.planogram.version}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  if (!venue) {
    return (
      <div className="h-screen flex items-center justify-center bg-app-bg text-gray-500">
        <div className="text-center">
          <LayoutGrid className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Please select a venue first</p>
        </div>
      </div>
    )
  }
  
  // Planogram selection screen
  if (showPlanogramList) {
    return (
      <div className="h-screen flex flex-col bg-app-bg">
        <div className="p-4 border-b border-border-dark flex items-center gap-4">
          <LayoutGrid className="w-6 h-6 text-amber-500" />
          <h1 className="text-lg font-semibold text-white">Planogram Builder</h1>
          <span className="text-sm text-gray-500">{venue.name}</span>
          <div className="flex-1" />
          <button
            onClick={() => setMode('main')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Close Planogram Builder"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl mx-auto">
            {/* Create new */}
            <div className="bg-panel-bg border border-border-dark rounded-lg p-4 mb-6">
              <h2 className="text-sm font-medium text-white mb-3">Create New Planogram</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPlanogramName}
                  onChange={(e) => setNewPlanogramName(e.target.value)}
                  placeholder="Planogram name..."
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreatePlanogram()}
                />
                <button
                  onClick={handleCreatePlanogram}
                  disabled={!newPlanogramName.trim()}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create
                </button>
              </div>
            </div>
            
            {/* Existing planograms */}
            <h2 className="text-sm font-medium text-gray-400 mb-3">
              Existing Planograms ({planograms.length})
            </h2>
            
            {planograms.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No planograms yet. Create one to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {planograms.map(p => (
                  <div
                    key={p.id}
                    className="bg-panel-bg border border-border-dark rounded-lg p-4 hover:border-amber-600/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div 
                        className="flex-1 cursor-pointer"
                        onClick={() => handleSelectPlanogram(p.id)}
                      >
                        <div className="text-white font-medium">{p.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Version {p.version} • {p.status} • {new Date(p.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleExportPlanogram(p.id)}
                          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                          title="Export JSON"
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => duplicatePlanogram(p.id)}
                          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                          title="Duplicate"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deletePlanogram(p.id)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }
  
  // Main 3-panel layout
  return (
    <div className="h-screen flex flex-col bg-app-bg">
      {/* Header */}
      <div className="h-12 px-4 border-b border-border-dark flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => setShowPlanogramList(true)}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
          title="Back to planogram list"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <LayoutGrid className="w-5 h-5 text-amber-500" />
        <div className="flex-1">
          <span className="text-sm font-medium text-white">{activePlanogram?.name}</span>
          <span className="text-xs text-gray-500 ml-2">v{activePlanogram?.version}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-[10px] ${
            activePlanogram?.status === 'active' 
              ? 'bg-green-600/20 text-green-400' 
              : 'bg-gray-600/20 text-gray-400'
          }`}>
            {activePlanogram?.status}
          </span>
          <button
            onClick={() => activePlanogram && handleExportPlanogram(activePlanogram.id)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Export"
          >
            <FileDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMode('main')}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Close Planogram Builder"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: SKU Library */}
        <SkuLibraryPanel />
        
        {/* Center: 3D Viewport */}
        <div className="flex-1 min-w-0 relative">
          <PlanogramViewport />
        </div>
        
        {/* Right: Shelf Inspector */}
        <ShelfInspectorPanel />
      </div>
    </div>
  )
}
