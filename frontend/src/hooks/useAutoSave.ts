import { useEffect, useRef, useCallback } from 'react'
import { useVenue } from '../context/VenueContext'
import { useLidar } from '../context/LidarContext'

const AUTO_SAVE_DELAY_MS = 2000

export function useAutoSave() {
  const { venue, objects, saveVenue } = useVenue()
  const { placements } = useLidar()
  const timeoutRef = useRef<number | null>(null)
  const isFirstRender = useRef(true)
  const lastSavedRef = useRef<string>('')

  const performSave = useCallback(async () => {
    if (!venue) return
    
    const currentState = JSON.stringify({ venue, objects, placements })
    
    // Don't save if nothing changed
    if (currentState === lastSavedRef.current) return
    
    lastSavedRef.current = currentState
    await saveVenue(placements)
  }, [venue, objects, placements, saveVenue])

  useEffect(() => {
    // Skip first render to avoid saving on initial load
    if (isFirstRender.current) {
      isFirstRender.current = false
      // Store initial state
      lastSavedRef.current = JSON.stringify({ venue, objects, placements })
      return
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }

    // Set new timeout for debounced save
    timeoutRef.current = window.setTimeout(() => {
      performSave()
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [venue, objects, placements, performSave])

  return null
}
