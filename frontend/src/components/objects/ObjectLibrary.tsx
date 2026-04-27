import { useState, useEffect, useRef } from 'react'
import { Package, Square, ShoppingCart, DoorOpen, Circle, Shapes, Upload, FolderUp, X, ChevronDown, Plus, Monitor, Radio, Filter, Trash2, Eye, EyeOff } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { ObjectType, Vector3 } from '../../types'
import { API_BASE } from '../../config/api'

// Semantic highlight colors for each object type (digital twin aesthetic)
export const CLUSTER_HIGHLIGHT_COLORS: Record<string, number> = {
  shelf: 0x00D4FF,          // Electric Blue
  fridge: 0x22D3EE,         // Cyan
  checkout: 0x00FF88,       // Neon Green
  wall: 0x5EEAD4,           // Slate Cyan
  entrance: 0xFBBF24,       // Amber
  pillar: 0xA78BFA,         // Purple
  digital_display: 0xF472B6, // Magenta
  radio: 0x38BDF8,          // Sky Blue
  custom: 0x94A3B8,         // Slate
}


interface ObjectPreset {
  type: ObjectType
  name: string
  icon: typeof Package
  description: string
  color: string
  hasCustomModel?: boolean
  isUserAsset?: boolean
}

interface CatalogAsset {
  id: string
  name: string
  type: string
  color?: string
  hasCustomModel?: boolean
  isUserAsset?: boolean
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
  { type: 'shelf', name: 'Shelf', icon: Package, description: 'Standard retail shelf unit', color: '#6366f1' },
  { type: 'fridge', name: 'Fridge', icon: Package, description: 'Refrigerated display or cooler', color: '#22d3ee' },
  { type: 'wall', name: 'Wall', icon: Square, description: 'Wall or partition', color: '#64748b' },
  { type: 'checkout', name: 'Checkout', icon: ShoppingCart, description: 'Checkout counter', color: '#22c55e' },
  { type: 'entrance', name: 'Entrance', icon: DoorOpen, description: 'Door or entrance', color: '#f59e0b' },
  { type: 'pillar', name: 'Pillar', icon: Circle, description: 'Structural column', color: '#78716c' },
  { type: 'digital_display', name: 'Digital Display', icon: Monitor, description: 'Digital signage or screen', color: '#3b82f6' },
  { type: 'radio', name: 'Radio', icon: Radio, description: 'Radio or audio device', color: '#ef4444' },
  { type: 'custom', name: 'Custom', icon: Shapes, description: 'Custom object', color: '#8b5cf6' },
]

const DEFAULT_DIMENSIONS: Record<string, ObjectDimensions> = {
  shelf: { width: 2, height: 2, depth: 0.6 },
  fridge: { width: 2, height: 2, depth: 0.8 },
  wall: { width: 4, height: 3, depth: 0.2 },
  checkout: { width: 1.5, height: 1, depth: 0.8 },
  entrance: { width: 2, height: 2.5, depth: 0.1 },
  pillar: { width: 0.4, height: 3, depth: 0.4 },
  digital_display: { width: 1.5, height: 2, depth: 0.1 },
  radio: { width: 0.3, height: 0.3, depth: 0.2 },
  custom: { width: 1, height: 1, depth: 1 },
}

const PRESET_BY_TYPE = new Map(OBJECT_PRESETS.map(preset => [preset.type, preset]))

const getDefaultDimensions = (type: string): ObjectDimensions =>
  DEFAULT_DIMENSIONS[type] || DEFAULT_DIMENSIONS.custom

