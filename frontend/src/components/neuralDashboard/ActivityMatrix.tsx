/**
 * ActivityMatrix - Spatial activity panel (Neural Dashboard)
 *
 * Three layers:
 * - Density (dual-tone cyan / amber) — live headcount per cell
 * - Flow — 2–3s decay trail on movement
 * - Dwell mode — local accumulated time-in-cell
 * - Ghost toggle — faint venue floor outline for spatial context
 */

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { useTracksRef, useLiveMetricsRef } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import { countLiveFrameTracks } from '../../lib/frameOccupancy'
import Tooltip from './Tooltip'

const DOT_SIZE = 8
const DOT_GAP = 2
const GRID_UPDATE_INTERVAL = 500
const TRAIL_DECAY = 0.62 // ~2.5s fade at 500ms steps
const HOTSPOT_PERCENTILE = 0.85
const DWELL_COLOR_LOW = { h: 195, s: 70, l: 42 }
const DWELL_COLOR_HIGH = { h: 280, s: 75, l: 55 }

type ViewMode = 'density' | 'dwell'

interface ActivityMatrixProps {
  monochrome?: boolean
}

interface MatrixStats {
  hotSpots: number
  peakCell: number
  activeCells: number
}

interface HoverCell {
  row: number
  col: number
  live: number
  display: number
  dwellSec: number
}

