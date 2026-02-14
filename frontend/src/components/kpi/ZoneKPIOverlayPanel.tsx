import { useState, useMemo, useEffect, useRef } from 'react'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import ZoneKPIIndicator from './ZoneKPIIndicator'

interface ZoneKPIOverlayPanelProps {
  onZoneClick?: (roiId: string) => void
}

type ZoneCategory = 'queue' | 'shelf' | 'entrance' | 'cashier' | 'custom'

const CATEGORY_CONFIG: Record<ZoneCategory, { label: string; color: string }> = {
  queue: { label: 'Queue', color: '#f59e0b' },
  shelf: { label: 'Shelf', color: '#22c55e' },
  entrance: { label: 'Entrance', color: '#3b82f6' },
  cashier: { label: 'Cashier', color: '#8b5cf6' },
  custom: { label: 'Custom', color: '#6b7280' },
}

function getZoneCategory(name: string): ZoneCategory {
  const lower = name.toLowerCase()
  if (lower.includes('queue')) return 'queue'
  if (lower.includes('shelf') || lower.includes('engagement')) return 'shelf'
  if (lower.includes('entrance') || lower.includes('entry') || lower.includes('exit')) return 'entrance'
  if (lower.includes('cashier') || lower.includes('checkout')) return 'cashier'
  return 'custom'
}

export default function ZoneKPIOverlayPanel({ onZoneClick }: ZoneKPIOverlayPanelProps) {
  const { regions, showKPIOverlays, openKPIPopup, hoveredRoiId } = useRoi()
  const { selectedObjectId } = useVenue()
  const [activeFilters, setActiveFilters] = useState<Set<ZoneCategory>>(new Set())
  
  // Track pinned ROI that stays highlighted for 10 seconds
  const [pinnedRoiId, setPinnedRoiId] = useState<string | null>(null)
  const pinnedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)
  
  // When hoveredRoiId changes, pin it and set 10-second timeout
  useEffect(() => {
    if (hoveredRoiId) {
      // Clear any existing timeout
      if (pinnedTimeoutRef.current) {
        clearTimeout(pinnedTimeoutRef.current)
      }
      
      // Pin the new ROI
      setPinnedRoiId(hoveredRoiId)
      
      // Scroll to top when pinning
      if (listContainerRef.current) {
        listContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      }
      
      // Set 10-second timeout to unpin
      pinnedTimeoutRef.current = setTimeout(() => {
        setPinnedRoiId(null)
      }, 10000)
    }
    
    return () => {
      if (pinnedTimeoutRef.current) {
        clearTimeout(pinnedTimeoutRef.current)
      }
    }
  }, [hoveredRoiId])

  // Compute display names for ROIs, adding @Z{value} suffix for duplicates
  const roiDisplayNames = useMemo(() => {
    const nameMap = new Map<string, string[]>() // name -> [id1, id2, ...]
    const displayNames = new Map<string, string>() // id -> display name
    
    // First pass: group ROIs by name
    regions.forEach(roi => {
      const ids = nameMap.get(roi.name) || []
      ids.push(roi.id)
      nameMap.set(roi.name, ids)
    })
    
    // Second pass: assign display names
    regions.forEach(roi => {
      const ids = nameMap.get(roi.name) || []
      if (ids.length > 1) {
        // Duplicate name - add @Z{value} suffix using centroid Z
        const centroidZ = roi.vertices.length > 0
          ? roi.vertices.reduce((sum, v) => sum + v.z, 0) / roi.vertices.length
          : 0
        displayNames.set(roi.id, `${roi.name} @Z${Math.round(centroidZ)}`)
      } else {
        // Unique name - use as-is
        displayNames.set(roi.id, roi.name)
      }
    })
    
    return displayNames
  }, [regions])

  // Get available categories from current regions
  const availableCategories = useMemo(() => {
    const cats = new Set<ZoneCategory>()
    regions.forEach(roi => cats.add(getZoneCategory(roi.name)))
    return Array.from(cats)
  }, [regions])

  // Filter regions based on active filters (empty = show all)
  const filteredRegions = useMemo(() => {
    let result = activeFilters.size === 0 ? regions : regions.filter(roi => activeFilters.has(getZoneCategory(roi.name)))
    
    // If there's a pinned ROI, move it to the top of the list
    if (pinnedRoiId) {
      const pinnedIndex = result.findIndex(r => r.id === pinnedRoiId)
      if (pinnedIndex > 0) {
        const pinned = result[pinnedIndex]
        result = [pinned, ...result.slice(0, pinnedIndex), ...result.slice(pinnedIndex + 1)]
      }
    }
    
    return result
  }, [regions, activeFilters, pinnedRoiId])

  // Toggle filter
  const toggleFilter = (cat: ZoneCategory) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(cat)) {
        next.delete(cat)
      } else {
        next.add(cat)
      }
      return next
    })
  }

  // Hide when right panel is open (object selected) or KPI overlays toggled off
  if (!showKPIOverlays || regions.length === 0 || selectedObjectId) {
    return null
  }

  const handleZoneClick = (roiId: string) => {
    if (onZoneClick) {
      onZoneClick(roiId)
    } else {
      openKPIPopup(roiId)
    }
  }

  return (
    <div className="absolute top-14 right-4 z-20 flex gap-3">
      {/* Category Filter Pills - horizontal row on left */}
      {availableCategories.length > 1 && (
        <div className="flex flex-col gap-1 pt-1">
          {availableCategories.map(cat => {
            const config = CATEGORY_CONFIG[cat]
            const isActive = activeFilters.has(cat)
            return (
              <button
                key={cat}
                onClick={() => toggleFilter(cat)}
                className={`
                  px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap
                  transition-all duration-200 flex items-center gap-1.5
                  ${isActive 
                    ? 'bg-white/20 text-white' 
                    : 'bg-black/40 text-white/50 hover:text-white/80'
                  }
                `}
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: isActive ? config.color : 'rgba(255,255,255,0.1)',
                }}
              >
                <span 
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: config.color }}
                />
                {config.label}
              </button>
            )
          })}
        </div>
      )}

      {/* KPI Cards column - fixed width */}
      <div 
        ref={listContainerRef}
        className="flex flex-col gap-2 max-h-[calc(100vh-200px)] overflow-y-auto pr-1 w-[168px]"
      >
        {filteredRegions.map((roi) => (
          <ZoneKPIIndicator
            key={roi.id}
            roiId={roi.id}
            roiName={roiDisplayNames.get(roi.id) || roi.name}
            roiColor={roi.color}
            highlighted={roi.id === pinnedRoiId}
            onClick={() => handleZoneClick(roi.id)}
          />
        ))}

        {/* Empty state when all filtered out */}
        {filteredRegions.length === 0 && activeFilters.size > 0 && (
          <div className="text-white/40 text-xs text-center py-4">
            No zones match selected filters
          </div>
        )}
      </div>
    </div>
  )
}
