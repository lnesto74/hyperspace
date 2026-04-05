/**
 * PairDevicesModal — LaunchPad modal for pairing LiDAR placements with devices
 *
 * Drag-and-drop UX similar to EdgeCommissioningPage.
 * Shows placements on one side, available LiDARs on the other.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  X, Radio, Check, AlertCircle, Loader2, Link2, Unlink, MapPin, RefreshCw,
} from 'lucide-react'
import { API_BASE } from '../config/api'

// ─── Types ──────────────────────────────────────────────────────

interface EdgeLidar {
  lidarId: string
  ip: string
  mac: string
  vendor: string
  model: string
  reachable: boolean
  label?: string
}

interface EdgePlacement {
  id: string
  venueId: string
  layoutVersionId: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  lidarModelId: string
  modelName?: string
  label?: string
  range?: number
  mountHeight?: number
}

interface RoiBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface EdgePairing {
  id: string
  venueId: string
  edgeId: string
  placementId: string
  lidarId: string
  lidarIp?: string
}

interface PairDevicesModalProps {
  onClose: () => void
  venueId: string
  edgeId: string
  edgeTailscaleIp: string
  onPairingComplete: (pairedCount: number, totalPlacements: number) => void
}

// ─── Component ──────────────────────────────────────────────────

export default function PairDevicesModal({
  onClose,
  venueId,
  edgeId,
  edgeTailscaleIp,
  onPairingComplete,
}: PairDevicesModalProps) {
  // State
  const [lidars, setLidars] = useState<EdgeLidar[]>([])
  const [placements, setPlacements] = useState<EdgePlacement[]>([])
  const [pairings, setPairings] = useState<EdgePairing[]>([])
  const [roiBounds, setRoiBounds] = useState<RoiBounds | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draggedLidar, setDraggedLidar] = useState<EdgeLidar | null>(null)
  const [hoveredPlacementIndex, setHoveredPlacementIndex] = useState<number | null>(null)

  // Load data on mount
  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Fetch commissioned LiDARs (by venue), real-time inventory, placements, and pairings in parallel
      const [lidarsRes, inventoryRes, placementsRes, pairingsRes] = await Promise.all([
        fetch(`${API_BASE}/api/edge-commissioning/commissioned-lidars?venueId=${venueId}`),
        fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeTailscaleIp}/inventory`),
        fetch(`${API_BASE}/api/edge-commissioning/placements?venueId=${venueId}`),
        fetch(`${API_BASE}/api/edge-commissioning/pairings?venueId=${venueId}`),
      ])

      if (!lidarsRes.ok) throw new Error('Failed to load LiDARs')
      if (!placementsRes.ok) throw new Error('Failed to load placements')
      if (!pairingsRes.ok) throw new Error('Failed to load pairings')

      const [lidarsData, inventoryData, placementsData, pairingsData] = await Promise.all([
        lidarsRes.json(),
        inventoryRes.ok ? inventoryRes.json() : { lidars: [] },
        placementsRes.json(),
        pairingsRes.json(),
      ])

      // Build real-time reachability map from edge inventory
      const realtimeReachable = new Map<string, boolean>()
      for (const inv of (inventoryData.lidars || [])) {
        realtimeReachable.set(inv.ip, inv.reachable === true)
      }

      // Merge: use real-time reachability if available, otherwise offline
      const seenIps = new Set<string>()
      const mappedLidars: EdgeLidar[] = []

      // First add all LiDARs from real-time inventory (they are online)
      for (const inv of (inventoryData.lidars || [])) {
        if (seenIps.has(inv.ip)) continue
        seenIps.add(inv.ip)
        mappedLidars.push({
          lidarId: inv.lidarId || `lidar-${inv.ip.replace(/\./g, '-')}`,
          ip: inv.ip,
          mac: inv.mac || '',
          vendor: inv.vendor || 'RoboSense',
          model: inv.model || 'Unknown',
          reachable: inv.reachable === true,
          label: inv.label,
        })
      }

      // Then add commissioned LiDARs that aren't in real-time inventory (they are offline)
      for (const cl of (lidarsData.lidars || [])) {
        if (seenIps.has(cl.assignedIp)) continue
        seenIps.add(cl.assignedIp)
        mappedLidars.push({
          lidarId: `lidar-${cl.assignedIp.replace(/\./g, '-')}`,
          ip: cl.assignedIp,
          mac: cl.macAddress || '',
          vendor: cl.vendor || 'Unknown',
          model: cl.model || 'Unknown',
          reachable: false, // Not in real-time inventory = offline
          label: cl.label,
        })
      }

      // Sort by IP
      mappedLidars.sort((a, b) => {
        const aNum = parseInt(a.ip.split('.').pop() || '0')
        const bNum = parseInt(b.ip.split('.').pop() || '0')
        return aNum - bNum
      })

      setLidars(mappedLidars)
      setPlacements(placementsData.placements || [])
      setPairings(pairingsData.pairings || [])
      setRoiBounds(placementsData.roiBounds || null)
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [venueId, edgeId, edgeTailscaleIp])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Drag handlers
  const handleDragStart = (lidar: EdgeLidar) => {
    setDraggedLidar(lidar)
  }

  const handleDragEnd = () => {
    setDraggedLidar(null)
  }

  // Pair a placement with a LiDAR
  const pairPlacement = useCallback(async (placementId: string, lidar: EdgeLidar) => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/pairings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId,
          edgeId,
          edgeTailscaleIp,
          placementId,
          lidarId: lidar.lidarId,
          lidarIp: lidar.ip,
        }),
      })
      if (!res.ok) throw new Error('Failed to create pairing')
      const data = await res.json()
      setPairings(prev => {
        const filtered = prev.filter(p => p.placementId !== placementId)
        return [...filtered, data.pairing]
      })
    } catch (err: any) {
      setError(err.message || 'Failed to pair')
    }
  }, [venueId, edgeId, edgeTailscaleIp])

  // Unpair a placement
  const unpairPlacement = useCallback(async (placementId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/pairings/by-placement/${placementId}?venueId=${venueId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to unpair')
      setPairings(prev => prev.filter(p => p.placementId !== placementId))
    } catch (err: any) {
      setError(err.message || 'Failed to unpair')
    }
  }, [venueId])

  // Handle drop on placement
  const handleDrop = (placement: EdgePlacement) => {
    if (!draggedLidar) return
    pairPlacement(placement.id, draggedLidar)
    setDraggedLidar(null)
  }

  // Computed
  const getPairingForPlacement = (placementId: string) => pairings.find(p => p.placementId === placementId)
  const isLidarPaired = (lidar: EdgeLidar) => pairings.some(p => p.lidarId === lidar.lidarId || p.lidarIp === lidar.ip)
  const pairedCount = pairings.length
  const totalPlacements = placements.length
  const canConfirm = !isLoading

  // Handle confirm
  const handleConfirm = () => {
    onPairingComplete(pairedCount, totalPlacements)
  }

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[100] flex bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex flex-1 m-4 bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── Left: Available LiDARs ─── */}
        <div className="w-72 border-r border-gray-800 bg-gray-900/50 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-gray-200">Available LiDARs</span>
            </div>
            <button
              onClick={loadData}
              className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {isLoading ? (
              <div className="flex flex-col items-center py-8 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mb-2" />
                <span className="text-[10px]">Loading...</span>
              </div>
            ) : lidars.length === 0 ? (
              <div className="text-[11px] text-gray-500 text-center py-8">
                No LiDARs available.<br />Run Commission Edge first.
              </div>
            ) : (
              lidars.map(lidar => {
                const paired = isLidarPaired(lidar)
                return (
                  <div
                    key={lidar.lidarId}
                    draggable={!paired}
                    onDragStart={() => handleDragStart(lidar)}
                    onDragEnd={handleDragEnd}
                    className={`p-3 rounded-lg border transition-colors ${
                      paired
                        ? 'bg-green-900/30 border-green-700 opacity-60'
                        : lidar.reachable
                          ? 'bg-gray-800 border-gray-700 cursor-grab hover:border-blue-500 hover:bg-gray-750'
                          : 'bg-gray-800/50 border-gray-700 cursor-grab hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Online/Offline indicator dot */}
                      <div className={`w-2 h-2 rounded-full ${lidar.reachable ? 'bg-green-400' : 'bg-gray-500'}`} />
                      <Radio className={`w-4 h-4 ${lidar.reachable ? 'text-blue-400' : 'text-gray-500'}`} />
                      <span className={`font-medium text-sm ${lidar.reachable ? 'text-white' : 'text-gray-400'}`}>
                        {lidar.ip.split('.').pop()}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        {paired && <Check className="w-3 h-3 text-green-400" />}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {lidar.ip} • {lidar.vendor || 'RoboSense'}
                    </div>
                    <div className="mt-1 text-xs">
                      {lidar.reachable ? (
                        <span className="text-green-400">● Online</span>
                      ) : (
                        <span className="text-gray-500">○ Offline</span>
                      )}
                      {paired && <span className="text-green-400 ml-2">• Paired</span>}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-gray-800 text-[9px] text-gray-600">
            Drag a LiDAR to a placement to pair
          </div>
        </div>

        {/* ─── Right: Placements ─── */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <MapPin className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-gray-200">Pair Devices</span>
              <span className="text-xs text-gray-500">
                {pairedCount}/{totalPlacements} paired
              </span>
            </div>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-800">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Placements grid */}
          <div className="flex-1 overflow-auto p-4">
            {error && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-700 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            {isLoading ? (
              <div className="flex flex-col items-center py-16 text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                <span className="text-sm">Loading placements...</span>
              </div>
            ) : placements.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">No placements found</div>
                <div className="text-xs mt-1">Run LiDAR Planner first</div>
              </div>
            ) : (
              <>
                {/* Visual Viewport - ROI Wireframe */}
                {roiBounds && (
                  <div className="mb-4 bg-gray-900 rounded-lg border border-gray-700 p-2">
                    <div className="text-[10px] text-gray-500 mb-2 flex items-center justify-between">
                      <span>Placement Map</span>
                      <span>{placements.length} sensors</span>
                    </div>
                    <svg 
                      width="100%" 
                      height="180" 
                      viewBox={`0 0 ${Math.max(200, (roiBounds.maxX - roiBounds.minX) * 3 + 60)} ${Math.max(120, (roiBounds.maxZ - roiBounds.minZ) * 3 + 60)}`}
                      className="bg-gray-950 rounded"
                      preserveAspectRatio="xMidYMid meet"
                    >
                      {/* ROI boundary */}
                      <rect
                        x={30}
                        y={30}
                        width={(roiBounds.maxX - roiBounds.minX) * 3}
                        height={(roiBounds.maxZ - roiBounds.minZ) * 3}
                        fill="none"
                        stroke="#374151"
                        strokeWidth="1"
                        strokeDasharray="4,4"
                      />
                      
                      {/* Placements */}
                      {placements.map((p, i) => {
                        const scale = 3
                        const cx = 30 + (p.position.x - roiBounds.minX) * scale
                        const cy = 30 + (p.position.z - roiBounds.minZ) * scale
                        const pairing = getPairingForPlacement(p.id)
                        const isPaired = !!pairing
                        const isHovered = hoveredPlacementIndex === i + 1
                        const pairedLidar = pairing ? lidars.find(l => l.lidarId === pairing.lidarId || l.ip === pairing.lidarIp) : null
                        const isOnline = pairedLidar?.reachable ?? false
                        
                        let strokeColor = '#3b82f6' // blue - unpaired
                        let fillColor = 'rgba(59, 130, 246, 0.1)'
                        
                        if (isPaired && isOnline) {
                          strokeColor = '#22c55e' // green
                          fillColor = 'rgba(34, 197, 94, 0.15)'
                        } else if (isPaired && !isOnline) {
                          strokeColor = '#f59e0b' // amber
                          fillColor = 'rgba(245, 158, 11, 0.15)'
                        }
                        
                        const range = (p.range || 15) * scale * 0.6
                        
                        return (
                          <g key={p.id}>
                            <circle
                              cx={cx}
                              cy={cy}
                              r={range}
                              fill={fillColor}
                              stroke={strokeColor}
                              strokeWidth={isHovered ? 2 : 1}
                              opacity={isHovered ? 1 : 0.7}
                            />
                            <text
                              x={cx}
                              y={cy + 3}
                              textAnchor="middle"
                              fontSize="8"
                              fill={strokeColor}
                            >
                              {i + 1}
                            </text>
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                )}

                {/* Placements Grid */}
                <div className="grid grid-cols-3 gap-3">
                {placements.map((placement, idx) => {
                  const pairing = getPairingForPlacement(placement.id)
                  const pairedLidar = pairing ? lidars.find(l => l.lidarId === pairing.lidarId || l.ip === pairing.lidarIp) : null
                  const isOnline = pairedLidar?.reachable ?? false
                  
                  // ROI-relative coordinates
                  const roiX = roiBounds ? placement.position.x - roiBounds.minX : placement.position.x
                  const roiZ = roiBounds ? placement.position.z - roiBounds.minZ : placement.position.z

                  // Card color based on state
                  let cardClasses = 'p-3 rounded-lg border transition-all relative '
                  if (pairing) {
                    if (isOnline) {
                      cardClasses += 'bg-green-900/20 border-green-600'
                    } else {
                      cardClasses += 'bg-amber-900/20 border-amber-600'
                    }
                  } else {
                    cardClasses += 'bg-gray-800 border-gray-700'
                  }

                  return (
                    <div
                      key={placement.id}
                      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-blue-500', 'border-dashed') }}
                      onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-blue-500', 'border-dashed') }}
                      onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('ring-2', 'ring-blue-500', 'border-dashed'); handleDrop(placement) }}
                      onMouseEnter={() => setHoveredPlacementIndex(idx + 1)}
                      onMouseLeave={() => setHoveredPlacementIndex(null)}
                      className={cardClasses}
                    >
                      {/* Index number in bottom right */}
                      <span className="absolute bottom-2 right-2 text-2xl font-bold text-gray-600/50">
                        {idx + 1}
                      </span>

                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-gray-400">
                          {placement.id.substring(0, 8)}
                        </span>
                        {pairing ? (
                          <button
                            onClick={() => unpairPlacement(placement.id)}
                            className="p-1 hover:bg-red-900/50 rounded"
                            title="Unpair"
                          >
                            <Unlink className="w-3 h-3 text-red-400" />
                          </button>
                        ) : (
                          <Link2 className="w-3 h-3 text-gray-500" />
                        )}
                      </div>

                      <div className="text-xs text-gray-400 space-y-1">
                        <div>
                          <span className="text-gray-500">DWG:</span>{' '}
                          ({placement.position.x.toFixed(1)}, {placement.position.z.toFixed(1)})
                        </div>
                        <div>
                          <span className="text-blue-400">ROI:</span>{' '}
                          <span className="text-blue-300">({roiX.toFixed(1)}, {roiZ.toFixed(1)})</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Height:</span> {(placement.mountHeight || placement.position.y || 3.0).toFixed(1)}m
                        </div>
                        {placement.modelName && (
                          <div>
                            <span className="text-gray-500">Model:</span> {placement.modelName}
                          </div>
                        )}
                      </div>

                      {pairing ? (
                        <div className="mt-2 pt-2 border-t border-gray-700">
                          <div className={`flex items-center gap-1 text-xs ${isOnline ? 'text-green-400' : 'text-amber-400'}`}>
                            <Check className="w-3 h-3" />
                            <span>Paired: {pairedLidar?.ip?.split('.').pop() || pairing.lidarIp}</span>
                            {!isOnline && <span className="text-amber-500 ml-1">(Offline)</span>}
                          </div>
                          {pairing.lidarIp && (
                            <div className="text-xs text-gray-500 mt-0.5">{pairing.lidarIp}</div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 pt-2 border-t border-gray-700">
                          <div className="flex items-center gap-1 text-xs text-amber-400">
                            <AlertCircle className="w-3 h-3" />
                            <span>Unpaired - drop LiDAR here</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
            <div className="text-[11px] text-gray-500">
              {pairedCount === 0 ? (
                <span className="text-amber-400">No devices paired — will use simulation mode</span>
              ) : pairedCount === totalPlacements ? (
                <span className="text-green-400">All placements paired!</span>
              ) : (
                `${totalPlacements - pairedCount} placements remaining`
              )}
            </div>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-4 py-2 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Check className="w-4 h-4" />
              {pairedCount === 0 ? 'Skip (Simulation)' : 'Confirm Pairing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
