import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { RegionOfInterest, Vector2 } from '../types'
import { useToast } from './ToastContext'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface RoiContextType {
  regions: RegionOfInterest[]
  selectedRoiId: string | null
  isDrawing: boolean
  drawingVertices: Vector2[]
  kpiPopupRoiId: string | null
  showKPIOverlays: boolean
  hiddenRoiIds: Set<string>
  currentDwgLayoutId: string | null
  
  loadRegions: (venueId: string, dwgLayoutId?: string | null) => Promise<void>
  toggleRoiVisibility: (roiId: string) => void
  isRoiVisible: (roiId: string) => boolean
  createRegion: (venueId: string, name: string, vertices: Vector2[], color?: string, dwgLayoutId?: string | null) => Promise<RegionOfInterest | null>
  updateRegion: (id: string, updates: Partial<RegionOfInterest>) => Promise<void>
  deleteRegion: (id: string) => Promise<void>
  selectRegion: (id: string | null) => void
  
  startDrawing: () => void
  addDrawingVertex: (vertex: Vector2) => void
  removeLastVertex: () => void
  finishDrawing: (venueId: string, name: string, color?: string, dwgLayoutId?: string | null) => Promise<RegionOfInterest | null>
  cancelDrawing: () => void
  
  updateVertexPosition: (roiId: string, vertexIndex: number, position: Vector2) => void
  
  openKPIPopup: (roiId: string) => void
  closeKPIPopup: () => void
  toggleKPIOverlays: () => void
  hideKPIOverlays: () => void
}

const RoiContext = createContext<RoiContextType | null>(null)

const ROI_COLORS = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#22c55e', // green
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
]

