import { useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface LogoOverlayProps {
  venueId: string | undefined
}

interface WhiteLabelConfig {
  logoUrl: string | null
  logoWidth: number
  logoOpacity: number
}

export default function LogoOverlay({ venueId }: LogoOverlayProps) {
  const [settings, setSettings] = useState<WhiteLabelConfig | null>(null)

  const fetchSettings = useCallback(async () => {
    if (!venueId) return
    
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/white-label`)
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      }
    } catch (err) {
      console.error('Failed to fetch white label settings:', err)
    }
  }, [venueId])

  useEffect(() => {
    fetchSettings()
    
    // Listen for white label updates (dispatched when settings are saved)
    const handleUpdate = () => fetchSettings()
    window.addEventListener('whiteLabelUpdated', handleUpdate)
    
    // Also refetch every 30 seconds as fallback
    const interval = setInterval(fetchSettings, 30000)
    
    return () => {
      window.removeEventListener('whiteLabelUpdated', handleUpdate)
      clearInterval(interval)
    }
  }, [fetchSettings])

  if (!settings?.logoUrl) {
    return null
  }

  return (
    <div 
      className="absolute left-4 z-10 pointer-events-none select-none"
      style={{ opacity: settings.logoOpacity, top: '14px' }}
    >
      <img 
        src={`${API_BASE}${settings.logoUrl}`}
        alt="Logo"
        style={{ 
          width: settings.logoWidth,
          height: 'auto',
        }}
        onError={() => setSettings(prev => prev ? { ...prev, logoUrl: null } : null)}
      />
    </div>
  )
}
