/**
 * JourneyFlowStream - Q4 of Neural Dashboard
 * 
 * Live Journey Feed showing individual track journeys with:
 * - Track ID (short hash)
 * - Behavioral status (arrived/exploring/interested/buying)
 * - Zone/category they're in
 * - Time in current state
 */

import { useEffect, useState, useRef, useMemo } from 'react'
import { useTracksRef } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'
import AnimatedNumber from './AnimatedNumber'
import Tooltip from './Tooltip'
import { 
  DoorOpen, 
  Navigation, 
  Eye, 
  CreditCard,
  LogOut,
  Croissant,
  Wine,
  Milk,
  Salad,
  Snowflake,
  Package,
  Cookie,
  MapPin
} from 'lucide-react'

// Behavioral states
type BehaviorState = 'arrived' | 'exploring' | 'interested' | 'buying' | 'exiting'

// Track journey data
interface TrackJourney {
  id: string
  shortId: string
  state: BehaviorState
  zoneName: string | null
  category: string | null
  timeInState: number // seconds
  entryTime: number
  lastStateChange: number
  velocity: number
}

// Category to icon mapping
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  'Bakery & Breakfast': Croissant,
  'Beverages': Wine,
  'Dairy & Eggs': Milk,
  'Fresh Produce': Salad,
  'Frozen & Ready Meals': Snowflake,
  'Pantry': Package,
  'Snacks & Confectionery': Cookie,
}

// State config
const STATE_CONFIG: Record<BehaviorState, { label: string; color: string; Icon: React.ElementType; tip: string }> = {
  arrived:    { label: 'ARRIVED',    color: 'text-cyan-400',   Icon: DoorOpen,    tip: 'Just entered the venue (< 5s)' },
  exploring:  { label: 'EXPLORING',  color: 'text-purple-400', Icon: Navigation,  tip: 'Walking through the store' },
  interested: { label: 'INTERESTED', color: 'text-green-400',  Icon: Eye,         tip: 'Stopped in a zone (speed < 0.3 m/s)' },
  buying:     { label: 'BUYING',     color: 'text-amber-400',  Icon: CreditCard,  tip: 'Inside a checkout zone' },
  exiting:    { label: 'EXITING',    color: 'text-red-400',    Icon: LogOut,       tip: 'No longer detected, leaving' },
}

// Short hash from track ID
function shortHash(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(16).slice(0, 4).toUpperCase()
}

