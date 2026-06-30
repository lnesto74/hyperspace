import type { Track } from '../types'

/** Live canvas label: reconciler shopper # when present, else perception suffix. */
export function trackDisplayLabel(track: Pick<Track, 'shopperNumber' | 'originalPerceptionId' | 'id'>): string {
  const n = track.shopperNumber
  if (n != null && Number.isFinite(n)) return String(n)
  const perceptionId = track.originalPerceptionId || track.id || ''
  const digits = String(perceptionId).replace(/\D/g, '')
  return digits.slice(-4) || '?'
}
