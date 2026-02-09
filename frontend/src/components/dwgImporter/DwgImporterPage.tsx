import { useState, useEffect, useCallback } from 'react'
import { FileUp, Box, ArrowLeft, AlertCircle, CheckCircle2, Loader2, Eye, Box as Box3D, Radio } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import UploadCard from './UploadCard'
import GroupListPanel from './GroupListPanel'
import MappingPanel from './MappingPanel'
import PreviewPanel from './PreviewPanel'
import Layout3DPreview from './Layout3DPreview'
import DwgImportsList from './DwgImportsList'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// LiDAR types
export interface LidarModel {
  id: string
  name: string
  hfov_deg: number
  vfov_deg: number
  range_m: number
  dome_mode: boolean
  notes?: { min_overlap_m?: number }
}

export interface LidarInstance {
  id: string
  layout_version_id: string
  model_id: string
  x_m: number
  z_m: number
  y_m?: number
  mount_y_m?: number
  yaw_deg: number
  source: 'manual' | 'auto'
  range_m?: number
}

export interface SimulationResult {
  coverage_percent: number
  heatmap: { x: number; z: number; count: number; overlap?: boolean }[]
  uncovered_cells: number
  total_cells: number
}

export interface AutoplaceSettings {
  overlap_mode: 'everywhere' | 'critical_only' | 'percent_target'
  k_required: number
  overlap_target_pct: number
  los_enabled: boolean
  sample_spacing_m: number
  mount_y_m?: number
}

export interface DwgFixture {
  id: string
  group_id: string
  source: {
    layer: string
    block: string | null
    entity_type: string
  }
  pose2d: {
    x: number
    y: number
    rot_deg: number
  }
  footprint: {
    kind: 'rect' | 'poly'
    w: number
    d: number
    points: { x: number; y: number }[]
  }
}

export interface DwgGroup {
  group_id: string
  layer: string
  block: string | null
  count: number
  size: {
    w: number
    d: number
  }
  members: string[]
}

export interface GroupMapping {
  catalog_asset_id: string
  type: string
  anchor: 'center' | 'minx_miny' | 'minx_maxy' | 'maxx_miny' | 'maxx_maxy' | 'back_center'
  offset_m: { x: number; y: number; z: number }
  rotation_offset_deg: number
}

export interface CatalogAsset {
  id: string
  name: string
  type: string
  hasCustomModel: boolean
  modelPath?: string
}

export interface ImportData {
  import_id: string
  filename: string
  units: string
  unit_scale_to_m: number
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
  fixtures: DwgFixture[]
  groups: DwgGroup[]
  layers: string[]
}

interface DwgImporterPageProps {
  onClose: () => void
  onLayoutGenerated?: (layoutVersionId: string) => void
}

