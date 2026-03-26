/**
 * NeuralDashboard - 4-Quadrant Analytics View
 * 
 * Inspired by neural cortex visualization style.
 * Q1: Live Metrics Panel (top-left)
 * Q2: 3D Digital Twin (top-right - largest)
 * Q3: Activity Matrix (bottom-left)
 * Q4: Real-Time Charts (bottom-right)
 */

import { useMemo, useRef } from 'react'
import { useTracking } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import LiveMetricsPanel from './LiveMetricsPanel'
import ActivityMatrix from './ActivityMatrix'
import JourneyFlowStream from './JourneyFlowStream'

interface NeuralDashboardProps {
  children: React.ReactNode // The existing MainViewport
}

export default function NeuralDashboard({ children }: NeuralDashboardProps) {
  const { tracks } = useTracking()
  const { regions } = useRoi()
  useVenue() // For future use
  
  // Cache for last known good metrics (prevents drop to 0 on MQTT disconnect)
  const cachedMetricsRef = useRef({
    totalPax: 0,
    peakOccupancy: 0,
    activeZones: 0,
    avgOccupancy: 0,
  })
  
  // Aggregate metrics from tracks with caching
  const metrics = useMemo(() => {
    const totalPax = tracks.size
    
    // If we suddenly drop to 0, use cached values (MQTT disconnect)
    if (totalPax === 0 && cachedMetricsRef.current.totalPax > 0) {
      return cachedMetricsRef.current
    }
    
    // Count tracks per zone
    const zoneOccupancy = new Map<string, number>()
    regions.forEach(r => zoneOccupancy.set(r.id, 0))
    
    tracks.forEach(track => {
      const pos = track.venuePosition
      regions.forEach(roi => {
        if (isPointInPolygon(pos.x, pos.z, roi.vertices)) {
          zoneOccupancy.set(roi.id, (zoneOccupancy.get(roi.id) || 0) + 1)
        }
      })
    })
    
    const activeZones = Array.from(zoneOccupancy.entries()).filter(([_, count]) => count > 0).length
    const avgOccupancy = zoneOccupancy.size > 0 
      ? Array.from(zoneOccupancy.values()).reduce((a, b) => a + b, 0) / zoneOccupancy.size 
      : 0
    
    // Update peak if current is higher
    const peakOccupancy = Math.max(totalPax, cachedMetricsRef.current.peakOccupancy)
    
    // Cache the new values
    const newMetrics = { totalPax, peakOccupancy, activeZones, avgOccupancy }
    cachedMetricsRef.current = newMetrics
    
    return newMetrics
  }, [tracks, regions])

  return (
    <div className="absolute inset-0 grid grid-cols-[320px_1fr] grid-rows-[1fr_280px] gap-[1px] bg-[#0a0a0f]">
      {/* Q1: Live Metrics Panel */}
      <div className="relative overflow-hidden bg-[#0d0d14] border-r border-b border-[rgba(255,255,255,0.04)]">
        <LiveMetricsPanel 
          totalPax={metrics.totalPax}
          peakOccupancy={metrics.peakOccupancy}
          activeZones={metrics.activeZones}
          avgOccupancy={metrics.avgOccupancy}
        />
      </div>
      
      {/* Q2: 3D Digital Twin (MainViewport) */}
      <div className="relative overflow-hidden row-span-1 bg-[#0a0a0f]">
        {children}
      </div>
      
      {/* Q3: Activity Matrix */}
      <div className="relative overflow-hidden bg-[#0d0d14] border-r border-t border-[rgba(255,255,255,0.04)]">
        <ActivityMatrix />
      </div>
      
      {/* Q4: Journey Flow Stream */}
      <div className="relative overflow-hidden bg-[#0d0d14] border-t border-[rgba(255,255,255,0.04)]">
        <JourneyFlowStream />
      </div>
    </div>
  )
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
