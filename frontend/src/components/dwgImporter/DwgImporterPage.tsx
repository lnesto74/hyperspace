import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { FileUp, Box, ArrowLeft, AlertCircle, CheckCircle2, Loader2, Eye, Box as Box3D, Sliders } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import UploadCard from './UploadCard'
import GroupListPanel from './GroupListPanel'
import MappingPanel from './MappingPanel'
import PreviewPanel from './PreviewPanel'
import Layout3DPreview from './Layout3DPreview'
import DwgImportsList from './DwgImportsList'
import PrefilterStudio, { PrefilterDryRunResult, PrefilterSettings } from './PrefilterStudio'
import { API_BASE } from '../../config/api'


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

  // Prefilter Studio state ─ a slide-in panel that lets the user tune the
  // geometric prefilter (layer blocklist, size cap, cluster picker…) with a
  // live preview, then Apply or Revert. When a dry-run is active we also
  // overlay the would-be-dropped fixtures on the 2-D canvas.
  const [showPrefilterStudio, setShowPrefilterStudio] = useState(false)
  const [prefilterPreview, setPrefilterPreview] = useState<PrefilterDryRunResult | null>(null)
  const keptPreviewSet = useMemo(() => {
    if (!prefilterPreview?.kept_fixture_ids) return null
    return new Set(prefilterPreview.kept_fixture_ids)
  }, [prefilterPreview])
  
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

  // Persist scaleCorrection to layout DB so bootstrap always has it
  useEffect(() => {
    if (generatedLayoutId && scaleCorrection !== 1.0) {
      fetch(`${API_BASE}/api/dwg/layout/${generatedLayoutId}/view`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale_correction: scaleCorrection }),
      }).then(() => {
        console.log(`[DwgImporter] Saved scale_correction=${scaleCorrection} to layout ${generatedLayoutId}`)
      }).catch(err => {
        console.warn('[DwgImporter] Failed to save scale_correction to DB:', err)
      })
    }
  }, [scaleCorrection, generatedLayoutId])
  
  // LiDAR mode state - selectedLidarModelId persisted to localStorage using generatedLayoutId
  const [lidarMode, setLidarMode] = useState(false)
  const [lidarModels, setLidarModels] = useState<LidarModel[]>([])
  const [lidarInstances, setLidarInstances] = useState<LidarInstance[]>([])
  const [selectedLidarModelId, setSelectedLidarModelId] = useState<string | null>(null)
  const [selectedLidarInstanceId, setSelectedLidarInstanceId] = useState<string | null>(null)
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [lidarRoi, setLidarRoiState] = useState<{ x: number; z: number }[] | null>(null)
  
  // Compute focus bounds from ROI for 3D preview camera auto-sizing
  const roiFocusBounds = useMemo(() => {
    if (!lidarRoi || lidarRoi.length < 3) return undefined
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    lidarRoi.forEach(v => {
      minX = Math.min(minX, v.x)
      minY = Math.min(minY, v.z)
      maxX = Math.max(maxX, v.x)
      maxY = Math.max(maxY, v.z)
    })
    return isFinite(minX) ? { minX, minY, maxX, maxY } : undefined
  }, [lidarRoi])
  
  // Persist selected LiDAR model whenever it changes (using generatedLayoutId as key)
  useEffect(() => {
    if (!generatedLayoutId) return
    const storageKey = `dwg-selected-lidar-model-${generatedLayoutId}`
    if (selectedLidarModelId) {
      localStorage.setItem(storageKey, selectedLidarModelId)
    }
  }, [generatedLayoutId, selectedLidarModelId])
  
  // Load saved LiDAR model when generatedLayoutId becomes available
  useEffect(() => {
    if (!generatedLayoutId) return
    const storageKey = `dwg-selected-lidar-model-${generatedLayoutId}`
    const saved = localStorage.getItem(storageKey)
    if (saved && !selectedLidarModelId) {
      setSelectedLidarModelId(saved)
    }
  }, [generatedLayoutId])
  
  const handleUpdateGroupName = useCallback(async (groupId: string, name: string) => {
    const newCustomNames = { ...customNames, [groupId]: name }
    setCustomNames(newCustomNames)
    
    // Persist to database
    if (importData?.import_id) {
      try {
        await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/deleted-fixtures`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ custom_names: newCustomNames })
        })
      } catch (e) {
        console.error('Failed to save custom names:', e)
      }
    }
  }, [customNames, importData?.import_id])

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

  // Fetch LiDAR models + instances when layout is available (models are GLOBAL — no venue needed)
  const lidarDataLoadedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!generatedLayoutId) return
    const key = `${generatedLayoutId}::${venue?.id || 'no-venue'}`
    if (lidarDataLoadedKey.current === key) return
    lidarDataLoadedKey.current = key

    const fetchLidarData = async () => {
      try {
        // Load saved LiDAR model from localStorage FIRST
        const savedModelStorageKey = `dwg-selected-lidar-model-${generatedLayoutId}`
        const savedModelId = localStorage.getItem(savedModelStorageKey)
        
        // Fetch models (global — no venue needed)
        const modelsRes = await fetch(`${API_BASE}/api/lidar/models`)
        if (modelsRes.ok) {
          const models = await modelsRes.json()
          setLidarModels(models)
          // Use saved model if available and valid, otherwise default to first
          if (savedModelId && models.some((m: LidarModel) => m.id === savedModelId)) {
            setSelectedLidarModelId(savedModelId)
            console.log('[LiDAR] Restored saved model:', savedModelId)
          } else if (models.length > 0 && !selectedLidarModelId) {
            setSelectedLidarModelId(models[0].id)
          }
        }
        // Fetch instances for this layout (keyed by layout, not venue)
        let hasInstances = false
        const instancesRes = await fetch(`${API_BASE}/api/lidar/instances?layout_version_id=${generatedLayoutId}`)
        if (instancesRes.ok) {
          const instances = await instancesRes.json()
          console.log('Fetched LiDAR instances:', instances.length)
          setLidarInstances(instances)
          hasInstances = instances.length > 0
        }
        // Fetch ROIs — try DB endpoint first (needs venue), fallback to lidar_roi_json on layout
        let hasRoi = false
        console.log(`[ROI Load] venue?.id=${venue?.id}, generatedLayoutId=${generatedLayoutId}`)
        if (venue?.id) {
          try {
            const roiRes = await fetch(`${API_BASE}/api/venues/${venue.id}/dwg/${generatedLayoutId}/roi`)
            if (roiRes.ok) {
              const rois = await roiRes.json()
              console.log(`[ROI Load] DB path returned ${rois.length} ROIs`)
              if (rois.length > 0) {
                setLidarRoiState(rois[0].vertices)
                hasRoi = true
                console.log('[ROI Load] Using DB ROI (DXF units):', rois[0].vertices.length, 'vertices, first:', rois[0].vertices[0])
              }
            } else {
              console.log('[ROI Load] DB endpoint returned status:', roiRes.status)
            }
          } catch (e) { console.log('[ROI Load] DB path error:', e) }
        } else {
          console.log('[ROI Load] No venue — skipping DB path')
        }
        // Fallback: load ROI from layout endpoint (no venue needed)
        // Prefer lidar_roi_dxf (DXF units from regions_of_interest — no conversion)
        // Fall back to lidar_roi (meters from lidar_roi_json — needs conversion)
        if (!hasRoi) {
          try {
            const layoutRes = await fetch(`${API_BASE}/api/dwg/layout/${generatedLayoutId}`)
            if (layoutRes.ok) {
              const layoutData = await layoutRes.json()
              
              // Priority 1: lidar_roi_dxf — already in DXF units, use directly
              if (layoutData.lidar_roi_dxf && Array.isArray(layoutData.lidar_roi_dxf) && layoutData.lidar_roi_dxf.length >= 3) {
                setLidarRoiState(layoutData.lidar_roi_dxf)
                hasRoi = true
                console.log('[ROI Load] Using lidar_roi_dxf (DXF units, no conversion):', layoutData.lidar_roi_dxf.length, 'vertices, first:', layoutData.lidar_roi_dxf[0])
              }
              // Priority 2: lidar_roi — meters, convert to DXF
              else if (layoutData.lidar_roi) {
                let roiVerts = typeof layoutData.lidar_roi === 'string'
                  ? JSON.parse(layoutData.lidar_roi)
                  : layoutData.lidar_roi
                if (Array.isArray(roiVerts) && roiVerts.length >= 3) {
                  // Read effectiveScale = unit_scale_to_m × scaleCorrection
                  const rawScale = importData?.unit_scale_to_m || 0.001
                  const fname = importData?.filename || 'default'
                  let sc = 1.0
                  try {
                    const s = localStorage.getItem(`dwg-autoplace-settings-${fname}`)
                    if (s) sc = JSON.parse(s).scaleCorrection || 1.0
                  } catch {}
                  const effScale = rawScale * sc
                  if (effScale > 0) {
                    roiVerts = roiVerts.map((v: { x: number; z: number }) => ({
                      x: v.x / effScale,
                      z: v.z / effScale,
                    }))
                  }
                  console.log(`[ROI Load] Converted lidar_roi meters→DXF (effScale=${effScale}):`, roiVerts.length, 'vertices, first:', roiVerts[0])
                  setLidarRoiState(roiVerts)
                  hasRoi = true
                }
              }
            }
          } catch { /* ignore */ }
        }
        // Auto-enable LiDAR mode if instances or ROI already exist
        if (hasInstances || hasRoi) {
          setLidarMode(true)
        }
      } catch (err) {
        console.error('Failed to fetch LiDAR data:', err)
      }
    }
    fetchLidarData()
  }, [generatedLayoutId, venue?.id])

  // ROI handler - save to layout version (always) + ROI DB table (when venue available)
  // ROI vertices in DwgImporter are always in DXF units.
  // lidar_roi_json must store METERS (used by as-venue-bootstrap).
  // regions_of_interest stores DXF units (used by DWG Importer).
  const handleSetLidarRoi = useCallback(async (roi: { x: number; z: number }[] | null) => {
    setLidarRoiState(roi)
    if (!generatedLayoutId) return
    
    try {
      // Convert DXF → meters for lidar_roi_json (as-venue-bootstrap expects meters)
      // effectiveScale = unit_scale_to_m × scaleCorrection (e.g. 0.001 × 10 = 0.01)
      const effScale = (importData?.unit_scale_to_m || 0.001) * scaleCorrection
      const roiInMeters = roi && roi.length >= 3
        ? roi.map(v => ({ x: v.x * effScale, z: v.z * effScale }))
        : null
      console.log(`[ROI Save] DXF→meters effScale=${effScale}, first DXF:`, roi?.[0], 'first meters:', roiInMeters?.[0])
      
      await fetch(`${API_BASE}/api/dwg/layout/${generatedLayoutId}/view`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lidar_roi: roiInMeters })
      })
      console.log('Saved ROI to lidar_roi_json (meters):', roiInMeters ? roiInMeters.length + ' vertices' : 'cleared')
      
      // Save to ROI DB table in DXF units (for DWG Importer + MainViewport KPI overlays)
      if (venue?.id) {
        if (roi && roi.length >= 3) {
          // Delete existing ROIs for this layout first
          const existingRes = await fetch(`${API_BASE}/api/venues/${venue.id}/dwg/${generatedLayoutId}/roi`)
          if (existingRes.ok) {
            const existing = await existingRes.json()
            for (const r of existing) {
              await fetch(`${API_BASE}/api/roi/${r.id}`, { method: 'DELETE' })
            }
          }
          // Create new ROI (DXF units)
          await fetch(`${API_BASE}/api/venues/${venue.id}/dwg/${generatedLayoutId}/roi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'LiDAR Coverage ROI',
              vertices: roi,
              color: '#f59e0b',
              opacity: 0.5
            })
          })
          console.log('Saved ROI to database (DXF units):', roi.length, 'vertices')
        } else if (roi === null) {
          // Delete all ROIs for this layout
          const existingRes = await fetch(`${API_BASE}/api/venues/${venue.id}/dwg/${generatedLayoutId}/roi`)
          if (existingRes.ok) {
            const existing = await existingRes.json()
            for (const r of existing) {
              await fetch(`${API_BASE}/api/roi/${r.id}`, { method: 'DELETE' })
            }
          }
          console.log('Deleted ROI from database')
        }
      }
    } catch (err) {
      console.error('Failed to save ROI:', err)
    }
  }, [venue?.id, generatedLayoutId, importData?.unit_scale_to_m, scaleCorrection])

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
    // Optimistically update local state immediately (prevents snap-back on drag)
    setLidarInstances(prev => prev.map(i => i.id === instanceId ? { ...i, ...updates } : i))
    try {
      const res = await fetch(`${API_BASE}/api/lidar/instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (res.ok) {
        const updated = await res.json()
        setLidarInstances(prev => prev.map(i => i.id === instanceId ? { ...i, ...updated } : i))
      } else {
        // Revert on failure — refetch from server
        console.error('Failed to update LiDAR instance, reverting')
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
      
      // Load persisted deleted fixture IDs from database
      let deletedIds = new Set<string>()
      let loadedCustomNames: Record<string, string> = {}
      try {
        const deletedRes = await fetch(`${API_BASE}/api/dwg/import/${summary.import_id}/deleted-fixtures`)
        if (deletedRes.ok) {
          const deletedData = await deletedRes.json()
          deletedIds = new Set(deletedData.deleted_fixture_ids || [])
          loadedCustomNames = deletedData.custom_names || {}
          setDeletedFixtureIds(deletedIds)
          setCustomNames(loadedCustomNames)
        }
      } catch (e) {
        console.error('Failed to load deleted fixtures:', e)
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
      
      // Load persisted deleted fixture IDs from database
      let deletedIds = new Set<string>()
      let loadedCustomNames: Record<string, string> = {}
      try {
        const deletedRes = await fetch(`${API_BASE}/api/dwg/import/${importId}/deleted-fixtures`)
        if (deletedRes.ok) {
          const deletedData = await deletedRes.json()
          deletedIds = new Set(deletedData.deleted_fixture_ids || [])
          loadedCustomNames = deletedData.custom_names || {}
          setDeletedFixtureIds(deletedIds)
          setCustomNames(loadedCustomNames)
        }
      } catch (e) {
        console.error('Failed to load deleted fixtures:', e)
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
      // Track the active import for LaunchPad (even before a layout is generated)
      localStorage.setItem('launchpad-activeImportId', importId)
      console.log(`[DwgImporter] Active import set → ${importId} (${data.filename})`)
      
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
          // Sync to localStorage so LaunchPad + DwgContext see the correct DWG
          localStorage.setItem('venueDwg-selectedLayout', activeLayout.id)
          window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: activeLayout.id } }))
          console.log(`[DwgImporter] loadExistingImport synced layout → ${activeLayout.id}`)
          
          // Ensure venue is linked to this layout (may have been missed previously)
          if (venue?.id) {
            fetch(`${API_BASE}/api/venues/${venue.id}/dwg-layout`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dwg_layout_version_id: activeLayout.id })
            }).catch(err => console.error('Failed to link layout to venue:', err))
          }
        }
      }
      
    } catch (err: any) {
      setError(err.message)
    }
  }, [venue?.id])

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
  const handleDeleteFixtures = useCallback(async (fixtureIds: string[]) => {
    if (!importData) return
    
    const idsToDelete = new Set(fixtureIds)
    
    // Add to persisted deleted IDs
    const newDeletedIds = new Set([...deletedFixtureIds, ...fixtureIds])
    setDeletedFixtureIds(newDeletedIds)
    
    // Persist to database
    try {
      await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/deleted-fixtures`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted_fixture_ids: [...newDeletedIds] })
      })
    } catch (e) {
      console.error('Failed to save deleted fixtures:', e)
    }
    
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
          name: `${importData.filename} Layout`,
          scale_correction: scaleCorrection,
        })
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }
      
      const result = await res.json()
      
      // Migrate localStorage keys from old layout ID to new one
      if (result.previous_layout_id && result.previous_layout_id !== result.layout_version_id) {
        const keysToMigrate = [
          'dwg-camera-view-',
          'dwg-lidar-roi-by-layout-',
          'dwg-selected-lidar-model-',
        ]
        for (const prefix of keysToMigrate) {
          const oldKey = `${prefix}${result.previous_layout_id}`
          const newKey = `${prefix}${result.layout_version_id}`
          const saved = localStorage.getItem(oldKey)
          if (saved) {
            localStorage.setItem(newKey, saved)
            localStorage.removeItem(oldKey)
          }
        }
      }
      
      setGeneratedLayoutId(result.layout_version_id)
      // Sync to localStorage so LaunchPad + DwgContext see the correct DWG
      localStorage.setItem('venueDwg-selectedLayout', result.layout_version_id)
      window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: result.layout_version_id } }))
      console.log(`[DwgImporter] generateLayout synced layout → ${result.layout_version_id}`)
      onLayoutGenerated?.(result.layout_version_id)
      
      // ALWAYS create a NEW venue for each DWG (like Launchpad flow)
      // This ensures each DWG gets its own venue instead of overwriting existing venues
      const sc = (() => { try { const s = localStorage.getItem(`dwg-autoplace-settings-${importData?.filename || 'default'}`); return s ? JSON.parse(s).scaleCorrection || 1.0 : 1.0; } catch { return 1.0; } })()
      
      try {
        const bsRes = await fetch(`${API_BASE}/api/dwg/layout/${result.layout_version_id}/as-venue-bootstrap?scaleCorrection=${sc}`)
        if (bsRes.ok) {
          const bootstrap = await bsRes.json()
          
          // Generate new venue ID (like Launchpad)
          const newVenueId = crypto.randomUUID()
          // Derive venue name from DWG filename (strip ".dwg", " Layout" suffix)
          const rawName = importData?.filename || 'DWG Venue'
          const venueName = rawName.replace(/\.dwg\b/i, '').replace(/\s*Layout$/i, '').trim() || 'DWG Venue'
          
          const DEFAULT_COLORS: Record<string, string> = {
            shelf: '#4a9eff', wall: '#6b7280', checkout: '#22c55e', entrance: '#f59e0b',
            pillar: '#9ca3af', digital_display: '#a855f7', radio: '#06b6d4', custom: '#8b5cf6', fridge: '#06b6d4',
          }
          const objects = (bootstrap.objectsDraft || []).map((obj: any) => ({
            ...obj,
            venueId: newVenueId,
            color: obj.color || DEFAULT_COLORS[obj.type] || DEFAULT_COLORS.custom,
          }))
          
          // Create new venue with objects
          const saveRes = await fetch(`${API_BASE}/api/venues/${newVenueId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              venue: {
                id: newVenueId,
                name: venueName,
                width: bootstrap.venueDefaults?.width || 30,
                depth: bootstrap.venueDefaults?.depth || 20,
                height: bootstrap.venueDefaults?.height || 4,
                tileSize: bootstrap.venueDefaults?.tileSize || 1,
                scene_source: 'dwg',
                dwg_layout_version_id: result.layout_version_id,
                dwg_transform_json: JSON.stringify({ scaleCorrection: bootstrap.transform?.scaleCorrection || sc }),
              },
              objects,
            }),
          })
          
          if (saveRes.ok) {
            // Link layout to new venue
            await fetch(`${API_BASE}/api/venues/${newVenueId}/dwg-layout`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dwg_layout_version_id: result.layout_version_id })
            }).catch(() => {})
            
            // Update layout_version's venue_id
            await fetch(`${API_BASE}/api/dwg/layout/${result.layout_version_id}/link-venue`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ venue_id: newVenueId }),
            }).catch(() => {})
            
            console.log(`[DwgImporter] Created NEW venue "${venueName}" (${newVenueId}) with ${objects.length} objects`)
          }
        }
      } catch (createErr) {
        console.warn('[DwgImporter] Venue creation failed:', createErr)
      }
      
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
              onClick={() => setShowPrefilterStudio(v => !v)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                showPrefilterStudio
                  ? 'bg-highlight text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              }`}
              title="Open Prefilter Studio to tune which CAD entities become fixtures"
            >
              <Sliders className="w-4 h-4" />
              Prefilter
            </button>
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
              unitScaleToM={importData.unit_scale_to_m * scaleCorrection}
              onDeleteGroup={(groupId: string) => {
                // Delete all fixtures in this group
                const fixtureIds = importData.fixtures
                  .filter(f => f.group_id === groupId)
                  .map(f => f.id)
                handleDeleteFixtures(fixtureIds)
              }}
              customNames={customNames}
              onUpdateName={handleUpdateGroupName}
              importId={importData.import_id}
              onApplyAiFilter={(groupIds: string[]) => {
                // Delete all fixtures in the filtered groups
                const fixtureIds = importData.fixtures
                  .filter(f => groupIds.includes(f.group_id))
                  .map(f => f.id)
                handleDeleteFixtures(fixtureIds)
              }}
              onSelectFixturesInGroup={(groupId: string) => {
                const ids = importData.fixtures
                  .filter(f => f.group_id === groupId)
                  .map(f => f.id)
                setSelectedFixtureIds(new Set(ids))
                setSelectedGroupId(groupId)
              }}
              onApplyAiMappings={(aiMappings: Record<string, { type: string }>) => {
                // Apply AI-recommended type mappings
                const newMappings = { ...mappings }
                for (const [groupId, { type }] of Object.entries(aiMappings)) {
                  if (!newMappings[groupId]) {
                    newMappings[groupId] = {
                      catalog_asset_id: '',
                      type,
                      anchor: 'center',
                      offset_m: { x: 0, y: 0, z: 0 },
                      rotation_offset_deg: 0
                    }
                  } else {
                    newMappings[groupId] = { ...newMappings[groupId], type }
                  }
                }
                setMappings(newMappings)
              }}
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
                  importId={importData?.import_id}
                  lidarInstances={lidarInstances}
                  lidarModels={lidarModels}
                  scaleCorrection={scaleCorrection}
                  focusBounds={roiFocusBounds}
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
                  dropPreviewKeepIds={keptPreviewSet}
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
                  lidarRoi={lidarRoi}
                  onSetLidarRoi={handleSetLidarRoi}
                  layoutVersionId={generatedLayoutId}
                />
              )}
            </div>
          </div>

          {/* Right Panel - Prefilter Studio takes priority over mapping */}
          {showPrefilterStudio ? (
            <div className="w-96 border-l border-border-dark overflow-hidden flex flex-col bg-panel-bg">
              <PrefilterStudio
                importId={importData.import_id}
                currentFixtureCount={importData.fixtures.length}
                onPreview={(result, _settings: PrefilterSettings) => setPrefilterPreview(result)}
                onApplied={() => {
                  setShowPrefilterStudio(false)
                  setPrefilterPreview(null)
                  // Reload the import so the groups + fixtures reflect the new filter
                  loadExistingImport(importData.import_id)
                }}
                onClose={() => {
                  setShowPrefilterStudio(false)
                  setPrefilterPreview(null)
                }}
              />
            </div>
          ) : selectedGroupId ? (
            <div className="w-80 border-l border-border-dark overflow-hidden flex flex-col">
              <MappingPanel
                group={importData.groups.find(g => g.group_id === selectedGroupId) || null}
                mapping={selectedGroupId ? mappings[selectedGroupId] : undefined}
                catalog={catalog}
                onUpdateMapping={(mapping: GroupMapping | null) => selectedGroupId && updateMapping(selectedGroupId, mapping)}
                unitScaleToM={importData.unit_scale_to_m * scaleCorrection}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
