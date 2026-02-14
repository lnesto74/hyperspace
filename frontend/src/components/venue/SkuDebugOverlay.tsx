import { useEffect, useState, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { useVenue } from '../../context/VenueContext'
import { useTracking } from '../../context/TrackingContext'
import { Package, Eye, Clock } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface DetectedSku {
  skuId: string
  skuCode: string
  name: string
  brand: string | null
  category: string | null
  price: number | null
  shelfId: string
  shelfName: string
  shelfPosition?: { x: number; z: number }
  shelfRotation?: number
  slotWorldPosition?: { x: number; z: number }
  levelIndex: number
  slotIndex: number
  positionScore: number
  attentionScore: number
  zoneType: string
  distanceToShelf?: number
}

interface TrackSkuDetection {
  trackKey: string
  position: { x: number; z: number }
  detectedSkus: DetectedSku[]
  dwellStartTime: number
  totalDwellTime: number
  lastSeenTime: number
  isStale: boolean
}

const CARD_PERSISTENCE_MS = 5000 // Keep cards visible for 5 seconds after leaving zone

interface HoveredShelfInfo {
  shelfId: string
  shelfName: string
  position: { x: number; z: number }
  slotPosition?: { x: number; z: number }
  shelfRotation?: number
  levelIndex: number
  slotIndex: number
}

interface SkuDebugOverlayProps {
  enabled: boolean
  containerRef: React.RefObject<HTMLDivElement>
  cameraRef: React.RefObject<THREE.PerspectiveCamera>
  onHoverShelf?: (info: HoveredShelfInfo | null) => void
  autoShowSlotHighlight?: boolean
  onAutoSlotPositions?: (positions: Array<{ x: number; z: number; rotation?: number }>) => void
}

export default function SkuDebugOverlay({ enabled, containerRef, cameraRef, onHoverShelf, autoShowSlotHighlight, onAutoSlotPositions }: SkuDebugOverlayProps) {
  const { venue, objects } = useVenue()
  const { tracks } = useTracking()
  const [trackDetections, setTrackDetections] = useState<Map<string, TrackSkuDetection>>(new Map())
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const detectionCacheRef = useRef<Map<string, { timestamp: number; skus: DetectedSku[] }>>(new Map())
  const dwellTimersRef = useRef<Map<string, number>>(new Map())
  const lastSeenTimesRef = useRef<Map<string, number>>(new Map())
  
  // Detect SKUs for each tracked person
  const detectSkusForTrack = useCallback(async (trackKey: string, position: { x: number; z: number }) => {
    if (!venue?.id) return
    
    // Check cache (avoid calling API too frequently)
    const cached = detectionCacheRef.current.get(trackKey)
    const now = Date.now()
    if (cached && now - cached.timestamp < 500) {
      return cached.skus
    }
    
    try {
      const res = await fetch(`${API_BASE}/api/kpi/sku-detection/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          position,
        }),
      })
      
      if (res.ok) {
        const data = await res.json()
        if (data.detectedSkus?.length > 0) {
          console.log(`[SKU Debug FE] Track ${trackKey} @ (${position.x.toFixed(2)}, ${position.z.toFixed(2)}) -> ${data.detectedSkus.length} SKUs:`, 
            data.detectedSkus.map((s: DetectedSku) => `${s.name} (${s.shelfName})`))
        }
        detectionCacheRef.current.set(trackKey, {
          timestamp: now,
          skus: data.detectedSkus || [],
        })
        return data.detectedSkus || []
      }
    } catch (err) {
      // Silent fail
    }
    return []
  }, [venue?.id])
  
  // Update detections when tracks change
  useEffect(() => {
    if (!enabled || !venue?.id) {
      setTrackDetections(new Map())
      return
    }
    
    const updateDetections = async () => {
      const newDetections = new Map<string, TrackSkuDetection>()
      const now = Date.now()
      
      // First, process all current tracks
      for (const [trackKey, track] of tracks) {
        const position = { x: track.venuePosition.x, z: track.venuePosition.z }
        const skus = await detectSkusForTrack(trackKey, position)
        
        if (skus && skus.length > 0) {
          // Track dwell time
          let dwellStartTime = dwellTimersRef.current.get(trackKey) || now
          if (!dwellTimersRef.current.has(trackKey)) {
            dwellTimersRef.current.set(trackKey, now)
          }
          
          // Update last seen time
          lastSeenTimesRef.current.set(trackKey, now)
          
          newDetections.set(trackKey, {
            trackKey,
            position,
            detectedSkus: skus,
            dwellStartTime,
            totalDwellTime: now - dwellStartTime,
            lastSeenTime: now,
            isStale: false,
          })
        }
      }
      
      // Keep stale detections for persistence period
      setTrackDetections(prev => {
        const merged = new Map(newDetections)
        
        for (const [trackKey, detection] of prev) {
          if (!merged.has(trackKey)) {
            const lastSeen = lastSeenTimesRef.current.get(trackKey) || detection.lastSeenTime
            const timeSinceLastSeen = now - lastSeen
            
            if (timeSinceLastSeen < CARD_PERSISTENCE_MS) {
              // Keep the card but mark as stale
              merged.set(trackKey, {
                ...detection,
                isStale: true,
                totalDwellTime: detection.totalDwellTime, // Freeze dwell time
              })
            } else {
              // Card has expired, clean up
              dwellTimersRef.current.delete(trackKey)
              lastSeenTimesRef.current.delete(trackKey)
            }
          }
        }
        
        return merged
      })
    }
    
    updateDetections()
    const interval = setInterval(updateDetections, 500)
    return () => clearInterval(interval)
  }, [enabled, venue?.id, tracks, detectSkusForTrack])
  
  // Convert 3D position to screen position
  const worldToScreen = useCallback((worldPos: { x: number; z: number }) => {
    if (!containerRef.current || !cameraRef.current) return null
    
    const camera = cameraRef.current
    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    
    // Create a 3D vector at the track position (y = 2 to float above person)
    const vector = new THREE.Vector3(worldPos.x, 2.5, worldPos.z)
    vector.project(camera)
    
    // Convert to screen coordinates
    const x = (vector.x * 0.5 + 0.5) * rect.width
    const y = (-(vector.y * 0.5) + 0.5) * rect.height
    
    // Check if behind camera
    if (vector.z > 1) return null
    
    return { x, y }
  }, [containerRef, cameraRef])
  
  // Auto-emit slot positions when autoShowSlotHighlight is enabled
  useEffect(() => {
    if (!autoShowSlotHighlight || !onAutoSlotPositions) {
      onAutoSlotPositions?.([])
      return
    }
    
    // Collect all slot positions from active detections
    const slotPositions: Array<{ x: number; z: number; rotation?: number }> = []
    trackDetections.forEach(detection => {
      if (!detection.isStale) {
        detection.detectedSkus.forEach(sku => {
          if (sku.slotWorldPosition) {
            slotPositions.push({
              x: sku.slotWorldPosition.x,
              z: sku.slotWorldPosition.z,
              rotation: sku.shelfRotation,
            })
          }
        })
      }
    })
    
    onAutoSlotPositions(slotPositions)
  }, [autoShowSlotHighlight, trackDetections, onAutoSlotPositions])
  
  if (!enabled) return null
  
  // Convert detections to array and sort by dwell time
  const detectionsArray = Array.from(trackDetections.values())
    .filter(d => d.detectedSkus.length > 0)
    .sort((a, b) => b.totalDwellTime - a.totalDwellTime)
  
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-40">
      {/* Stacked SKU Cards Panel - Left Side */}
      {detectionsArray.length > 0 && (
        <div className="absolute top-4 left-16 flex flex-col gap-2 max-h-[calc(100%-8rem)] overflow-y-auto">
          {detectionsArray.map((detection, index) => {
            const topSku = detection.detectedSkus[0]
            if (!topSku) return null
            
            const dwellSeconds = Math.floor(detection.totalDwellTime / 1000)
            const screenPos = worldToScreen(detection.position)
            
            // Use shelf/slot position from API response
            const shelfObj = objects.find(o => o.id === topSku.shelfId)
            const shelfPosition = topSku.shelfPosition || (shelfObj ? { x: shelfObj.position.x, z: shelfObj.position.z } : null)
            const slotPosition = topSku.slotWorldPosition
            
            const handleMouseEnter = () => {
              setHoveredCard(detection.trackKey)
              if (onHoverShelf && shelfPosition) {
                onHoverShelf({
                  shelfId: topSku.shelfId,
                  shelfName: topSku.shelfName,
                  position: shelfPosition,
                  slotPosition: slotPosition,
                  shelfRotation: topSku.shelfRotation,
                  levelIndex: topSku.levelIndex,
                  slotIndex: topSku.slotIndex,
                })
              }
            }
            
            const handleMouseLeave = () => {
              setHoveredCard(null)
              if (onHoverShelf) {
                onHoverShelf(null)
              }
            }
            
            return (
              <div
                key={detection.trackKey}
                className={`bg-gray-900/95 border rounded-lg p-2 min-w-[200px] shadow-xl backdrop-blur-sm pointer-events-auto cursor-pointer transition-all duration-300 ${
                  detection.isStale
                    ? 'border-gray-500/50 opacity-60'
                    : hoveredCard === detection.trackKey 
                      ? 'border-green-400 ring-2 ring-green-400/30 scale-[1.02]' 
                      : 'border-green-500/50 hover:border-green-400/70'
                }`}
                style={{
                  animation: detection.isStale ? undefined : `fadeSlideIn 0.3s ease-out ${index * 0.1}s both`,
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                {/* Track indicator */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${detection.isStale ? 'bg-gray-500' : 'bg-green-500 animate-pulse'}`} />
                    <span className="text-[10px] text-gray-400">
                      Track {detection.trackKey.slice(-4)}
                      {detection.isStale && <span className="ml-1 text-gray-500">(leaving)</span>}
                    </span>
                  </div>
                  {screenPos && (
                    <span className="text-[9px] text-gray-500 font-mono">
                      ({detection.position.x.toFixed(1)}, {detection.position.z.toFixed(1)})
                    </span>
                  )}
                </div>
                
                {/* Header */}
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-green-400" />
                  <span className="text-xs font-bold text-green-400 truncate max-w-[140px]">
                    {topSku.name}
                  </span>
                </div>
                
                {/* SKU Code & Category */}
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-2">
                  <span className="font-mono">{topSku.skuCode}</span>
                  <span className="text-gray-500">{topSku.category}</span>
                </div>
                
                {/* Real-time KPIs */}
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="flex items-center gap-1 bg-gray-800/50 rounded px-1.5 py-0.5">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span className="text-white font-medium">{dwellSeconds}s</span>
                    <span className="text-gray-500">dwell</span>
                  </div>
                  <div className="flex items-center gap-1 bg-gray-800/50 rounded px-1.5 py-0.5">
                    <Eye className="w-3 h-3 text-blue-400" />
                    <span className="text-white font-medium">{Math.round(topSku.attentionScore * 100)}%</span>
                    <span className="text-gray-500">focus</span>
                  </div>
                </div>
                
                {/* Position Info */}
                <div className="mt-1.5 pt-1.5 border-t border-gray-700/50 text-[9px] text-gray-500">
                  <div className="flex justify-between">
                    <span>L{topSku.levelIndex + 1} S{topSku.slotIndex + 1}</span>
                    {topSku.distanceToShelf && (
                      <span className="text-cyan-400">{topSku.distanceToShelf.toFixed(2)}m</span>
                    )}
                  </div>
                  {topSku.shelfPosition && (
                    <div className="mt-0.5 font-mono text-[8px] text-gray-600">
                      Shelf @ ({topSku.shelfPosition.x.toFixed(1)}, {topSku.shelfPosition.z.toFixed(1)})
                    </div>
                  )}
                </div>
                
                {/* Other detected SKUs */}
                {detection.detectedSkus.length > 1 && (
                  <div className="mt-1 text-[9px] text-gray-500">
                    +{detection.detectedSkus.length - 1} nearby: {detection.detectedSkus.slice(1, 3).map(s => s.skuCode).join(', ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      
      {/* Debug info panel - Top Right */}
      {trackDetections.size > 0 && (
        <div className="absolute top-4 right-4 bg-gray-900/90 border border-gray-700 rounded-lg p-3 min-w-[200px]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium text-white">SKU Detection Active</span>
          </div>
          <div className="text-[10px] text-gray-400 space-y-1">
            <div className="flex justify-between">
              <span>Tracked persons:</span>
              <span className="text-white">{tracks.size}</span>
            </div>
            <div className="flex justify-between">
              <span>In shelf zones:</span>
              <span className="text-green-400">{trackDetections.size}</span>
            </div>
            <div className="flex justify-between">
              <span>SKUs detected:</span>
              <span className="text-amber-400">
                {Array.from(trackDetections.values()).reduce((sum, d) => sum + d.detectedSkus.length, 0)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
