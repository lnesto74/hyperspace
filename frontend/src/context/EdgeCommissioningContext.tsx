import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { useToast } from './ToastContext'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Types
export interface EdgeDevice {
  edgeId: string
  hostname: string
  displayName: string
  tailscaleIp: string
  online: boolean
  lastSeen: string
  os: string
  tags: string[]
  notes?: string | null
}

export interface EdgeLidar {
  lidarId: string
  ip: string
  mac: string
  vendor: string
  model: string
  reachable: boolean
  ports: number[]
}

export interface EdgeInventory {
  edgeId: string
  hostname: string
  tailscaleIp: string
  lidars: EdgeLidar[]
}

export interface EdgePlacement {
  id: string
  venueId: string
  layoutVersionId?: string
  source?: string
  modelId?: string
  modelName?: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  mountHeight: number
  fovHorizontal: number
  fovVertical: number
  range: number
  enabled: boolean
}

export interface RoiBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface DwgFixture {
  id: string
  group_id: string
  source: {
    layer: string
    block: string | null
    entity_type: string
  }
  pose2d: {
    x: number
    y: number
    rot_deg: number
  }
  footprint: {
    kind: 'rect' | 'poly'
    w: number
    d: number
    points: { x: number; y: number }[]
  }
}

export interface DwgLayout {
  fixtures: DwgFixture[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null
  unitScaleToM: number
}

export interface EdgePairing {
  id: string
  venueId: string
  edgeId: string
  edgeTailscaleIp?: string
  placementId: string
  lidarId: string
  lidarIp?: string
  createdAt: string
  updatedAt: string
}

export interface EdgeStatus {
  online: boolean
  edgeId: string
  hostname?: string
  tailscaleIp?: string
  appliedConfigHash?: string
  uptime?: number
  edgeVersion?: string
  lidarConnectionStatuses?: Record<string, boolean>
  mqttPublishStatus?: boolean
  lastError?: string
  error?: string
}

export interface DeployResult {
  success: boolean
  deploymentId: string
  configHash: string
  appliedConfigHash?: string
  lidarCount: number
  error?: string
}

export interface DeployHistoryItem {
  id: string
  venueId: string
  edgeId: string
  edgeTailscaleIp?: string
  configHash: string
  status: string
  edgeResponse?: any
  deploymentType?: 'simulator' | 'her'
  providerModule?: AlgorithmProvider
  herResponse?: any
  createdAt: string
}

export interface DebPackageConfig {
  downloadUrl: string
  aptRepo: string
  aptKey: string
  serviceName: string
  packageName: string
}

export interface AlgorithmProvider {
  providerId: string
  name: string
  version: string
  packageType: 'docker' | 'deb'
  // Docker config (if packageType === 'docker')
  dockerImage: string | null
  dockerRegistry?: string | null
  // Deb package config (if packageType === 'deb')
  debPackage: DebPackageConfig | null
  requiresGpu: boolean
  supportedLidarModels: string[]
  notes?: string
  website?: string
  docsUrl?: string
  isActive?: boolean
}

export interface HerStatus {
  mode: 'simulator' | 'her'
  containerRunning: boolean
  containerStatus: string | null
  lastError: string | null
  providerModule: AlgorithmProvider | null
  deploymentId: string | null
  startedAt: string | null
  uptimeSeconds: number | null
  recentLogs: string | null
}

export interface HerDeployResult {
  success: boolean
  deploymentId: string
  configHash: string
  lidarCount: number
  providerModule: { name: string; version: string }
  herResponse: any
  historyId: string
  error?: string
}

export interface CommissionedLidar {
  id: string
  venueId: string
  edgeId: string
  assignedIp: string
  label?: string
  originalIp?: string
  vendor?: string
  model?: string
  macAddress?: string
  commissionedAt?: string
  lastSeenAt?: string
  status: string
}

interface EdgeCommissioningContextType {
  // State
  edges: EdgeDevice[]
  selectedEdgeId: string | null
  edgeInventory: EdgeInventory | null
  commissionedLidars: CommissionedLidar[]
  placements: EdgePlacement[]
  pairings: EdgePairing[]
  edgeStatuses: Map<string, EdgeStatus>
  deployHistory: DeployHistoryItem[]
  roiBounds: RoiBounds | null
  dwgLayout: DwgLayout | null
  
