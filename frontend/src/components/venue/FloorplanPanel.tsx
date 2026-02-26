import { useState, useEffect, useMemo } from 'react'
import { 
  Map as MapIcon, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  Loader2, 
  Plus,
  Settings,
  Save,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Trash2,
  Radio,
  Building2
} from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { LidarPlacement } from '../../types'
import VenueSettingsPanel from './VenueSettingsPanel'
import AddressAutocomplete from './AddressAutocomplete'
import { API_BASE } from '../../config/api'

interface Company {
  id: string
  name: string
  venue_count: number
}


interface DwgImport {
  import_id: string
  filename: string
  created_at: string
  status: string
}

interface LayoutVersion {
  id: string
  import_id: string
  name: string
  is_active: boolean
  created_at: string
  venue_id?: string
}

interface FloorplanItem {
  id: string
  name: string
  type: 'dwg' | 'manual'
  dimensions: { width: number; depth: number; height: number }
  createdAt: string
  layoutId?: string
  venueId?: string
  importId?: string
  dwgFilename?: string
  has3D: boolean
}

interface FloorplanPanelProps {
  onOpenDwgImporter?: () => void
}

export default function FloorplanPanel({ onOpenDwgImporter }: FloorplanPanelProps) {
  const { 
    venue, 
    venueList, 
    updateVenue, 
    saveVenue, 
    createVenue, 
    loadVenue, 
    fetchVenueList, 
    deleteVenue, 
    isLoading: venueLoading 
  } = useVenue()
  const { placements, setPlacements } = useLidar()
  const { addToast } = useToast()
  const { token, isSuperadmin } = useAuth()
  
  // DWG state
  const [imports, setImports] = useState<DwgImport[]>([])
  const [layouts, setLayouts] = useState<Map<string, LayoutVersion>>(new Map())
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(() => {
    return localStorage.getItem('venueDwg-selectedLayout') || null
  })
  const [isLoadingDwg, setIsLoadingDwg] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Company state
  const [companies, setCompanies] = useState<Company[]>([])
  const [filterCompanyId, setFilterCompanyId] = useState<string>('all')
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set(['all']))
  
  // UI state
  const [showSettings, setShowSettings] = useState(false)
  const [showVenueSettingsModal, setShowVenueSettingsModal] = useState(false)
  const [showNewManual, setShowNewManual] = useState(false)
  const [newVenueName, setNewVenueName] = useState('New Venue')
  const [newVenueWidth, setNewVenueWidth] = useState(20)
  const [newVenueDepth, setNewVenueDepth] = useState(15)
  const [newVenueHeight, setNewVenueHeight] = useState(4)
  const [newVenueAddress, setNewVenueAddress] = useState<{ address: string; latitude: number; longitude: number; place_id: string } | null>(null)

  // Fetch venue list on mount
  useEffect(() => {
    fetchVenueList()
  }, [])

  // Fetch companies
  useEffect(() => {
    if (!token || !isSuperadmin) return
    const fetchCompanies = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/companies`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) setCompanies(await res.json())
      } catch { /* ignore */ }
    }
    fetchCompanies()
  }, [token, isSuperadmin])

  // Fetch DWG imports
  useEffect(() => {
    const fetchImports = async () => {
      setIsLoadingDwg(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/dwg/imports`)
        if (!res.ok) throw new Error('Failed to fetch imports')
        const data = await res.json()
        setImports(data)
        
        // Fetch layout versions for each import
        const layoutMap = new Map<string, LayoutVersion>()
        for (const imp of data) {
          try {
            const layoutRes = await fetch(`${API_BASE}/api/dwg/import/${imp.import_id}/layouts`)
            if (layoutRes.ok) {
              const layoutData = await layoutRes.json()
              if (layoutData.length > 0) {
                // Get the most recent layout that has a venue_id, or fall back to first
                const layout = layoutData.find((l: LayoutVersion) => l.venue_id) || layoutData[0]
                layoutMap.set(imp.import_id, layout)
              }
            }
          } catch {
            // Ignore individual layout fetch errors
          }
        }
        setLayouts(layoutMap)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setIsLoadingDwg(false)
      }
    }
    fetchImports()
  }, [])

  // Persist selected layout
  useEffect(() => {
    if (selectedLayoutId) {
      localStorage.setItem('venueDwg-selectedLayout', selectedLayoutId)
    } else {
      localStorage.removeItem('venueDwg-selectedLayout')
    }
  }, [selectedLayoutId])

  // Build unified floorplan list - start from venues as source of truth
  const floorplans: FloorplanItem[] = []
  
  // Create a map of venue_id -> layout info for quick lookup
  const venueToLayout = new Map<string, { layout: LayoutVersion; importId: string; filename: string }>()
  imports.forEach(imp => {
    const layout = layouts.get(imp.import_id)
    if (layout?.venue_id) {
      venueToLayout.set(layout.venue_id, { 
        layout, 
        importId: imp.import_id, 
        filename: imp.filename 
      })
    }
  })
  
  // Add all venues, determining type based on DWG linkage
  venueList.forEach(v => {
    const dwgInfo = venueToLayout.get(v.id)
    const isDwgBased = !!dwgInfo
    
    floorplans.push({
      id: v.id,
      name: v.name,
      type: isDwgBased ? 'dwg' : 'manual',
      dimensions: { width: v.width, depth: v.depth, height: 4 },
      createdAt: '',
      layoutId: dwgInfo?.layout.id,
      venueId: v.id,
      importId: dwgInfo?.importId,
      dwgFilename: dwgInfo?.filename,
      has3D: true
    })
  })

  // Get current active floorplan
  const activeFloorplan = floorplans.find(fp => 
    (fp.type === 'dwg' && fp.layoutId === selectedLayoutId) ||
    (fp.type === 'manual' && fp.venueId === venue?.id && !selectedLayoutId)
  )

  const handleSelectFloorplan = async (fp: FloorplanItem) => {
    if (fp.type === 'dwg' && fp.layoutId) {
      setSelectedLayoutId(fp.layoutId)
      if (fp.venueId) {
        await loadVenue(fp.venueId)
      }
      window.dispatchEvent(new CustomEvent('dwgLayoutSelected', { detail: { layoutId: fp.layoutId } }))
    } else if (fp.type === 'manual' && fp.venueId) {
      setSelectedLayoutId(null)
      await loadVenue(fp.venueId, (loadedPlacements) => {
        setPlacements(loadedPlacements as LidarPlacement[])
      })
    }
  }

  const handleSave = () => {
    saveVenue(placements)
    addToast('success', 'Venue saved')
  }

  const handleCreateManual = async () => {
    createVenue(newVenueName, newVenueWidth, newVenueDepth, newVenueHeight, 1)
    setShowNewManual(false)
    setSelectedLayoutId(null) // Clear DWG selection for manual venue
    
    // Save address if provided (will be persisted after venue is saved)
    if (newVenueAddress) {
      // We need to wait for the venue to be saved first, then patch address
      // The venue ID is set via createVenue but not yet persisted.
      // We'll patch it after the next save cycle via a timeout.
      const addrData = newVenueAddress
      setTimeout(async () => {
        try {
          // Fetch the latest venue list to get the newly created venue ID
          const res = await fetch(`${API_BASE}/api/venues`)
          if (res.ok) {
            const allVenues = await res.json()
            const newest = allVenues.find((v: any) => v.name === newVenueName)
            if (newest) {
              await fetch(`${API_BASE}/api/venues/${newest.id}/address`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(addrData),
              })
            }
          }
        } catch { /* address will need manual save */ }
      }, 2000)
    }
    
    setNewVenueName('New Venue')
    setNewVenueWidth(20)
    setNewVenueDepth(15)
    setNewVenueHeight(4)
    setNewVenueAddress(null)
  }

  const toggleCompanyExpand = (id: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteFloorplan = async (e: React.MouseEvent, fp: FloorplanItem) => {
    e.stopPropagation()
    if (!confirm(`Delete "${fp.name}"? This cannot be undone.`)) return
    
    if (fp.venueId) {
      await deleteVenue(fp.venueId)
    }
  }

  const handleRefresh = () => {
    window.location.reload()
  }

  // Group floorplans by company
  const groupedFloorplans = useMemo(() => {
    const groups: { id: string; name: string; items: FloorplanItem[] }[] = []
    
    if (companies.length === 0) {
      // No companies loaded — show flat list under "All Venues"
      groups.push({ id: 'all', name: 'All Venues', items: floorplans })
      return groups
    }

    // Group by company
    const companyMap = new Map<string, FloorplanItem[]>()
    const unassigned: FloorplanItem[] = []
    
    floorplans.forEach(fp => {
      const venueItem = venueList.find(v => v.id === fp.venueId)
      const companyId = venueItem?.company_id
      if (companyId) {
        if (!companyMap.has(companyId)) companyMap.set(companyId, [])
        companyMap.get(companyId)!.push(fp)
      } else {
        unassigned.push(fp)
      }
    })

    companies.forEach(c => {
      const items = companyMap.get(c.id) || []
      if (filterCompanyId === 'all' || filterCompanyId === c.id) {
        groups.push({ id: c.id, name: c.name, items })
      }
    })

    if (filterCompanyId === 'all' && unassigned.length > 0) {
      groups.push({ id: 'unassigned', name: 'Unassigned', items: unassigned })
    }

    return groups
  }, [floorplans, companies, venueList, filterCompanyId])

  const isLoading = isLoadingDwg || venueLoading

  return (
    <div className="p-4 space-y-4">
      {/* Section 1: Current Floorplan */}
      <div className="bg-card-bg border border-border-dark rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-white flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-highlight" />
            Current Floorplan
          </h2>
          <button
            onClick={handleRefresh}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : venue ? (
          <div className="space-y-3">
            {/* Active Floorplan Card */}
            <div className="bg-highlight/5 border border-highlight/30 rounded-lg p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Check className="w-4 h-4 text-highlight flex-shrink-0" />
                    <span className="text-sm font-medium text-white truncate">{venue.name}</span>
                    {activeFloorplan?.type === 'dwg' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">DWG</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {venue.width}m × {venue.depth}m × {venue.height}m
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowVenueSettingsModal(true)}
                className="flex-1 py-2 bg-panel-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-2 text-xs whitespace-nowrap"
                title="Capacity & Thresholds"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={handleSave}
                disabled={venueLoading}
                className="flex-1 py-2 bg-highlight text-white rounded-lg hover:bg-highlight-hover transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {venueLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500">No floorplan active</p>
            <p className="text-xs text-gray-600 mt-1">Select one from the library below</p>
          </div>
        )}
      </div>

      {/* Section 2: Settings (Collapsible) */}
      {venue && (
        <div className="bg-card-bg border border-border-dark rounded-lg overflow-hidden">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-300 hover:bg-panel-bg transition-colors"
          >
            <span className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Dimensions
            </span>
            {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          
          {showSettings && (
            <div className="p-4 pt-0 space-y-3 border-t border-border-dark">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={venue.name}
                  onChange={e => updateVenue({ name: e.target.value })}
                  className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Address</label>
                <AddressAutocomplete
                  value={venueList.find(v => v.id === venue.id)?.address}
                  onChange={async (result) => {
                    try {
                      await fetch(`${API_BASE}/api/venues/${venue.id}/address`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(result || { address: null, latitude: null, longitude: null, place_id: null }),
                      })
                      fetchVenueList()
                      addToast('success', result ? 'Address updated' : 'Address cleared')
                    } catch { addToast('error', 'Failed to update address') }
                  }}
                  placeholder="Search store address..."
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Width (m)</label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={venue.width}
                    onChange={e => updateVenue({ width: parseFloat(e.target.value) || 20 })}
                    className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Depth (m)</label>
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={venue.depth}
                    onChange={e => updateVenue({ depth: parseFloat(e.target.value) || 15 })}
                    className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Height (m)</label>
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={venue.height}
                    onChange={e => updateVenue({ height: parseFloat(e.target.value) || 4 })}
                    className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Grid Size</label>
                <select
                  value={venue.tileSize}
                  onChange={e => updateVenue({ tileSize: parseFloat(e.target.value) })}
                  className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
                >
                  <option value="0.5">0.5m</option>
                  <option value="1">1m</option>
                  <option value="2">2m</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section 3: Floorplan Library */}
      <div className="bg-card-bg border border-border-dark rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Radio className="w-4 h-4" />
            Floorplan Library
          </h3>
          {companies.length > 0 && (
            <select
              value={filterCompanyId}
              onChange={e => setFilterCompanyId(e.target.value)}
              className="bg-panel-bg border border-border-dark rounded px-2 py-1 text-[11px] text-gray-300 focus:border-highlight focus:outline-none max-w-[120px]"
            >
              <option value="all">All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div className="p-2 mb-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {floorplans.length === 0 ? (
          <div className="text-center py-6">
            <MapIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No floorplans yet</p>
            <p className="text-xs text-gray-600 mt-1">Import a DWG or create a manual venue</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {groupedFloorplans.map(group => {
              const isGroupExpanded = expandedCompanies.has(group.id) || expandedCompanies.has('all')
              const isCompanyGroup = group.id !== 'all'

              return (
                <div key={group.id}>
                  {/* Company group header */}
                  {isCompanyGroup && (
                    <button
                      onClick={() => toggleCompanyExpand(group.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors rounded hover:bg-white/5"
                    >
                      {isGroupExpanded ? (
                        <ChevronDown className="w-3 h-3 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 shrink-0" />
                      )}
                      <Building2 className="w-3 h-3 shrink-0 text-blue-400" />
                      <span className="font-medium truncate">{group.name}</span>
                      <span className="text-gray-600 ml-auto shrink-0">{group.items.length}</span>
                    </button>
                  )}

                  {/* Venue items */}
                  {(isGroupExpanded || !isCompanyGroup) && (
                    <div className={`space-y-1 ${isCompanyGroup ? 'ml-3 mt-1 mb-2' : ''}`}>
                      {group.items.length === 0 && isCompanyGroup ? (
                        <p className="text-[11px] text-gray-600 px-2 py-1 italic">No venues</p>
                      ) : (
                        group.items.map(fp => {
                          const isActive = 
                            (fp.type === 'dwg' && fp.layoutId === selectedLayoutId) ||
                            (fp.type === 'manual' && fp.venueId === venue?.id && !selectedLayoutId)
                          const venueItem = venueList.find(v => v.id === fp.venueId)
                          
                          return (
                            <button
                              key={fp.id}
                              onClick={() => fp.has3D && handleSelectFloorplan(fp)}
                              disabled={!fp.has3D}
                              className={`w-full text-left p-2.5 rounded-lg border transition-colors group ${
                                isActive
                                  ? 'bg-highlight/10 border-highlight text-white'
                                  : fp.has3D
                                  ? 'bg-panel-bg border-border-dark hover:border-gray-600 text-gray-300'
                                  : 'bg-panel-bg/50 border-border-dark/50 text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {isActive ? (
                                      <div className="w-2.5 h-2.5 rounded-full bg-highlight flex-shrink-0" />
                                    ) : (
                                      <div className="w-2.5 h-2.5 rounded-full border border-gray-600 flex-shrink-0" />
                                    )}
                                    <span className="text-sm font-medium truncate">{fp.name}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      fp.type === 'dwg' 
                                        ? 'bg-blue-500/20 text-blue-400' 
                                        : 'bg-purple-500/20 text-purple-400'
                                    }`}>
                                      {fp.type === 'dwg' ? 'DWG' : 'Manual'}
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5 ml-[18px]">
                                    {fp.dimensions.width}m × {fp.dimensions.depth}m
                                  </div>
                                  {venueItem?.address && (
                                    <div className="text-[11px] text-gray-600 mt-0.5 ml-[18px] truncate max-w-[200px]" title={venueItem.address}>
                                      {venueItem.address}
                                    </div>
                                  )}
                                </div>
                                {fp.venueId && (
                                  <button
                                    onClick={(e) => handleDeleteFloorplan(e, fp)}
                                    className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Create Actions */}
        <div className="flex gap-2 mt-3 pt-3 border-t border-border-dark">
          {onOpenDwgImporter && (
            <button
              onClick={onOpenDwgImporter}
              className="flex-1 py-2 px-3 bg-highlight/10 border border-highlight/30 text-highlight rounded-lg hover:bg-highlight/20 transition-colors flex items-center justify-center gap-1.5 text-xs whitespace-nowrap"
              title="Import DWG/DXF file"
            >
              <Plus className="w-3.5 h-3.5" />
              DWG
            </button>
          )}
          <button
            onClick={() => setShowNewManual(true)}
            className="flex-1 py-2 px-3 bg-panel-bg border border-border-dark text-gray-300 rounded-lg hover:bg-border-dark transition-colors flex items-center justify-center gap-1.5 text-xs whitespace-nowrap"
            title="Create manual venue"
          >
            <Plus className="w-3.5 h-3.5" />
            Manual
          </button>
        </div>
      </div>

      {/* New Manual Venue Modal */}
      {showNewManual && (
        <div className="bg-card-bg border border-highlight rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">Create Manual Venue</h3>
          <p className="text-xs text-gray-400">
            Create a simple rectangular venue without a DWG file.
          </p>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Venue Name</label>
            <input
              type="text"
              value={newVenueName}
              onChange={e => setNewVenueName(e.target.value)}
              placeholder="My Store"
              className="w-full bg-panel-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Address</label>
            <AddressAutocomplete
              value={newVenueAddress?.address}
              onChange={(result) => setNewVenueAddress(result)}
              placeholder="Search store address..."
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Width (m)</label>
              <input
                type="number"
                min="5"
                max="100"
                value={newVenueWidth}
                onChange={e => setNewVenueWidth(parseFloat(e.target.value) || 20)}
                className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Depth (m)</label>
              <input
                type="number"
                min="5"
                max="100"
                value={newVenueDepth}
                onChange={e => setNewVenueDepth(parseFloat(e.target.value) || 15)}
                className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Height (m)</label>
              <input
                type="number"
                min="2"
                max="20"
                value={newVenueHeight}
                onChange={e => setNewVenueHeight(parseFloat(e.target.value) || 4)}
                className="w-full bg-panel-bg border border-border-dark rounded px-2 py-1.5 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreateManual}
              className="flex-1 py-2 bg-highlight text-white rounded hover:bg-highlight-hover transition-colors text-sm"
            >
              Create
            </button>
            <button
              onClick={() => { setShowNewManual(false); setNewVenueAddress(null) }}
              className="flex-1 py-2 bg-border-dark text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Venue Settings Modal */}
      {venue && (
        <VenueSettingsPanel
          venueId={venue.id}
          venueName={venue.name}
          isOpen={showVenueSettingsModal}
          onClose={() => setShowVenueSettingsModal(false)}
        />
      )}
    </div>
  )
}
