import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const STORAGE_KEY = 'hyperspace-heatmap-settings'

interface HeatmapSettings {
  timeframe: 'day' | 'week' | 'month'
  heightKpi: 'visits' | 'dwellSec'
  colorKpi: 'visits' | 'dwellSec'
  opacity: number
}

const defaultSettings: HeatmapSettings = {
  timeframe: 'day',
  heightKpi: 'visits',
  colorKpi: 'dwellSec',
  opacity: 0.8,
}

function loadSettings(): HeatmapSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) }
    }
  } catch (e) {
    console.error('Failed to load heatmap settings:', e)
  }
  return defaultSettings
}

function saveSettings(settings: HeatmapSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save heatmap settings:', e)
  }
}

export interface HeatmapTile {
  tileX: number
  tileZ: number
  x: number
  z: number
  visits: number
  dwellSec: number
}

export interface HeatmapData {
  tiles: HeatmapTile[]
  tileSize: number
  timeframe: string
  startTime: number
  endTime: number
  maxVisits: number
  maxDwell: number
  venueWidth: number
  venueDepth: number
}

interface HeatmapContextType {
  isEnabled: boolean
  isLoading: boolean
  heatmapData: HeatmapData | null
  timeframe: 'day' | 'week' | 'month'
  heightKpi: 'visits' | 'dwellSec'
  colorKpi: 'visits' | 'dwellSec'
  opacity: number
  
  toggleHeatmap: () => void
  setTimeframe: (tf: 'day' | 'week' | 'month') => void
  setHeightKpi: (kpi: 'visits' | 'dwellSec') => void
  setColorKpi: (kpi: 'visits' | 'dwellSec') => void
  setOpacity: (opacity: number) => void
  loadHeatmap: (venueId: string) => Promise<void>
  refreshHeatmap: () => Promise<void>
}

const HeatmapContext = createContext<HeatmapContextType | null>(null)

export function HeatmapProvider({ children }: { children: ReactNode }) {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null)
  const [settings, setSettings] = useState<HeatmapSettings>(loadSettings)
  const [currentVenueId, setCurrentVenueId] = useState<string | null>(null)

  const { timeframe, heightKpi, colorKpi, opacity } = settings

  // Save settings whenever they change
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const loadHeatmap = useCallback(async (venueId: string) => {
    setCurrentVenueId(venueId)
    setIsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/heatmap?timeframe=${timeframe}`)
      if (!res.ok) throw new Error('Failed to load heatmap')
      const data: HeatmapData = await res.json()
      setHeatmapData(data)
    } catch (err) {
      console.error('Failed to load heatmap:', err)
      setHeatmapData(null)
    } finally {
      setIsLoading(false)
    }
  }, [timeframe])

  const refreshHeatmap = useCallback(async () => {
    if (currentVenueId && isEnabled) {
      await loadHeatmap(currentVenueId)
    }
  }, [currentVenueId, isEnabled, loadHeatmap])

  const toggleHeatmap = useCallback(() => {
    setIsEnabled(prev => !prev)
  }, [])

  const setTimeframe = useCallback((tf: 'day' | 'week' | 'month') => {
    setSettings(prev => ({ ...prev, timeframe: tf }))
  }, [])

  const setHeightKpi = useCallback((kpi: 'visits' | 'dwellSec') => {
    setSettings(prev => ({ ...prev, heightKpi: kpi }))
  }, [])

  const setColorKpi = useCallback((kpi: 'visits' | 'dwellSec') => {
    setSettings(prev => ({ ...prev, colorKpi: kpi }))
  }, [])

  const setOpacity = useCallback((newOpacity: number) => {
    setSettings(prev => ({ ...prev, opacity: newOpacity }))
  }, [])

  return (
    <HeatmapContext.Provider value={{
      isEnabled,
      isLoading,
      heatmapData,
      timeframe,
      heightKpi,
      colorKpi,
      opacity,
      toggleHeatmap,
      setTimeframe,
      setHeightKpi,
      setColorKpi,
      setOpacity,
      loadHeatmap,
      refreshHeatmap,
    }}>
      {children}
    </HeatmapContext.Provider>
  )
}

export function useHeatmap() {
  const context = useContext(HeatmapContext)
  if (!context) {
    throw new Error('useHeatmap must be used within a HeatmapProvider')
  }
  return context
}
