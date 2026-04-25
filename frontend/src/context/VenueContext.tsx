import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { Venue, VenueObject, Vector3 } from '../types'
import { useToast } from './ToastContext'
import { v4 as uuidv4 } from 'uuid'

interface VenueListItem {
  id: string
  name: string
  width: number
  depth: number
  updatedAt: string
  company_id?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  place_id?: string | null
}

interface DwgBootstrapResult {
  venueDefaults: {
    width: number
    depth: number
    height: number
    tileSize: number
  }
  objectsDraft: VenueObject[]
  lidarDraft: unknown[]
  transform: {
    effectiveScale: number
    scaleCorrection?: number
    centerOffset: { x: number; z: number }
    shift?: { x: number; z: number }
    venueSize?: { width: number; depth: number }
    bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  }
  dwgMetadata: {
    layoutVersionId: string
    importId: string
    layoutName: string
  }
}

interface VenueContextType {
  venue: Venue | null
  objects: VenueObject[]
  venueList: VenueListItem[]
  selectedObjectId: string | null
  selectedObjectIds: Set<string>
  hoveredObjectId: string | null
  copiedObjects: VenueObject[]
  isLoading: boolean
  
  fetchVenueList: () => Promise<void>
  deleteVenue: (id: string) => Promise<void>
  createVenue: (name: string, width: number, depth: number, height: number, tileSize: number) => void
  createVenueFromDwg: (layoutVersionId: string, venueName: string, scaleCorrection?: number, onLidarsLoaded?: (lidars: unknown[]) => void) => Promise<void>
  updateVenue: (updates: Partial<Venue>) => void
  loadVenue: (id: string, onPlacementsLoaded?: (placements: unknown[]) => void) => Promise<void>
  saveVenue: (placements?: unknown[]) => Promise<void>
  exportVenue: (placements?: unknown[]) => string
  importVenue: (json: string) => void
  setObjects: (objects: VenueObject[]) => void
  
  addObject: (type: VenueObject['type'], position: Vector3, scale?: Vector3) => VenueObject
  addObjects: (newObjects: VenueObject[]) => void
  updateObject: (id: string, updates: Partial<VenueObject>) => void
  removeObject: (id: string) => void
  removeObjects: (ids: string[]) => void
  selectObject: (id: string | null) => void
  selectObjects: (ids: string[]) => void
  hoverObject: (id: string | null) => void
  toggleObjectSelection: (id: string) => void
  addToSelection: (id: string) => void
  clearSelection: () => void
  copySelectedObjects: () => void
  pasteObjects: () => void
  
  snapToGrid: (position: Vector3) => Vector3
}

const VenueContext = createContext<VenueContextType | null>(null)

const DEFAULT_OBJECT_SCALES: Record<VenueObject['type'], Vector3> = {
  shelf: { x: 2, y: 2, z: 0.6 },
  wall: { x: 4, y: 3, z: 0.2 },
  checkout: { x: 1.5, y: 1, z: 0.8 },
  entrance: { x: 2, y: 2.5, z: 0.1 },
  pillar: { x: 0.4, y: 3, z: 0.4 },
  digital_display: { x: 1.5, y: 2, z: 0.1 },
  radio: { x: 0.3, y: 0.3, z: 0.2 },
  custom: { x: 1, y: 1, z: 1 },
}

const DEFAULT_OBJECT_COLORS: Record<VenueObject['type'], string> = {
  shelf: '#6366f1',
  wall: '#64748b',
  checkout: '#22c55e',
  entrance: '#f59e0b',
  pillar: '#78716c',
  digital_display: '#3b82f6',
  radio: '#ef4444',
  custom: '#8b5cf6',
}

