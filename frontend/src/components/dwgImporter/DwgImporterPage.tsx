import { useState, useEffect, useCallback } from 'react'
import { FileUp, Box, ArrowLeft, AlertCircle, CheckCircle2, Loader2, Eye, Box as Box3D } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import UploadCard from './UploadCard'
import GroupListPanel from './GroupListPanel'
import MappingPanel from './MappingPanel'
import PreviewPanel from './PreviewPanel'
import Layout3DPreview from './Layout3DPreview'
import DwgImportsList from './DwgImportsList'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
                <Layout3DPreview layoutVersionId={generatedLayoutId} />
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
