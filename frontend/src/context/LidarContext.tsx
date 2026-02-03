import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import { LidarDevice, LidarPlacement, LidarStatus, Vector3 } from '../types'
import { useToast } from './ToastContext'
import { useVenue } from './VenueContext'
import { v4 as uuidv4 } from 'uuid'

interface LidarContextType {
  devices: LidarDevice[]
  placements: LidarPlacement[]
  selectedPlacementId: string | null
  isScanning: boolean
  
  scanDevices: () => Promise<void>
  connectDevice: (deviceId: string) => Promise<void>
  disconnectDevice: (deviceId: string) => Promise<void>
  
  addPlacement: (deviceId: string, position: Vector3) => LidarPlacement
  updatePlacement: (id: string, updates: Partial<LidarPlacement>) => void
  removePlacement: (id: string) => void
  selectPlacement: (id: string | null) => void
  setPlacements: (placements: LidarPlacement[]) => void
  
  getDeviceById: (id: string) => LidarDevice | undefined
  getPlacementByDeviceId: (deviceId: string) => LidarPlacement | undefined
}

const LidarContext = createContext<LidarContextType | null>(null)

const DEFAULT_LIDAR_FOV_H = 360  // 360° horizontal FOV
const DEFAULT_LIDAR_FOV_V = 180  // 180° vertical FOV (hemisphere)
const DEFAULT_LIDAR_RANGE = 15   // 15 meter coverage radius (adjustable)
const DEFAULT_MOUNT_HEIGHT = 4   // Ceiling mount height (adjustable)

export function LidarProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast()
  const { venue, snapToGrid } = useVenue()
  const [devices, setDevices] = useState<LidarDevice[]>([])
  const [placements, setPlacements] = useState<LidarPlacement[]>([])
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  const scanDevices = useCallback(async () => {
    setIsScanning(true)
    try {
      const res = await fetch('/api/discovery/scan')
      if (!res.ok) throw new Error('Scan failed')
      const data = await res.json()
      setDevices(data.devices || [])
      addToast('success', `Found ${data.devices?.length || 0} devices`)
    } catch (err) {
      addToast('error', `Scan failed: ${err}`)
    } finally {
      setIsScanning(false)
    }
  }, [addToast])

  const connectDevice = useCallback(async (deviceId: string) => {
    try {
      setDevices(prev => prev.map(d => 
        d.id === deviceId ? { ...d, status: 'connecting' as LidarStatus } : d
      ))
      
      const res = await fetch(`/api/lidars/${deviceId}/connect`, { method: 'POST' })
      if (!res.ok) throw new Error('Connection failed')
      
      setDevices(prev => prev.map(d => 
        d.id === deviceId ? { ...d, status: 'online' as LidarStatus } : d
      ))
      addToast('success', 'LiDAR connected')
    } catch (err) {
      setDevices(prev => prev.map(d => 
        d.id === deviceId ? { ...d, status: 'error' as LidarStatus } : d
      ))
      addToast('error', `Connection failed: ${err}`)
    }
  }, [addToast])

  const disconnectDevice = useCallback(async (deviceId: string) => {
    try {
      const res = await fetch(`/api/lidars/${deviceId}/disconnect`, { method: 'POST' })
      if (!res.ok) throw new Error('Disconnect failed')
      
      setDevices(prev => prev.map(d => 
        d.id === deviceId ? { ...d, status: 'offline' as LidarStatus } : d
      ))
      addToast('info', 'LiDAR disconnected')
    } catch (err) {
      addToast('error', `Disconnect failed: ${err}`)
    }
  }, [addToast])

  const addPlacement = useCallback((deviceId: string, position: Vector3): LidarPlacement => {
    const placement: LidarPlacement = {
      id: uuidv4(),
      venueId: venue?.id || '',
      deviceId,
      position: snapToGrid(position),
      rotation: { x: 0, y: 0, z: 0 },
      mountHeight: venue?.height || DEFAULT_MOUNT_HEIGHT, // Mount at ceiling
      fovHorizontal: DEFAULT_LIDAR_FOV_H,
      fovVertical: DEFAULT_LIDAR_FOV_V,
      range: DEFAULT_LIDAR_RANGE,
      enabled: true,
    }
    setPlacements(prev => [...prev, placement])
    setSelectedPlacementId(placement.id)
    return placement
  }, [venue, snapToGrid])

  const updatePlacement = useCallback((id: string, updates: Partial<LidarPlacement>) => {
    setPlacements(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }, [])

  const removePlacement = useCallback((id: string) => {
    setPlacements(prev => prev.filter(p => p.id !== id))
    if (selectedPlacementId === id) setSelectedPlacementId(null)
  }, [selectedPlacementId])

  const selectPlacement = useCallback((id: string | null) => {
    setSelectedPlacementId(id)
  }, [])

  const getDeviceById = useCallback((id: string) => {
    return devices.find(d => d.id === id)
  }, [devices])

  const getPlacementByDeviceId = useCallback((deviceId: string) => {
    return placements.find(p => p.deviceId === deviceId)
  }, [placements])

  useEffect(() => {
    scanDevices()
  }, [])

  return (
    <LidarContext.Provider value={{
      devices,
      placements,
      selectedPlacementId,
      isScanning,
      scanDevices,
      connectDevice,
      disconnectDevice,
      addPlacement,
      updatePlacement,
      removePlacement,
      selectPlacement,
      setPlacements,
      getDeviceById,
      getPlacementByDeviceId,
    }}>
      {children}
    </LidarContext.Provider>
  )
}

export function useLidar() {
  const context = useContext(LidarContext)
  if (!context) {
    throw new Error('useLidar must be used within a LidarProvider')
  }
  return context
}
