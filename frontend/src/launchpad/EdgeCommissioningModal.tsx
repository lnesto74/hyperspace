/**
 * EdgeCommissioningModal — LaunchPad modal for commissioning Edge devices
 *
 * Same style as FixtureClassifyModal / RoiDrawingModal.
 * Scans for Edge devices, shows LiDAR inventory, allows basic commissioning.
 * Does NOT replace or impact EdgeCommissioningPage — this is a simplified
 * LaunchPad-specific modal.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  X, Server, Radio, Wifi, WifiOff, RefreshCw, Check, AlertCircle, Loader2, Wand2,
} from 'lucide-react'
import { API_BASE } from '../config/api'
import LidarCommissioningWizard from '../components/edgeCommissioning/LidarCommissioningWizard'

// ─── Types ──────────────────────────────────────────────────────

interface EdgeDevice {
  edgeId: string
  hostname: string
  displayName: string
  tailscaleIp: string
  online: boolean
  lastSeen: string
  os: string
  tags: string[]
}

interface EdgeLidar {
  lidarId: string
  ip: string
  mac: string
  vendor: string
  model: string
  reachable: boolean
  ports: number[]
  label?: string
}

interface EdgeCommissioningModalProps {
  onClose: () => void
  venueId: string
  layoutVersionId?: string
  onCommissioned: (edgeId: string, edgeHostname: string, edgeTailscaleIp: string, lidarCount: number) => void
}

// ─── Component ──────────────────────────────────────────────────

export default function EdgeCommissioningModal({
  onClose,
  venueId,
  layoutVersionId,
  onCommissioned,
}: EdgeCommissioningModalProps) {
  // State
  const [edges, setEdges] = useState<EdgeDevice[]>([])
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [lidars, setLidars] = useState<EdgeLidar[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isScanningLidars, setIsScanningLidars] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWizard, setShowWizard] = useState(false)

  // Scan for Edge devices
  const scanEdges = useCallback(async () => {
    setIsScanning(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/scan-edges`)
      if (!res.ok) throw new Error('Failed to scan for Edge devices')
      const data = await res.json()
      const edgeDevices = data.edges || []
      setEdges(edgeDevices)
      // Auto-select first online device
      const onlineEdge = edgeDevices.find((e: EdgeDevice) => e.online)
      if (onlineEdge && !selectedEdgeId) {
        setSelectedEdgeId(onlineEdge.edgeId)
      }
    } catch (err: any) {
      setError(err.message || 'Scan failed')
    } finally {
      setIsScanning(false)
    }
  }, [selectedEdgeId])

  // Fetch all commissioned LiDARs for the selected edge (globally available)
  const scanLidars = useCallback(async () => {
    if (!selectedEdgeId) return

    setIsScanningLidars(true)
    setError(null)
    try {
      // Get ALL commissioned LiDARs for this edge (they can be re-paired to any venue)
      const res = await fetch(`${API_BASE}/api/edge-commissioning/commissioned-lidars?edgeId=${selectedEdgeId}`)
      if (!res.ok) throw new Error('Failed to get available LiDARs')
      const data = await res.json()
      // Map commissioned LiDARs to EdgeLidar format
      const seenIps = new Set<string>()
      const mappedLidars = (data.lidars || [])
        .filter((cl: any) => {
          if (seenIps.has(cl.assignedIp)) return false
          seenIps.add(cl.assignedIp)
          return true
        })
        .map((cl: any) => ({
          lidarId: `lidar-${cl.assignedIp.replace(/\./g, '-')}`,
          ip: cl.assignedIp,
          mac: cl.macAddress || '',
          vendor: cl.vendor || 'Unknown',
          model: cl.model || 'Unknown',
          reachable: cl.status === 'active',
          ports: [],
          label: cl.label,
        }))
      setLidars(mappedLidars)
    } catch (err: any) {
      setError(err.message || 'LiDAR scan failed')
      setLidars([])
    } finally {
      setIsScanningLidars(false)
    }
  }, [selectedEdgeId])

  // Initial scan on mount
  useEffect(() => {
    scanEdges()
  }, [])

  // Scan LiDARs when edge is selected
  useEffect(() => {
    if (selectedEdgeId) {
      scanLidars()
    }
  }, [selectedEdgeId])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Computed values
  const selectedEdge = edges.find(e => e.edgeId === selectedEdgeId)
  const onlineEdges = edges.filter(e => e.online)
  const canConfirm = selectedEdge?.online && lidars.length > 0

  // Handle confirm
  const handleConfirm = useCallback(() => {
    if (!selectedEdgeId) return
    const edge = edges.find(e => e.edgeId === selectedEdgeId)
    if (!edge) return
    const reachableCount = lidars.filter(l => l.reachable).length
    onCommissioned(
      selectedEdgeId,
      edge.displayName || edge.hostname,
      edge.tailscaleIp,
      reachableCount
    )
  }, [selectedEdgeId, edges, lidars, onCommissioned])

  // Handle wizard complete
  const handleWizardComplete = useCallback(() => {
    setShowWizard(false)
    // Refresh LiDARs after wizard completes
    scanLidars()
  }, [scanLidars])

  // ─── Render ────────────────────────────────────────────────────

  // Show wizard if requested
  if (showWizard && selectedEdge) {
    return (
      <LidarCommissioningWizard
        venueId={venueId}
        edgeId={selectedEdge.edgeId}
        edgeTailscaleIp={selectedEdge.tailscaleIp}
        edgeHostname={selectedEdge.hostname}
        totalPlacements={4}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex flex-1 m-4 bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ─── Main content ─── */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-3">
              <Server className="w-4 h-4 text-indigo-400" />
              <span className="text-sm text-gray-200 font-medium">Commission Edge Device</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={scanEdges}
                disabled={isScanning}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50"
                title="Refresh Devices"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              </button>
              <div className="w-px h-5 bg-gray-800 mx-1" />
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Main area - Edge device list */}
          <div className="flex-1 overflow-auto p-4">
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {isScanning ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mb-3" />
                <span className="text-sm">Scanning for Edge devices...</span>
              </div>
            ) : edges.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <Server className="w-12 h-12 mb-3 opacity-30" />
                <span className="text-sm">No Edge devices found</span>
                <button
                  onClick={scanEdges}
                  className="mt-3 px-4 py-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                >
                  Scan Again
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">
                  {onlineEdges.length} of {edges.length} Edge Devices Online
                </div>
                {edges.map(edge => (
                  <button
                    key={edge.edgeId}
                    onClick={() => setSelectedEdgeId(edge.edgeId)}
                    className={`w-full p-3 rounded-lg border text-left transition-all ${
                      selectedEdgeId === edge.edgeId
                        ? 'bg-indigo-500/10 border-indigo-500/50'
                        : edge.online
                        ? 'bg-gray-900/50 border-gray-800 hover:border-gray-700'
                        : 'bg-gray-900/30 border-gray-800/50 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${edge.online ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-200 truncate">
                            {edge.displayName || edge.hostname}
                          </span>
                          {edge.online ? (
                            <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" />
                          ) : (
                            <WifiOff className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {edge.tailscaleIp} · {edge.os}
                        </div>
                      </div>
                      {selectedEdgeId === edge.edgeId && (
                        <Check className="w-4 h-4 text-indigo-400 shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Hint bar */}
          <div className="px-4 py-2 border-t border-gray-800 text-[9px] text-gray-600">
            Select an online Edge device to view connected LiDARs
          </div>
        </div>

        {/* ─── Right sidebar ─── */}
        <div className="w-72 border-l border-gray-800 bg-gray-900/50 flex flex-col shrink-0">
          {/* Status */}
          <div className="p-4 border-b border-gray-800">
            <div className="text-[11px] text-gray-400 font-medium mb-2">Commission Status</div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${selectedEdge?.online ? 'bg-green-400' : 'bg-gray-600'}`} />
                <span className="text-[11px] text-gray-300">
                  {selectedEdge ? (selectedEdge.online ? 'Edge Online' : 'Edge Offline') : 'No Edge Selected'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${lidars.length > 0 ? 'bg-green-400' : 'bg-gray-600'}`} />
                <span className="text-[11px] text-gray-300">
                  {lidars.length} LiDAR{lidars.length !== 1 ? 's' : ''} Available
                </span>
              </div>
            </div>
          </div>

          {/* LiDAR inventory */}
          <div className="p-4 border-b border-gray-800 flex-1 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">LiDAR Inventory</div>
              {selectedEdgeId && (
                <button
                  onClick={scanLidars}
                  disabled={isScanningLidars}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isScanningLidars ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              )}
            </div>

            {!selectedEdgeId ? (
              <div className="text-[11px] text-gray-600 text-center py-8">
                Select an Edge device to view LiDARs
              </div>
            ) : isScanningLidars ? (
              <div className="flex flex-col items-center py-8 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mb-2" />
                <span className="text-[10px]">Scanning...</span>
              </div>
            ) : lidars.length === 0 ? (
              <div className="text-[11px] text-gray-600 text-center py-8">
                No LiDARs commissioned on this Edge.<br />
                Use the Wizard to commission new LiDARs.
              </div>
            ) : (
              <div className="space-y-2">
                {lidars.map(lidar => (
                  <div
                    key={lidar.lidarId}
                    className={`p-2.5 rounded-lg border ${
                      lidar.reachable
                        ? 'bg-green-500/5 border-green-500/20'
                        : 'bg-gray-800/50 border-gray-700/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Radio className={`w-3.5 h-3.5 ${lidar.reachable ? 'text-green-400' : 'text-gray-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-gray-200 truncate">{lidar.label || lidar.model || 'LiDAR'}</div>
                        <div className="text-[9px] text-gray-500">{lidar.ip} · {lidar.vendor}</div>
                      </div>
                      {lidar.reachable && (
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Wizard button */}
            {selectedEdgeId && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <button
                  onClick={() => setShowWizard(true)}
                  disabled={!selectedEdge?.online}
                  className="w-full p-2 text-[10px] text-amber-400 hover:text-amber-300 flex items-center justify-center gap-1 bg-amber-900/10 border border-amber-700/30 rounded-lg disabled:opacity-50"
                >
                  <Wand2 className="w-3 h-3" />
                  Commission New LiDARs
                </button>
              </div>
            )}
          </div>

          {/* Confirm button */}
          <div className="p-4 border-t border-gray-800">
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="w-full h-9 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[12px] font-medium rounded-lg transition-colors"
            >
              <Check className="w-4 h-4" />
              Confirm Edge Setup
            </button>
            {!canConfirm && (
              <div className="text-[9px] text-gray-600 text-center mt-2">
                {!selectedEdge?.online
                  ? 'Select an online Edge device'
                  : lidars.length === 0
                  ? 'No LiDARs available'
                  : ''}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
