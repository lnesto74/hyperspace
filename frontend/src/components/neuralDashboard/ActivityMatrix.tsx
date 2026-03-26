/**
 * ActivityMatrix - Q3 of Neural Dashboard
 * 
 * Pixel/dot matrix visualization showing zone activity.
 * Inspired by "Cortical Activity" panel in neural dashboards.
 */

import { useMemo, useRef, useEffect } from 'react'
import { useTracking } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'

const GRID_COLS = 24
const GRID_ROWS = 16
const DOT_SIZE = 8
const DOT_GAP = 2

export default function ActivityMatrix() {
  const { tracks } = useTracking()
  const { regions } = useRoi()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  // Cache for last known good grid (prevents drop to empty on MQTT disconnect)
  const cachedGridRef = useRef<number[][] | null>(null)
  const cachedBoundsRef = useRef<{ minX: number; maxX: number; minZ: number; maxZ: number } | null>(null)
  const prevTrackCountRef = useRef(0)
  
  // Compute bounds from ROI vertices (actual tracked area)
  const bounds = useMemo(() => {
    if (regions.length === 0) return null
    
    let minX = Infinity, maxX = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    
    regions.forEach(roi => {
      roi.vertices.forEach(v => {
        if (v.x < minX) minX = v.x
        if (v.x > maxX) maxX = v.x
        if (v.z < minZ) minZ = v.z
        if (v.z > maxZ) maxZ = v.z
      })
    })
    
    // Add small padding (5%)
    const padX = (maxX - minX) * 0.05
    const padZ = (maxZ - minZ) * 0.05
    
    const newBounds = { 
      minX: minX - padX, 
      maxX: maxX + padX, 
      minZ: minZ - padZ, 
      maxZ: maxZ + padZ 
    }
    
    // Cache bounds for MQTT disconnect resilience
    cachedBoundsRef.current = newBounds
    return newBounds
  }, [regions])
  
  // Build occupancy grid from track positions with caching
  const gridData = useMemo(() => {
    const currentCount = tracks.size
    
    // If tracks suddenly dropped to 0, use cached grid
    if (currentCount === 0 && prevTrackCountRef.current > 0 && cachedGridRef.current) {
      return cachedGridRef.current
    }
    prevTrackCountRef.current = currentCount
    
    const grid: number[][] = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(0))
    
    // Use current bounds or cached bounds
    const activeBounds = bounds || cachedBoundsRef.current
    if (!activeBounds) return grid
    
    const width = activeBounds.maxX - activeBounds.minX
    const height = activeBounds.maxZ - activeBounds.minZ
    const cellWidth = width / GRID_COLS
    const cellHeight = height / GRID_ROWS
    
    tracks.forEach(track => {
      const pos = track.venuePosition
      // Map track position to grid cell using ROI bounds
      const col = Math.floor((pos.x - activeBounds.minX) / cellWidth)
      const row = Math.floor((pos.z - activeBounds.minZ) / cellHeight)
      
      if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
        grid[row][col] += 1
      }
    })
    
    // Cache the grid if we have tracks
    if (currentCount > 0) {
      cachedGridRef.current = grid
    }
    
    return grid
  }, [tracks, bounds])
  
  // Find max for normalization
  const maxVal = useMemo(() => {
    let max = 1
    gridData.forEach(row => {
      row.forEach(val => {
        if (val > max) max = val
      })
    })
    return max
  }, [gridData])
  
  // Draw on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const width = GRID_COLS * (DOT_SIZE + DOT_GAP)
    const height = GRID_ROWS * (DOT_SIZE + DOT_GAP)
    
    canvas.width = width
    canvas.height = height
    
    ctx.clearRect(0, 0, width, height)
    
    gridData.forEach((row, rowIdx) => {
      row.forEach((val, colIdx) => {
        const x = colIdx * (DOT_SIZE + DOT_GAP)
        const y = rowIdx * (DOT_SIZE + DOT_GAP)
        
        // Normalize value
        const intensity = val / maxVal
        
        // Color based on intensity (blue → cyan → green → yellow → red)
        const color = getHeatColor(intensity)
        
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x + DOT_SIZE / 2, y + DOT_SIZE / 2, DOT_SIZE / 2 - 1, 0, Math.PI * 2)
        ctx.fill()
        
        // Add glow for active cells
        if (val > 0) {
          ctx.shadowColor = color
          ctx.shadowBlur = 4 + intensity * 8
          ctx.fill()
          ctx.shadowBlur = 0
        }
      })
    })
  }, [gridData, maxVal])
  
  return (
    <div className="h-full flex flex-col p-4 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse shadow-[0_0_8px_rgba(167,139,250,0.6)]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">SPATIAL ACTIVITY</span>
        </div>
        <span className="text-[10px] text-gray-600 tabular-nums">{tracks.size} tracks</span>
      </div>
      
      {/* Matrix Canvas */}
      <div className="flex-1 flex items-center justify-center">
        <canvas 
          ref={canvasRef}
          className="opacity-90"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[rgba(255,255,255,0.04)]">
        <span className="text-[9px] text-gray-600">LOW</span>
        <div className="flex gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((v, i) => (
            <div 
              key={i}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: getHeatColor(v) }}
            />
          ))}
        </div>
        <span className="text-[9px] text-gray-600">HIGH</span>
      </div>
    </div>
  )
}

function getHeatColor(intensity: number): string {
  if (intensity === 0) return 'rgba(30, 41, 59, 0.4)'
  
  // HSL-based gradient: Blue (220°) → Cyan (180°) → Green (120°) → Yellow (60°) → Red (0°)
  const t = Math.min(intensity, 1)
  let h: number, s: number, l: number
  
  if (t < 0.25) {
    h = 220 - t * 160 // 220 → 180
    s = 0.6 + t * 0.3
    l = 0.3 + t * 0.15
  } else if (t < 0.5) {
    h = 180 - (t - 0.25) * 240 // 180 → 120
    s = 0.75 + (t - 0.25) * 0.25
    l = 0.4 + (t - 0.25) * 0.1
  } else if (t < 0.75) {
    h = 120 - (t - 0.5) * 240 // 120 → 60
    s = 0.9
    l = 0.45 + (t - 0.5) * 0.1
  } else {
    h = 60 - (t - 0.75) * 240 // 60 → 0
    s = 1.0
    l = 0.5 + (t - 0.75) * 0.15
  }
  
  return `hsl(${h}, ${s * 100}%, ${l * 100}%)`
}