  // HER State
  providers: AlgorithmProvider[]
  selectedProviderId: string | null
  herEnabled: boolean
  
  // Loading states
  isScanning: boolean
  isScanningLidars: boolean
  isLoadingInventory: boolean
  isLoadingPlacements: boolean
  isDeploying: boolean
  isLoadingProviders: boolean
  
  // Actions
  scanEdges: () => Promise<void>
  selectEdge: (edgeId: string | null) => void
  scanEdgeLidars: (edgeId: string) => Promise<void>
  fetchEdgeInventory: (edgeId: string) => Promise<void>
  fetchEdgeStatus: (edgeId: string) => Promise<EdgeStatus | null>
  loadPlacements: (venueId: string) => Promise<void>
  loadPairings: (venueId: string) => Promise<void>
  pairPlacement: (venueId: string, edgeId: string, edgeTailscaleIp: string, placementId: string, lidarId: string, lidarIp?: string) => Promise<void>
  unpairPlacement: (venueId: string, placementId: string) => Promise<void>
  deployToEdge: (edgeId: string, venueId: string) => Promise<DeployResult | null>
  loadDeployHistory: (venueId?: string, edgeId?: string) => Promise<void>
  loadCommissionedLidars: (venueId: string, edgeId?: string) => Promise<void>
  
  // HER Actions
  loadProviders: () => Promise<void>
  selectProvider: (providerId: string | null) => void
  setHerEnabled: (enabled: boolean) => void
  deployHer: (edgeId: string, venueId: string, providerId: string, mqttBrokerUrl?: string) => Promise<HerDeployResult | null>
  stopHer: (edgeId: string) => Promise<boolean>
  fetchHerStatus: (edgeId: string) => Promise<HerStatus | null>
  
  // Helpers
  getPairingForPlacement: (placementId: string) => EdgePairing | undefined
  getLidarById: (lidarId: string) => EdgeLidar | undefined
  getMergedLidars: () => EdgeLidar[]
  getSelectedProvider: () => AlgorithmProvider | undefined
  
  // Edge name management
  updateEdgeName: (edgeId: string, displayName: string, notes?: string) => Promise<void>
}

const EdgeCommissioningContext = createContext<EdgeCommissioningContextType | null>(null)

export function useEdgeCommissioning() {
  const context = useContext(EdgeCommissioningContext)
  if (!context) {
    throw new Error('useEdgeCommissioning must be used within EdgeCommissioningProvider')
  }
  return context
}

interface Props {
  children: ReactNode
}

export function EdgeCommissioningProvider({ children }: Props) {
  const { addToast } = useToast()
  
  // State
  const [edges, setEdges] = useState<EdgeDevice[]>([])
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [edgeInventory, setEdgeInventory] = useState<EdgeInventory | null>(null)
  const [placements, setPlacements] = useState<EdgePlacement[]>([])
  const [roiBounds, setRoiBounds] = useState<RoiBounds | null>(null)
  const [dwgLayout, setDwgLayout] = useState<DwgLayout | null>(null)
  const [pairings, setPairings] = useState<EdgePairing[]>([])
  const [edgeStatuses, setEdgeStatuses] = useState<Map<string, EdgeStatus>>(new Map())
  const [deployHistory, setDeployHistory] = useState<DeployHistoryItem[]>([])
  const [commissionedLidars, setCommissionedLidars] = useState<CommissionedLidar[]>([])
  
  // HER State
  const [providers, setProviders] = useState<AlgorithmProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [herEnabled, setHerEnabled] = useState(false)
  
  // Loading states
  const [isScanning, setIsScanning] = useState(false)
  const [isScanningLidars, setIsScanningLidars] = useState(false)
  const [isLoadingInventory, setIsLoadingInventory] = useState(false)
  const [isLoadingPlacements, setIsLoadingPlacements] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)

