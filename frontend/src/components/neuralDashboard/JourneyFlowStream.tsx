/**
 * JourneyFlowStream - Q4 of Neural Dashboard
 * 
 * Real-time particle flow visualization showing individual track journeys
 * through behavioral states: Entry → Browse → Engage → Dwell → Checkout → Exit
 * 
 * Each track is a glowing particle that flows left-to-right through state columns.
 */

import { useMemo, useRef, useEffect, useState } from 'react'
import { useTracking } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'

// Behavioral phases (left to right)
const PHASES = ['entry', 'browse', 'engage', 'dwell', 'checkout', 'exit'] as const
type Phase = typeof PHASES[number]

// Phase display config
const PHASE_CONFIG: Record<Phase, { label: string; color: string; glowColor: string }> = {
  entry:    { label: 'ENTER',    color: '#22d3ee', glowColor: 'rgba(34,211,238,0.6)' },   // cyan
  browse:   { label: 'BROWSE',   color: '#a78bfa', glowColor: 'rgba(167,139,250,0.6)' },  // purple
  engage:   { label: 'ENGAGE',   color: '#34d399', glowColor: 'rgba(52,211,153,0.6)' },   // green
  dwell:    { label: 'DWELL',    color: '#fbbf24', glowColor: 'rgba(251,191,36,0.6)' },   // amber
  checkout: { label: 'CHECKOUT', color: '#f97316', glowColor: 'rgba(249,115,22,0.6)' },  // orange
  exit:     { label: 'EXIT',     color: '#ef4444', glowColor: 'rgba(239,68,68,0.6)' },    // red
}

// Track state for animation
interface TrackState {
  id: string
  phase: Phase
  targetX: number      // target X position for animation
  currentX: number     // current animated X position
  y: number            // Y position (lane)
  velocity: number     // movement speed
  dwellTime: number    // time in current zone (ms)
  lastZoneId: string | null
  entryTime: number
}

// Animation constants
const PARTICLE_SIZE = 6
const LANE_HEIGHT = 12
const ANIMATION_SPEED = 0.08 // lerp factor
const UPDATE_INTERVAL = 50  // ms

