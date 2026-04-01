/**
 * NeuralDashboard - Multi-Panel Analytics View
 * 
 * Inspired by neural cortex / Bloomberg Terminal visualization style.
 * 
 * Layout:
 * ┌──────────┬─────────────────────────────────┬──────────┐
 * │ METRICS  │                                 │ AI       │
 * │ TOWER    │         3D CANVAS               │ DECISION │
 * │ 240px    │         (untouched)             │ FEED     │
 * │          │                                 │ 260px    │
 * ├──────────┼────────┬────────┬───────┬───────┤          │
 * │ SPATIAL  │ LIVE   │JOURNEY │FUNNEL │RETAIL │          │
 * │ ACTIVITY │JOURNEYS│ FLOW   │       │MEDIA  │          │
 * │ 240×280  │(keep)  │(Sankey)│(new)  │(new)  │          │
 * └──────────┴────────┴────────┴───────┴───────┴──────────┘
 */

import React, { useRef, useState, useEffect, memo } from 'react'
import { useTracking } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'
import LiveMetricsPanel from './LiveMetricsPanel'
import ActivityMatrix from './ActivityMatrix'
import JourneyFlowStream from './JourneyFlowStream'
import ConversionFunnel from './ConversionFunnel'
import JourneyFlowGraph from './JourneyFlowGraph'
import RetailMediaPanel from './RetailMediaPanel'
import AIDecisionFeed from './AIDecisionFeed'
import { useNeuralBatch } from './useNeuralBatch'

const LEFT_W = 240
const RIGHT_W = 260
const BOTTOM_H = 280

interface NeuralDashboardProps {
  children: React.ReactNode // The existing MainViewport
  enabled?: boolean // When false, just render children without dashboard layout
  leftOffset?: number // Extra padding from left edge when sidebar collapsed
}

