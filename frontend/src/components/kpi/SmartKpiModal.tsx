import { useState, useEffect, useCallback } from 'react'
import { X, Zap, ShoppingCart, DoorOpen, Package, Check, Loader2, Eye, Sparkles, AlertCircle } from 'lucide-react'
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

export default function SmartKpiModal({ isOpen, onClose, dwgLayoutId }: SmartKpiModalProps) {
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
  const previewTemplate = useCallback(async (templateId: string, depth?: number) => {
    if (!venue?.id) return
    
    setLoading(true)
    setError(null)
    
    try {
      const options: Record<string, number> = {}
      if (templateId === 'shelf-engagement' && depth !== undefined) {
        options.engagementDepth = depth
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
      previewTemplate(templateId, defaultDepth)
    } else {
      previewTemplate(templateId)
    }
  }

  const handleDepthChange = (newDepth: number) => {
    setEngagementDepth(newDepth)
    if (selectedTemplate === 'shelf-engagement') {
      previewTemplate(selectedTemplate, newDepth)
    }
  }

  // Generate and save ROIs
  const generateRois = async () => {
    if (!venue?.id || !selectedTemplate) return
    
    setGenerating(true)
    setError(null)
    
    try {
      const options: Record<string, number> = {}
      if (selectedTemplate === 'shelf-engagement') {
        options.engagementDepth = engagementDepth
      }
      
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
      
      // Reload ROIs in context
      await loadRegions(venue.id)
      
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
          ) : (
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