const getNameForType = (type: string) =>
  PRESET_BY_TYPE.get(type)?.name || type.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function ObjectLibrary() {
  const { venue, objects, addObject, updateObject, removeObject, selectObject, selectedObjectId, hoveredObjectId, hoverObject } = useVenue()
  const listContainerRef = useRef<HTMLDivElement>(null)
  const cardRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())
  const [catalogAssets, setCatalogAssets] = useState<CatalogAsset[]>([])
  const [customModels, setCustomModels] = useState<Map<string, CustomModel>>(new Map())
  const [uploading, setUploading] = useState<string | null>(null)
  const [expandedType, setExpandedType] = useState<ObjectType | null>(null)
  const [dimensions, setDimensions] = useState<Record<string, ObjectDimensions>>(() => ({ ...DEFAULT_DIMENSIONS }))
  const [typeFilter, setTypeFilter] = useState<ObjectType | 'all'>('all')
  const [highlightedTypes, setHighlightedTypes] = useState<Set<ObjectType>>(new Set())
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const folderInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // Dispatch event when highlighted types change
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('cluster-highlight-change', {
      detail: { highlightedTypes: Array.from(highlightedTypes) }
    }))
  }, [highlightedTypes])

  const toggleTypeHighlight = (type: ObjectType) => {
    setHighlightedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  // Track whether hover originated from sidebar (to avoid auto-scroll when user hovers sidebar cards)
  const hoverFromSidebarRef = useRef(false)

  // Compute type counts and filtered objects
  const typeCounts = objects.reduce((acc, obj) => {
    acc[obj.type] = (acc[obj.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const filteredObjects = typeFilter === 'all' ? objects : objects.filter(o => o.type === typeFilter)
  const availableTypes = Object.keys(typeCounts).sort() as ObjectType[]

  const objectPresets: ObjectPreset[] = (() => {
    const merged = new Map<string, ObjectPreset>()
    OBJECT_PRESETS.forEach(preset => merged.set(preset.type, preset))
    catalogAssets.forEach(asset => {
      const builtIn = merged.get(asset.type)
      merged.set(asset.type, {
        type: asset.type as ObjectType,
        name: asset.name || builtIn?.name || getNameForType(asset.type),
        icon: builtIn?.icon || Shapes,
        description: builtIn?.description || (asset.hasCustomModel ? 'DWG catalog asset with uploaded model' : 'DWG catalog asset using fallback geometry'),
        color: asset.color || builtIn?.color || '#8b5cf6',
        hasCustomModel: asset.hasCustomModel,
        isUserAsset: asset.isUserAsset,
      })
    })
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
  })()

  // Auto-scroll to hovered card when hover comes from 3D viewport
  useEffect(() => {
    if (!hoveredObjectId || hoverFromSidebarRef.current) return
    const card = cardRefsMap.current.get(hoveredObjectId)
    if (card && listContainerRef.current) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [hoveredObjectId])

  // Fetch custom models and DWG catalog assets on mount
  useEffect(() => {
    fetchCatalogAssets()
    fetchCustomModels()
  }, [])

  useEffect(() => {
    setDimensions(prev => {
      const next = { ...prev }
      objectPresets.forEach(preset => {
        if (!next[preset.type]) next[preset.type] = { ...getDefaultDimensions(preset.type) }
      })
      return next
    })
  }, [catalogAssets])

  const fetchCatalogAssets = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dwg/catalog`)
      if (res.ok) {
        const assets: CatalogAsset[] = await res.json()
        setCatalogAssets(assets)
      }
    } catch (err) {
      console.error('Failed to fetch DWG catalog assets:', err)
    }
  }

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
        await fetchCatalogAssets()
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
        await fetchCatalogAssets()
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
        await fetchCatalogAssets()
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

  const handleColorChange = async (preset: ObjectPreset, color: string) => {
    setCatalogAssets(prev => prev.map(asset => asset.type === preset.type ? { ...asset, color } : asset))
    objects
      .filter(obj => obj.type === preset.type)
      .forEach(obj => updateObject(obj.id, { color }))

    try {
      const res = await fetch(`${API_BASE}/api/dwg/catalog/${preset.type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: preset.name, color })
      })
      if (res.ok) {
        await fetchCatalogAssets()
      }
    } catch (err) {
      console.error('Failed to update asset color:', err)
    }
  }

  const handleAddObject = (preset: ObjectPreset) => {
    if (!venue) return
    const dim = dimensions[preset.type] || getDefaultDimensions(preset.type)
    
    // Find a clear spawn position away from existing fixtures
    // Calculate bounding box of all existing objects
    let minX = Infinity, maxX = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    
    objects.forEach(obj => {
      const hw = (obj.scale?.x || 1) / 2
      const hd = (obj.scale?.z || 1) / 2
      minX = Math.min(minX, obj.position.x - hw)
      maxX = Math.max(maxX, obj.position.x + hw)
      minZ = Math.min(minZ, obj.position.z - hd)
      maxZ = Math.max(maxZ, obj.position.z + hd)
    })
    
    // Spawn position: top-left corner, 3m outside the fixture bounding box
    // If no objects exist, place at venue corner with some margin
    const margin = 3
    const objHalfW = dim.width / 2
    const objHalfD = dim.depth / 2
    
    let spawnX: number, spawnZ: number
    
    if (objects.length === 0 || !isFinite(minX)) {
      // No existing objects - place at top-left with margin
      spawnX = objHalfW + margin
      spawnZ = objHalfD + margin
    } else {
      // Place to the left of existing fixtures, or above if left is out of bounds
      spawnX = minX - margin - objHalfW
      spawnZ = minZ - margin - objHalfD
      
      // If would be negative, place to the right/bottom instead
      if (spawnX < objHalfW + 1) {
        spawnX = maxX + margin + objHalfW
      }
      if (spawnZ < objHalfD + 1) {
        spawnZ = maxZ + margin + objHalfD
      }
    }
    
    const position: Vector3 = {
      x: spawnX,
      y: 0,
      z: spawnZ,
    }
    const scale: Vector3 = { x: dim.width, y: dim.height, z: dim.depth }
    addObject(preset.type, position, scale, { name: preset.name, color: preset.color })
    setExpandedType(null)
  }

  const updateDimension = (type: ObjectType, field: keyof ObjectDimensions, value: number) => {
    setDimensions(prev => ({
      ...prev,
      [type]: { ...(prev[type] || getDefaultDimensions(type)), [field]: value }
    }))
  }

  const resetDimensions = (type: ObjectType) => {
    setDimensions(prev => ({
      ...prev,
      [type]: { ...getDefaultDimensions(type) }
    }))
  }

  return (
    <div className="p-4 space-y-4">
      {/* Add Objects Section */}
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Add Object</h3>
        <div className="space-y-2">
          {objectPresets.map(preset => {
            const hasCustomModel = customModels.has(preset.type) || preset.hasCustomModel
            const isExpanded = expandedType === preset.type
            const dim = dimensions[preset.type] || getDefaultDimensions(preset.type)
            return (
              <div
                key={preset.type}
                className={`bg-card-bg border rounded-lg transition-colors ${
                  hasCustomModel ? 'border-green-500/50' : 'border-border-dark'
                } ${isExpanded ? 'border-highlight' : ''}`}
              >
                {/* Header - click to expand */}
                <div className="w-full p-3 flex items-center justify-between">
                  <button
                    onClick={() => setExpandedType(isExpanded ? null : preset.type)}
                    disabled={!venue}
                    className="flex items-center gap-2 flex-1 text-left disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <preset.icon className={`w-4 h-4 transition-colors ${isExpanded ? 'text-highlight' : 'text-gray-400 group-hover:text-highlight'}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{preset.name}</span>
                        {hasCustomModel && <span className="text-[8px] text-green-400 bg-green-500/20 px-1 rounded">3D</span>}
                        {preset.isUserAsset && <span className="text-[8px] text-violet-300 bg-violet-500/20 px-1 rounded">DWG</span>}
                        {typeCounts[preset.type] > 0 && (
                          <span className="text-[9px] text-gray-500 bg-gray-700/50 px-1.5 rounded">{typeCounts[preset.type]}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500">{dim.width}×{dim.depth}×{dim.height}m</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    {/* Highlight toggle - only show if objects of this type exist */}
                    {typeCounts[preset.type] > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleTypeHighlight(preset.type) }}
                        className={`p-1.5 rounded transition-colors ${
                          highlightedTypes.has(preset.type)
                            ? 'text-cyan-400 bg-cyan-500/20'
                            : 'text-gray-500 hover:text-cyan-400 hover:bg-cyan-500/10'
                        }`}
                        title={highlightedTypes.has(preset.type) ? `Hide ${preset.name} highlight` : `Highlight all ${preset.name}s`}
                      >
                        {highlightedTypes.has(preset.type) ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>
                
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
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                        <span>Color</span>
                        <span className="font-mono">{preset.color}</span>
                      </div>
                      <input
                        type="color"
                        value={preset.color}
                        onChange={(e) => handleColorChange(preset, e.target.value)}
                        className="w-full h-7 bg-gray-800 border border-border-dark rounded cursor-pointer"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => resetDimensions(preset.type)}
                        className="flex-1 py-1.5 text-xs text-gray-400 hover:text-white border border-border-dark rounded hover:border-gray-600 transition-colors"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => handleAddObject(preset)}
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
          {objectPresets.map(preset => {
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Scene Objects ({typeFilter === 'all' ? objects.length : `${filteredObjects.length}/${objects.length}`})
          </h3>
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-gray-500" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ObjectType | 'all')}
              className="bg-card-bg border border-border-dark rounded px-2 py-0.5 text-xs text-white focus:border-highlight focus:outline-none"
            >
              <option value="all">All Types</option>
              {availableTypes.map(type => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')} ({typeCounts[type]})
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Delete all filtered button */}
        {typeFilter !== 'all' && filteredObjects.length > 0 && (
          <button
            onClick={() => {
              if (confirm(`Delete all ${filteredObjects.length} ${typeFilter} objects?`)) {
                filteredObjects.forEach(obj => removeObject(obj.id))
                setTypeFilter('all')
              }
            }}
            className="w-full mb-2 py-1.5 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors flex items-center justify-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            Delete All {filteredObjects.length} {typeFilter}
          </button>
        )}
        
        {objects.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No objects in scene.<br />
            Click an object type above to add.
          </div>
        ) : filteredObjects.length === 0 ? (
          <div className="text-center py-4 text-gray-500 text-sm">
            No {typeFilter} objects found.
          </div>
        ) : (
          <div ref={listContainerRef} className="space-y-1 max-h-[400px] overflow-y-auto">
            {filteredObjects.map(obj => {
              const preset = objectPresets.find(p => p.type === obj.type)
              const Icon = preset?.icon || Shapes
              const isHovered = hoveredObjectId === obj.id
              const isSelected = selectedObjectId === obj.id
              
              return (
                <div
                  key={obj.id}
                  ref={(el) => { if (el) cardRefsMap.current.set(obj.id, el); else cardRefsMap.current.delete(obj.id) }}
                  onClick={() => selectObject(obj.id)}
                  onMouseEnter={() => { hoverFromSidebarRef.current = true; hoverObject(obj.id) }}
                  onMouseLeave={() => { hoverFromSidebarRef.current = false; hoverObject(null) }}
                  className={`p-2 rounded-lg cursor-pointer flex items-center justify-between group transition-colors ${
                    isSelected
                      ? 'bg-highlight/20 border border-highlight'
                      : isHovered
                        ? 'bg-cyan-500/10 border border-cyan-500/60'
                        : 'bg-card-bg border border-border-dark hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${
                      isSelected ? 'text-highlight' : isHovered ? 'text-cyan-400' : 'text-gray-400'
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
                    className={`p-1 text-gray-500 hover:text-red-400 transition-all ${
                      isHovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
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
