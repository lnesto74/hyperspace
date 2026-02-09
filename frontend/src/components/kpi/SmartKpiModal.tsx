import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Zap, ShoppingCart, DoorOpen, Package, Check, Loader2, Eye, Sparkles, AlertCircle, Settings2, Maximize2, RefreshCw } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useRoi } from '../../context/RoiContext'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface KpiDefinition {
  id: string
  name: string
  unit: string
  description: string
}

interface DetectedObject {
  id: string
  name: string
  type: string
  position: { x: number; y: number; z: number }
}

interface RoiConfig {
  engagementDepth?: number
  engagementDepthMin?: number
  engagementDepthMax?: number
  queueDepth?: number
  zoneDepth?: number
}

interface SmartKpiTemplate {
  id: string
  name: string
  description: string
  icon: string
  kpis: KpiDefinition[]
  roiConfig?: RoiConfig
  detectedCount?: number
  detectedObjects?: DetectedObject[]
  canGenerate?: boolean
}

interface PreviewRoi {
  id: string
  name: string
  vertices: { x: number; z: number }[]
  color: string
  opacity: number
  roiType?: string // e.g., 'service', 'queue', 'browse', 'engagement'
}

interface RoiDimensionConfig {
  width: number
  depth: number
  minWidth: number
  maxWidth: number
  minDepth: number
  maxDepth: number
  offsetX: number  // +X/-X offset on floor plane
  offsetZ: number  // +Z/-Z offset on floor plane
}

interface SmartKpiModalProps {
  isOpen: boolean
  onClose: () => void
  dwgLayoutId?: string | null  // If provided, use DWG mode
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  ShoppingCart,
  DoorOpen,
  Package,
}

// Mini 2D preview component for ROIs
function MiniRoiPreview({ rois }: { rois: PreviewRoi[] }) {
  // Calculate bounds
  const allPoints = rois.flatMap(r => r.vertices)
  if (allPoints.length === 0) return null
  
  const minX = Math.min(...allPoints.map(p => p.x))
  const maxX = Math.max(...allPoints.map(p => p.x))
  const minZ = Math.min(...allPoints.map(p => p.z))
  const maxZ = Math.max(...allPoints.map(p => p.z))
  
  const width = maxX - minX || 1
  const depth = maxZ - minZ || 1
  
  // Transform point to SVG coordinates (0-100 viewBox)
  const toSvg = (x: number, z: number) => ({
    x: ((x - minX) / width) * 80 + 10, // 10% margin
    y: ((z - minZ) / depth) * 80 + 10,
  })
  
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      {/* Grid */}
      <defs>
        <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#374151" strokeWidth="0.3" />
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#grid)" />
      
      {/* ROIs */}
      {rois.map((roi, idx) => {
        if (roi.vertices.length < 3) return null
        const points = roi.vertices.map(v => toSvg(v.x, v.z))
        const pathD = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')} Z`
        
        return (
          <g key={roi.id || idx}>
            <path
              d={pathD}
              fill={roi.color}
              fillOpacity={0.4}
              stroke={roi.color}
              strokeWidth="0.5"
            />
          </g>
        )
      })}
      
      {/* Scale indicator */}
      <text x="5" y="97" fontSize="3" fill="#9ca3af">
        {width.toFixed(1)}m × {depth.toFixed(1)}m
      </text>
    </svg>
  )
}

