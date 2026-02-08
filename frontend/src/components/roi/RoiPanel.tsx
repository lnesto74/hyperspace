import { useState } from 'react'
import { Plus, Trash2, Edit2, X, Check, MousePointer2, Eye, EyeOff } from 'lucide-react'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'

export default function RoiPanel() {
  const { venue } = useVenue()
  const { 
    regions, 
    selectedRoiId, 
    isDrawing, 
    drawingVertices,
    selectRegion, 
    deleteRegion, 
    updateRegion,
    startDrawing, 
    cancelDrawing,
    finishDrawing,
    removeLastVertex,
    toggleRoiVisibility,
    isRoiVisible,
  } = useRoi()
  
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [newRoiName, setNewRoiName] = useState('Zone')

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id)
    setEditName(name)
  }

  const handleSaveEdit = async (id: string) => {
    if (editName.trim()) {
      await updateRegion(id, { name: editName.trim() })
    }
    setEditingId(null)
  }

  const handleFinishDrawing = async () => {
    if (!venue) return
    const name = newRoiName.trim() || `Zone ${regions.length + 1}`
    await finishDrawing(venue.id, name)
    setNewRoiName('Zone')
  }

  return (
    <div className="p-4 space-y-4">
      {/* Drawing Mode */}
      {isDrawing ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-400">
            <MousePointer2 className="w-4 h-4 animate-pulse" />
            <span className="text-sm font-medium">Drawing Mode</span>
          </div>
          
          <p className="text-xs text-gray-400">
            Click on the floor plan to add vertices. Need at least 3 points.
          </p>
          
          <div className="text-xs text-gray-500">
            Vertices: {drawingVertices.length}
          </div>
          
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Region Name</label>
            <input
              type="text"
              value={newRoiName}
              onChange={(e) => setNewRoiName(e.target.value)}
              placeholder="Enter zone name"
              className="w-full px-2 py-1.5 text-sm bg-card-bg border border-border-dark rounded text-white focus:border-highlight focus:outline-none"
            />
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={removeLastVertex}
              disabled={drawingVertices.length === 0}
              className="flex-1 py-1.5 text-xs border border-border-dark rounded hover:border-gray-600 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Undo
            </button>
            <button
              onClick={cancelDrawing}
              className="flex-1 py-1.5 text-xs border border-red-500/50 rounded text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleFinishDrawing}
              disabled={drawingVertices.length < 3}
              className="flex-1 py-1.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Finish
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={startDrawing}
          disabled={!venue}
          className="w-full py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Draw New Region
        </button>
      )}

      {/* Regions List */}
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          Regions ({regions.length})
        </h3>
        
        {regions.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No regions defined.<br />
            Click "Draw New Region" to create one.
          </div>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {regions.map(roi => (
              <div
                key={roi.id}
                onClick={() => !editingId && selectRegion(roi.id)}
                className={`p-2 rounded-lg cursor-pointer flex items-center justify-between group transition-colors ${
                  selectedRoiId === roi.id
                    ? 'bg-amber-500/20 border border-amber-500'
                    : 'bg-card-bg border border-border-dark hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div 
                    className="w-4 h-4 rounded flex-shrink-0"
                    style={{ backgroundColor: roi.color, opacity: roi.opacity }}
                  />
                  {editingId === roi.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(roi.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="flex-1 px-1 py-0.5 text-sm bg-transparent border-b border-highlight text-white focus:outline-none"
                    />
                  ) : (
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{roi.name}</div>
                      <div className="text-[10px] text-gray-500">
                        {roi.vertices.length} vertices
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-1">
                  {editingId === roi.id ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSaveEdit(roi.id)
                        }}
                        className="p-1 text-green-400 hover:bg-green-500/10 rounded transition-colors"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingId(null)
                        }}
                        className="p-1 text-gray-400 hover:bg-gray-500/10 rounded transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleRoiVisibility(roi.id)
                        }}
                        className={`p-1 transition-all ${isRoiVisible(roi.id) ? 'text-gray-500 hover:text-yellow-400' : 'text-yellow-500'}`}
                        title={isRoiVisible(roi.id) ? 'Hide zone' : 'Show zone'}
                      >
                        {isRoiVisible(roi.id) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStartEdit(roi.id, roi.name)
                        }}
                        className="p-1 text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteRegion(roi.id)
                        }}
                        className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
        <h4 className="text-xs font-medium text-blue-400 mb-1">Tips</h4>
        <ul className="text-[10px] text-gray-400 space-y-1">
          <li>• Click floor to place vertices</li>
          <li>• Drag vertex handles to reshape</li>
          <li>• Press Escape to cancel drawing</li>
        </ul>
      </div>
    </div>
  )
}