export function VenueProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast()
  const [venue, setVenue] = useState<Venue | null>(null)
  const [objects, setObjects] = useState<VenueObject[]>([])
  const [venueList, setVenueList] = useState<VenueListItem[]>([])
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(new Set())
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null)
  const [copiedObjects, setCopiedObjects] = useState<VenueObject[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchVenueList = useCallback(async () => {
    try {
      const res = await fetch('/api/venues')
      if (!res.ok) throw new Error('Failed to fetch venues')
      const data = await res.json()
      // Backend returns array directly
      setVenueList(Array.isArray(data) ? data : (data.venues || []))
    } catch (err) {
      console.error('Failed to fetch venue list:', err)
    }
  }, [])

  const deleteVenue = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/venues/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete venue')
      setVenueList(prev => prev.filter(v => v.id !== id))
      if (venue?.id === id) {
        setVenue(null)
        setObjects([])
      }
      addToast('success', 'Venue deleted')
    } catch (err) {
      addToast('error', `Failed to delete venue: ${err}`)
    }
  }, [venue, addToast])

  const snapToGrid = useCallback((position: Vector3): Vector3 => {
    if (!venue) return position
    const ts = venue.tileSize
    return {
      x: Math.round(position.x / ts) * ts,
      y: position.y,
      z: Math.round(position.z / ts) * ts,
    }
  }, [venue])

  const createVenue = useCallback((name: string, width: number, depth: number, height: number, tileSize: number) => {
    const newVenue: Venue = {
      id: uuidv4(),
      name,
      width,
      depth,
      height,
      tileSize,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setVenue(newVenue)
    setObjects([])
    setSelectedObjectId(null)
    addToast('success', `Created venue: ${name}`)
  }, [addToast])

  const createVenueFromDwg = useCallback(async (
    layoutVersionId: string, 
    venueName: string,
    scaleCorrection: number = 1.0,
    onLidarsLoaded?: (lidars: unknown[]) => void
  ) => {
    setIsLoading(true)
    try {
      // Step 1: Fetch DWG bootstrap data (STATELESS - doesn't create anything)
      const bootstrapUrl = `/api/dwg/layout/${layoutVersionId}/as-venue-bootstrap?scaleCorrection=${scaleCorrection}`
      console.log(`[DWG Venue Bootstrap] Calling: ${bootstrapUrl}`)
      const bootstrapRes = await fetch(bootstrapUrl)
      if (!bootstrapRes.ok) {
        const err = await bootstrapRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to fetch DWG bootstrap data')
      }
      const bootstrap: DwgBootstrapResult = await bootstrapRes.json()
      
      // DEBUG: Log first 5 objects to compare with Layout3DPreview
      console.log('[DWG Venue Bootstrap] Received objects:')
      bootstrap.objectsDraft.slice(0, 5).forEach((obj, i) => {
        console.log(`  Object #${i}: "${obj.name}" type=${obj.type}`)
        console.log(`    position: x=${obj.position.x.toFixed(3)}, z=${obj.position.z.toFixed(3)}`)
        console.log(`    scale: x=${obj.scale.x.toFixed(3)}, y=${obj.scale.y.toFixed(3)}, z=${obj.scale.z.toFixed(3)}`)
        console.log(`    rotation: y=${(obj.rotation.y * 180 / Math.PI).toFixed(1)}°`)
      })
      console.log(`  Total objects: ${bootstrap.objectsDraft.length}`)
      console.log(`  Venue dimensions: ${bootstrap.venueDefaults.width}m x ${bootstrap.venueDefaults.depth}m x ${bootstrap.venueDefaults.height}m`)
      
      // Step 2: Create a new venue with DWG metadata
      const newVenueId = uuidv4()
      const now = new Date().toISOString()
      const newVenue: Venue = {
        id: newVenueId,
        name: venueName || bootstrap.dwgMetadata.layoutName || 'DWG Venue',
        width: bootstrap.venueDefaults.width,
        depth: bootstrap.venueDefaults.depth,
        height: bootstrap.venueDefaults.height,
        tileSize: bootstrap.venueDefaults.tileSize,
        createdAt: now,
        updatedAt: now,
        scene_source: 'dwg',
        dwg_layout_version_id: bootstrap.dwgMetadata.layoutVersionId,
        dwg_transform_json: JSON.stringify({ scaleCorrection: bootstrap.transform?.scaleCorrection || scaleCorrection }),
      }
      
      // Step 3: Update objects with the new venue ID and apply default colors
      const venueObjects: VenueObject[] = bootstrap.objectsDraft.map(obj => ({
        ...obj,
        venueId: newVenueId,
        color: obj.color || DEFAULT_OBJECT_COLORS[obj.type as keyof typeof DEFAULT_OBJECT_COLORS] || DEFAULT_OBJECT_COLORS.custom,
      }))
      
      // Step 4: Set state (same as manual mode from this point)
      setVenue(newVenue)
      setObjects(venueObjects)
      setSelectedObjectId(null)
      setSelectedObjectIds(new Set())
      
      // Step 5: Notify about LiDAR placements if callback provided
      if (onLidarsLoaded && bootstrap.lidarDraft.length > 0) {
        // Update lidar placements with new venue ID
        const lidarPlacements = bootstrap.lidarDraft.map((lidar) => ({
          ...(lidar as Record<string, unknown>),
          venueId: newVenueId,
        }))
        onLidarsLoaded(lidarPlacements)
      }
      
      addToast('success', `Created venue from DWG: ${newVenue.name} (${venueObjects.length} objects)`)
      
    } catch (err) {
      console.error('Failed to create venue from DWG:', err)
      addToast('error', `Failed to create venue from DWG: ${err}`)
    } finally {
      setIsLoading(false)
    }
  }, [addToast])

  const updateVenue = useCallback((updates: Partial<Venue>) => {
    setVenue(prev => prev ? { ...prev, ...updates, updatedAt: new Date().toISOString() } : null)
  }, [])

  const loadVenue = useCallback(async (id: string, onPlacementsLoaded?: (placements: unknown[]) => void) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/venues/${id}`)
      if (!res.ok) throw new Error('Failed to load venue')
      const data = await res.json()
      
      const loadedVenue = data.venue
      const loadedObjects = data.objects || []
      
      // ── AUTO-REBOOTSTRAP: Fix DWG venues ──
      // Re-bootstrap when bootstrap version is outdated or data is missing.
      // Bump CURRENT_BOOTSTRAP_VERSION when bootstrap logic changes.
      const CURRENT_BOOTSTRAP_VERSION = 6  // v6: DWG venue geometry stays in real meters
      const isDwg = loadedVenue.scene_source === 'dwg' || !!loadedVenue.dwg_layout_version_id
      const isAbsurd = Math.max(loadedVenue.width || 0, loadedVenue.depth || 0) > 500
      const lacksPolygonData = loadedObjects.length > 0 && !loadedObjects.some(
        (o: any) => o.metadata?.dwg_footprint_points?.length > 0
      )
      const firstDwgObj = loadedObjects.find((o: any) => o.metadata?.source === 'dwg')
      const storedVersion = firstDwgObj?.metadata?.dwg_bootstrap_version || 0
      const isOutdated = storedVersion < CURRENT_BOOTSTRAP_VERSION
      const needsRebootstrap = isAbsurd || lacksPolygonData || isOutdated
      
      if (isDwg && needsRebootstrap && loadedVenue.dwg_layout_version_id) {
        console.log(`[VenueContext] DWG venue needs rebootstrap (absurd=${isAbsurd}, lacksPolygon=${lacksPolygonData}, dims=${loadedVenue.width}×${loadedVenue.depth}m). Rebootstrapping...`)
        try {
          // Read scaleCorrection from localStorage (same as DwgImporterPage)
          let sc = 1.0
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith('dwg-autoplace-settings-')) {
              try {
                const parsed = JSON.parse(localStorage.getItem(key) || '{}')
                if (parsed.scaleCorrection) { sc = parsed.scaleCorrection; break }
              } catch { /* ignore */ }
            }
          }
          
          const bsUrl = `/api/dwg/layout/${loadedVenue.dwg_layout_version_id}/as-venue-bootstrap?scaleCorrection=${sc}`
          const bsRes = await fetch(bsUrl)
          if (bsRes.ok) {
            const bs = await bsRes.json()
            console.log(`[VenueContext] Rebootstrap: ${bs.venueDefaults.width}×${bs.venueDefaults.depth}m, ${bs.objectsDraft.length} objects`)
            
            // Update venue dimensions in-place (keep same ID)
            const fixedVenue = {
              ...loadedVenue,
              width: bs.venueDefaults.width,
              depth: bs.venueDefaults.depth,
              dwg_transform_json: JSON.stringify({ scaleCorrection: bs.transform?.scaleCorrection || sc }),
              updatedAt: new Date().toISOString(),
            }
            
            // Apply default colors to new objects
            const fixedObjects = bs.objectsDraft.map((obj: VenueObject) => ({
              ...obj,
              venueId: id,
              color: obj.color || DEFAULT_OBJECT_COLORS[obj.type as keyof typeof DEFAULT_OBJECT_COLORS] || DEFAULT_OBJECT_COLORS.custom,
            }))
            
            // Save fixed data to backend
            await fetch(`/api/venues/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ venue: fixedVenue, objects: fixedObjects }),
            })
            
            setVenue(fixedVenue)
            setObjects(fixedObjects)
            setSelectedObjectId(null)
            if (onPlacementsLoaded && data.placements) {
              onPlacementsLoaded(data.placements)
            }
            // Refresh venue list so Floorplan Library shows correct dimensions
            setVenueList(prev => prev.map(v => 
              v.id === id ? { ...v, width: fixedVenue.width, depth: fixedVenue.depth } : v
            ))
            addToast('success', `Rebootstrapped DWG venue: ${fixedVenue.width}×${fixedVenue.depth}m, ${fixedObjects.length} objects`)
            return
          }
        } catch (rebootErr) {
          console.warn('[VenueContext] Rebootstrap failed, loading original data:', rebootErr)
        }
      }
      
      // Normal load path
      console.log('%c[FLOW-DEBUG] VenueContext.loadVenue completed', 'color:#8b5cf6;font-weight:bold', {
        venueId: loadedVenue.id,
        venueName: loadedVenue.name,
        isDwg: loadedVenue.scene_source === 'dwg' || !!loadedVenue.dwg_layout_version_id,
        dwgLayoutVersionId: loadedVenue.dwg_layout_version_id,
        dimensions: `${loadedVenue.width}×${loadedVenue.depth}m`,
        objectCount: loadedObjects.length,
        placementsCount: data.placements?.length || 0,
        objectsByType: loadedObjects.reduce((acc: Record<string, number>, o: any) => {
          acc[o.type] = (acc[o.type] || 0) + 1
          return acc
        }, {}),
      })
      setVenue(loadedVenue)
      setObjects(loadedObjects)
      setSelectedObjectId(null)
      if (onPlacementsLoaded && data.placements) {
        console.log('%c[FLOW-DEBUG] Passing placements to callback (lidar_placements table)', 'color:#8b5cf6', {
          count: data.placements.length,
        })
        onPlacementsLoaded(data.placements)
      }
      addToast('success', `Loaded venue: ${loadedVenue.name}`)
    } catch (err) {
      addToast('error', `Failed to load venue: ${err}`)
    } finally {
      setIsLoading(false)
    }
  }, [addToast])

  const saveVenue = useCallback(async (placements?: unknown[]) => {
    if (!venue) return
    setIsLoading(true)
    try {
      const payload: { venue: Venue; objects: VenueObject[]; placements?: unknown[] } = { venue, objects }
      if (placements) {
        payload.placements = placements
      }
      const res = await fetch(`/api/venues/${venue.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.details || 'Failed to save venue')
      }
      addToast('success', 'Venue saved successfully')
    } catch (err) {
      addToast('error', `Failed to save venue: ${err}`)
    } finally {
      setIsLoading(false)
    }
  }, [venue, objects, addToast])

  const exportVenue = useCallback((placements?: unknown[]): string => {
    return JSON.stringify({ venue, objects, placements: placements || [] }, null, 2)
  }, [venue, objects])

  const importVenue = useCallback((json: string) => {
    try {
      const data = JSON.parse(json)
      if (!data.venue) throw new Error('Invalid venue data')
      setVenue({ ...data.venue, id: uuidv4() })
      setObjects((data.objects || []).map((o: VenueObject) => ({ ...o, id: uuidv4() })))
      setSelectedObjectId(null)
      addToast('success', `Imported venue: ${data.venue.name}`)
    } catch (err) {
      addToast('error', `Failed to import: ${err}`)
    }
  }, [addToast])

  const addObject = useCallback((type: VenueObject['type'], position: Vector3, scale?: Vector3): VenueObject => {
    const obj: VenueObject = {
      id: uuidv4(),
      venueId: venue?.id || '',
      type,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${objects.length + 1}`,
      position: snapToGrid(position),
      rotation: { x: 0, y: 0, z: 0 },
      scale: scale ? { ...scale } : { ...DEFAULT_OBJECT_SCALES[type] },
      color: DEFAULT_OBJECT_COLORS[type],
    }
    setObjects(prev => [...prev, obj])
    setSelectedObjectId(obj.id)
    
    // Dispatch event so MainViewport can auto-zoom and highlight the new object
    window.dispatchEvent(new CustomEvent('venue-object-added', { 
      detail: { objectId: obj.id, position: obj.position, scale: obj.scale }
    }))
    
    return obj
  }, [venue, objects, snapToGrid])

  const updateObject = useCallback((id: string, updates: Partial<VenueObject>) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o))
  }, [])

  const addObjects = useCallback((newObjects: VenueObject[]) => {
    setObjects(prev => [...prev, ...newObjects])
    // Select all newly added objects
    const newIds = new Set(newObjects.map(o => o.id))
    setSelectedObjectIds(newIds)
    setSelectedObjectId(newObjects.length > 0 ? newObjects[0].id : null)
  }, [])

  const removeObject = useCallback((id: string) => {
    setObjects(prev => prev.filter(o => o.id !== id))
    setSelectedObjectIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (selectedObjectId === id) setSelectedObjectId(null)
    // Auto-persist deletion to DB
    if (venue) {
      fetch(`/api/venues/${venue.id}/objects/${id}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [selectedObjectId, venue])

  const removeObjects = useCallback((ids: string[]) => {
    const idsSet = new Set(ids)
    setObjects(prev => prev.filter(o => !idsSet.has(o.id)))
    setSelectedObjectIds(new Set())
    setSelectedObjectId(null)
    // Auto-persist deletions to DB
    if (venue && ids.length > 0) {
      fetch(`/api/venues/${venue.id}/objects/delete-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }).catch(() => {})
    }
  }, [venue])

  const selectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
    setSelectedObjectIds(id ? new Set([id]) : new Set())
  }, [])

  const selectObjects = useCallback((ids: string[]) => {
    setSelectedObjectIds(new Set(ids))
    setSelectedObjectId(ids[0] || null)
  }, [])

  const hoverObject = useCallback((id: string | null) => {
    setHoveredObjectId(id)
  }, [])

  const toggleObjectSelection = useCallback((id: string) => {
    setSelectedObjectIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      // Update single selectedObjectId to match
      if (next.size === 1) {
        setSelectedObjectId(Array.from(next)[0])
      } else if (next.size === 0) {
        setSelectedObjectId(null)
      } else {
        setSelectedObjectId(id) // Most recent selection
      }
      return next
    })
  }, [])

  const addToSelection = useCallback((id: string) => {
    setSelectedObjectIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setSelectedObjectId(id)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedObjectIds(new Set())
    setSelectedObjectId(null)
  }, [])

  const copySelectedObjects = useCallback(() => {
    const toCopy = objects.filter(o => selectedObjectIds.has(o.id))
    setCopiedObjects(toCopy)
  }, [objects, selectedObjectIds])

  const pasteObjects = useCallback(() => {
    if (copiedObjects.length === 0) return
    
    // Create new objects with new IDs and offset position
    const offset = 1 // 1 meter offset
    const newObjects: VenueObject[] = copiedObjects.map(obj => ({
      ...obj,
      id: uuidv4(),
      name: `${obj.name} (copy)`,
      position: {
        x: obj.position.x + offset,
        y: obj.position.y,
        z: obj.position.z + offset,
      },
    }))
    
    addObjects(newObjects)
  }, [copiedObjects, addObjects])

  return (
    <VenueContext.Provider value={{
      venue,
      objects,
      venueList,
      selectedObjectId,
      selectedObjectIds,
      hoveredObjectId,
      copiedObjects,
      isLoading,
      fetchVenueList,
      deleteVenue,
      createVenue,
      createVenueFromDwg,
      updateVenue,
      loadVenue,
      saveVenue,
      exportVenue,
      importVenue,
      setObjects,
      addObject,
      addObjects,
      updateObject,
      removeObject,
      removeObjects,
      selectObject,
      selectObjects,
      hoverObject,
      toggleObjectSelection,
      addToSelection,
      clearSelection,
      copySelectedObjects,
      pasteObjects,
      snapToGrid,
    }}>
      {children}
    </VenueContext.Provider>
  )
}

export function useVenue() {
  const context = useContext(VenueContext)
  if (!context) {
    throw new Error('useVenue must be used within a VenueProvider')
  }
  return context
}