export default function NeuralDashboard({ children, enabled = true, leftOffset = 0 }: NeuralDashboardProps) {
  const { tracks, setInterpolation } = useTracking()
  const { regions } = useRoi()
  const [monoMode, setMonoMode] = useState(false)
  
  // Toggle track interpolation when Neural Dashboard is enabled/disabled
  useEffect(() => {
    setInterpolation(enabled)
    return () => setInterpolation(false)
  }, [enabled, setInterpolation])
  
  // Throttled metrics — recompute at most once per second to avoid lag
  const [metrics, setMetrics] = useState({
    totalPax: 0,
    peakOccupancy: 0,
    activeZones: 0,
    avgOccupancy: 0,
  })
  
  const peakRef = useRef(0)
  const tracksRef = useRef(tracks)
  const regionsRef = useRef(regions)
  tracksRef.current = tracks
  regionsRef.current = regions
  
  useEffect(() => {
    if (!enabled) return
    
    const interval = setInterval(() => {
      const currentTracks = tracksRef.current
      const currentRegions = regionsRef.current
      const totalPax = currentTracks.size
      
      if (totalPax === 0) return // keep last known values
      
      // Count tracks per zone
      let activeZones = 0
      let totalOccupancy = 0
      
      if (currentRegions.length > 0) {
        for (const roi of currentRegions) {
          let count = 0
          currentTracks.forEach(track => {
            const pos = track.venuePosition
            if (isPointInPolygon(pos.x, pos.z, roi.vertices)) count++
          })
          if (count > 0) activeZones++
          totalOccupancy += count
        }
      }
      
      const avgOccupancy = currentRegions.length > 0 ? totalOccupancy / currentRegions.length : 0
      peakRef.current = Math.max(totalPax, peakRef.current)
      
      setMetrics({
        totalPax,
        peakOccupancy: peakRef.current,
        activeZones,
        avgOccupancy,
      })
    }, 1000) // Update metrics once per second
    
    return () => clearInterval(interval)
  }, [enabled])

  // Always render children in a stable container - only show/hide panels with CSS
  // This prevents React from remounting MainViewport when toggling
  return (
    <div className="absolute inset-0">
      {/* Side panels - absolutely positioned, hidden when disabled */}
      {enabled && (
        <>
          {/* Monochrome toggle */}
          <div
            className="absolute flex gap-2 z-20"
            style={{ top: 8, left: leftOffset + 12 }}
          >
            <button
              onClick={() => setMonoMode(!monoMode)}
              className={`px-3 py-1 text-[10px] uppercase tracking-[0.2em] border border-white/10 rounded transition-colors ${
                monoMode ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {monoMode ? 'B/W MODE' : 'COLOR MODE'}
            </button>
          </div>
          {/** Panels filtered when mono mode enabled — memoized to avoid re-renders from tracks context */}
          <MemoizedPanels
            monoMode={monoMode}
            leftOffset={leftOffset}
            metrics={metrics}
          />
        </>
      )}
      
      {/* 3D Digital Twin (MainViewport) - ALWAYS in same container position */}
      <div 
        className="absolute overflow-hidden bg-[#0a0a0f]"
        style={enabled 
          ? { top: 0, left: LEFT_W + leftOffset, right: RIGHT_W, bottom: BOTTOM_H }
          : { top: 0, left: 0, right: 0, bottom: 0 }
        }
      >
        {children}
      </div>
    </div>
  )
}

/**
 * MemoizedPanels — isolated from parent re-renders caused by tracks context churn.
 * Only re-renders when metrics, monoMode, or leftOffset actually change.
 */
interface PanelProps {
  monoMode: boolean
  leftOffset: number
  metrics: { totalPax: number; peakOccupancy: number; activeZones: number; avgOccupancy: number }
}

const MemoizedPanels = memo(function MemoizedPanels({ monoMode, leftOffset, metrics }: PanelProps) {
  const panelFilter = monoMode ? 'grayscale(1)' : 'none'
  const { data: batchData } = useNeuralBatch('1h')
  
  return (
    <>
      {/* LEFT COLUMN: Metrics Tower (top) + Activity Matrix (bottom) */}
      <div
        className="absolute top-0 overflow-hidden bg-[#0d0d14] border-r border-[rgba(255,255,255,0.04)] z-10"
        style={{ width: LEFT_W, bottom: BOTTOM_H, left: leftOffset, filter: panelFilter, paddingTop: 36 }}
      >
        <LiveMetricsPanel
          totalPax={metrics.totalPax}
          peakOccupancy={metrics.peakOccupancy}
          activeZones={metrics.activeZones}
          avgOccupancy={metrics.avgOccupancy}
          batchKpis={batchData.venueKpis}
        />
      </div>

      <div
        className="absolute bottom-0 overflow-hidden bg-[#0d0d14] border-r border-t border-[rgba(255,255,255,0.04)] z-10"
        style={{ width: LEFT_W, height: BOTTOM_H, left: leftOffset, filter: panelFilter }}
      >
        <ActivityMatrix monochrome={monoMode} />
      </div>

      {/* RIGHT COLUMN: AI Decision Feed (full height) */}
      <div
        className="absolute top-0 right-0 overflow-hidden bg-[#0d0d14] border-l border-[rgba(255,255,255,0.04)] z-10"
        style={{ width: RIGHT_W, bottom: 0, filter: panelFilter }}
      >
        <AIDecisionFeed batchAlerts={batchData.alerts} />
      </div>

      {/* BOTTOM BAR: 4 panels split equally between left col and right col */}
      <div
        className="absolute overflow-hidden bg-[#0d0d14] border-t border-[rgba(255,255,255,0.04)] z-10 flex"
        style={{ left: LEFT_W + leftOffset, right: RIGHT_W, bottom: 0, height: BOTTOM_H, filter: panelFilter }}
      >
        <div className="flex-1 border-r border-[rgba(255,255,255,0.04)] overflow-hidden">
          <JourneyFlowStream />
        </div>
        <div className="flex-1 border-r border-[rgba(255,255,255,0.04)] overflow-hidden">
          <JourneyFlowGraph />
        </div>
        <div className="flex-1 border-r border-[rgba(255,255,255,0.04)] overflow-hidden">
          <ConversionFunnel batchFunnel={batchData.funnel} />
        </div>
        <div className="flex-1 overflow-hidden">
          <RetailMediaPanel batchMedia={batchData.mediaSummary} />
        </div>
      </div>
    </>
  )
})

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