export default function JourneyFlowStream() {
  const { tracks } = useTracking()
  const { regions } = useRoi()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackStatesRef = useRef<Map<string, TrackState>>(new Map())
  const [phaseCounts, setPhaseCounts] = useState<Record<Phase, number>>({
    entry: 0, browse: 0, engage: 0, dwell: 0, checkout: 0, exit: 0
  })
  
  // Classify ROIs by type
  const roiTypes = useMemo(() => {
    const checkoutRois = new Set<string>()
    const entranceRois = new Set<string>()
    const engagementRois = new Set<string>()
    
    regions.forEach(roi => {
      const name = roi.name.toLowerCase()
      if (name.includes('checkout') || name.includes('queue') || name.includes('cashier') || name.includes('service')) {
        checkoutRois.add(roi.id)
      } else if (name.includes('entrance') || name.includes('entry') || name.includes('exit') || name.includes('door')) {
        entranceRois.add(roi.id)
      } else {
        engagementRois.add(roi.id)
      }
    })
    
    return { checkoutRois, entranceRois, engagementRois }
  }, [regions])
  
  // Point-in-polygon helper
  const isInRoi = (x: number, z: number, roi: typeof regions[0]): boolean => {
    const vertices = roi.vertices
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
  
  // Determine phase for a track
  const determinePhase = (
    trackId: string,
    pos: { x: number; z: number },
    velocity: number,
    existingState: TrackState | undefined
  ): { phase: Phase; zoneId: string | null } => {
    const now = Date.now()
    
    // Check which ROI the track is in
    let currentZoneId: string | null = null
    let isInCheckout = false
    let isInEntrance = false
    let isInEngagement = false
    
    for (const roi of regions) {
      if (isInRoi(pos.x, pos.z, roi)) {
        currentZoneId = roi.id
        if (roiTypes.checkoutRois.has(roi.id)) isInCheckout = true
        if (roiTypes.entranceRois.has(roi.id)) isInEntrance = true
        if (roiTypes.engagementRois.has(roi.id)) isInEngagement = true
        break
      }
    }
    
    // New track = entry phase
    if (!existingState) {
      return { phase: 'entry', zoneId: currentZoneId }
    }
    
    // Recent entry (< 3 seconds)
    if (now - existingState.entryTime < 3000) {
      return { phase: 'entry', zoneId: currentZoneId }
    }
    
    // In checkout zone
    if (isInCheckout) {
      return { phase: 'checkout', zoneId: currentZoneId }
    }
    
    // In entrance/exit zone after being in store
    if (isInEntrance && existingState.phase !== 'entry') {
      return { phase: 'exit', zoneId: currentZoneId }
    }
    
    // In engagement zone
    if (isInEngagement) {
      // Check dwell time in this zone
      const sameZone = existingState.lastZoneId === currentZoneId
      const dwellTime = sameZone ? existingState.dwellTime + UPDATE_INTERVAL : 0
      
      // Dwell if stopped for > 5 seconds
      if (dwellTime > 5000 && velocity < 0.3) {
        return { phase: 'dwell', zoneId: currentZoneId }
      }
      return { phase: 'engage', zoneId: currentZoneId }
    }
    
    // Moving through store = browse
    return { phase: 'browse', zoneId: currentZoneId }
  }
  
  // Get X position for phase
  const getPhaseX = (phase: Phase, canvasWidth: number): number => {
    const phaseIndex = PHASES.indexOf(phase)
    const sectionWidth = canvasWidth / PHASES.length
    return sectionWidth * phaseIndex + sectionWidth / 2
  }
  
  // Update track states
  useEffect(() => {
    const interval = setInterval(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      
      const width = canvas.getBoundingClientRect().width
      const height = canvas.getBoundingClientRect().height
      const states = trackStatesRef.current
      const now = Date.now()
      
      // Track IDs that are still active
      const activeIds = new Set<string>()
      const counts: Record<Phase, number> = {
        entry: 0, browse: 0, engage: 0, dwell: 0, checkout: 0, exit: 0
      }
      
      // Assign lanes to tracks (vertical distribution)
      const maxLanes = Math.floor((height - 40) / LANE_HEIGHT)
      let laneIndex = 0
      
      tracks.forEach(track => {
        activeIds.add(track.id)
        const existing = states.get(track.id)
        const pos = track.venuePosition
        const vel = track.velocity || 0
        
        const { phase, zoneId } = determinePhase(track.id, pos, vel, existing)
        const targetX = getPhaseX(phase, width)
        
        counts[phase]++
        
        if (existing) {
          // Update existing track
          existing.phase = phase
          existing.targetX = targetX
          existing.velocity = vel
          existing.lastZoneId = zoneId
          if (zoneId === existing.lastZoneId) {
            existing.dwellTime += UPDATE_INTERVAL
          } else {
            existing.dwellTime = 0
          }
          // Animate X position
          existing.currentX += (targetX - existing.currentX) * ANIMATION_SPEED
        } else {
          // New track - assign a lane
          const y = 30 + (laneIndex % maxLanes) * LANE_HEIGHT
          laneIndex++
          
          states.set(track.id, {
            id: track.id,
            phase,
            targetX,
            currentX: 0, // Start from left edge
            y,
            velocity: vel,
            dwellTime: 0,
            lastZoneId: zoneId,
            entryTime: now
          })
        }
      })
      
      // Remove tracks that are no longer active (they've exited)
      states.forEach((state, id) => {
        if (!activeIds.has(id)) {
          // Animate to exit before removing
          state.phase = 'exit'
          state.targetX = width + 20
          state.currentX += (state.targetX - state.currentX) * ANIMATION_SPEED
          
          // Remove once off-screen
          if (state.currentX > width + 10) {
            states.delete(id)
          }
        }
      })
      
      setPhaseCounts(counts)
    }, UPDATE_INTERVAL)
    
    return () => clearInterval(interval)
  }, [tracks, regions, roiTypes])
  
  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const render = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
      
      const width = rect.width
      const height = rect.height
      
      // Clear
      ctx.clearRect(0, 0, width, height)
      
      // Draw phase dividers and labels
      const sectionWidth = width / PHASES.length
      
      PHASES.forEach((phase, i) => {
        const x = sectionWidth * i
        
        // Vertical divider (except first)
        if (i > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.05)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, 20)
          ctx.lineTo(x, height - 20)
          ctx.stroke()
        }
        
        // Phase label at bottom
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.font = '8px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(PHASE_CONFIG[phase].label, x + sectionWidth / 2, height - 6)
      })
      
      // Draw particles
      const states = trackStatesRef.current
      
      states.forEach(state => {
        const config = PHASE_CONFIG[state.phase]
        
        // Animate towards target
        state.currentX += (state.targetX - state.currentX) * ANIMATION_SPEED
        
        // Draw trail
        const trailLength = 20
        const gradient = ctx.createLinearGradient(
          state.currentX - trailLength, state.y,
          state.currentX, state.y
        )
        gradient.addColorStop(0, 'transparent')
        gradient.addColorStop(1, config.color)
        
        ctx.strokeStyle = gradient
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(Math.max(0, state.currentX - trailLength), state.y)
        ctx.lineTo(state.currentX, state.y)
        ctx.stroke()
        
        // Draw particle with glow
        ctx.shadowColor = config.glowColor
        ctx.shadowBlur = 8 + (state.velocity * 4)
        
        ctx.fillStyle = config.color
        ctx.beginPath()
        ctx.arc(state.currentX, state.y, PARTICLE_SIZE / 2, 0, Math.PI * 2)
        ctx.fill()
        
        ctx.shadowBlur = 0
      })
      
      requestAnimationFrame(render)
    }
    
    const animationId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animationId)
  }, [])
  
  // Total active
  const totalActive = Object.values(phaseCounts).reduce((a, b) => a + b, 0)
  
  return (
    <div className="h-full flex flex-col p-4 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">JOURNEY FLOW</span>
        </div>
        <span className="text-[10px] text-gray-600 tabular-nums">{totalActive} active</span>
      </div>
      
      {/* Canvas */}
      <div className="flex-1 relative min-h-0">
        <canvas 
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>
      
      {/* Phase counts bar */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[rgba(255,255,255,0.04)]">
        {PHASES.map(phase => (
          <div key={phase} className="flex flex-col items-center">
            <div 
              className="w-4 h-1 rounded-full mb-1"
              style={{ 
                backgroundColor: PHASE_CONFIG[phase].color,
                opacity: phaseCounts[phase] > 0 ? 1 : 0.2
              }}
            />
            <span className="text-[9px] text-gray-500 tabular-nums">
              {phaseCounts[phase]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
