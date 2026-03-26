/**
 * TrendChart - Q4 of Neural Dashboard
 * 
 * Real-time line chart showing occupancy/flow trends.
 * Inspired by "Training Metrics" chart style.
 */

import { useState, useEffect, useRef } from 'react'
import { useTracking } from '../../context/TrackingContext'

const CHART_POINTS = 60 // 60 data points (last 60 seconds)
const UPDATE_INTERVAL = 1000 // 1 second

interface DataPoint {
  timestamp: number
  occupancy: number
  flow: number // entries - exits
}

export default function TrendChart() {
  const { tracks } = useTracking()
  const [history, setHistory] = useState<DataPoint[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const prevTracksRef = useRef(0)
  
  // Update history with current occupancy (with caching to prevent MQTT disconnect drops)
  useEffect(() => {
    const interval = setInterval(() => {
      const currentCount = tracks.size
      
      // Skip if tracks suddenly dropped to 0 (likely MQTT disconnect)
      // Use last known value instead
      if (currentCount === 0 && prevTracksRef.current > 0) {
        return // Don't update - keep showing last values
      }
      
      const flow = currentCount - prevTracksRef.current
      prevTracksRef.current = currentCount
      
      setHistory(prev => {
        const newPoint: DataPoint = {
          timestamp: Date.now(),
          occupancy: currentCount,
          flow,
        }
        const updated = [...prev, newPoint].slice(-CHART_POINTS)
        return updated
      })
    }, UPDATE_INTERVAL)
    
    return () => clearInterval(interval)
  }, [tracks])
  
  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || history.length < 2) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    
    const width = rect.width
    const height = rect.height
    const padding = { top: 10, right: 10, bottom: 20, left: 40 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom
    
    // Clear
    ctx.clearRect(0, 0, width, height)
    
    // Find max for scaling
    const maxOccupancy = Math.max(...history.map(d => d.occupancy), 10)
    
    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()
    }
    
    // Draw Y-axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.font = '9px monospace'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      const val = Math.round(maxOccupancy * (1 - i / 4))
      const y = padding.top + (chartHeight / 4) * i + 3
      ctx.fillText(String(val), padding.left - 5, y)
    }
    
    // Draw occupancy line
    const points: [number, number][] = history.map((d, i) => {
      const x = padding.left + (i / (CHART_POINTS - 1)) * chartWidth
      const y = padding.top + chartHeight - (d.occupancy / maxOccupancy) * chartHeight
      return [x, y]
    })
    
    // Gradient fill under line
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom)
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)')
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)')
    
    ctx.beginPath()
    ctx.moveTo(points[0][0], height - padding.bottom)
    points.forEach(([x, y]) => ctx.lineTo(x, y))
    ctx.lineTo(points[points.length - 1][0], height - padding.bottom)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()
    
    // Draw line
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    points.forEach(([x, y], i) => {
      if (i === 0) return
      ctx.lineTo(x, y)
    })
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.stroke()
    
    // Draw current value dot
    const lastPoint = points[points.length - 1]
    ctx.beginPath()
    ctx.arc(lastPoint[0], lastPoint[1], 4, 0, Math.PI * 2)
    ctx.fillStyle = '#3b82f6'
    ctx.fill()
    ctx.strokeStyle = '#0a0a0f'
    ctx.lineWidth = 2
    ctx.stroke()
    
    // Glow effect on dot
    ctx.shadowColor = '#3b82f6'
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(lastPoint[0], lastPoint[1], 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    
    // X-axis time labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.textAlign = 'center'
    ctx.fillText('-60s', padding.left, height - 5)
    ctx.fillText('-30s', padding.left + chartWidth / 2, height - 5)
    ctx.fillText('now', width - padding.right, height - 5)
    
  }, [history])
  
  // Current stats
  const avgOccupancy = history.length > 0 
    ? (history.reduce((sum, d) => sum + d.occupancy, 0) / history.length).toFixed(1)
    : '0'
  const trend = history.length >= 2 
    ? history[history.length - 1].occupancy - history[history.length - 2].occupancy 
    : 0

  return (
    <div className="h-full flex flex-col p-4 font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">OCCUPANCY TREND</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-500">
            AVG: <span className="text-white">{avgOccupancy}</span>
          </span>
          <span className="text-[10px] text-gray-400">
            {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} {Math.abs(trend)}
          </span>
        </div>
      </div>
      
      {/* Chart */}
      <div className="flex-1 relative min-h-0">
        <canvas 
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>
      
    </div>
  )
}
