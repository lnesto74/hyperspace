import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { useVenue } from './VenueContext'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export interface SkuItem {
  id: string
  catalogId: string
  skuCode: string
  name: string
  brand: string | null
  category: string | null
  subcategory: string | null
  size: string | null
  widthM: number | null
  heightM: number | null
  depthM: number | null
  price: number | null
  margin: number | null
  imageUrl: string | null
}

export interface SkuCatalog {
  id: string
  name: string
  description: string | null
  items: SkuItem[]
  categories: string[]
  brands: string[]
}

export interface SlotData {
  slotIndex: number
  skuItemId: string | null
  facingSpan: number
}

export interface LevelData {
  levelIndex: number
  slots: SlotData[]
}

export interface SlotsStructure {
  levels: LevelData[]
}

export type SlotFacing = 'front' | 'back' | 'left' | 'right'

export interface ShelfPlanogram {
  id: string
  planogramId: string
  shelfId: string
  numLevels: number
  slotWidthM: number
  levelHeightM: number | null
  slotFacings: SlotFacing[]
  slots: SlotsStructure
}

export interface Planogram {
  id: string
  venueId: string
  name: string
  version: number
  status: string
  createdAt: string
  updatedAt: string
  shelves: ShelfPlanogram[]
}

interface PlanogramContextType {
  // Catalogs
  catalogs: SkuCatalog[]
  activeCatalog: SkuCatalog | null
  loadCatalogs: () => Promise<void>
  loadCatalog: (id: string) => Promise<void>
  importCatalog: (file: File, name?: string) => Promise<void>
  deleteCatalog: (id: string) => Promise<void>
  
  // Planograms
  planograms: Planogram[]
  activePlanogram: Planogram | null
  loadPlanograms: () => Promise<void>
  loadPlanogram: (id: string) => Promise<void>
  createPlanogram: (name: string) => Promise<Planogram>
  deletePlanogram: (id: string) => Promise<void>
  duplicatePlanogram: (id: string) => Promise<void>
  
  // Shelf operations
  activeShelfId: string | null
  setActiveShelfId: (id: string | null) => void
  activeShelfPlanogram: ShelfPlanogram | null
  loadShelfPlanogram: (shelfId: string) => Promise<void>
  saveShelfPlanogram: (shelfId: string, data: Partial<ShelfPlanogram>) => Promise<void>
  placeSkusOnShelf: (shelfId: string, skuItemIds: string[], dropTarget: any, shelfWidth: number, options?: { fillOrder?: 'sequential' | 'random' }) => Promise<any>
  autoFillShelf: (shelfId: string, params: any) => Promise<any>
  
  // Selection
  selectedSkuIds: string[]
  setSelectedSkuIds: (ids: string[]) => void
  toggleSkuSelection: (id: string) => void
  
  // Filters
  categoryFilter: string | null
  setCategoryFilter: (cat: string | null) => void
  brandFilter: string | null
  setBrandFilter: (brand: string | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  
  // Filtered items
  filteredSkuItems: SkuItem[]
  
  // Placed SKUs tracking
  placedSkuIds: Set<string>
  getSkuPlacement: (skuId: string) => { shelfId: string; shelfName: string; levelIndex: number; slotIndex: number } | null
  removeSkuFromSlot: (skuId: string) => Promise<void>
  
  // Loading states
  loading: boolean
  
  // Hover state for SKU highlighting
  hoveredSkuId: string | null
  setHoveredSkuId: (id: string | null) => void
}

const PlanogramContext = createContext<PlanogramContextType | null>(null)

export function PlanogramProvider({ children }: { children: ReactNode }) {
  const { venue } = useVenue()
  
  // Catalogs
  const [catalogs, setCatalogs] = useState<SkuCatalog[]>([])
  const [activeCatalog, setActiveCatalog] = useState<SkuCatalog | null>(null)
  
  // Planograms
  const [planograms, setPlanograms] = useState<Planogram[]>([])
  const [activePlanogram, setActivePlanogram] = useState<Planogram | null>(null)
  
  // Shelf
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null)
  const [activeShelfPlanogram, setActiveShelfPlanogram] = useState<ShelfPlanogram | null>(null)
  