export default function SmartKpiModal({ isOpen, onClose, dwgLayoutId: propDwgLayoutId }: SmartKpiModalProps) {
  const { venue } = useVenue()
  const { loadRegions } = useRoi()
  
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  const [availableTemplates, setAvailableTemplates] = useState<SmartKpiTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [previewRois, setPreviewRois] = useState<PreviewRoi[]>([])
  const [engagementDepth, setEngagementDepth] = useState(1.5)
  
  // Tab state: 'generate' or 'adjust'
  const [activeTab, setActiveTab] = useState<'generate' | 'adjust'>('generate')
  
  // ROI dimension adjustments per type
  const [roiDimensions, setRoiDimensions] = useState<Record<string, RoiDimensionConfig>>({
    service: { width: 1.5, depth: 2.5, minWidth: 0.5, maxWidth: 4.0, minDepth: 1.0, maxDepth: 5.0, offsetX: 0, offsetZ: 0 },
    queue: { width: 1.5, depth: 3.0, minWidth: 0.5, maxWidth: 4.0, minDepth: 1.0, maxDepth: 8.0, offsetX: 0, offsetZ: 0 },
    browse: { width: 2.0, depth: 2.0, minWidth: 0.5, maxWidth: 5.0, minDepth: 0.5, maxDepth: 5.0, offsetX: 0, offsetZ: 0 },
    engagement: { width: 2.0, depth: 1.5, minWidth: 0.5, maxWidth: 6.0, minDepth: 0.5, maxDepth: 4.0, offsetX: 0, offsetZ: 0 },
  })

  // Use venue's dwg_layout_version_id if available (for saved DWG venues), otherwise use prop
  const dwgLayoutId = venue?.dwg_layout_version_id || propDwgLayoutId
  
  // Determine if we're in DWG mode
  const isDwgMode = !!dwgLayoutId

  // Analyze venue/DWG when modal opens
  const analyzeVenue = useCallback(async () => {
    if (!venue?.id) return
    
    console.log(`[SmartKpiModal] analyzeVenue called, isDwgMode=${isDwgMode}, dwgLayoutId=${dwgLayoutId}`)
    
    setAnalyzing(true)
    setError(null)
    
    try {
      // Use different endpoint for DWG mode
      const url = isDwgMode
        ? `${API_BASE}/api/smart-kpi/dwg/${dwgLayoutId}/venues/${venue.id}/analyze`
        : `${API_BASE}/api/smart-kpi/venues/${venue.id}/analyze`
      
      console.log(`[SmartKpiModal] Fetching: ${url}`)
      
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to analyze ${isDwgMode ? 'DWG layout' : 'venue'}`)
      
      const data = await res.json()
      console.log(`[SmartKpiModal] Got ${data.availableKpis?.length || 0} available KPIs`)
      setAvailableTemplates(data.availableKpis || [])
      
      if (data.availableKpis?.length === 0) {
        const hint = isDwgMode
          ? 'No fixtures detected for smart KPIs. Make sure your DWG has mapped checkout, entrance, or shelf fixtures.'
          : 'No objects detected for smart KPIs. Add checkout counters, entrances, or shelves to your floor plan.'
        setError(hint)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to analyze ${isDwgMode ? 'DWG layout' : 'venue'}`)
    } finally {
      setAnalyzing(false)
    }
  }, [venue?.id, isDwgMode, dwgLayoutId])

  useEffect(() => {
    if (isOpen && venue?.id) {
      analyzeVenue()
      setSelectedTemplate(null)
      setPreviewRois([])
      setSuccess(null)
    }
  }, [isOpen, venue?.id, analyzeVenue])

  // Preview ROIs for selected template
  const previewTemplate = useCallback(async (templateId: string, depth?: number, dimensions?: Record<string, RoiDimensionConfig>) => {
    if (!venue?.id) return
    
    setLoading(true)
    setError(null)
    
    try {
      const options: Record<string, unknown> = {}
      if (templateId === 'shelf-engagement' && depth !== undefined) {
        options.engagementDepth = depth
      }
      
      // Pass dimension overrides if provided
      if (dimensions) {
        options.roiDimensions = dimensions
      }
      
      // Use different endpoint for DWG mode
      const url = isDwgMode
        ? `${API_BASE}/api/smart-kpi/dwg/${dwgLayoutId}/venues/${venue.id}/preview/${templateId}`
        : `${API_BASE}/api/smart-kpi/venues/${venue.id}/preview/${templateId}`
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
      
      if (!res.ok) throw new Error('Failed to preview')
      
      const data = await res.json()
      setPreviewRois(data.generatedRois || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview')
    } finally {
      setLoading(false)
    }
  }, [venue?.id, isDwgMode, dwgLayoutId])

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplate(templateId)
    setSuccess(null)
    // Reset depth to default when selecting shelf template
    if (templateId === 'shelf-engagement') {
      const template = availableTemplates.find(t => t.id === templateId)
      const defaultDepth = template?.roiConfig?.engagementDepth || 1.5
      setEngagementDepth(defaultDepth)
      previewTemplate(templateId, defaultDepth, roiDimensions)
    } else {
      previewTemplate(templateId, undefined, roiDimensions)
    }
  }

  const handleDepthChange = (newDepth: number) => {
    setEngagementDepth(newDepth)
    if (selectedTemplate === 'shelf-engagement') {
      previewTemplate(selectedTemplate, newDepth, roiDimensions)
    }
  }
  
  // Handle ROI dimension changes with auto-refresh
  const handleDimensionChange = (roiType: string, field: 'width' | 'depth' | 'offsetX' | 'offsetZ', value: number) => {
    const newDimensions = {
      ...roiDimensions,
      [roiType]: { ...roiDimensions[roiType], [field]: value }
    }
    setRoiDimensions(newDimensions)
    
    // Auto-refresh preview after a short delay (debounced via mouseup)
  }
  
  // Called on slider mouseup to refresh preview
  const handleDimensionCommit = () => {
    if (selectedTemplate) {
      previewTemplate(selectedTemplate, selectedTemplate === 'shelf-engagement' ? engagementDepth : undefined, roiDimensions)
    }
  }
  
  // Refresh preview with current dimensions
  const refreshPreview = () => {
    if (selectedTemplate) {
      previewTemplate(selectedTemplate, selectedTemplate === 'shelf-engagement' ? engagementDepth : undefined, roiDimensions)
    }
  }
  
  // Get unique ROI types from preview
  const roiTypes = useMemo(() => {
    const types = new Set<string>()
    previewRois.forEach(roi => {
      // Extract type from name (e.g., "Cashier 1 - Service" -> "service")
      const nameParts = roi.name.split(' - ')
      if (nameParts.length > 1) {
        types.add(nameParts[nameParts.length - 1].toLowerCase())
      }
    })
    return Array.from(types)
  }, [previewRois])

  // Generate and save ROIs
  const generateRois = async () => {
    if (!venue?.id || !selectedTemplate) return
    
    setGenerating(true)
    setError(null)
    
    try {
      const options: Record<string, unknown> = {}
      if (selectedTemplate === 'shelf-engagement') {
        options.engagementDepth = engagementDepth
      }
      // Pass dimension overrides
      options.roiDimensions = roiDimensions
      
      // Use different endpoint for DWG mode
      const url = isDwgMode
        ? `${API_BASE}/api/smart-kpi/dwg/${dwgLayoutId}/venues/${venue.id}/generate/${selectedTemplate}`
        : `${API_BASE}/api/smart-kpi/venues/${venue.id}/generate/${selectedTemplate}`
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
      
      if (!res.ok) throw new Error('Failed to generate zones')
      
      const data = await res.json()
      
      // Reload ROIs in context (pass dwgLayoutId for DWG mode)
      await loadRegions(venue.id, dwgLayoutId)
      
      setSuccess(`Created ${data.savedRois?.length || 0} zones for ${data.templateName}`)
      setPreviewRois([])
      
      // Close after success
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate zones')
    } finally {
      setGenerating(false)
    }
  }

  if (!isOpen) return null

  const selectedTemplateData = availableTemplates.find(t => t.id === selectedTemplate)

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[800px] max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gradient-to-r from-purple-900/30 to-blue-900/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Smart KPI Mode {isDwgMode && <span className="text-purple-400 text-sm ml-2">(DWG)</span>}
              </h2>
              <p className="text-xs text-gray-400">
                Auto-generate zones based on your {isDwgMode ? 'DWG fixtures' : 'floor plan objects'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('generate')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'generate'
                ? 'text-purple-400 border-b-2 border-purple-500 bg-purple-900/20'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Generate
          </button>
          <button
            onClick={() => setActiveTab('adjust')}
            disabled={previewRois.length === 0}
            className={`flex-1 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'adjust'
                ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-900/20'
                : previewRois.length === 0
                  ? 'text-gray-600 cursor-not-allowed'
                  : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <Settings2 className="w-4 h-4" />
            Adjust Dimensions
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {analyzing ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-3" />
              <p className="text-gray-400">Analyzing your floor plan...</p>
            </div>
          ) : error && availableTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="w-12 h-12 text-amber-500 mb-3" />
              <p className="text-gray-300 text-center max-w-md">{error}</p>
              <p className="text-gray-500 text-sm mt-2">
                Tip: Add objects like "Cashier 1", "Entrance", or "Shelf A" to enable smart KPIs
              </p>
            </div>
          ) : activeTab === 'adjust' ? (
            /* Adjust Dimensions Tab */
            <div className="grid grid-cols-2 gap-6">
              {/* Left: Dimension Controls */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                    <Maximize2 className="w-4 h-4 text-blue-400" />
                    ROI Dimensions
                  </h3>
                  <button
                    onClick={refreshPreview}
                    disabled={loading}
                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                    Apply
                  </button>
                </div>
                
                <div className="space-y-4">
                  {roiTypes.map(roiType => {
                    const config = roiDimensions[roiType]
                    if (!config) return null
                    
                    const typeLabel = roiType.charAt(0).toUpperCase() + roiType.slice(1)
                    const typeColor = roiType === 'service' ? '#22c55e' : roiType === 'queue' ? '#f59e0b' : roiType === 'browse' ? '#3b82f6' : '#a855f7'
                    
                    return (
                      <div key={roiType} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded" style={{ backgroundColor: typeColor }} />
                          <span className="text-sm font-medium text-white">{typeLabel} Zones</span>
                          <span className="text-xs text-gray-500 ml-auto">
                            {previewRois.filter(r => r.name.toLowerCase().includes(roiType)).length} zones
                          </span>
                        </div>
                        
                        {/* Width Slider */}
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-gray-400">Width</label>
                            <span className="text-xs font-mono text-blue-400">{config.width.toFixed(1)}m</span>
                          </div>
                          <input
                            type="range"
                            min={config.minWidth}
                            max={config.maxWidth}
                            step={0.1}
                            value={config.width}
                            onChange={(e) => handleDimensionChange(roiType, 'width', parseFloat(e.target.value))}
                            onMouseUp={handleDimensionCommit}
                            onTouchEnd={handleDimensionCommit}
                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                        </div>
                        
                        {/* Depth Slider */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-gray-400">Depth</label>
                            <span className="text-xs font-mono text-blue-400">{config.depth.toFixed(1)}m</span>
                          </div>
                          <input
                            type="range"
                            min={config.minDepth}
                            max={config.maxDepth}
                            step={0.1}
                            value={config.depth}
                            onChange={(e) => handleDimensionChange(roiType, 'depth', parseFloat(e.target.value))}
                            onMouseUp={handleDimensionCommit}
                            onTouchEnd={handleDimensionCommit}
                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                          />
                        </div>
                        
                        {/* Offset Controls */}
                        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-700">
                          {/* Offset X */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs text-gray-400">Offset X</label>
                              <span className="text-xs font-mono text-green-400">{config.offsetX >= 0 ? '+' : ''}{config.offsetX.toFixed(1)}m</span>
                            </div>
                            <input
                              type="range"
                              min={-5}
                              max={5}
                              step={0.1}
                              value={config.offsetX}
                              onChange={(e) => handleDimensionChange(roiType, 'offsetX', parseFloat(e.target.value))}
                              onMouseUp={handleDimensionCommit}
                              onTouchEnd={handleDimensionCommit}
                              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                            />
                          </div>
                          
                          {/* Offset Z */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs text-gray-400">Offset Z</label>
                              <span className="text-xs font-mono text-green-400">{config.offsetZ >= 0 ? '+' : ''}{config.offsetZ.toFixed(1)}m</span>
                            </div>
                            <input
                              type="range"
                              min={-5}
                              max={5}
                              step={0.1}
                              value={config.offsetZ}
                              onChange={(e) => handleDimensionChange(roiType, 'offsetZ', parseFloat(e.target.value))}
                              onMouseUp={handleDimensionCommit}
                              onTouchEnd={handleDimensionCommit}
                              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  
                  {roiTypes.length === 0 && (
                    <p className="text-gray-500 text-sm text-center py-4">
                      Generate zones first to adjust dimensions
                    </p>
                  )}
                </div>
              </div>
              
              {/* Right: Mini Preview */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-400" />
                  Preview
                </h3>
                
                {/* Mini 2D Preview Canvas */}
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-2 aspect-square relative overflow-hidden">
                  {previewRois.length > 0 ? (
                    <MiniRoiPreview rois={previewRois} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                      No zones to preview
                    </div>
                  )}
                </div>
                
                <p className="text-xs text-gray-500 mt-2 text-center">
                  Click "Apply" after adjusting dimensions to update preview
                </p>
              </div>
            </div>
          ) : (
            /* Generate Tab */
            <div className="grid grid-cols-2 gap-6">
              {/* Left: Template Selection */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Available Smart KPIs
                </h3>
                <div className="space-y-3">
                  {availableTemplates.map(template => {
                    const IconComponent = ICON_MAP[template.icon] || Package
                    const isSelected = selectedTemplate === template.id
                    
                    return (
                      <button
                        key={template.id}
                        onClick={() => handleSelectTemplate(template.id)}
                        className={`w-full text-left p-4 rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-purple-900/40 border-purple-500'
                            : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            isSelected ? 'bg-purple-600' : 'bg-gray-700'
                          }`}>
                            <IconComponent className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-white">{template.name}</span>
                              {template.detectedCount && (
                                <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-400 rounded-full">
                                  {template.detectedCount} detected
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-1">{template.description}</p>
                            
                            {/* Detected Objects */}
                            {template.detectedObjects && template.detectedObjects.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {template.detectedObjects.slice(0, 5).map(obj => (
                                  <span key={obj.id} className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">
                                    {obj.name}
                                  </span>
                                ))}
                                {template.detectedObjects.length > 5 && (
                                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">
                                    +{template.detectedObjects.length - 5} more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {isSelected && <Check className="w-5 h-5 text-purple-400" />}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Right: Preview & KPIs */}
              <div>
                {selectedTemplateData ? (
                  <>
                    {/* Preview Info */}
                    <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                      <Eye className="w-4 h-4 text-blue-400" />
                      Zones to Generate
                    </h3>

                    {/* Engagement Depth Slider for Shelf template */}
                    {selectedTemplate === 'shelf-engagement' && (
                      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-medium text-gray-300">
                            Engagement Zone Depth
                          </label>
                          <span className="text-xs font-mono text-purple-400">
                            {engagementDepth.toFixed(1)}m
                          </span>
                        </div>
                        <input
                          type="range"
                          min={selectedTemplateData?.roiConfig?.engagementDepthMin || 0.5}
                          max={selectedTemplateData?.roiConfig?.engagementDepthMax || 3.0}
                          step={0.1}
                          value={engagementDepth}
                          onChange={(e) => handleDepthChange(parseFloat(e.target.value))}
                          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] text-gray-500">
                            {selectedTemplateData?.roiConfig?.engagementDepthMin || 0.5}m
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {selectedTemplateData?.roiConfig?.engagementDepthMax || 3.0}m
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {loading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                      </div>
                    ) : (
                      <>
                        {/* Preview ROIs */}
                        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 mb-4 max-h-40 overflow-y-auto">
                          {previewRois.length > 0 ? (
                            <div className="space-y-2">
                              {previewRois.map(roi => (
                                <div key={roi.id} className="flex items-center gap-2 text-sm">
                                  <div 
                                    className="w-3 h-3 rounded"
                                    style={{ backgroundColor: roi.color }}
                                  />
                                  <span className="text-gray-300">{roi.name}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-gray-500 text-sm">No zones to preview</p>
                          )}
                        </div>

                        {/* KPIs that will be tracked */}
                        <h4 className="text-xs font-medium text-gray-400 mb-2">KPIs that will be tracked:</h4>
                        <div className="grid grid-cols-2 gap-2">
                          {selectedTemplateData.kpis.map(kpi => (
                            <div 
                              key={kpi.id}
                              className="bg-gray-800/30 border border-gray-700 rounded p-2"
                              title={kpi.description}
                            >
                              <div className="text-xs font-medium text-white">{kpi.name}</div>
                              <div className="text-[10px] text-gray-500">{kpi.unit}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500">
                    <Package className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">Select a smart KPI template</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700 bg-gray-900/95 flex items-center justify-between">
          <div>
            {error && availableTemplates.length > 0 && (
              <p className="text-sm text-red-400">{error}</p>
            )}
            {success && (
              <p className="text-sm text-green-400 flex items-center gap-2">
                <Check className="w-4 h-4" />
                {success}
              </p>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={generateRois}
              disabled={!selectedTemplate || generating || previewRois.length === 0}
              className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-all ${
                !selectedTemplate || generating || previewRois.length === 0
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white'
              }`}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Generate {previewRois.length} Zones
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