  // Scan for edge devices on tailnet
  const scanEdges = useCallback(async () => {
    setIsScanning(true)
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/scan-edges`)
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      setEdges(data.edges || [])
      addToast('success', `Found ${data.edges?.length || 0} edge devices`)
    } catch (err: any) {
      addToast('error', `Edge scan failed: ${err.message}`)
    } finally {
      setIsScanning(false)
    }
  }, [addToast])

  // Select an edge device
  const selectEdge = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId)
    if (!edgeId) {
      setEdgeInventory(null)
    }
  }, [])

  // Trigger LiDAR LAN scan on edge
  const scanEdgeLidars = useCallback(async (edgeId: string) => {
    setIsScanningLidars(true)
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/scan-lidars`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('LiDAR scan failed')
      const data = await res.json()
      addToast('success', `LiDAR scan complete: ${data.foundCount || 0} devices found`)
      // Automatically fetch updated inventory
      await fetchEdgeInventory(edgeId)
    } catch (err: any) {
      addToast('error', `LiDAR scan failed: ${err.message}`)
    } finally {
      setIsScanningLidars(false)
    }
  }, [addToast])

  // Fetch edge inventory (cached LiDAR list)
  const fetchEdgeInventory = useCallback(async (edgeId: string) => {
    setIsLoadingInventory(true)
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/inventory`)
      if (!res.ok) throw new Error('Inventory fetch failed')
      const data = await res.json()
      setEdgeInventory({
        edgeId: data.edgeId,
        hostname: data.hostname,
        tailscaleIp: data.tailscaleIp,
        lidars: data.lidars || [],
      })
    } catch (err: any) {
      addToast('error', `Failed to fetch inventory: ${err.message}`)
    } finally {
      setIsLoadingInventory(false)
    }
  }, [addToast])

  // Fetch edge status
  const fetchEdgeStatus = useCallback(async (edgeId: string): Promise<EdgeStatus | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/status`)
      if (!res.ok) throw new Error('Status fetch failed')
      const data = await res.json()
      const status: EdgeStatus = {
        online: data.online,
        edgeId: data.edgeId,
        hostname: data.hostname,
        tailscaleIp: data.tailscaleIp,
        appliedConfigHash: data.appliedConfigHash,
        uptime: data.uptime,
        edgeVersion: data.edgeVersion,
        lidarConnectionStatuses: data.lidarConnectionStatuses,
        mqttPublishStatus: data.mqttPublishStatus,
        lastError: data.lastError,
        error: data.error,
      }
      setEdgeStatuses(prev => new Map(prev).set(edgeId, status))
      return status
    } catch (err: any) {
      const errorStatus: EdgeStatus = { online: false, edgeId, error: err.message }
      setEdgeStatuses(prev => new Map(prev).set(edgeId, errorStatus))
      return errorStatus
    }
  }, [])

  // Load placements for a venue
  const loadPlacements = useCallback(async (venueId: string) => {
    setIsLoadingPlacements(true)
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/placements?venueId=${venueId}`)
      if (!res.ok) throw new Error('Failed to load placements')
      const data = await res.json()
      setPlacements(data.placements || [])
      if (data.roiBounds) {
        setRoiBounds(data.roiBounds)
      }
      if (data.dwgLayout) {
        setDwgLayout(data.dwgLayout)
      }
    } catch (err: any) {
      addToast('error', `Failed to load placements: ${err.message}`)
    } finally {
      setIsLoadingPlacements(false)
    }
  }, [addToast])

  // Load pairings for a venue
  const loadPairings = useCallback(async (venueId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/pairings?venueId=${venueId}`)
      if (!res.ok) throw new Error('Failed to load pairings')
      const data = await res.json()
      setPairings(data.pairings || [])
    } catch (err: any) {
      console.error('Failed to load pairings:', err)
    }
  }, [])

  // Pair a placement with a lidar
  const pairPlacement = useCallback(async (
    venueId: string,
    edgeId: string,
    edgeTailscaleIp: string,
    placementId: string,
    lidarId: string,
    lidarIp?: string
  ) => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/pairings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, edgeId, edgeTailscaleIp, placementId, lidarId, lidarIp }),
      })
      if (!res.ok) throw new Error('Failed to create pairing')
      const data = await res.json()
      setPairings(prev => {
        // Remove any existing pairing for this placement
        const filtered = prev.filter(p => p.placementId !== placementId)
        return [...filtered, data.pairing]
      })
      addToast('success', `Paired LiDAR ${lidarId} with placement`)
    } catch (err: any) {
      addToast('error', `Failed to pair: ${err.message}`)
    }
  }, [addToast])

  // Unpair a placement
  const unpairPlacement = useCallback(async (venueId: string, placementId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/pairings/by-placement/${placementId}?venueId=${venueId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete pairing')
      setPairings(prev => prev.filter(p => p.placementId !== placementId))
      addToast('success', 'Pairing removed')
    } catch (err: any) {
      addToast('error', `Failed to unpair: ${err.message}`)
    }
  }, [addToast])

  // Deploy configuration to edge
  const deployToEdge = useCallback(async (edgeId: string, venueId: string): Promise<DeployResult | null> => {
    setIsDeploying(true)
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId }),
      })
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Deploy failed')
      }
      
      addToast('success', `Deployed to edge: ${data.lidarCount} LiDARs configured`)
      
      // Refresh deploy history
      await loadDeployHistory(venueId, edgeId)
      
      return data
    } catch (err: any) {
      addToast('error', `Deploy failed: ${err.message}`)
      return null
    } finally {
      setIsDeploying(false)
    }
  }, [addToast])

  // Load deploy history
  const loadDeployHistory = useCallback(async (venueId?: string, edgeId?: string) => {
    try {
      let url = `${API_BASE}/api/edge-commissioning/deploy-history?limit=20`
      if (venueId) url += `&venueId=${venueId}`
      if (edgeId) url += `&edgeId=${edgeId}`
      
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load deploy history')
      const data = await res.json()
      setDeployHistory(data.history || [])
    } catch (err: any) {
      console.error('Failed to load deploy history:', err)
    }
  }, [])

  // Load commissioned LiDARs for a venue
  const loadCommissionedLidars = useCallback(async (venueId: string, edgeId?: string) => {
    try {
      let url = `${API_BASE}/api/edge-commissioning/commissioned-lidars?venueId=${venueId}`
      if (edgeId) url += `&edgeId=${edgeId}`
      
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load commissioned lidars')
      const data = await res.json()
      setCommissionedLidars(data.lidars || [])
    } catch (err: any) {
      console.error('Failed to load commissioned lidars:', err)
    }
  }, [])

  // Helpers
  const getPairingForPlacement = useCallback((placementId: string) => {
    return pairings.find(p => p.placementId === placementId)
  }, [pairings])

  const getLidarById = useCallback((lidarId: string) => {
    return edgeInventory?.lidars.find(l => l.lidarId === lidarId)
  }, [edgeInventory])

  // Get merged list of LiDARs (commissioned + scanned, with online status)
  const getMergedLidars = useCallback((): EdgeLidar[] => {
    const scannedIps = new Set(edgeInventory?.lidars.map(l => l.ip) || [])
    const result: EdgeLidar[] = []

    // First add all LiDARs from edge inventory (preserving their actual reachable status)
    if (edgeInventory?.lidars) {
      result.push(...edgeInventory.lidars)
    }

    // Then add commissioned LiDARs that aren't currently online
    for (const cl of commissionedLidars) {
      if (!scannedIps.has(cl.assignedIp)) {
        result.push({
          lidarId: `lidar-${cl.assignedIp.replace(/\./g, '-')}`,
          ip: cl.assignedIp,
          mac: cl.macAddress || '',
          vendor: cl.vendor || 'RoboSense',
          model: cl.model || '',
          reachable: false, // offline
          ports: [80, 6699, 7788],
        })
      }
    }

    // Sort by IP address
    return result.sort((a, b) => {
      const aNum = parseInt(a.ip.split('.').pop() || '0')
      const bNum = parseInt(b.ip.split('.').pop() || '0')
      return aNum - bNum
    })
  }, [edgeInventory, commissionedLidars])

  // Update edge device display name
  const updateEdgeName = useCallback(async (edgeId: string, displayName: string, notes?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, notes }),
      })
      if (!res.ok) throw new Error('Failed to update edge name')
      
      // Update local state
      setEdges(prev => prev.map(e => 
        e.edgeId === edgeId 
          ? { ...e, displayName, notes: notes || null } 
          : e
      ))
      addToast('success', `Edge renamed to "${displayName}"`)
    } catch (err: any) {
      addToast('error', `Failed to update edge name: ${err.message}`)
    }
  }, [addToast])

  // ========== HER Functions ==========

  // Load algorithm providers from new API
  const loadProviders = useCallback(async () => {
    setIsLoadingProviders(true)
    try {
      const res = await fetch(`${API_BASE}/api/algorithm-providers`)
      if (!res.ok) throw new Error('Failed to load providers')
      const data = await res.json()
      // Transform API response to match AlgorithmProvider interface
      const transformed = (data || []).map((p: any) => ({
        providerId: p.providerId,
        name: p.name,
        version: p.version,
        packageType: 'docker' as const, // All providers are now Docker-only
        dockerImage: p.dockerImage,
        dockerRegistry: null,
        debPackage: null,
        requiresGpu: p.requiresGpu || false,
        supportedLidarModels: p.supportedLidarModels || [],
        notes: p.notes,
        website: p.website,
        docsUrl: p.docsUrl,
        isActive: p.isActive,
      }))
      setProviders(transformed)
    } catch (err: any) {
      console.error('Failed to load providers:', err)
      addToast('error', `Failed to load providers: ${err.message}`)
    } finally {
      setIsLoadingProviders(false)
    }
  }, [addToast])

  // Select a provider
  const selectProvider = useCallback((providerId: string | null) => {
    setSelectedProviderId(providerId)
  }, [])

  // Get selected provider object
  const getSelectedProvider = useCallback(() => {
    return providers.find(p => p.providerId === selectedProviderId)
  }, [providers, selectedProviderId])

  // Deploy HER with provider
  const deployHer = useCallback(async (edgeId: string, venueId: string, providerId: string, mqttBrokerUrl?: string): Promise<HerDeployResult | null> => {
    setIsDeploying(true)
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/deploy-her`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, providerId, mqttBrokerUrl }),
      })
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'HER deploy failed')
      }
      
      addToast('success', `HER deployed: ${data.providerModule?.name} v${data.providerModule?.version}`)
      
      // Refresh deploy history
      await loadDeployHistory(venueId, edgeId)
      
      return data
    } catch (err: any) {
      addToast('error', `HER deploy failed: ${err.message}`)
      return null
    } finally {
      setIsDeploying(false)
    }
  }, [addToast])

  // Stop HER and revert to simulator
  const stopHer = useCallback(async (edgeId: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/stop-her`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to stop HER')
      }
      
      addToast('success', 'HER stopped, simulator mode active')
      return true
    } catch (err: any) {
      addToast('error', `Failed to stop HER: ${err.message}`)
      return false
    }
  }, [addToast])

  // Fetch HER status from edge
  const fetchHerStatus = useCallback(async (edgeId: string): Promise<HerStatus | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/edge/${edgeId}/her-status`)
      if (!res.ok) throw new Error('Failed to fetch HER status')
      const data = await res.json()
      return data.herStatus || null
    } catch (err: any) {
      console.error('Failed to fetch HER status:', err)
      return null
    }
  }, [])

  const value: EdgeCommissioningContextType = {
    edges,
    selectedEdgeId,
    edgeInventory,
    commissionedLidars,
    placements,
    pairings,
    edgeStatuses,
    deployHistory,
    roiBounds,
    dwgLayout,
    // HER State
    providers,
    selectedProviderId,
    herEnabled,
    // Loading states
    isScanning,
    isScanningLidars,
    isLoadingInventory,
    isLoadingPlacements,
    isDeploying,
    isLoadingProviders,
    // Actions
    scanEdges,
    selectEdge,
    scanEdgeLidars,
    fetchEdgeInventory,
    fetchEdgeStatus,
    loadPlacements,
    loadPairings,
    pairPlacement,
    unpairPlacement,
    deployToEdge,
    loadDeployHistory,
    loadCommissionedLidars,
    // HER Actions
    loadProviders,
    selectProvider,
    setHerEnabled,
    deployHer,
    stopHer,
    fetchHerStatus,
    // Helpers
    getPairingForPlacement,
    getLidarById,
    getMergedLidars,
    getSelectedProvider,
    updateEdgeName,
  }

  return (
    <EdgeCommissioningContext.Provider value={value}>
      {children}
    </EdgeCommissioningContext.Provider>
  )
}
