import { Rocket, Edit3, BarChart2, ChevronDown, Building2, Pencil, Check, X } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useViewMode } from '../../App'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'

type AppMode = 'setup' | 'edit' | 'live'

interface VenueOption {
  id: string
  name: string
  width?: number
  depth?: number
}

export default function ModeBar() {
  const { mode, setMode, launchPadOpen, setLaunchPadOpen } = useViewMode()
  const { venue, loadVenue, venueList, updateVenue } = useVenue()
  const [showVenueDropdown, setShowVenueDropdown] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Derive current app mode from viewMode + launchPadOpen
  const currentMode: AppMode = launchPadOpen ? 'setup' : (mode === 'main' ? 'edit' : 'live')

  // Use venueList from context (already fetched by VenueProvider)
  const venues: VenueOption[] = venueList.map(v => ({
    id: v.id,
    name: v.name,
    width: v.width,
    depth: v.depth,
  }))

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowVenueDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Listen for LaunchPad venue creation/selection events
  useEffect(() => {
    const handleLaunchPadVenue = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.venueId && detail.venueId !== venue?.id) {
        console.log('[ModeBar] LaunchPad venue event, loading:', detail.venueId)
        loadVenue(detail.venueId)
      }
    }
    window.addEventListener('launchpad-venue-created', handleLaunchPadVenue)
    window.addEventListener('launchpad-venue-selected', handleLaunchPadVenue)
    return () => {
      window.removeEventListener('launchpad-venue-created', handleLaunchPadVenue)
      window.removeEventListener('launchpad-venue-selected', handleLaunchPadVenue)
    }
  }, [venue?.id, loadVenue])

  const handleModeChange = (newMode: AppMode) => {
    if (newMode === 'setup') {
      // Open LaunchPad, stay on main view
      setLaunchPadOpen(true)
      if (mode !== 'main') setMode('main')
    } else if (newMode === 'edit') {
      // Close LaunchPad, switch to main view
      setLaunchPadOpen(false)
      setMode('main')
    } else if (newMode === 'live') {
      // Close LaunchPad, could switch to analytics view or stay on main
      setLaunchPadOpen(false)
      // For now, stay on main but could expand to analytics mode
      setMode('main')
    }
  }

  const handleVenueSelect = async (venueId: string) => {
    setShowVenueDropdown(false)
    // Load the venue via context
    await loadVenue(venueId)
    // Also update localStorage for LaunchPad sync
    localStorage.setItem('launchpad-selectedVenueId', venueId)
    window.dispatchEvent(new CustomEvent('venue-selected', { detail: { venueId } }))
  }

  const startEditing = () => {
    if (venue?.name) {
      setEditName(venue.name)
      setIsEditing(true)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const saveVenueName = async () => {
    if (!venue?.id || !editName.trim()) {
      setIsEditing(false)
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venue.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })
      if (res.ok) {
        updateVenue({ name: editName.trim() })
      }
    } catch (e) {
      console.warn('[ModeBar] Failed to rename venue:', e)
    }
    setIsEditing(false)
  }

  const cancelEditing = () => {
    setIsEditing(false)
    setEditName('')
  }

  const modes: { id: AppMode; icon: typeof Rocket; label: string; shortLabel: string; color: string }[] = [
    { id: 'setup', icon: Rocket, label: 'Setup', shortLabel: '🚀', color: 'cyan' },
    { id: 'edit', icon: Edit3, label: 'Edit', shortLabel: '🏗️', color: 'amber' },
    { id: 'live', icon: BarChart2, label: 'Live', shortLabel: '📊', color: 'green' },
  ]

  // Truncate venue name for display
  const displayVenueName = venue?.name 
    ? (venue.name.length > 30 ? venue.name.substring(0, 27) + '...' : venue.name)
    : 'Select Venue'

  return (
    <div className="h-10 bg-gray-900/95 border-b border-gray-700/50 flex items-center justify-between px-4 flex-shrink-0">
      {/* Left: Venue Selector with inline rename */}
      <div className="flex items-center gap-3" ref={dropdownRef}>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Working on:</span>
        
        {isEditing ? (
          /* Inline Edit Mode */
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveVenueName()
                if (e.key === 'Escape') cancelEditing()
              }}
              className="px-2 py-1 bg-gray-800 border border-cyan-500 rounded text-sm text-white w-48 focus:outline-none"
              autoFocus
            />
            <button onClick={saveVenueName} className="p-1 text-green-400 hover:text-green-300" title="Save">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={cancelEditing} className="p-1 text-gray-500 hover:text-gray-300" title="Cancel">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Normal Display Mode */
          <div className="relative flex items-center gap-1">
            <button
              onClick={() => setShowVenueDropdown(!showVenueDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-md text-sm text-white transition-colors min-w-[180px]"
            >
              <Building2 className="w-3.5 h-3.5 text-gray-400" />
              <span className="truncate flex-1 text-left">{displayVenueName}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showVenueDropdown ? 'rotate-180' : ''}`} />
            </button>
            {venue?.id && (
              <button
                onClick={startEditing}
                className="p-1 text-gray-500 hover:text-cyan-400 transition-colors"
                title="Rename venue"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          
            {/* Venue Dropdown */}
            {showVenueDropdown && (
              <div className="absolute top-full left-0 mt-1 w-72 max-h-64 overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50">
                {venues.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500">No venues found</div>
                ) : (
                  venues.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => handleVenueSelect(v.id)}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-700 transition-colors flex items-center justify-between ${
                        v.id === venue?.id ? 'bg-cyan-900/30 text-cyan-400' : 'text-white'
                      }`}
                    >
                      <span className="truncate">{v.name}</span>
                      {v.width && v.depth && (
                        <span className="text-[10px] text-gray-500 ml-2">{v.width}m × {v.depth}m</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center: Mode Toggle */}
      <div className="flex items-center gap-1 bg-gray-800/50 rounded-lg p-0.5 border border-gray-700/50">
        {modes.map(({ id, icon: Icon, label, color }) => {
          const isActive = currentMode === id
          const colorClasses = {
            cyan: isActive ? 'bg-cyan-600/20 text-cyan-400 border-cyan-500/50' : 'text-gray-400 hover:text-cyan-400',
            amber: isActive ? 'bg-amber-600/20 text-amber-400 border-amber-500/50' : 'text-gray-400 hover:text-amber-400',
            green: isActive ? 'bg-green-600/20 text-green-400 border-green-500/50' : 'text-gray-400 hover:text-green-400',
          }[color]
          
          return (
            <button
              key={id}
              onClick={() => handleModeChange(id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${colorClasses} ${
                isActive ? 'border' : 'border border-transparent hover:bg-gray-700/50'
              }`}
              title={`${label} Mode`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>

      {/* Right: Spacer or future actions */}
      <div className="w-[180px]" />
    </div>
  )
}