export default function ActivityMatrix({ monochrome = false }: ActivityMatrixProps) {
  const tracksRef = useTracksRef()
  const liveMetricsRef = useLiveMetricsRef()
  const { venue } = useVenue()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const cachedGridRef = useRef<number[][] | null>(null)
  const trailGridRef = useRef<number[][] | null>(null)
  const dwellGridRef = useRef<number[][] | null>(null)
  const prevTrackCountRef = useRef(0)

  const venueW = venue?.width || 100
  const venueD = venue?.depth || 100
  const aspect = venueW / venueD
  const GRID_COLS = aspect >= 1 ? Math.round(24 * Math.min(aspect, 2)) : 24
  const GRID_ROWS = aspect >= 1 ? 16 : Math.round(16 * Math.min(1 / aspect, 2))

  const [viewMode, setViewMode] = useState<ViewMode>('density')
  const [showGhost, setShowGhost] = useState(false)
  const [liveGrid, setLiveGrid] = useState<number[][]>(() => emptyGrid(GRID_ROWS, GRID_COLS))
  const [displayGrid, setDisplayGrid] = useState<number[][]>(() => emptyGrid(GRID_ROWS, GRID_COLS))
  const [dwellGrid, setDwellGrid] = useState<number[][]>(() => emptyGrid(GRID_ROWS, GRID_COLS))
  const [displayTrackCount, setDisplayTrackCount] = useState(0)
  const [stats, setStats] = useState<MatrixStats>({ hotSpots: 0, peakCell: 0, activeCells: 0 })
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null)

  const initGrids = useCallback((rows: number, cols: number) => {
    trailGridRef.current = emptyGrid(rows, cols)
    dwellGridRef.current = emptyGrid(rows, cols)
    setLiveGrid(emptyGrid(rows, cols))
    setDisplayGrid(emptyGrid(rows, cols))
    setDwellGrid(emptyGrid(rows, cols))
  }, [])

  useEffect(() => {
    initGrids(GRID_ROWS, GRID_COLS)
  }, [GRID_ROWS, GRID_COLS, initGrids])

  useEffect(() => {
    const rebuild = () => {
      const currentTracks = tracksRef.current
      const frameOcc = liveMetricsRef.current.frameOccupancy
      const liveFrameTs = liveMetricsRef.current.liveFrameTs
      const currentCount = countLiveFrameTracks(currentTracks, liveFrameTs, frameOcc)
      setDisplayTrackCount(currentCount)

      if (currentCount === 0 && prevTrackCountRef.current > 0 && cachedGridRef.current) {
        setLiveGrid(cachedGridRef.current)
        return
      }
      prevTrackCountRef.current = currentCount

      const instant = emptyGrid(GRID_ROWS, GRID_COLS)
      const cellWidth = venueW / GRID_COLS
      const cellHeight = venueD / GRID_ROWS

      currentTracks.forEach(track => {
        const pos = track.venuePosition
        const col = Math.floor(pos.x / cellWidth)
        const row = Math.floor(pos.z / cellHeight)
        if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
          instant[row][col] += 1
        }
      })

      if (!trailGridRef.current) trailGridRef.current = emptyGrid(GRID_ROWS, GRID_COLS)
      if (!dwellGridRef.current) dwellGridRef.current = emptyGrid(GRID_ROWS, GRID_COLS)

      const trail = trailGridRef.current
      const dwellAcc = dwellGridRef.current

      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const live = instant[r][c]
          const prev = trail[r][c]
          trail[r][c] = live > 0 ? live : prev * TRAIL_DECAY

          if (live > 0) {
            dwellAcc[r][c] += GRID_UPDATE_INTERVAL
          } else {
            dwellAcc[r][c] *= 0.92
          }
        }
      }

      let peakCell = 0
      let activeCells = 0
      let hotSpots = 0
      const positives: number[] = []
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const v = trail[r][c]
          const live = instant[r][c]
          if (v > 0.08) activeCells++
          if (live > 0) {
            peakCell = Math.max(peakCell, live)
            positives.push(live)
          }
        }
      }
      if (positives.length > 0) {
        positives.sort((a, b) => a - b)
        const threshold = positives[Math.floor(positives.length * HOTSPOT_PERCENTILE)] ?? 1
        for (let r = 0; r < GRID_ROWS; r++) {
          for (let c = 0; c < GRID_COLS; c++) {
            if (instant[r][c] >= threshold && instant[r][c] > 0) hotSpots++
          }
        }
      }

      if (currentCount > 0) cachedGridRef.current = instant

      setLiveGrid(instant)
      setDisplayGrid(trail.map(row => [...row]))
      setDwellGrid(dwellAcc.map(row => [...row]))
      setStats({ hotSpots, peakCell, activeCells })
    }

    rebuild()
    const interval = setInterval(rebuild, GRID_UPDATE_INTERVAL)
    return () => clearInterval(interval)
  }, [GRID_COLS, GRID_ROWS, venueW, venueD])

  const renderGrid = viewMode === 'density' ? displayGrid : dwellGrid

  const maxVal = useMemo(() => {
    let max = 0.15
    renderGrid.forEach(row => {
      row.forEach(val => {
        if (val > max) max = val
      })
    })
    return max
  }, [renderGrid])

  const hotspotThreshold = useMemo(() => {
    if (viewMode !== 'density') return maxVal
    const vals = liveGrid.flat().filter(v => v > 0).sort((a, b) => a - b)
    if (!vals.length) return maxVal
    return vals[Math.floor(vals.length * HOTSPOT_PERCENTILE)] ?? 1
  }, [liveGrid, maxVal, viewMode])

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

    if (showGhost) drawFloorGhost(ctx, width, height)

    renderGrid.forEach((row, rowIdx) => {
      row.forEach((val, colIdx) => {
        if (val < 0.06) return
        const x = colIdx * (DOT_SIZE + DOT_GAP)
        const y = rowIdx * (DOT_SIZE + DOT_GAP)
        const liveVal = liveGrid[rowIdx]?.[colIdx] ?? 0
        const intensity = Math.min(val / maxVal, 1)
        const isHot = viewMode === 'density' && liveVal >= hotspotThreshold && liveVal > 0

        const color = monochrome
          ? getMonoColor(intensity)
          : viewMode === 'density'
            ? getDualToneColor(intensity, isHot)
            : getDwellColor(intensity)

        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x + DOT_SIZE / 2, y + DOT_SIZE / 2, DOT_SIZE / 2 - 1, 0, Math.PI * 2)
        if (val > 0.08) {
          ctx.shadowColor = color
          ctx.shadowBlur = 3 + intensity * (isHot ? 10 : 6)
        }
        ctx.fill()
        ctx.shadowBlur = 0
      })
    })
  }, [renderGrid, liveGrid, maxVal, hotspotThreshold, monochrome, viewMode, showGhost, GRID_COLS, GRID_ROWS])

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY
    const col = Math.floor(px / (DOT_SIZE + DOT_GAP))
    const row = Math.floor(py / (DOT_SIZE + DOT_GAP))
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      setHoverCell(null)
      return
    }
    const live = liveGrid[row]?.[col] ?? 0
    const display = displayGrid[row]?.[col] ?? 0
    const dwellMs = dwellGrid[row]?.[col] ?? 0
    if (live < 0.05 && display < 0.08 && dwellMs < 100) {
      setHoverCell(null)
      return
    }
    setHoverCell({ row, col, live, display, dwellSec: dwellMs / 1000 })
  }

  const dwellSubtitle = useMemo(() => {
    let maxD = 0
    dwellGrid.forEach(row => row.forEach(v => { if (v > maxD) maxD = v }))
    return maxD > 500 ? `${Math.round(maxD / 1000)}s peak dwell` : null
  }, [dwellGrid])

  return (
    <div className="h-full flex flex-col p-2 font-mono text-[11px] min-h-0 overflow-hidden">
      {/* Header + toggles (always visible — bottom was clipped in 280px panel) */}
      <div className="shrink-0 mb-1 space-y-1">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.5)] shrink-0" />
            <Tooltip text="Live spatial map — density, flow trail, and dwell by floor cell">
              <span className="text-[9px] uppercase tracking-[0.15em] text-white/50 cursor-help leading-tight">
                SPATIAL ACTIVITY
              </span>
            </Tooltip>
          </div>
          <span className="text-[9px] text-cyan-400/70 tabular-nums shrink-0 pt-0.5">{displayTrackCount} live</span>
        </div>

        <div className="flex items-center justify-between gap-1 pl-3.5">
          <div className="flex rounded overflow-hidden border border-white/10 shrink-0">
            <ModeButton active={viewMode === 'density'} onClick={() => setViewMode('density')} label="Density" tip="Live headcount — cyan normal, amber hotspots" />
            <ModeButton active={viewMode === 'dwell'} onClick={() => setViewMode('dwell')} label="Dwell" tip="Time spent in each cell (recent memory)" />
          </div>
          <Tooltip text="Show venue floor outline for spatial context">
            <button
              type="button"
              onClick={() => setShowGhost(v => !v)}
              className={`px-1.5 py-0.5 text-[7px] uppercase tracking-wider rounded border transition-colors shrink-0 ${
                showGhost
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                  : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
            >
              Ghost
            </button>
          </Tooltip>
        </div>

        <div className="text-[8px] text-white/40 tabular-nums pl-3.5 truncate">
          {viewMode === 'density' ? (
            <>
              {stats.hotSpots} hot · peak {stats.peakCell} · {stats.activeCells} cells
            </>
          ) : (
            <>
              {stats.activeCells} cells{dwellSubtitle ? ` · ${dwellSubtitle}` : ''}
            </>
          )}
        </div>
      </div>

      {/* Canvas — capped so header + legend always fit in 280px panel */}
      <div ref={wrapperRef} className="flex-1 flex items-center justify-center min-h-0 max-h-[168px] relative">
        <canvas
          ref={canvasRef}
          className="opacity-95 max-w-full max-h-full"
          style={{ imageRendering: 'pixelated' }}
          onMouseMove={handleCanvasMove}
          onMouseLeave={() => setHoverCell(null)}
        />
        {hoverCell && (
          <div
            className="absolute pointer-events-none px-2 py-1 rounded text-[9px] font-mono
              bg-[#1a1a24]/95 border border-white/15 text-white/90 shadow-lg tabular-nums"
            style={{
              left: '50%',
              bottom: 4,
              transform: 'translateX(-50%)',
            }}
          >
            {viewMode === 'density' ? (
              hoverCell.live > 0
                ? `${Math.round(hoverCell.live)} here now · trail ${hoverCell.display.toFixed(1)}`
                : `flow trail ${hoverCell.display.toFixed(1)}`
            ) : (
              hoverCell.live > 0
                ? `${Math.round(hoverCell.live)} here · ${Math.round(hoverCell.dwellSec)}s dwell`
                : `${Math.round(hoverCell.dwellSec)}s recent dwell`
            )}
          </div>
        )}
      </div>

      {/* Legend only (controls moved to header) */}
      <div className="shrink-0 mt-1 pt-1 border-t border-white/[0.04]">
        <div className="flex items-center justify-between text-[7px] text-white/35 px-0.5">
          <span>{viewMode === 'density' ? 'quiet' : 'brief'}</span>
          <div className="flex items-center gap-1">
            {viewMode === 'density' ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDualToneColor(0.5, false) }} />
                <span className="w-6 h-0.5 rounded" style={{ background: 'linear-gradient(90deg, hsl(195,70%,42%), hsl(38,90%,52%))' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDualToneColor(1, true) }} />
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDwellColor(0.2) }} />
                <span className="w-6 h-0.5 rounded" style={{ background: 'linear-gradient(90deg, hsl(195,70%,42%), hsl(280,75%,55%))' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getDwellColor(1) }} />
              </>
            )}
          </div>
          <span>{viewMode === 'density' ? 'busy' : 'lingering'}</span>
        </div>
      </div>
    </div>
  )
}

function ModeButton({ active, onClick, label, tip }: { active: boolean; onClick: () => void; label: string; tip: string }) {
  return (
    <Tooltip text={tip}>
      <button
        type="button"
        onClick={onClick}
        className={`px-2 py-0.5 text-[8px] uppercase tracking-wider transition-colors ${
          active ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/65'
        }`}
      >
        {label}
      </button>
    </Tooltip>
  )
}

function emptyGrid(rows: number, cols: number): number[][] {
  return Array(rows).fill(null).map(() => Array(cols).fill(0))
}

function drawFloorGhost(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const pad = 2
  ctx.save()
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.12)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2)
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(34, 211, 238, 0.03)'
  ctx.fillRect(pad, pad, width - pad * 2, height - pad * 2)
  const cx = width / 2
  const cy = height / 2
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.beginPath()
  ctx.moveTo(cx, pad)
  ctx.lineTo(cx, height - pad)
  ctx.moveTo(pad, cy)
  ctx.lineTo(width - pad, cy)
  ctx.stroke()
  ctx.restore()
}

/** Cyan for normal density; amber for top-tier hotspots. */
function getDualToneColor(intensity: number, isHotspot: boolean): string {
  if (intensity < 0.06) return 'rgba(15, 23, 42, 0.55)'
  if (isHotspot) {
    const t = Math.min(intensity, 1)
    const h = 38
    const s = 85 + t * 10
    const l = 45 + t * 12
    return `hsl(${h}, ${s}%, ${l}%)`
  }
  const t = Math.min(intensity, 1)
  const h = 195
  const s = 55 + t * 25
  const l = 28 + t * 22
  return `hsl(${h}, ${s}%, ${l}%)`
}

function getDwellColor(intensity: number): string {
  if (intensity < 0.06) return 'rgba(15, 23, 42, 0.55)'
  const t = Math.min(intensity, 1)
  const h = DWELL_COLOR_LOW.h + (DWELL_COLOR_HIGH.h - DWELL_COLOR_LOW.h) * t
  const s = DWELL_COLOR_LOW.s + (DWELL_COLOR_HIGH.s - DWELL_COLOR_LOW.s) * t
  const l = DWELL_COLOR_LOW.l + (DWELL_COLOR_HIGH.l - DWELL_COLOR_LOW.l) * t
  return `hsl(${h}, ${s}%, ${l}%)`
}

function getMonoColor(intensity: number): string {
  const clamped = Math.max(0, Math.min(intensity, 1))
  const value = Math.round(30 + clamped * 200)
  return `rgba(${value}, ${value}, ${value}, ${0.5 + clamped * 0.5})`
}