// Point-in-polygon helper
function isPointInPolygon(x: number, z: number, vertices: { x: number; z: number }[]): boolean {
  if (vertices.length < 3) return false
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, zi = vertices[i].z
    const xj = vertices[j].x, zj = vertices[j].z
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

const UPDATE_INTERVAL = 500
const MAX_VISIBLE_ROWS = 8

export default function JourneyFlowStream() {
  const tracksRef = useTracksRef()
  const { regions } = useRoi()
  const regionsRef = useRef(regions)
  regionsRef.current = regions
  const journeysRef = useRef<Map<string, TrackJourney>>(new Map())
  const [visibleJourneys, setVisibleJourneys] = useState<TrackJourney[]>([])
  const [stateCounts, setStateCounts] = useState<Record<BehaviorState, number>>({
    arrived: 0, exploring: 0, interested: 0, buying: 0, exiting: 0
  })
  
  // Classify ROIs - filter out Service zones for checkout
  const roiClassification = useMemo(() => {
    const checkoutRois = new Map<string, string>() // id -> checkout name
    const shelfRois = new Map<string, { name: string; category: string | null }>()
    
    regions.forEach(roi => {
      const name = roi.name
      const nameLower = name.toLowerCase()
      
      // Only use Queue zones for checkout, not Service
      if (nameLower.includes('checkout') && nameLower.includes('queue')) {
        // Extract checkout number
        const match = name.match(/Checkout\s*(\d+)/i)
        const checkoutName = match ? `Checkout ${match[1]}` : 'Checkout'
        checkoutRois.set(roi.id, checkoutName)
      } else if (nameLower.includes('shelf') && nameLower.includes('engagement')) {
        // Extract shelf number
        const match = name.match(/Shelf\s*(\d+)/i)
        const shelfName = match ? `Shelf ${match[1]}` : name
        shelfRois.set(roi.id, { name: shelfName, category: null })
      }
    })
    
    return { checkoutRois, shelfRois }
  }, [regions])
  
  // Update journeys
  useEffect(() => {
    const interval = setInterval(() => {
      const journeys = journeysRef.current
      const now = Date.now()
      const activeIds = new Set<string>()
      const counts: Record<BehaviorState, number> = {
        arrived: 0, exploring: 0, interested: 0, buying: 0, exiting: 0
      }
      
      tracksRef.current.forEach(track => {
        activeIds.add(track.id)
        const pos = track.venuePosition
        const vel = typeof track.velocity === 'number' && !isNaN(track.velocity) ? track.velocity : 0
        
        // Find which ROI track is in
        let zoneName: string | null = null
        let category: string | null = null
        let isInCheckout = false
        
        for (const roi of regionsRef.current) {
          if (isPointInPolygon(pos.x, pos.z, roi.vertices)) {
            
            if (roiClassification.checkoutRois.has(roi.id)) {
              zoneName = roiClassification.checkoutRois.get(roi.id)!
              isInCheckout = true
            } else if (roiClassification.shelfRois.has(roi.id)) {
              const shelf = roiClassification.shelfRois.get(roi.id)!
              zoneName = shelf.name
              category = shelf.category
            } else {
              zoneName = roi.name
            }
            break
          }
        }
        
        const existing = journeys.get(track.id)
        
        // Determine state
        let state: BehaviorState
        if (!existing || now - existing.entryTime < 5000) {
          state = 'arrived'
        } else if (isInCheckout) {
          state = 'buying'
        } else if (zoneName && vel < 0.3) {
          state = 'interested'
        } else {
          state = 'exploring'
        }
        
        if (existing) {
          // Check if state changed
          const stateChanged = existing.state !== state
          
          existing.state = state
          existing.zoneName = zoneName
          existing.category = category
          existing.velocity = vel
          existing.timeInState = stateChanged 
            ? 0 
            : (now - existing.lastStateChange) / 1000
          if (stateChanged) {
            existing.lastStateChange = now
          }
        } else {
          journeys.set(track.id, {
            id: track.id,
            shortId: shortHash(track.id),
            state,
            zoneName,
            category,
            timeInState: 0,
            entryTime: now,
            lastStateChange: now,
            velocity: vel,
          })
        }
        
        counts[state]++
      })
      
      // Mark exiting tracks
      journeys.forEach((journey, id) => {
        if (!activeIds.has(id)) {
          journey.state = 'exiting'
          journey.timeInState = (now - journey.lastStateChange) / 1000
          counts.exiting++
          
          // Remove after 3 seconds
          if (journey.timeInState > 3) {
            journeys.delete(id)
          }
        }
      })
      
      // Sort by most recent state change and take top N
      const sorted = Array.from(journeys.values())
        .sort((a, b) => b.lastStateChange - a.lastStateChange)
        .slice(0, MAX_VISIBLE_ROWS)
      
      setVisibleJourneys(sorted)
      setStateCounts(counts)
    }, UPDATE_INTERVAL)
    
    return () => clearInterval(interval)
  }, [roiClassification])
  
  const formatTime = (sec: number) => {
    if (sec < 60) return `${Math.round(sec)}s`
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }
  
  const totalActive = Object.values(stateCounts).reduce((a, b) => a + b, 0)
  
  return (
    <div className="h-full flex flex-col p-3 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/50">LIVE JOURNEYS</span>
        </div>
        <Tooltip text="Total people currently tracked in the venue">
          <span className="text-[10px] text-white/50 tabular-nums cursor-help"><AnimatedNumber value={totalActive} duration={500} /> in store</span>
        </Tooltip>
      </div>
      
      {/* Journey Feed */}
      <div className="flex-1 overflow-hidden space-y-1">
        {visibleJourneys.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/30 text-[10px]">
            No active journeys
          </div>
        ) : (
          visibleJourneys.map(journey => {
            const stateConfig = STATE_CONFIG[journey.state]
            const StateIcon = stateConfig.Icon
            const CategoryIcon = journey.category 
              ? CATEGORY_ICONS[journey.category] || MapPin
              : MapPin
            
            return (
              <div 
                key={journey.id}
                className="flex items-center gap-2 py-1 px-2 rounded bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
              >
                {/* Track ID */}
                <span className="text-[10px] text-white/60 font-bold w-10">
                  #{journey.shortId}
                </span>
                
                {/* State */}
                <div className={`flex items-center gap-1 w-24 ${stateConfig.color}`}>
                  <StateIcon className="w-3 h-3" />
                  <span className="text-[9px] font-medium">{stateConfig.label}</span>
                </div>
                
                {/* Zone */}
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <CategoryIcon className="w-3 h-3 text-white/40 flex-shrink-0" />
                  <span className="text-[10px] text-white/60 truncate">
                    {journey.zoneName || 'Store'}
                  </span>
                </div>
                
                {/* Time */}
                <span className="text-[10px] text-white/45 tabular-nums w-10 text-right">
                  {formatTime(journey.timeInState)}
                </span>
              </div>
            )
          })
        )}
      </div>
      
      {/* State Summary */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[rgba(255,255,255,0.04)]">
        {Object.entries(STATE_CONFIG).map(([state, config]) => (
          <Tooltip key={state} text={config.tip}>
            <div className="flex items-center gap-1 cursor-help">
              <config.Icon className={`w-3 h-3 ${stateCounts[state as BehaviorState] > 0 ? config.color : 'text-white/20'}`} />
              <span className={`text-[9px] tabular-nums ${stateCounts[state as BehaviorState] > 0 ? 'text-white/60' : 'text-white/20'}`}>
                {stateCounts[state as BehaviorState]}
              </span>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
