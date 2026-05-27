/**
 * ActivityMatrix - Q3 of Neural Dashboard
 * 
 * Pixel/dot matrix visualization showing zone activity.
 * Inspired by "Cortical Activity" panel in neural dashboards.
 */

import { useMemo, useRef, useEffect, useState } from 'react'
import { useTracksRef, useLiveMetricsRef } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import { countLiveFrameTracks } from '../../lib/frameOccupancy'
import Tooltip from './Tooltip'

const DOT_SIZE = 8
const DOT_GAP = 2
const GRID_UPDATE_INTERVAL = 500 // Rebuild grid at most every 500ms (~2fps)

interface ActivityMatrixProps {
  monochrome?: boolean
}

export default function ActivityMatrix({ monochrome = false }: ActivityMatrixProps) {
  const tracksRef = useTracksRef()
  const liveMetricsRef = useLiveMetricsRef()
  const { venue } = useVenue()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  // Cache for last known good grid (prevents drop on MQTT disconnect)
  const cachedGridRef = useRef<number[][] | null>(null)
  const prevTrackCountRef = useRef(0)
  
  // Use venue dimensions for grid aspect ratio (match the real store layout)
  const venueW = venue?.width || 100
  const venueD = venue?.depth || 100
  const aspect = venueW / venueD
  const GRID_COLS = aspect >= 1 ? Math.round(24 * Math.min(aspect, 2)) : 24
  const GRID_ROWS = aspect >= 1 ? 16 : Math.round(16 * Math.min(1 / aspect, 2))

  // Throttled grid — rebuild on a fixed interval, not on every tracks change
  const [gridData, setGridData] = useState<number[][]>(() =>
    Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(0))
  )
  const [displayTrackCount, setDisplayTrackCount] = useState(0)

  useEffect(() => {
    const rebuild = () => {
      const currentTracks = tracksRef.current
      const frameOcc = liveMetricsRef.current.frameOccupancy
      const liveFrameTs = liveMetricsRef.current.liveFrameTs
      const currentCount = countLiveFrameTracks(currentTracks, liveFrameTs, frameOcc)
      setDisplayTrackCount(currentCount)
      
      if (currentCount === 0 && prevTrackCountRef.current > 0 && cachedGridRef.current) {
        setGridData(cachedGridRef.current)
        return
      }
      prevTrackCountRef.current = currentCount
      
      const grid: number[][] = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(0))
      const cellWidth = venueW / GRID_COLS
      const cellHeight = venueD / GRID_ROWS
      
      currentTracks.forEach(track => {
        const pos = track.venuePosition
        const col = Math.floor(pos.x / cellWidth)
        const row = Math.floor(pos.z / cellHeight)
        if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
          grid[row][col] += 1
        }
      })
      
      if (currentCount > 0) {
        cachedGridRef.current = grid
      }
      setGridData(grid)
    }
    
    rebuild()
    const interval = setInterval(rebuild, GRID_UPDATE_INTERVAL)
    return () => clearInterval(interval)
  }, [GRID_COLS, GRID_ROWS, venueW, venueD])
  
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
        const color = monochrome ? getMonoColor(intensity) : getHeatColor(intensity)
        
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
  }, [gridData, maxVal, monochrome])
  
  return (
    <div className="h-full flex flex-col p-4 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse shadow-[0_0_8px_rgba(167,139,250,0.6)]" />
          <Tooltip text="Heatmap of track density across the venue floor plan">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/50 cursor-help">SPATIAL ACTIVITY</span>
          </Tooltip>
        </div>
        <Tooltip text="Number of people currently being tracked">
          <span className="text-[10px] text-white/45 tabular-nums cursor-help">{displayTrackCount} tracks</span>
        </Tooltip>
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
        <span className="text-[9px] text-white/45">LOW</span>
        <div className="flex gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((v, i) => (
            <div 
              key={i}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: monochrome ? getMonoColor(v) : getHeatColor(v) }}
            />
          ))}
        </div>
        <span className="text-[9px] text-white/45">HIGH</span>
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

function getMonoColor(intensity: number): string {
  const clamped = Math.max(0, Math.min(intensity, 1))
  const value = Math.round(30 + clamped * 200)
  return `rgba(${value}, ${value}, ${value}, ${0.5 + clamped * 0.5})`
}
