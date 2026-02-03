import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Upload, Trash2, Image } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface WhiteLabelSettingsProps {
  venueId: string
  isOpen: boolean
  onClose: () => void
}

interface WhiteLabelConfig {
  logoUrl: string | null
  logoWidth: number
  logoOpacity: number
  showBranding: boolean
  primaryColor: string
  accentColor: string
}

export default function WhiteLabelSettings({ venueId, isOpen, onClose }: WhiteLabelSettingsProps) {
  const [settings, setSettings] = useState<WhiteLabelConfig>({
    logoUrl: null,
    logoWidth: 200,
    logoOpacity: 1,
    showBranding: true,
    primaryColor: '#3b82f6',
    accentColor: '#f59e0b',
  })
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchSettings = useCallback(async () => {
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
    if (isOpen && venueId) {
      fetchSettings()
    }
  }, [isOpen, venueId, fetchSettings])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('logo', file)

      const res = await fetch(`${API_BASE}/api/venues/${venueId}/white-label/logo`, {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        setSettings(prev => ({ ...prev, logoUrl: data.logoUrl }))
      }
    } catch (err) {
      console.error('Failed to upload logo:', err)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDeleteLogo = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/white-label/logo`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setSettings(prev => ({ ...prev, logoUrl: null }))
      }
    } catch (err) {
      console.error('Failed to delete logo:', err)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/venues/${venueId}/white-label`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      // Notify LogoOverlay to refresh
      window.dispatchEvent(new CustomEvent('whiteLabelUpdated'))
      onClose()
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-2">
            <Image className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">White Label Settings</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Logo Upload */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-white">Customer Logo</label>
            
            {settings.logoUrl ? (
              <div className="relative bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-auto">
                <img 
                  src={`${API_BASE}${settings.logoUrl}`}
                  alt="Customer Logo"
                  className="mx-auto"
                  style={{ 
                    width: settings.logoWidth, 
                    height: 'auto',
                    opacity: settings.logoOpacity,
                  }}
                />
                <button
                  onClick={handleDeleteLogo}
                  className="absolute top-2 right-2 p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                  title="Remove logo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div 
                className="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-gray-500 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Click to upload logo</p>
                <p className="text-xs text-gray-500 mt-1">PNG, JPEG, SVG, or WebP (max 5MB)</p>
              </div>
            )}
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={handleFileUpload}
              className="hidden"
            />
            
            {uploading && (
              <p className="text-sm text-blue-400">Uploading...</p>
            )}
          </div>

          {/* Logo Width */}
          {settings.logoUrl && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white flex justify-between">
                <span>Logo Width</span>
                <span className="text-gray-400">{settings.logoWidth}px</span>
              </label>
              <input
                type="range"
                min="50"
                max="400"
                step="10"
                value={settings.logoWidth}
                onChange={(e) => setSettings(prev => ({ ...prev, logoWidth: parseInt(e.target.value) }))}
                className="w-full accent-blue-500"
              />
            </div>
          )}

          {/* Logo Opacity */}
          {settings.logoUrl && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white flex justify-between">
                <span>Logo Opacity</span>
                <span className="text-gray-400">{Math.round(settings.logoOpacity * 100)}%</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={settings.logoOpacity}
                onChange={(e) => setSettings(prev => ({ ...prev, logoOpacity: parseFloat(e.target.value) }))}
                className="w-full accent-blue-500"
              />
            </div>
          )}

          {/* Show Default Branding Toggle */}
          <div className="flex items-center justify-between py-2">
            <div>
              <label className="text-sm font-medium text-white">Show Hyperspace Branding</label>
              <p className="text-xs text-gray-500">Display default branding in sidebar</p>
            </div>
            <button
              onClick={() => setSettings(prev => ({ ...prev, showBranding: !prev.showBranding }))}
              className={`w-11 h-6 rounded-full transition-colors ${
                settings.showBranding ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                settings.showBranding ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
