import { useState, useEffect, useRef } from 'react'
import { Package, Square, ShoppingCart, DoorOpen, Circle, Shapes, Upload, FolderUp, X, ChevronDown, Plus } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { ObjectType, Vector3 } from '../../types'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface ObjectPreset {
  type: ObjectType
  name: string
  icon: typeof Package
  description: string
}

interface CustomModel {
  object_type: string
  file_path: string
  original_name: string
  uploaded_at: string
}

interface ObjectDimensions {
  width: number
  height: number
  depth: number
}

const OBJECT_PRESETS: ObjectPreset[] = [
  { type: 'shelf', name: 'Shelf', icon: Package, description: 'Standard retail shelf unit' },
  { type: 'wall', name: 'Wall', icon: Square, description: 'Wall or partition' },
  { type: 'checkout', name: 'Checkout', icon: ShoppingCart, description: 'Checkout counter' },
  { type: 'entrance', name: 'Entrance', icon: DoorOpen, description: 'Door or entrance' },
  { type: 'pillar', name: 'Pillar', icon: Circle, description: 'Structural column' },
  { type: 'custom', name: 'Custom', icon: Shapes, description: 'Custom object' },
]

const DEFAULT_DIMENSIONS: Record<ObjectType, ObjectDimensions> = {
  shelf: { width: 2, height: 2, depth: 0.6 },
  wall: { width: 4, height: 3, depth: 0.2 },
  checkout: { width: 1.5, height: 1, depth: 0.8 },
  entrance: { width: 2, height: 2.5, depth: 0.1 },
  pillar: { width: 0.4, height: 3, depth: 0.4 },
  custom: { width: 1, height: 1, depth: 1 },
}

