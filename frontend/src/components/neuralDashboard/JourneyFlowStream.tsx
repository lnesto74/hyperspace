/**
 * JourneyFlowStream - Q4 of Neural Dashboard
 * 
 * Simplified dwell-time bar visualization showing how long each track
 * has been in the venue. Bars grow over time like a progress meter.
 * Color indicates current behavior state.
 */

import { useRef, useEffect, useState } from 'react'
import { useTracking } from '../../context/TrackingContext'

// Track visualization state
interface TrackBar {
  id: string
  entryTime: number    // when track first appeared
  dwellSec: number     // current dwell time in seconds
  velocity: number     // current velocity
  lane: number         // stable Y lane (hash-based)
  hue: number          // stable color hue (hash-based)
}

// Simple hash to get stable number from string
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

const MAX_DWELL_SEC = 300 // 5 min = full bar
const BAR_HEIGHT = 6
const BAR_GAP = 3
const UPDATE_MS = 200

export default function JourneyFlowStream() {
  const { tracks } = useTracking()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackBarsRef = useRef<Map<string, TrackBar>>(new Map())
  const [stats, setStats] = useState({ active: 0, avgDwell: 0, maxDwell: 0 })
  
  // Update track bars
  useEffect(() => {
    const interval = setInterval(() => {
      const bars = trackBarsRef.current
      const now = Date.now()
      const activeIds = new Set<string>()
      
      let totalDwell = 0
      let maxDwell = 0
      
      // Get canvas dimensions for lane calculation
      const canvas = canvasRef.current
      const height = canvas ? canvas.getBoundingClientRect().height - 40 : 200
      const maxLanes = Math.floor(height / (BAR_HEIGHT + BAR_GAP))
      
      tracks.forEach(track => {
        activeIds.add(track.id)
        const existing = bars.get(track.id)
        
        if (existing) {
          // Update existing
          existing.dwellSec = (now - existing.entryTime) / 1000
          existing.velocity = track.velocity || 0
        } else {
          // New track - assign stable lane and color from ID hash
          const hash = hashCode(track.id)
          bars.set(track.id, {
            id: track.id,
            entryTime: now,
            dwellSec: 0,
            velocity: track.velocity || 0,
            lane: hash % maxLanes,
            hue: (hash * 37) % 360, // spread hues
          })
        }
        
        const bar = bars.get(track.id)!
        totalDwell += bar.dwellSec
        if (bar.dwellSec > maxDwell) maxDwell = bar.dwellSec
      })
      
      // Remove exited tracks
      bars.forEach((_, id) => {
        if (!activeIds.has(id)) {
          bars.delete(id)
        }
      })
      
      setStats({
        active: tracks.size,
        avgDwell: tracks.size > 0 ? totalDwell / tracks.size : 0,
        maxDwell,
      })
    }, UPDATE_MS)
    
    return () => clearInterval(interval)
  }, [tracks])
  
  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    let animationId: number
    
    const render = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
      
      const width = rect.width
      const height = rect.height
      const barAreaHeight = height - 30
      
      // Clear
      ctx.fillStyle = '#0d0d14'
      ctx.fillRect(0, 0, width, height)
      
      // Draw time scale at bottom
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.font = '8px monospace'
      ctx.textAlign = 'center'
      const markers = [0, 60, 120, 180, 240, 300]
      markers.forEach(sec => {
        const x = 10 + (sec / MAX_DWELL_SEC) * (width - 20)
        ctx.fillText(sec < 60 ? '0' : `${Math.floor(sec / 60)}m`, x, height - 4)
      })
      
      // Draw bars
      const bars = trackBarsRef.current
      const maxLanes = Math.floor(barAreaHeight / (BAR_HEIGHT + BAR_GAP))
      
      // Group by lane for stacking
      const laneGroups = new Map<number, TrackBar[]>()
      bars.forEach(bar => {
        const lane = bar.lane % maxLanes
        if (!laneGroups.has(lane)) laneGroups.set(lane, [])
        laneGroups.get(lane)!.push(bar)
      })
      
      laneGroups.forEach((laneBars, lane) => {
        const y = 10 + lane * (BAR_HEIGHT + BAR_GAP)
        
        // Sort by dwell time for consistent rendering
        laneBars.sort((a, b) => a.dwellSec - b.dwellSec)
        
        laneBars.forEach((bar, idx) => {
          const progress = Math.min(bar.dwellSec / MAX_DWELL_SEC, 1)
          const barWidth = Math.max(4, progress * (width - 20))
          
          // Offset if multiple bars in same lane
          const yOffset = idx * 2
          
          // Color based on velocity (moving = cooler, stopped = warmer)
          const saturation = 70
          const lightness = 50 + bar.velocity * 10
          const hueShift = bar.velocity < 0.5 ? 30 : 0 // warmer when stopped
          const color = `hsl(${(bar.hue + hueShift) % 360}, ${saturation}%, ${lightness}%)`
          
          // Draw bar with gradient
          const gradient = ctx.createLinearGradient(10, 0, 10 + barWidth, 0)
          gradient.addColorStop(0, 'transparent')
          gradient.addColorStop(0.1, color)
          gradient.addColorStop(1, color)
          
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.roundRect(10, y + yOffset, barWidth, BAR_HEIGHT - 1, 2)
          ctx.fill()
          
          // Glow on tip
          ctx.shadowColor = color
          ctx.shadowBlur = 6
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(10 + barWidth, y + yOffset + BAR_HEIGHT / 2, 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
        })
      })
      
      animationId = requestAnimationFrame(render)
    }
    
    animationId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animationId)
  }, [])
  
  const formatTime = (sec: number) => {
    if (sec < 60) return `${Math.round(sec)}s`
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }
  
  return (
    <div className="h-full flex flex-col p-4 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse shadow-[0_0_8px_rgba(167,139,250,0.6)]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">DWELL STREAM</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-gray-600">
            AVG <span className="text-white">{formatTime(stats.avgDwell)}</span>
          </span>
          <span className="text-gray-600">
            MAX <span className="text-amber-400">{formatTime(stats.maxDwell)}</span>
          </span>
        </div>
      </div>
      
      {/* Canvas */}
      <div className="flex-1 relative min-h-0">
        <canvas 
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between mt-1 pt-1 border-t border-[rgba(255,255,255,0.04)]">
        <span className="text-[9px] text-gray-600">{stats.active} active journeys</span>
        <span className="text-[9px] text-gray-600">← dwell time →</span>
      </div>
    </div>
  )
}