export default function DwgImporterPage({ onClose, onLayoutGenerated }: DwgImporterPageProps) {
  const { venue } = useVenue()
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null)
  const [dwgSupported, setDwgSupported] = useState(false)
  const [importData, setImportData] = useState<ImportData | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<Set<string>>(new Set())
  const [hoveredFixtureId, setHoveredFixtureId] = useState<string | null>(null)
  const [mappings, setMappings] = useState<Record<string, GroupMapping>>({})
  const [catalog, setCatalog] = useState<CatalogAsset[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedLayoutId, setGeneratedLayoutId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show3DPreview, setShow3DPreview] = useState(false)
  const [showUploadView, setShowUploadView] = useState(false)
  const [deletedFixtureIds, setDeletedFixtureIds] = useState<Set<string>>(new Set())
  const [customNames, setCustomNames] = useState<Record<string, string>>({})
  
  // Scale correction for DXF units (read from autoplace settings where PreviewPanel stores it)
  const autoplaceStorageKey = `dwg-autoplace-settings-${importData?.filename || 'default'}`
  const [scaleCorrection, setScaleCorrection] = useState<number>(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) {
      try { 
        return JSON.parse(saved).scaleCorrection || 1.0 
      } catch { 
        return 1.0 
      }
    }
    return 1.0
  })
  
  // Re-read scaleCorrection when switching to 3D view (since PreviewPanel may have updated it)
  useEffect(() => {
    if (show3DPreview) {
      const saved = localStorage.getItem(autoplaceStorageKey)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.scaleCorrection && parsed.scaleCorrection !== scaleCorrection) {
            console.log('Syncing scaleCorrection from PreviewPanel:', parsed.scaleCorrection)
            setScaleCorrection(parsed.scaleCorrection)
          }
        } catch { }
      }
    }
  }, [show3DPreview, autoplaceStorageKey, scaleCorrection])
  
  // LiDAR mode state - selectedLidarModelId persisted to localStorage
  const lidarModelStorageKey = `dwg-selected-lidar-model-${importData?.filename || 'default'}`
  const [lidarMode, setLidarMode] = useState(false)
  const [lidarModels, setLidarModels] = useState<LidarModel[]>([])
  const [lidarInstances, setLidarInstances] = useState<LidarInstance[]>([])
  const [selectedLidarModelId, setSelectedLidarModelId] = useState<string | null>(() => {
    const saved = localStorage.getItem(lidarModelStorageKey)
    return saved || null
  })
  const [selectedLidarInstanceId, setSelectedLidarInstanceId] = useState<string | null>(null)
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  
  // Persist selected LiDAR model whenever it changes
  useEffect(() => {
    if (selectedLidarModelId) {
      localStorage.setItem(lidarModelStorageKey, selectedLidarModelId)
    } else {
      localStorage.removeItem(lidarModelStorageKey)
    }
  }, [lidarModelStorageKey, selectedLidarModelId])
  
  const handleUpdateGroupName = useCallback((groupId: string, name: string) => {
    setCustomNames(prev => ({ ...prev, [groupId]: name }))
  }, [])

  // Check feature flag and DWG support
  useEffect(() => {
    const checkFeature = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dwg/feature-status`)
        if (res.ok) {
          const data = await res.json()
          setFeatureEnabled(data.enabled)
          setDwgSupported(data.dwg_supported || false)
        } else {
          setFeatureEnabled(false)
        }
      } catch {
        setFeatureEnabled(false)
      }
    }
    checkFeature()
  }, [])

  // Fetch catalog
  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dwg/catalog`)
        if (res.ok) {
          const data = await res.json()
          setCatalog(data)
        }
      } catch (err) {
        console.error('Failed to fetch catalog:', err)
      }
    }
    if (featureEnabled) {
      fetchCatalog()
    }
  }, [featureEnabled])

  // Fetch LiDAR models when entering LiDAR mode or 3D preview
  useEffect(() => {
    if ((lidarMode || show3DPreview) && generatedLayoutId) {
      const fetchLidarData = async () => {
        try {
          // Fetch models
          const modelsRes = await fetch(`${API_BASE}/api/lidar/models`)
          if (modelsRes.ok) {
            const models = await modelsRes.json()
            setLidarModels(models)
            if (models.length > 0 && !selectedLidarModelId) {
              setSelectedLidarModelId(models[0].id)
            }
          }
          // Fetch instances for this layout
          const instancesRes = await fetch(`${API_BASE}/api/lidar/instances?layout_version_id=${generatedLayoutId}`)
          if (instancesRes.ok) {
            const instances = await instancesRes.json()
            console.log('Fetched LiDAR instances:', instances.length)
            setLidarInstances(instances)
          }
        } catch (err) {
          console.error('Failed to fetch LiDAR data:', err)
        }
      }
      fetchLidarData()
    }
  }, [lidarMode, show3DPreview, generatedLayoutId, selectedLidarModelId])

  // LiDAR handlers
  const handleAddLidarInstance = useCallback(async (x: number, z: number) => {
    if (!generatedLayoutId || !selectedLidarModelId) return
    const model = lidarModels.find(m => m.id === selectedLidarModelId)
    if (!model) return
    
    try {
      const res = await fetch(`${API_BASE}/api/lidar/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_version_id: generatedLayoutId,
          model_id: selectedLidarModelId,
          x_m: x,
          z_m: z,
          mount_y_m: 3,
          yaw_deg: 0,
          source: 'manual'
        })
      })
      if (res.ok) {
        const newInstance = await res.json()
        newInstance.range_m = model.range_m
        setLidarInstances(prev => [...prev, newInstance])
      }
    } catch (err) {
      console.error('Failed to add LiDAR instance:', err)
    }
  }, [generatedLayoutId, selectedLidarModelId, lidarModels])

  const handleDeleteLidarInstance = useCallback(async (instanceId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/lidar/instances/${instanceId}`, { method: 'DELETE' })
      if (res.ok) {
        setLidarInstances(prev => prev.filter(i => i.id !== instanceId))
        if (selectedLidarInstanceId === instanceId) {
          setSelectedLidarInstanceId(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete LiDAR instance:', err)
    }
  }, [selectedLidarInstanceId])

  const handleUpdateLidarInstance = useCallback(async (instanceId: string, updates: Partial<LidarInstance>) => {
    try {
      const res = await fetch(`${API_BASE}/api/lidar/instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (res.ok) {
        const updated = await res.json()
        setLidarInstances(prev => prev.map(i => i.id === instanceId ? { ...i, ...updated } : i))
        console.log('Updated LiDAR instance:', instanceId, updates)
      }
    } catch (err) {
      console.error('Failed to update LiDAR instance:', err)
    }
  }, [])

  const handleDeleteAllLidarInstances = useCallback(async () => {
    if (!generatedLayoutId) return
    try {
      // Delete all instances for this layout
      const deletePromises = lidarInstances.map(inst =>
        fetch(`${API_BASE}/api/lidar/instances/${inst.id}`, { method: 'DELETE' })
      )
      await Promise.all(deletePromises)
      setLidarInstances([])
      setSelectedLidarInstanceId(null)
      setSimulationResult(null)
      console.log('Deleted all LiDAR instances')
    } catch (err) {
      console.error('Failed to delete all LiDAR instances:', err)
    }
  }, [generatedLayoutId, lidarInstances])

  const handleRunSimulation = useCallback(async () => {
    if (!generatedLayoutId || lidarInstances.length === 0) return
    setIsSimulating(true)
    try {
      const res = await fetch(`${API_BASE}/api/lidar/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_version_id: generatedLayoutId,
          floor_cell_size_m: 0.5,
          floor_y_m: 0
        })
      })
      if (res.ok) {
        const result = await res.json()
        setSimulationResult(result)
      }
    } catch (err) {
      console.error('Failed to run simulation:', err)
    } finally {
      setIsSimulating(false)
    }
  }, [generatedLayoutId, lidarInstances.length])

  const handleAutoPlace = useCallback(async (
    roi: { x: number; z: number }[],
    settings?: AutoplaceSettings
  ) => {
    if (!generatedLayoutId || !selectedLidarModelId || roi.length < 3) {
      console.log('Auto-place preconditions not met:', { generatedLayoutId, selectedLidarModelId, roiLength: roi.length })
      return
    }
    console.log('Starting auto-place with ROI:', roi, 'settings:', settings)
    setIsSimulating(true)
    try {
      const res = await fetch(`${API_BASE}/api/lidar/autoplace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_version_id: generatedLayoutId,
          model_id: selectedLidarModelId,
          floor_cell_size_m: 0.5,
          coverage_target_pct: 0.95,
          roi_vertices: roi,
          // New solver parameters
          overlap_mode: settings?.overlap_mode || 'everywhere',
          k_required: settings?.k_required || 2,
          overlap_target_pct: settings?.overlap_target_pct || 0.8,
          los_enabled: settings?.los_enabled || false,
          sample_spacing_m: settings?.sample_spacing_m || 0.75,
          mount_y_m: settings?.mount_y_m || 3.0
        })
      })
      const result = await res.json()
      console.log('Auto-place response:', res.status, result)
      
      if (res.ok) {
        // Set instances directly from result if available
        if (result.instances && result.instances.length > 0) {
          console.log('Setting instances from result:', result.instances.length)
          // Map the instances to include model_id and source
          const mappedInstances = result.instances.map((inst: { id: string; x_m: number; z_m: number; mount_y_m?: number; yaw_deg?: number }) => ({
            ...inst,
            model_id: selectedLidarModelId,
            source: 'auto',
            layout_version_id: generatedLayoutId
          }))
          setLidarInstances(prev => [...prev.filter(i => i.source !== 'auto'), ...mappedInstances])
        }
        
        // Also try to refresh from API
        const instancesRes = await fetch(`${API_BASE}/api/lidar/instances?layout_version_id=${generatedLayoutId}`)
        if (instancesRes.ok) {
          const instances = await instancesRes.json()
          console.log('Refreshed instances from API:', instances.length)
          if (instances.length > 0) {
            setLidarInstances(instances)
          }
        }
        
        if (result.simulation) {
          setSimulationResult(result.simulation)
        }
        
        // Log solver results
        if (result.solver_status) {
          console.log('Solver status:', result.solver_status, 
            'Coverage:', (result.coverage_pct * 100).toFixed(1) + '%',
            'K-Coverage:', (result.k_coverage_pct * 100).toFixed(1) + '%')
        }
        if (result.warnings?.length > 0) {
          console.warn('Solver warnings:', result.warnings)
        }
      } else {
        console.error('Auto-place failed:', result.error || result)
      }
    } catch (err) {
      console.error('Failed to auto-place:', err)
    } finally {
      setIsSimulating(false)
    }
  }, [generatedLayoutId, selectedLidarModelId])

  // Handle file upload
  const handleUpload = useCallback(async (file: File) => {
    setError(null)
    const formData = new FormData()
    formData.append('file', file)
    if (venue?.id) {
      formData.append('venue_id', venue.id)
    }

    try {
      const res = await fetch(`${API_BASE}/api/dwg/import`, {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }

      const summary = await res.json()
      
      // Fetch full import data
      const detailRes = await fetch(`${API_BASE}/api/dwg/import/${summary.import_id}`)
      if (!detailRes.ok) {
        throw new Error('Failed to fetch import details')
      }
      
      const data = await detailRes.json()
      
      // Load persisted deleted fixture IDs (if re-uploading same file)
      const storageKey = `dwg-deleted-fixtures-${summary.import_id}`
      const savedDeleted = localStorage.getItem(storageKey)
      let deletedIds = new Set<string>()
      if (savedDeleted) {
        try {
          deletedIds = new Set(JSON.parse(savedDeleted))
          setDeletedFixtureIds(deletedIds)
        } catch (e) {
          console.error('Failed to parse deleted fixtures:', e)
        }
      } else {
        setDeletedFixtureIds(new Set())
      }
      
      // Filter out deleted fixtures
      if (deletedIds.size > 0) {
        data.fixtures = data.fixtures.filter((f: DwgFixture) => !deletedIds.has(f.id))
        data.groups = data.groups.map((g: DwgGroup) => ({
          ...g,
          members: g.members.filter((m: string) => !deletedIds.has(m)),
          count: g.members.filter((m: string) => !deletedIds.has(m)).length
        })).filter((g: DwgGroup) => g.count > 0)
      }
      
      setImportData(data)
      
      // Load existing mapping if any
      const mappingRes = await fetch(`${API_BASE}/api/dwg/import/${summary.import_id}/mapping`)
      if (mappingRes.ok) {
        const mappingData = await mappingRes.json()
        setMappings(mappingData.group_mappings || {})
      }
      
    } catch (err: any) {
      setError(err.message)
    }
  }, [venue?.id])

  // Load existing import by ID
  const loadExistingImport = useCallback(async (importId: string) => {
    setError(null)
    setShowUploadView(false)
    
    try {
      const detailRes = await fetch(`${API_BASE}/api/dwg/import/${importId}`)
      if (!detailRes.ok) {
        throw new Error('Failed to fetch import details')
      }
      
      const data = await detailRes.json()
      
      // Load persisted deleted fixture IDs
      const storageKey = `dwg-deleted-fixtures-${importId}`
      const savedDeleted = localStorage.getItem(storageKey)
      let deletedIds = new Set<string>()
      if (savedDeleted) {
        try {
          deletedIds = new Set(JSON.parse(savedDeleted))
          setDeletedFixtureIds(deletedIds)
        } catch (e) {
          console.error('Failed to parse deleted fixtures:', e)
        }
      } else {
        setDeletedFixtureIds(new Set())
      }
      
      // Filter out deleted fixtures
      if (deletedIds.size > 0) {
        data.fixtures = data.fixtures.filter((f: DwgFixture) => !deletedIds.has(f.id))
        data.groups = data.groups.map((g: DwgGroup) => ({
          ...g,
          members: g.members.filter((m: string) => !deletedIds.has(m)),
          count: g.members.filter((m: string) => !deletedIds.has(m)).length
        })).filter((g: DwgGroup) => g.count > 0)
      }
      
      setImportData(data)
      setGeneratedLayoutId(null)
      setShow3DPreview(false)
      
      // Load existing mapping if any
      const mappingRes = await fetch(`${API_BASE}/api/dwg/import/${importId}/mapping`)
      if (mappingRes.ok) {
        const mappingData = await mappingRes.json()
        setMappings(mappingData.group_mappings || {})
      }
      
      // Check if there's a generated layout
      const layoutsRes = await fetch(`${API_BASE}/api/dwg/import/${importId}/layouts`)
      if (layoutsRes.ok) {
        const layouts = await layoutsRes.json()
        if (layouts.length > 0) {
          // Use the most recent active layout
          const activeLayout = layouts.find((l: any) => l.is_active) || layouts[0]
          setGeneratedLayoutId(activeLayout.id)
        }
      }
      
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  // Update mapping for a group
  const updateMapping = useCallback((groupId: string, mapping: GroupMapping | null) => {
    setMappings(prev => {
      const next = { ...prev }
      if (mapping) {
        next[groupId] = mapping
      } else {
        delete next[groupId]
      }
      return next
    })
  }, [])

  // Delete selected fixtures from the import data
  const handleDeleteFixtures = useCallback((fixtureIds: string[]) => {
    if (!importData) return
    
    const idsToDelete = new Set(fixtureIds)
    
    // Add to persisted deleted IDs
    const newDeletedIds = new Set([...deletedFixtureIds, ...fixtureIds])
    setDeletedFixtureIds(newDeletedIds)
    
    // Persist to localStorage
    const storageKey = `dwg-deleted-fixtures-${importData.import_id}`
    localStorage.setItem(storageKey, JSON.stringify([...newDeletedIds]))
    
    // Filter out deleted fixtures
    const remainingFixtures = importData.fixtures.filter(f => !idsToDelete.has(f.id))
    
    // Update groups - remove deleted members and recalculate counts
    const updatedGroups = importData.groups.map(g => ({
      ...g,
      members: g.members.filter((m: string) => !idsToDelete.has(m)),
      count: g.members.filter((m: string) => !idsToDelete.has(m)).length
    })).filter(g => g.count > 0) // Remove empty groups
    
    setImportData({
      ...importData,
      fixtures: remainingFixtures,
      groups: updatedGroups
    })
    
    // Clear selection
    setSelectedFixtureIds(new Set())
    setSelectedGroupId(null)
  }, [importData, deletedFixtureIds])

  // Save mappings to backend
  const saveMappings = useCallback(async () => {
    if (!importData) return
    
    try {
      await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/mapping`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_mappings: mappings })
      })
    } catch (err) {
      console.error('Failed to save mappings:', err)
    }
  }, [importData, mappings])

  // Auto-save mappings when they change
  useEffect(() => {
    if (importData && Object.keys(mappings).length > 0) {
      const timeout = setTimeout(saveMappings, 1000)
      return () => clearTimeout(timeout)
    }
  }, [mappings, importData, saveMappings])

  // Generate layout
  const handleGenerate = useCallback(async () => {
    if (!importData) return
    
    setIsGenerating(true)
    setError(null)
    
    try {
      // Ensure mappings are saved
      await saveMappings()
      
      const res = await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venue?.id,
          name: `${importData.filename} Layout`
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }
      
      const result = await res.json()
      setGeneratedLayoutId(result.layout_version_id)
      onLayoutGenerated?.(result.layout_version_id)
      
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsGenerating(false)
    }
  }, [importData, venue?.id, saveMappings, onLayoutGenerated])

  // Count unmapped groups
  const unmappedCount = importData 
    ? importData.groups.filter(g => !mappings[g.group_id]).length 
    : 0

  if (featureEnabled === null) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-app-bg">
        <Loader2 className="w-8 h-8 text-highlight animate-spin" />
      </div>
    )
  }

  if (!featureEnabled) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-app-bg gap-4">
        <AlertCircle className="w-16 h-16 text-red-500" />
        <h1 className="text-xl font-medium text-white">DWG Importer Disabled</h1>
        <p className="text-gray-400">Enable FEATURE_DWG_IMPORTER=true in backend .env</p>
        <button
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
        >
          Go Back
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-app-bg overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border-dark flex items-center px-4 gap-4 bg-panel-bg">
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <FileUp className="w-5 h-5 text-highlight" />
          <h1 className="text-lg font-medium text-white">DWG → 3D Scene Importer</h1>
        </div>
        {importData && (
          <>
            <button
              onClick={() => {
                setImportData(null)
                setMappings({})
                setGeneratedLayoutId(null)
                setShow3DPreview(false)
                setShowUploadView(false)
              }}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              ← All Imports
            </button>
            <span className="text-sm text-gray-400">
              {importData.filename} • {importData.fixtures.length} fixtures • {importData.groups.length} groups
            </span>
          </>
        )}
        <div className="flex-1" />
        {importData && (
          <div className="flex items-center gap-3">
            {unmappedCount > 0 && (
              <span className="text-amber-400 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {unmappedCount} unmapped
              </span>
            )}
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`px-4 py-2 rounded-lg text-white font-medium transition-colors flex items-center gap-2 ${
                generatedLayoutId 
                  ? 'bg-gray-700 hover:bg-gray-600' 
                  : 'bg-highlight hover:bg-highlight/80'
              } disabled:bg-gray-600`}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : generatedLayoutId ? (
                <>
                  <Box className="w-4 h-4" />
                  Regenerate 3D
                </>
              ) : (
                <>
                  <Box className="w-4 h-4" />
                  Generate 3D Scene
                </>
              )}
            </button>
            {generatedLayoutId && (
              <span className="text-green-400 text-sm flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                Ready
              </span>
            )}
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-white">×</button>
        </div>
      )}

      {/* Main Content */}
      {!importData ? (
        showUploadView ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <UploadCard onUpload={handleUpload} dwgSupported={dwgSupported} />
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <DwgImportsList
              onSelectImport={loadExistingImport}
              onUploadNew={() => setShowUploadView(true)}
              dwgSupported={dwgSupported}
            />
          </div>
        )
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Groups */}
          <div className="w-80 border-r border-border-dark overflow-hidden flex flex-col">
            <GroupListPanel
              groups={importData.groups}
              fixtures={importData.fixtures}
              mappings={mappings}
              selectedGroupId={selectedGroupId}
              onSelectGroup={setSelectedGroupId}
              hoveredFixtureId={hoveredFixtureId}
              onDeleteGroup={(groupId: string) => {
                // Delete all fixtures in this group
                const fixtureIds = importData.fixtures
                  .filter(f => f.group_id === groupId)
                  .map(f => f.id)
                handleDeleteFixtures(fixtureIds)
              }}
              customNames={customNames}
              onUpdateName={handleUpdateGroupName}
            />
          </div>

          {/* Center - Preview */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Preview Toggle (shown after layout generation) */}
            {generatedLayoutId && (
              <div className="h-10 border-b border-border-dark flex items-center px-3 gap-2 bg-panel-bg">
                <button
                  onClick={() => setShow3DPreview(false)}
                  className={`px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-1.5 ${
                    !show3DPreview ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  2D Preview
                </button>
                <button
                  onClick={() => setShow3DPreview(true)}
                  className={`px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-1.5 ${
                    show3DPreview ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Box3D className="w-3.5 h-3.5" />
                  3D Preview
                </button>
                <div className="flex-1" />
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Layout Generated
                </span>
              </div>
            )}
            
            {/* Preview Content */}
            <div className="flex-1">
              {show3DPreview && generatedLayoutId ? (
                <Layout3DPreview 
                  layoutVersionId={generatedLayoutId}
                  lidarInstances={lidarInstances}
                  lidarModels={lidarModels}
                  scaleCorrection={scaleCorrection}
                />
              ) : (
                <PreviewPanel
                  importData={importData}
                  selectedGroupId={selectedGroupId}
                  mappings={mappings}
                  selectedFixtureIds={selectedFixtureIds}
                  onSelectFixtures={(ids: string[]) => {
                    setSelectedFixtureIds(new Set(ids))
                    // Auto-select the group of the first selected fixture
                    if (ids.length > 0) {
                      const fixture = importData.fixtures.find(f => f.id === ids[0])
                      if (fixture) {
                        setSelectedGroupId(fixture.group_id)
                      }
                    }
                  }}
                  onDeleteFixtures={handleDeleteFixtures}
                  onHoverFixture={setHoveredFixtureId}
                  hoveredFixtureId={hoveredFixtureId}
                  // LiDAR mode props
                  lidarMode={lidarMode}
                  onToggleLidarMode={() => setLidarMode(!lidarMode)}
                  lidarEnabled={!!generatedLayoutId}
                  lidarModels={lidarModels}
                  lidarInstances={lidarInstances}
                  selectedLidarModelId={selectedLidarModelId}
                  selectedLidarInstanceId={selectedLidarInstanceId}
                  onSelectLidarModel={setSelectedLidarModelId}
                  onSelectLidarInstance={setSelectedLidarInstanceId}
                  onAddLidarInstance={handleAddLidarInstance}
                  onDeleteLidarInstance={handleDeleteLidarInstance}
                  onUpdateLidarInstance={handleUpdateLidarInstance}
                  onDeleteAllLidarInstances={handleDeleteAllLidarInstances}
                  simulationResult={simulationResult}
                  isSimulating={isSimulating}
                  onRunSimulation={handleRunSimulation}
                  onAutoPlace={handleAutoPlace}
                />
              )}
            </div>
          </div>

          {/* Right Panel - Mapping */}
          <div className="w-80 border-l border-border-dark overflow-hidden flex flex-col">
            <MappingPanel
              group={importData.groups.find(g => g.group_id === selectedGroupId) || null}
              mapping={selectedGroupId ? mappings[selectedGroupId] : undefined}
              catalog={catalog}
              onUpdateMapping={(mapping: GroupMapping | null) => selectedGroupId && updateMapping(selectedGroupId, mapping)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