  // Selection
  const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>([])
  
  // Filters
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Loading
  const [loading, setLoading] = useState(false)
  
  // Hover state for SKU highlighting across components
  const [hoveredSkuId, setHoveredSkuId] = useState<string | null>(null)
  
  // Track all placed SKUs across shelves in active planogram
  const [allShelfPlanograms, setAllShelfPlanograms] = useState<Map<string, ShelfPlanogram>>(new Map())
  
  // Load catalogs
  const loadCatalogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/planogram/sku-catalogs`)
      const data = await res.json()
      setCatalogs(data)
    } catch (err) {
      console.error('Failed to load catalogs:', err)
    }
  }, [])
  
  // Load single catalog with items
  const loadCatalog = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/planogram/sku-catalogs/${id}`)
      const data = await res.json()
      setActiveCatalog(data)
    } catch (err) {
      console.error('Failed to load catalog:', err)
    }
    setLoading(false)
  }, [])
  
  // Import catalog from file
  const importCatalog = useCallback(async (file: File, name?: string) => {
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (name) formData.append('name', name)
      
      const res = await fetch(`${API_BASE}/api/planogram/sku-catalogs/import`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      
      if (res.ok) {
        await loadCatalogs()
        await loadCatalog(data.id)
      } else {
        throw new Error(data.error)
      }
    } catch (err) {
      console.error('Failed to import catalog:', err)
      throw err
    }
    setLoading(false)
  }, [loadCatalogs, loadCatalog])
  
  // Delete catalog
  const deleteCatalog = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/planogram/sku-catalogs/${id}`, { method: 'DELETE' })
      await loadCatalogs()
      if (activeCatalog?.id === id) {
        setActiveCatalog(null)
      }
    } catch (err) {
      console.error('Failed to delete catalog:', err)
    }
  }, [loadCatalogs, activeCatalog])
  
  // Load planograms for venue
  const loadPlanograms = useCallback(async () => {
    if (!venue?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/planogram/venues/${venue.id}/planograms`)
      const data = await res.json()
      setPlanograms(data)
    } catch (err) {
      console.error('Failed to load planograms:', err)
    }
  }, [venue?.id])
  
  // Load single planogram with shelves
  const loadPlanogram = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/planogram/planograms/${id}`)
      const data = await res.json()
      setActivePlanogram(data)
    } catch (err) {
      console.error('Failed to load planogram:', err)
    }
    setLoading(false)
  }, [])
  
  // Create planogram
  const createPlanogram = useCallback(async (name: string) => {
    if (!venue?.id) throw new Error('No venue selected')
    const res = await fetch(`${API_BASE}/api/planogram/venues/${venue.id}/planograms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    await loadPlanograms()
    return data
  }, [venue?.id, loadPlanograms])
  
  // Delete planogram
  const deletePlanogram = useCallback(async (id: string) => {
    await fetch(`${API_BASE}/api/planogram/planograms/${id}`, { method: 'DELETE' })
    await loadPlanograms()
    if (activePlanogram?.id === id) {
      setActivePlanogram(null)
    }
  }, [loadPlanograms, activePlanogram])
  
  // Duplicate planogram
  const duplicatePlanogram = useCallback(async (id: string) => {
    await fetch(`${API_BASE}/api/planogram/planograms/${id}/duplicate`, { method: 'POST' })
    await loadPlanograms()
  }, [loadPlanograms])
  
  // Load shelf planogram
  const loadShelfPlanogram = useCallback(async (shelfId: string) => {
    if (!activePlanogram?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/planogram/planograms/${activePlanogram.id}/shelves/${shelfId}`)
      const data = await res.json()
      setActiveShelfPlanogram(data)
      // Update cache for placed SKU tracking
      if (data) {
        setAllShelfPlanograms(prev => {
          const next = new Map(prev)
          next.set(shelfId, data)
          return next
        })
      }
    } catch (err) {
      console.error('Failed to load shelf planogram:', err)
    }
  }, [activePlanogram?.id])
  
  // Save shelf planogram
  const saveShelfPlanogram = useCallback(async (shelfId: string, data: Partial<ShelfPlanogram>) => {
    if (!activePlanogram?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/planogram/planograms/${activePlanogram.id}/shelves/${shelfId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const updated = await res.json()
      setActiveShelfPlanogram(updated)
      // Update cache for placed SKU tracking
      if (updated) {
        setAllShelfPlanograms(prev => {
          const next = new Map(prev)
          next.set(shelfId, updated)
          return next
        })
      }
    } catch (err) {
      console.error('Failed to save shelf planogram:', err)
    }
  }, [activePlanogram?.id])
  
  // Place SKUs on shelf
  const placeSkusOnShelf = useCallback(async (
    shelfId: string,
    skuItemIds: string[],
    dropTarget: any,
    shelfWidth: number,
    options?: { fillOrder?: 'sequential' | 'random' }
  ) => {
    if (!activePlanogram?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/planogram/planograms/${activePlanogram.id}/shelves/${shelfId}/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuItemIds, dropTarget, shelfWidth, options }),
      })
      const result = await res.json()
      await loadShelfPlanogram(shelfId)
      return result
    } catch (err) {
      console.error('Failed to place SKUs:', err)
    }
  }, [activePlanogram?.id, loadShelfPlanogram])
  
  // Auto-fill shelf
  const autoFillShelf = useCallback(async (shelfId: string, params: any) => {
    if (!activePlanogram?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/planogram/planograms/${activePlanogram.id}/shelves/${shelfId}/auto-fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const result = await res.json()
      await loadShelfPlanogram(shelfId)
      return result
    } catch (err) {
      console.error('Failed to auto-fill shelf:', err)
    }
  }, [activePlanogram?.id, loadShelfPlanogram])
  
  // Toggle SKU selection
  const toggleSkuSelection = useCallback((id: string) => {
    setSelectedSkuIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }, [])
  
  // Filtered SKU items
  const filteredSkuItems = activeCatalog?.items.filter(item => {
    if (categoryFilter && item.category !== categoryFilter) return false
    if (brandFilter && item.brand !== brandFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        item.skuCode.toLowerCase().includes(q) ||
        item.brand?.toLowerCase().includes(q)
      )
    }
    return true
  }) || []
  
  // Compute placed SKU IDs from all shelf planograms in active planogram
  const placedSkuIds = new Set<string>()
  const skuPlacements = new Map<string, { shelfId: string; shelfName: string; levelIndex: number; slotIndex: number }>()
  
  // Build placed SKU map from active planogram's shelves
  if (activePlanogram?.shelves) {
    activePlanogram.shelves.forEach(sp => {
      sp.slots?.levels?.forEach(level => {
        level.slots?.forEach(slot => {
          if (slot.skuItemId) {
            placedSkuIds.add(slot.skuItemId)
            skuPlacements.set(slot.skuItemId, {
              shelfId: sp.shelfId,
              shelfName: sp.shelfId, // Will be resolved to actual name
              levelIndex: level.levelIndex,
              slotIndex: slot.slotIndex,
            })
          }
        })
      })
    })
  }
  
  // Also check allShelfPlanograms cache for recently placed items
  allShelfPlanograms.forEach((sp, shelfId) => {
    sp.slots?.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (slot.skuItemId && !placedSkuIds.has(slot.skuItemId)) {
          placedSkuIds.add(slot.skuItemId)
          skuPlacements.set(slot.skuItemId, {
            shelfId,
            shelfName: shelfId,
            levelIndex: level.levelIndex,
            slotIndex: slot.slotIndex,
          })
        }
      })
    })
  })
  
  // Get placement info for a SKU
  const getSkuPlacement = useCallback((skuId: string) => {
    return skuPlacements.get(skuId) || null
  }, [skuPlacements])
  
  // Remove SKU from its current slot
  const removeSkuFromSlot = useCallback(async (skuId: string) => {
    const placement = skuPlacements.get(skuId)
    if (!placement || !activePlanogram?.id) return
    
    // Get current shelf planogram
    const shelfPlanogram = allShelfPlanograms.get(placement.shelfId) || 
      activePlanogram.shelves?.find(s => s.shelfId === placement.shelfId)
    
    if (!shelfPlanogram) return
    
    // Clone and remove the SKU from its slot
    const newLevels = JSON.parse(JSON.stringify(shelfPlanogram.slots?.levels || []))
    const level = newLevels.find((l: LevelData) => l.levelIndex === placement.levelIndex)
    if (level) {
      const slot = level.slots?.find((s: SlotData) => s.slotIndex === placement.slotIndex)
      if (slot && slot.skuItemId === skuId) {
        slot.skuItemId = null
      }
    }
    
    // Save updated shelf planogram
    await saveShelfPlanogram(placement.shelfId, {
      ...shelfPlanogram,
      slots: { levels: newLevels },
    })
    
    // Update local cache
    setAllShelfPlanograms(prev => {
      const next = new Map(prev)
      next.set(placement.shelfId, { ...shelfPlanogram, slots: { levels: newLevels } })
      return next
    })
  }, [skuPlacements, activePlanogram, allShelfPlanograms, saveShelfPlanogram])
  
  // Load shelf planogram when active shelf changes
  useEffect(() => {
    if (activeShelfId && activePlanogram) {
      loadShelfPlanogram(activeShelfId)
    } else {
      setActiveShelfPlanogram(null)
    }
  }, [activeShelfId, activePlanogram, loadShelfPlanogram])
  
  // Load data on mount
  useEffect(() => {
    loadCatalogs()
  }, [loadCatalogs])
  
  useEffect(() => {
    loadPlanograms()
  }, [loadPlanograms])
  
  // Persist active planogram ID to localStorage
  useEffect(() => {
    if (activePlanogram?.id) {
      localStorage.setItem('activePlanogramId', activePlanogram.id)
    }
  }, [activePlanogram?.id])
  
  // Persist active catalog ID to localStorage
  useEffect(() => {
    if (activeCatalog?.id) {
      localStorage.setItem('activeCatalogId', activeCatalog.id)
    }
  }, [activeCatalog?.id])
  
  // Restore active planogram on mount
  useEffect(() => {
    const savedPlanogramId = localStorage.getItem('activePlanogramId')
    if (savedPlanogramId && planograms.length > 0 && !activePlanogram) {
      const exists = planograms.find(p => p.id === savedPlanogramId)
      if (exists) {
        loadPlanogram(savedPlanogramId)
      }
    }
  }, [planograms, activePlanogram, loadPlanogram])
  
  // Restore active catalog on mount
  useEffect(() => {
    const savedCatalogId = localStorage.getItem('activeCatalogId')
    if (savedCatalogId && catalogs.length > 0 && !activeCatalog) {
      const exists = catalogs.find(c => c.id === savedCatalogId)
      if (exists) {
        loadCatalog(savedCatalogId)
      }
    }
  }, [catalogs, activeCatalog, loadCatalog])
  
  return (
    <PlanogramContext.Provider value={{
      catalogs,
      activeCatalog,
      loadCatalogs,
      loadCatalog,
      importCatalog,
      deleteCatalog,
      planograms,
      activePlanogram,
      loadPlanograms,
      loadPlanogram,
      createPlanogram,
      deletePlanogram,
      duplicatePlanogram,
      activeShelfId,
      setActiveShelfId,
      activeShelfPlanogram,
      loadShelfPlanogram,
      saveShelfPlanogram,
      placeSkusOnShelf,
      autoFillShelf,
      selectedSkuIds,
      setSelectedSkuIds,
      toggleSkuSelection,
      categoryFilter,
      setCategoryFilter,
      brandFilter,
      setBrandFilter,
      searchQuery,
      setSearchQuery,
      filteredSkuItems,
      placedSkuIds,
      getSkuPlacement,
      removeSkuFromSlot,
      loading,
      hoveredSkuId,
      setHoveredSkuId,
    }}>
      {children}
    </PlanogramContext.Provider>
  )
}

export function usePlanogram() {
  const context = useContext(PlanogramContext)
  if (!context) {
    throw new Error('usePlanogram must be used within PlanogramProvider')
  }
  return context
}
