import { useState, useEffect, useCallback, useRef } from 'react'
import { useVenue } from '../../context/VenueContext'
import { useTracking } from '../../context/TrackingContext'
import { API_BASE } from '../../config/api'
import { withDemoSession } from '../../utils/demoSession'

interface XRayZone {
  roiId: string
  name: string
  template: string
  position: { x: number; z: number }
  visits: number
  avgDwellSec: number
  dwells: number
  engagements: number
  peakOccupancy: number
  categories?: string[]
  shelfId?: string
}

interface XRayDoohScreen {
  screenId: string
  name: string
  campaignName: string
  position: { x: number; z: number }
  exposures: number
  avgAqs: number
  conversionRate: number
  liftRel: number
  cesScore: number
}

export interface XRayData {
  zones: XRayZone[]
  doohScreens: XRayDoohScreen[]
}

const XRAY_POLL_INTERVAL = 15_000

export function useXRayData(enabled: boolean): XRayData | null {
  const { venue } = useVenue()
  const { demoSessionId } = useTracking()
  const [data, setData] = useState<XRayData | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchXRay = useCallback(async () => {
    if (!venue?.id) return
    const t0 = performance.now()
    try {
      const res = await fetch(
        withDemoSession(`${API_BASE}/api/neural/xray-zones?venueId=${venue.id}`, demoSessionId)
      )
      const elapsed = Math.round(performance.now() - t0)
      if (res.ok) {
        const json = await res.json()
        setData(json)
        if (elapsed > 500) {
          console.warn(`[DIAG] xray fetch SLOW  ${elapsed}ms  status=${res.status}  t=${Date.now()}`)
        } else {
          console.log(`[DIAG] xray fetch OK  ${elapsed}ms  t=${Date.now()}`)
        }
      } else {
        console.warn(`[DIAG] xray fetch FAIL  ${elapsed}ms  status=${res.status}  t=${Date.now()}`)
      }
    } catch (e) {
      console.warn(`[DIAG] xray fetch ERROR  ${Math.round(performance.now() - t0)}ms  err=${e}  t=${Date.now()}`)
      setData(null)
    }
  }, [venue?.id, demoSessionId])

  useEffect(() => {
    if (!enabled) {
      setData(null)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    fetchXRay()
    intervalRef.current = setInterval(fetchXRay, XRAY_POLL_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, fetchXRay])

  return data
}
