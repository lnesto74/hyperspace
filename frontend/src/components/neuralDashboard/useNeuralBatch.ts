/**
 * useNeuralBatch — single polling hook that replaces 4+ concurrent neural API calls.
 * 
 * Instead of each panel independently polling its own endpoint (causing SQLite contention
 * and event-loop blocking on the backend), this fetches everything in one request.
 * 
 * Polling interval: 8s (matches the fastest previous individual poll).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'

interface NeuralBatchData {
  venueKpis: any | null
  funnel: any | null
  alerts: { alerts: any[]; count: number } | null
  mediaSummary: any | null
}

const BATCH_POLL_INTERVAL = 8000

export function useNeuralBatch(range: string = '1h') {
  const { venue } = useVenue()
  const [data, setData] = useState<NeuralBatchData>({
    venueKpis: null,
    funnel: null,
    alerts: null,
    mediaSummary: null,
  })
  const [loading, setLoading] = useState(false)
  const rangeRef = useRef(range)
  rangeRef.current = range

  const fetchBatch = useCallback(async () => {
    if (!venue?.id) return
    try {
      setLoading(true)
      const res = await fetch(
        `${API_BASE}/api/neural/batch?venueId=${venue.id}&range=${rangeRef.current}`
      )
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) {
      // silent — individual panels show their own empty states
    } finally {
      setLoading(false)
    }
  }, [venue?.id])

  useEffect(() => {
    fetchBatch()
    const interval = setInterval(fetchBatch, BATCH_POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchBatch])

  return { data, loading, refetch: fetchBatch }
}
