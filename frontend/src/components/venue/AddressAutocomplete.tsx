import { useEffect, useRef, useState, useCallback } from 'react'
import { MapPin, Loader2, X } from 'lucide-react'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

interface AddressResult {
  address: string
  latitude: number
  longitude: number
  place_id: string
}

interface AddressAutocompleteProps {
  value?: string | null
  onChange: (result: AddressResult | null) => void
  placeholder?: string
  className?: string
}

let googleMapsLoaded = false
let googleMapsLoading = false
const loadCallbacks: (() => void)[] = []

function loadGoogleMaps(): Promise<void> {
  if (googleMapsLoaded) return Promise.resolve()
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error('No Google Maps API key'))

  return new Promise((resolve, reject) => {
    if (googleMapsLoaded) return resolve()

    loadCallbacks.push(resolve)

    if (googleMapsLoading) return

    googleMapsLoading = true
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => {
      googleMapsLoaded = true
      googleMapsLoading = false
      loadCallbacks.forEach(cb => cb())
      loadCallbacks.length = 0
    }
    script.onerror = () => {
      googleMapsLoading = false
      reject(new Error('Failed to load Google Maps'))
    }
    document.head.appendChild(script)
  })
}

export default function AddressAutocomplete({ value, onChange, placeholder, className }: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const [inputValue, setInputValue] = useState(value || '')
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync external value
  useEffect(() => {
    setInputValue(value || '')
  }, [value])

  // Load Google Maps and init autocomplete
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      setError('Maps API key not configured')
      return
    }

    let cancelled = false

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current) return

        const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          types: ['establishment', 'geocode'],
          fields: ['formatted_address', 'geometry', 'place_id', 'name'],
        })

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace()
          if (!place.geometry?.location) return

          const result: AddressResult = {
            address: place.formatted_address || place.name || '',
            latitude: place.geometry.location.lat(),
            longitude: place.geometry.location.lng(),
            place_id: place.place_id || '',
          }

          setInputValue(result.address)
          onChange(result)
        })

        autocompleteRef.current = autocomplete
        setIsReady(true)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })

    return () => { cancelled = true }
  }, [onChange])

  const handleClear = useCallback(() => {
    setInputValue('')
    onChange(null)
    inputRef.current?.focus()
  }, [onChange])

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-panel-bg border border-border-dark rounded text-xs text-gray-500">
        <MapPin className="w-3.5 h-3.5" />
        <span>{error}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
        {!isReady ? (
          <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
        ) : (
          <MapPin className="w-3.5 h-3.5 text-gray-500" />
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={placeholder || 'Search address...'}
        disabled={!isReady}
        className={`w-full pl-8 pr-8 py-2 bg-panel-bg border border-border-dark rounded text-sm text-white placeholder-gray-500 focus:border-highlight focus:outline-none disabled:opacity-50 ${className || ''}`}
      />
      {inputValue && (
        <button
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
