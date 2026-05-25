import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import ZoneKPIIndicator from './ZoneKPIIndicator'
import { API_BASE } from '../../config/api'
import { fetchRoiCategoryLabel, resolveRoiCategorySync } from '../../utils/roiCategoryUtils'

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
  const { selectedObjectId, objects } = useVenue()
  const [activeFilters, setActiveFilters] = useState<Set<ZoneCategory>>(new Set())
  
  // Track pinned ROI that stays highlighted for 10 seconds
  const [pinnedRoiId, setPinnedRoiId] = useState<string | null>(null)
  const pinnedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const listContainerRef = useRef<HTMLDivElement>(null)

  // Live metrics from cards for realtime sort order
  const liveMetricsRef = useRef<Map<string, { currentOccupancy: number; totalEntries: number }>>(new Map())
  const [sortTick, setSortTick] = useState(0)

  // Category labels resolved from ROI metadata, linked objects, or shelf-info API
  const categoryCacheRef = useRef<Map<string, string>>(new Map())
  const [categoryTick, setCategoryTick] = useState(0)

  const handleMetricsUpdate = useCallback((roiId: string, metrics: { currentOccupancy: number; totalEntries: number }) => {
    liveMetricsRef.current.set(roiId, metrics)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setSortTick(t => t + 1), 500)
    return () => clearInterval(id)
  }, [])

  // When hoveredRoiId changes, pin it and set 10-second timeout
  useEffect(() => {
    if (hoveredRoiId) {
      if (pinnedTimeoutRef.current) {
        clearTimeout(pinnedTimeoutRef.current)
      }
      
      setPinnedRoiId(hoveredRoiId)
      
      if (listContainerRef.current) {
        listContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      }
      
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

  const baseRegions = useMemo(
    () => regions.filter(roi => roi.name !== 'Zone 1' && roi.name !== 'LiDAR Coverage'),
    [regions],
  )

  // Resolve categories (sync first, async fetch for shelf zones)
  useEffect(() => {
    baseRegions.forEach(roi => {
      const sync = resolveRoiCategorySync(roi, objects)
      if (sync) {
        categoryCacheRef.current.set(roi.id, sync)
        return
      }
      if (categoryCacheRef.current.has(roi.id)) return

      void fetchRoiCategoryLabel(roi.id, API_BASE).then(label => {
        if (!label) return
        categoryCacheRef.current.set(roi.id, label)
        setCategoryTick(t => t + 1)
      }).catch(() => {})
    })
  }, [baseRegions, objects])

  const roiCategories = useMemo(() => {
    const map = new Map<string, string>()
    baseRegions.forEach(roi => {
      const label =
        categoryCacheRef.current.get(roi.id) ??
        resolveRoiCategorySync(roi, objects)
      if (label) map.set(roi.id, label)
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRegions, objects, categoryTick])

  // Compute display names for ROIs, adding @Z{value} suffix for duplicates
  const roiDisplayNames = useMemo(() => {
    const nameMap = new Map<string, string[]>()
    const displayNames = new Map<string, string>()
    
    regions.forEach(roi => {
      const ids = nameMap.get(roi.name) || []
      ids.push(roi.id)
      nameMap.set(roi.name, ids)
    })
    
    regions.forEach(roi => {
      const ids = nameMap.get(roi.name) || []
      if (ids.length > 1) {
        const centroidZ = roi.vertices.length > 0
          ? roi.vertices.reduce((sum, v) => sum + v.z, 0) / roi.vertices.length
          : 0
        displayNames.set(roi.id, `${roi.name} @Z${Math.round(centroidZ)}`)
      } else {
        displayNames.set(roi.id, roi.name)
      }
    })
    
    return displayNames
  }, [regions])

  const availableCategories = useMemo(() => {
    const cats = new Set<ZoneCategory>()
    baseRegions.forEach(roi => cats.add(getZoneCategory(roi.name)))
    return Array.from(cats)
  }, [baseRegions])

  const filteredRegions = useMemo(() => {
    let result = activeFilters.size === 0
      ? [...baseRegions]
      : baseRegions.filter(roi => activeFilters.has(getZoneCategory(roi.name)))

    // Sort by realtime traffic: current occupancy, then total entries
    result.sort((a, b) => {
      const ma = liveMetricsRef.current.get(a.id)
      const mb = liveMetricsRef.current.get(b.id)
      const occDiff = (mb?.currentOccupancy ?? 0) - (ma?.currentOccupancy ?? 0)
      if (occDiff !== 0) return occDiff
      return (mb?.totalEntries ?? 0) - (ma?.totalEntries ?? 0)
    })

    // Pinned (hovered) ROI stays on top with distinct highlight
    if (pinnedRoiId) {
      const pinnedIndex = result.findIndex(r => r.id === pinnedRoiId)
      if (pinnedIndex > 0) {
        const pinned = result[pinnedIndex]
        result = [pinned, ...result.slice(0, pinnedIndex), ...result.slice(pinnedIndex + 1)]
      }
    }

    return result
    // sortTick triggers re-sort as live metrics update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRegions, activeFilters, pinnedRoiId, sortTick])

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

      <div 
        ref={listContainerRef}
        className="flex flex-col gap-2 max-h-[calc(100vh-200px)] overflow-y-auto p-1 w-[176px]"
      >
        {filteredRegions.map((roi) => (
          <ZoneKPIIndicator
            key={roi.id}
            roiId={roi.id}
            roiName={roiDisplayNames.get(roi.id) || roi.name}
            roiColor={roi.color}
            categoryLabel={roiCategories.get(roi.id) ?? null}
            highlighted={roi.id === pinnedRoiId}
            onMetricsUpdate={handleMetricsUpdate}
            onClick={() => handleZoneClick(roi.id)}
          />
        ))}

        {filteredRegions.length === 0 && activeFilters.size > 0 && (
          <div className="text-white/40 text-xs text-center py-4">
            No zones match selected filters
          </div>
        )}
      </div>
    </div>
  )
}