export function RoiProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast()
  const [regions, setRegions] = useState<RegionOfInterest[]>([])
  const [selectedRoiId, setSelectedRoiId] = useState<string | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawingVertices, setDrawingVertices] = useState<Vector2[]>([])
  const [kpiPopupRoiId, setKpiPopupRoiId] = useState<string | null>(null)
  const [showKPIOverlays, setShowKPIOverlays] = useState(false)
  const [hiddenRoiIds, setHiddenRoiIds] = useState<Set<string>>(new Set())
  const [currentDwgLayoutId, setCurrentDwgLayoutId] = useState<string | null>(null)

  const toggleRoiVisibility = useCallback((roiId: string) => {
    setHiddenRoiIds(prev => {
      const next = new Set(prev)
      if (next.has(roiId)) {
        next.delete(roiId)
      } else {
        next.add(roiId)
      }
      return next
    })
  }, [])

  const isRoiVisible = useCallback((roiId: string) => {
    return !hiddenRoiIds.has(roiId)
  }, [hiddenRoiIds])

  const toggleKPIOverlays = useCallback(() => {
    setShowKPIOverlays(prev => !prev)
  }, [])

  const hideKPIOverlays = useCallback(() => {
    setShowKPIOverlays(false)
  }, [])

  const loadRegions = useCallback(async (venueId: string, dwgLayoutId?: string | null) => {
    try {
      // Use different endpoint for DWG vs manual mode
      const url = dwgLayoutId
        ? `${API_BASE}/api/venues/${venueId}/dwg/${dwgLayoutId}/roi`
        : `${API_BASE}/api/venues/${venueId}/roi`
      
      console.log(`[RoiContext] Loading regions from: ${url}`)
      
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load regions')
      const data = await res.json()
      
      console.log(`[RoiContext] Loaded ${data.length} ROIs for ${dwgLayoutId ? 'DWG mode' : 'manual mode'}`)
      if (data.length > 0) {
        console.log(`[RoiContext] First ROI: "${data[0].name}" at (${data[0].vertices[0]?.x?.toFixed(2)}, ${data[0].vertices[0]?.z?.toFixed(2)})`)
      }
      
      setRegions(data)
      setCurrentDwgLayoutId(dwgLayoutId || null)
    } catch (err) {
      console.error('Failed to load ROIs:', err)
    }
  }, [])

  const createRegion = useCallback(async (
    venueId: string, 
    name: string, 
    vertices: Vector2[], 
    color?: string,
    dwgLayoutId?: string | null
  ): Promise<RegionOfInterest | null> => {
    try {
      // Use different endpoint for DWG vs manual mode
      const url = dwgLayoutId
        ? `${API_BASE}/api/venues/${venueId}/dwg/${dwgLayoutId}/roi`
        : `${API_BASE}/api/venues/${venueId}/roi`
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          vertices,
          color: color || ROI_COLORS[regions.length % ROI_COLORS.length],
          opacity: 0.5,
        }),
      })
      if (!res.ok) throw new Error('Failed to create region')
      const roi = await res.json()
      setRegions(prev => [...prev, roi])
      addToast('success', `Region "${name}" created`)
      return roi
    } catch (err) {
      addToast('error', 'Failed to create region')
      return null
    }
  }, [regions.length, addToast])

  const updateRegion = useCallback(async (id: string, updates: Partial<RegionOfInterest>) => {
    try {
      const res = await fetch(`${API_BASE}/api/roi/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to update region')
      const updated = await res.json()
      setRegions(prev => prev.map(r => r.id === id ? updated : r))
    } catch (err) {
      addToast('error', 'Failed to update region')
    }
  }, [addToast])

  const deleteRegion = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/roi/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete region')
      setRegions(prev => prev.filter(r => r.id !== id))
      if (selectedRoiId === id) setSelectedRoiId(null)
      addToast('success', 'Region deleted')
    } catch (err) {
      addToast('error', 'Failed to delete region')
    }
  }, [selectedRoiId, addToast])

  const selectRegion = useCallback((id: string | null) => {
    setSelectedRoiId(id)
  }, [])

  const startDrawing = useCallback(() => {
    setIsDrawing(true)
    setDrawingVertices([])
    setSelectedRoiId(null)
  }, [])

  const addDrawingVertex = useCallback((vertex: Vector2) => {
    setDrawingVertices(prev => [...prev, vertex])
  }, [])

  const removeLastVertex = useCallback(() => {
    setDrawingVertices(prev => prev.slice(0, -1))
  }, [])

  const finishDrawing = useCallback(async (
    venueId: string, 
    name: string, 
    color?: string,
    dwgLayoutId?: string | null
  ): Promise<RegionOfInterest | null> => {
    if (drawingVertices.length < 3) {
      addToast('error', 'Need at least 3 vertices to create a region')
      return null
    }
    
    const roi = await createRegion(venueId, name, drawingVertices, color, dwgLayoutId)
    setIsDrawing(false)
    setDrawingVertices([])
    return roi
  }, [drawingVertices, createRegion, addToast])

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false)
    setDrawingVertices([])
  }, [])

  const updateVertexPosition = useCallback(async (roiId: string, vertexIndex: number, position: Vector2) => {
    // Update local state immediately for responsive UI
    const updatedRegion = regions.find(r => r.id === roiId)
    if (!updatedRegion) return
    
    const newVertices = [...updatedRegion.vertices]
    newVertices[vertexIndex] = position
    
    setRegions(prev => prev.map(r => {
      if (r.id !== roiId) return r
      return { ...r, vertices: newVertices }
    }))
    
    // Persist to database
    try {
      await fetch(`${API_BASE}/api/roi/${roiId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vertices: newVertices })
      })
    } catch (err) {
      console.error('Failed to save vertex position:', err)
    }
  }, [regions])

  const openKPIPopup = useCallback((roiId: string) => {
    setKpiPopupRoiId(roiId)
  }, [])

  const closeKPIPopup = useCallback(() => {
    setKpiPopupRoiId(null)
  }, [])

  return (
    <RoiContext.Provider value={{
      regions,
      selectedRoiId,
      isDrawing,
      drawingVertices,
      kpiPopupRoiId,
      showKPIOverlays,
      hiddenRoiIds,
      currentDwgLayoutId,
      loadRegions,
      toggleRoiVisibility,
      isRoiVisible,
      createRegion,
      updateRegion,
      deleteRegion,
      selectRegion,
      startDrawing,
      addDrawingVertex,
      removeLastVertex,
      finishDrawing,
      cancelDrawing,
      updateVertexPosition,
      openKPIPopup,
      closeKPIPopup,
      toggleKPIOverlays,
      hideKPIOverlays,
    }}>
      {children}
    </RoiContext.Provider>
  )
}

export function useRoi() {
  const context = useContext(RoiContext)
  if (!context) {
    throw new Error('useRoi must be used within a RoiProvider')
  }
  return context
}
