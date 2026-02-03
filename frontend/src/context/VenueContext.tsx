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
}

interface VenueContextType {
  venue: Venue | null
  objects: VenueObject[]
  venueList: VenueListItem[]
  selectedObjectId: string | null
  isLoading: boolean
  
  fetchVenueList: () => Promise<void>
  deleteVenue: (id: string) => Promise<void>
  createVenue: (name: string, width: number, depth: number, height: number, tileSize: number) => void
  updateVenue: (updates: Partial<Venue>) => void
  loadVenue: (id: string, onPlacementsLoaded?: (placements: unknown[]) => void) => Promise<void>
  saveVenue: (placements?: unknown[]) => Promise<void>
  exportVenue: (placements?: unknown[]) => string
  importVenue: (json: string) => void
  setObjects: (objects: VenueObject[]) => void
  
  addObject: (type: VenueObject['type'], position: Vector3, scale?: Vector3) => VenueObject
  updateObject: (id: string, updates: Partial<VenueObject>) => void
  removeObject: (id: string) => void
  selectObject: (id: string | null) => void
  
  snapToGrid: (position: Vector3) => Vector3
}

const VenueContext = createContext<VenueContextType | null>(null)

const DEFAULT_VENUE: Venue = {
  id: '',
  name: 'New Venue',
  width: 20,
  depth: 15,
  height: 4,
  tileSize: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const DEFAULT_OBJECT_SCALES: Record<VenueObject['type'], Vector3> = {
  shelf: { x: 2, y: 2, z: 0.6 },
  wall: { x: 4, y: 3, z: 0.2 },
  checkout: { x: 1.5, y: 1, z: 0.8 },
  entrance: { x: 2, y: 2.5, z: 0.1 },
  pillar: { x: 0.4, y: 3, z: 0.4 },
  custom: { x: 1, y: 1, z: 1 },
}

const DEFAULT_OBJECT_COLORS: Record<VenueObject['type'], string> = {
  shelf: '#6366f1',
  wall: '#64748b',
  checkout: '#22c55e',
  entrance: '#f59e0b',
  pillar: '#78716c',
  custom: '#8b5cf6',
}

export function VenueProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast()
  const [venue, setVenue] = useState<Venue | null>(null)
  const [objects, setObjects] = useState<VenueObject[]>([])
  const [venueList, setVenueList] = useState<VenueListItem[]>([])
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
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

  const updateVenue = useCallback((updates: Partial<Venue>) => {
    setVenue(prev => prev ? { ...prev, ...updates, updatedAt: new Date().toISOString() } : null)
  }, [])

  const loadVenue = useCallback(async (id: string, onPlacementsLoaded?: (placements: unknown[]) => void) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/venues/${id}`)
      if (!res.ok) throw new Error('Failed to load venue')
      const data = await res.json()
      setVenue(data.venue)
      setObjects(data.objects || [])
      setSelectedObjectId(null)
      if (onPlacementsLoaded && data.placements) {
        onPlacementsLoaded(data.placements)
      }
      addToast('success', `Loaded venue: ${data.venue.name}`)
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
    return obj
  }, [venue, objects, snapToGrid])

  const updateObject = useCallback((id: string, updates: Partial<VenueObject>) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o))
  }, [])

  const removeObject = useCallback((id: string) => {
    setObjects(prev => prev.filter(o => o.id !== id))
    if (selectedObjectId === id) setSelectedObjectId(null)
  }, [selectedObjectId])

  const selectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
  }, [])

  return (
    <VenueContext.Provider value={{
      venue,
      objects,
      venueList,
      selectedObjectId,
      isLoading,
      fetchVenueList,
      deleteVenue,
      createVenue,
      updateVenue,
      loadVenue,
      saveVenue,
      exportVenue,
      importVenue,
      setObjects,
      addObject,
      updateObject,
      removeObject,
      selectObject,
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