export default function ObjectLibrary() {
  const { venue, objects, addObject, removeObject, selectObject, selectedObjectId } = useVenue()
  const [customModels, setCustomModels] = useState<Map<string, CustomModel>>(new Map())
  const [uploading, setUploading] = useState<string | null>(null)
  const [expandedType, setExpandedType] = useState<ObjectType | null>(null)
  const [dimensions, setDimensions] = useState<Record<ObjectType, ObjectDimensions>>(() => ({ ...DEFAULT_DIMENSIONS }))
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const folderInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // Fetch custom models on mount
  useEffect(() => {
    fetchCustomModels()
  }, [])

  const fetchCustomModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models`)
      if (res.ok) {
        const models: CustomModel[] = await res.json()
        const modelMap = new Map<string, CustomModel>()
        models.forEach(m => modelMap.set(m.object_type, m))
        setCustomModels(modelMap)
      }
    } catch (err) {
      console.error('Failed to fetch custom models:', err)
    }
  }

  const handleUpload = async (type: ObjectType, file: File) => {
    setUploading(type)
    try {
      const formData = new FormData()
      formData.append('model', file)
      
      const res = await fetch(`${API_BASE}/api/models/${type}/upload`, {
        method: 'POST',
        body: formData,
      })
      
      if (res.ok) {
        await fetchCustomModels()
        window.dispatchEvent(new CustomEvent('customModelsUpdated'))
      } else {
        const err = await res.json()
        alert(`Upload failed: ${err.error}`)
      }
    } catch (err) {
      console.error('Upload error:', err)
      alert('Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const handleFolderUpload = async (type: ObjectType, files: FileList) => {
    setUploading(type)
    try {
      const formData = new FormData()
      
      // Add all files from the folder
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        // Use webkitRelativePath to preserve folder structure
        const relativePath = (file as any).webkitRelativePath || file.name
        formData.append('files', file, relativePath)
      }
      
      const res = await fetch(`${API_BASE}/api/models/${type}/upload-folder`, {
        method: 'POST',
        body: formData,
      })
      
      if (res.ok) {
        await fetchCustomModels()
        window.dispatchEvent(new CustomEvent('customModelsUpdated'))
      } else {
        const err = await res.json()
        alert(`Upload failed: ${err.error}`)
      }
    } catch (err) {
      console.error('Upload error:', err)
      alert('Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const handleDeleteModel = async (type: ObjectType) => {
    if (!confirm(`Remove custom model for ${type}?`)) return
    
    try {
      const res = await fetch(`${API_BASE}/api/models/${type}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchCustomModels()
        window.dispatchEvent(new CustomEvent('customModelsUpdated'))
      }
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  const triggerFileInput = (type: ObjectType) => {
    const input = fileInputRefs.current.get(type)
    if (input) input.click()
  }

  const triggerFolderInput = (type: ObjectType) => {
    const input = folderInputRefs.current.get(type)
    if (input) input.click()
  }

  const handleAddObject = (type: ObjectType) => {
    if (!venue) return
    const position: Vector3 = {
      x: venue.width / 2,
      y: 0,
      z: venue.depth / 2,
    }
    const dim = dimensions[type]
    const scale: Vector3 = { x: dim.width, y: dim.height, z: dim.depth }
    addObject(type, position, scale)
    setExpandedType(null)
  }

  const updateDimension = (type: ObjectType, field: keyof ObjectDimensions, value: number) => {
    setDimensions(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value }
    }))
  }

  const resetDimensions = (type: ObjectType) => {
    setDimensions(prev => ({
      ...prev,
      [type]: { ...DEFAULT_DIMENSIONS[type] }
    }))
  }

  return (
    <div className="p-4 space-y-4">
      {/* Add Objects Section */}
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Add Object</h3>
        <div className="space-y-2">
          {OBJECT_PRESETS.map(preset => {
            const hasCustomModel = customModels.has(preset.type)
            const isExpanded = expandedType === preset.type
            const dim = dimensions[preset.type]
            return (
              <div
                key={preset.type}
                className={`bg-card-bg border rounded-lg transition-colors ${
                  hasCustomModel ? 'border-green-500/50' : 'border-border-dark'
                } ${isExpanded ? 'border-highlight' : ''}`}
              >
                {/* Header - click to expand */}
                <button
                  onClick={() => setExpandedType(isExpanded ? null : preset.type)}
                  disabled={!venue}
                  className="w-full p-3 flex items-center justify-between text-left disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="flex items-center gap-2">
                    <preset.icon className={`w-4 h-4 transition-colors ${isExpanded ? 'text-highlight' : 'text-gray-400 group-hover:text-highlight'}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{preset.name}</span>
                        {hasCustomModel && <span className="text-[8px] text-green-400 bg-green-500/20 px-1 rounded">OBJ</span>}
                      </div>
                      <p className="text-[10px] text-gray-500">{dim.width}×{dim.depth}×{dim.height}m</p>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                
                {/* Expanded panel with dimension controls */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-border-dark pt-3">
                    {/* Width */}
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                        <span>Width</span>
                        <span>{dim.width.toFixed(1)}m</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={dim.width}
                        onChange={(e) => updateDimension(preset.type, 'width', parseFloat(e.target.value))}
                        className="w-full accent-highlight h-1"
                      />
                    </div>
                    {/* Depth */}
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                        <span>Depth</span>
                        <span>{dim.depth.toFixed(1)}m</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="10"
                        step="0.1"
                        value={dim.depth}
                        onChange={(e) => updateDimension(preset.type, 'depth', parseFloat(e.target.value))}
                        className="w-full accent-highlight h-1"
                      />
                    </div>
                    {/* Height */}
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                        <span>Height</span>
                        <span>{dim.height.toFixed(1)}m</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="5"
                        step="0.1"
                        value={dim.height}
                        onChange={(e) => updateDimension(preset.type, 'height', parseFloat(e.target.value))}
                        className="w-full accent-highlight h-1"
                      />
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => resetDimensions(preset.type)}
                        className="flex-1 py-1.5 text-xs text-gray-400 hover:text-white border border-border-dark rounded hover:border-gray-600 transition-colors"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => handleAddObject(preset.type)}
                        className="flex-1 py-1.5 text-xs bg-highlight text-white rounded hover:bg-highlight/80 transition-colors flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Custom Models Section */}
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Custom 3D Models</h3>
        <div className="space-y-2">
          {OBJECT_PRESETS.map(preset => {
            const model = customModels.get(preset.type)
            const isUploading = uploading === preset.type
            return (
              <div key={preset.type} className="flex items-center justify-between p-2 bg-card-bg border border-border-dark rounded-lg">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <preset.icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm text-white">{preset.name}</div>
                    {model && (
                      <div className="text-[10px] text-green-400 truncate">{model.original_name}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {model && (
                    <button
                      onClick={() => handleDeleteModel(preset.type)}
                      className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                      title="Remove custom model"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={() => triggerFileInput(preset.type)}
                    disabled={isUploading}
                    className={`p-1.5 rounded transition-colors ${
                      isUploading ? 'text-gray-600' : 'text-gray-400 hover:text-highlight hover:bg-highlight/10'
                    }`}
                    title="Upload single file (.obj, .glb)"
                  >
                    <Upload className={`w-3 h-3 ${isUploading ? 'animate-pulse' : ''}`} />
                  </button>
                  <button
                    onClick={() => triggerFolderInput(preset.type)}
                    disabled={isUploading}
                    className={`p-1.5 rounded transition-colors ${
                      isUploading ? 'text-gray-600' : 'text-gray-400 hover:text-highlight hover:bg-highlight/10'
                    }`}
                    title="Upload GLTF folder (with textures)"
                  >
                    <FolderUp className={`w-3 h-3 ${isUploading ? 'animate-pulse' : ''}`} />
                  </button>
                  <input
                    type="file"
                    accept=".obj,.glb"
                    className="hidden"
                    ref={(el) => { if (el) fileInputRefs.current.set(preset.type, el) }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        handleUpload(preset.type, file)
                        e.target.value = ''
                      }
                    }}
                  />
                  <input
                    type="file"
                    className="hidden"
                    ref={(el) => { 
                      if (el) {
                        folderInputRefs.current.set(preset.type, el)
                        el.setAttribute('webkitdirectory', '')
                        el.setAttribute('directory', '')
                      }
                    }}
                    onChange={(e) => {
                      const files = e.target.files
                      if (files && files.length > 0) {
                        handleFolderUpload(preset.type, files)
                        e.target.value = ''
                      }
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Objects List */}
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          Scene Objects ({objects.length})
        </h3>
        
        {objects.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No objects in scene.<br />
            Click an object type above to add.
          </div>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {objects.map(obj => {
              const preset = OBJECT_PRESETS.find(p => p.type === obj.type)
              const Icon = preset?.icon || Shapes
              
              return (
                <div
                  key={obj.id}
                  onClick={() => selectObject(obj.id)}
                  className={`p-2 rounded-lg cursor-pointer flex items-center justify-between group transition-colors ${
                    selectedObjectId === obj.id
                      ? 'bg-highlight/20 border border-highlight'
                      : 'bg-card-bg border border-border-dark hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${
                      selectedObjectId === obj.id ? 'text-highlight' : 'text-gray-400'
                    }`} />
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{obj.name}</div>
                      <div className="text-[10px] text-gray-500">
                        ({obj.position.x.toFixed(1)}, {obj.position.z.toFixed(1)})
                      </div>
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeObject(obj.id)
                    }}
                    className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
        <h4 className="text-xs font-medium text-blue-400 mb-1">Tips</h4>
        <ul className="text-[10px] text-gray-400 space-y-1">
          <li>• Click object in 3D to select</li>
          <li>• Use right panel to edit properties</li>
          <li>• Objects snap to grid tiles</li>
        </ul>
      </div>
    </div>
  )
}
