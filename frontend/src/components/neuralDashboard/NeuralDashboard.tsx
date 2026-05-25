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

import React, { useRef, useState, useEffect, memo, createContext, useContext } from 'react'
import { useTrackingActions, useTracksRef } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'
import LiveMetricsPanel from './LiveMetricsPanel'
import ActivityMatrix from './ActivityMatrix'
import JourneyFlowStream from './JourneyFlowStream'
import ConversionFunnel from './ConversionFunnel'
import JourneyFlowGraph from './JourneyFlowGraph'
import RetailMediaPanel from './RetailMediaPanel'
import AIDecisionFeed from './AIDecisionFeed'
import { useNeuralBatch } from './useNeuralBatch'
import { useXRayData } from './useXRayData'
import type { XRayData } from './useXRayData'

const LEFT_W = 240
const RIGHT_W = 260
const BOTTOM_H = 280

export interface XRayFilters { shelves: boolean; queues: boolean; screens: boolean }
const defaultFilters: XRayFilters = { shelves: true, queues: true, screens: true }

interface XRayContextValue {
  xrayMode: boolean
  xrayData: XRayData | null
  xrayFilters: XRayFilters
  setXrayFilters: React.Dispatch<React.SetStateAction<XRayFilters>>
}

export const XRayContext = createContext<XRayContextValue>({
  xrayMode: false, xrayData: null, xrayFilters: defaultFilters, setXrayFilters: () => {}
})
export const useXRay = () => useContext(XRayContext)

interface NeuralDashboardProps {
  children: React.ReactNode
  enabled?: boolean
  leftOffset?: number
  isReplayMode?: boolean
}

export default function NeuralDashboard({ children, enabled = true, leftOffset = 0, isReplayMode = false }: NeuralDashboardProps) {
  const { setInterpolation } = useTrackingActions()
  const tracksRef = useTracksRef()
  const { regions } = useRoi()
  const [monoMode, setMonoMode] = useState(false)
  const [xrayMode, setXrayMode] = useState(false)
  const [xrayFilters, setXrayFilters] = useState<XRayFilters>(defaultFilters)
  const xrayData = useXRayData(enabled && xrayMode)
  
  // Toggle track interpolation when Neural Dashboard is enabled/disabled
  useEffect(() => {
    const trackCount = tracksRef.current.size
    const tooManyTracks = trackCount > 80
    setInterpolation(enabled && !isReplayMode && !tooManyTracks)
    return () => setInterpolation(false)
  }, [enabled, isReplayMode, setInterpolation, tracksRef])
  
  // Throttled metrics — recompute at most once per second to avoid lag
  const [metrics, setMetrics] = useState({
    totalPax: 0,
    peakOccupancy: 0,
    activeZones: 0,
    avgOccupancy: 0,
  })
  
  const peakRef = useRef(0)
  const regionsRef = useRef(regions)
  regionsRef.current = regions
  
  useEffect(() => {
    if (!enabled) return
    
    const interval = setInterval(() => {
      const currentTracks = tracksRef.current
      const currentRegions = regionsRef.current
      const totalPax = currentTracks.size
      
      if (totalPax === 0) return // keep last known values

      // Heavy ROI×track scan — skip when load would block the main thread
      const scanCost = totalPax * currentRegions.length
      if (scanCost > 8000) {
        peakRef.current = Math.max(totalPax, peakRef.current)
        setMetrics(prev => ({
          ...prev,
          totalPax,
          peakOccupancy: peakRef.current,
        }))
        return
      }
      
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
          {/* Mode toggles */}
          <div
            className="absolute flex gap-2 z-20"
            style={{ top: 8, left: leftOffset + 12 }}
          >
            <button
              onClick={() => setMonoMode(!monoMode)}
              className={`px-3 py-1 text-[10px] uppercase tracking-[0.2em] border border-white/10 rounded transition-colors ${
                monoMode ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'
              }`}
            >
              {monoMode ? 'B/W MODE' : 'COLOR MODE'}
            </button>
            <div className="flex border border-white/10 rounded overflow-hidden">
              <button
                onClick={() => setXrayMode(false)}
                className={`px-3 py-1 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                  !xrayMode ? 'bg-cyan-500/20 text-cyan-300 border-r border-white/10' : 'text-white/40 hover:text-white/70 border-r border-white/10'
                }`}
              >
                LIVE
              </button>
              <button
                onClick={() => setXrayMode(true)}
                className={`px-3 py-1 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                  xrayMode ? 'bg-cyan-500/20 text-cyan-300' : 'text-white/40 hover:text-white/70'
                }`}
              >
                X-RAY
              </button>
            </div>
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
      <XRayContext.Provider value={{ xrayMode: enabled && xrayMode, xrayData, xrayFilters, setXrayFilters }}>
        <div 
          className="absolute overflow-hidden bg-[#0a0a0f]"
          style={enabled 
            ? { top: 0, left: LEFT_W + leftOffset, right: RIGHT_W, bottom: BOTTOM_H }
            : { top: 0, left: 0, right: 0, bottom: 0 }
          }
        >
          {children}
        </div>
      </XRayContext.Provider>
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
  const [funnelRange, setFunnelRange] = useState<'1h' | '24h' | '7d'>('1h')
  const { data: batchData } = useNeuralBatch(funnelRange)
  
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
          <ConversionFunnel
            batchFunnel={batchData.funnel}
            range={funnelRange}
            onRangeChange={setFunnelRange}
          />
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
