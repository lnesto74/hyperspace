/**
 * AIDecisionFeed — Scrolling real-time alert cards for the Neural Dashboard
 * 
 * Shows behavioral alerts: queue risk, low engagement, bottleneck, media ROI.
 * Alerts PILE UP — new ones merge in, old ones stay until dismissed.
 * Dismiss per-card (×) or dismiss all.
 * Neural style: monospace, dark bg, minimal accent colors.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import Tooltip from './Tooltip'
import AlertDetailModal from './AlertDetailModal'

interface Alert {
  id: string
  type: 'queue_risk' | 'low_engagement' | 'bottleneck' | 'media_roi'
  severity: 'high' | 'medium' | 'low'
  title: string
  message: string
  action: string
  timestamp: number
  zoneId?: string
  zoneIds?: string[]
  categories?: string[]
  shelfName?: string
  firstSeen: number
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; glow: string; tip: string }> = {
  queue_risk:     { icon: '⏱', color: 'rgba(255, 80, 80, 0.8)',   glow: 'rgba(255, 80, 80, 0.15)',  tip: 'Checkout zone with elevated wait times' },
  low_engagement: { icon: '◇', color: 'rgba(255, 180, 50, 0.8)',  glow: 'rgba(255, 180, 50, 0.15)', tip: 'Product zone with below-average dwell rates' },
  bottleneck:     { icon: '⬡', color: 'rgba(255, 120, 50, 0.8)',  glow: 'rgba(255, 120, 50, 0.15)', tip: 'Zone with slow flow and high occupancy' },
  media_roi:      { icon: '◈', color: 'rgba(180, 100, 255, 0.8)', glow: 'rgba(180, 100, 255, 0.15)', tip: 'DOOH campaign underperforming targets' },
}

export default function AIDecisionFeed({ batchAlerts }: { batchAlerts?: { alerts: any[]; count: number } | null } = {}) {
  const { venue } = useVenue()
  const alertMapRef = useRef<Map<string, Alert>>(new Map())
  const [visibleAlerts, setVisibleAlerts] = useState<Alert[]>([])
  const [newAlertIds, setNewAlertIds] = useState<Set<string>>(new Set())
  const dismissedRef = useRef<Set<string>>(new Set())
  const [, setTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [detailAlert, setDetailAlert] = useState<Alert | null>(null)

  const rebuildVisible = useCallback(() => {
    const sorted = Array.from(alertMapRef.current.values())
      .sort((a, b) => b.firstSeen - a.firstSeen)
    setVisibleAlerts(sorted)
  }, [])

  // Process incoming alerts (from batch or individual fetch)
  const processAlerts = useCallback((incoming: Omit<Alert, 'firstSeen'>[]) => {
    const now = Date.now()
    const freshIds = new Set<string>()

    for (const a of incoming) {
      if (dismissedRef.current.has(a.id)) continue
      const existing = alertMapRef.current.get(a.id)
      if (existing) {
        alertMapRef.current.set(a.id, { ...a, firstSeen: existing.firstSeen })
      } else {
        alertMapRef.current.set(a.id, { ...a, firstSeen: now })
        freshIds.add(a.id)
      }
    }

    if (freshIds.size > 0) {
      setNewAlertIds(freshIds)
      setTimeout(() => setNewAlertIds(new Set()), 2000)
    }

    rebuildVisible()
  }, [rebuildVisible])

  // Use batch data if available
  useEffect(() => {
    if (batchAlerts?.alerts) {
      processAlerts(batchAlerts.alerts)
    }
  }, [batchAlerts, processAlerts])

  const fetchAlerts = useCallback(async () => {
    if (!venue?.id || batchAlerts) return
    try {
      const res = await fetch(`${API_BASE}/api/neural/alerts?venueId=${venue.id}&limit=50`)
      if (res.ok) {
        const json = await res.json()
        processAlerts(json.alerts || [])
      }
    } catch (e) {
      // silent
    }
  }, [venue?.id, batchAlerts, processAlerts])

  useEffect(() => {
    if (batchAlerts) return
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 5000)
    return () => clearInterval(interval)
  }, [fetchAlerts, batchAlerts])

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000)
    return () => clearInterval(t)
  }, [])

  const dismissOne = useCallback((id: string) => {
    alertMapRef.current.delete(id)
    dismissedRef.current.add(id)
    rebuildVisible()
  }, [rebuildVisible])

  const dismissAll = useCallback(() => {
    alertMapRef.current.forEach((_, id) => dismissedRef.current.add(id))
    alertMapRef.current.clear()
    rebuildVisible()
  }, [rebuildVisible])

  const timeAgo = (ts: number) => {
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return `${sec}s ago`
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
    return `${Math.floor(sec / 3600)}h ago`
  }

  return (
    <div className="h-full flex flex-col font-mono text-[10px]">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${visibleAlerts.length > 0 ? 'bg-green-400/80 animate-pulse' : 'bg-white/20'}`} />
          <span className="text-[11px] text-white/70 tracking-wider uppercase">
            Alerts
          </span>
          <span className="text-white/50 text-[9px]">{visibleAlerts.length}</span>
        </div>
        {visibleAlerts.length > 0 && (
          <button
            onClick={dismissAll}
            className="text-[8px] text-white/40 hover:text-white/60 transition-colors px-1.5 py-0.5 rounded hover:bg-white/[0.05]"
          >
            CLEAR ALL
          </button>
        )}
      </div>

      {/* Alert cards — pile up */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5 neural-scrollbar">
        {visibleAlerts.map(alert => {
          const cfg = TYPE_CONFIG[alert.type] || TYPE_CONFIG.bottleneck
          const isNew = newAlertIds.has(alert.id)

          return (
            <div
              key={alert.id}
              className="group rounded-md border transition-all duration-500 relative cursor-pointer hover:border-white/10"
              style={{
                background: isNew ? cfg.glow : 'rgba(255,255,255,0.02)',
                borderColor: isNew ? cfg.color : 'rgba(255,255,255,0.04)',
                animation: isNew ? 'slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
              }}
              onClick={() => setDetailAlert(alert)}
            >
              {/* Dismiss button (visible on hover) */}
              <button
                onClick={(e) => { e.stopPropagation(); dismissOne(alert.id) }}
                className="absolute top-1.5 right-1.5 w-4 h-4 flex items-center justify-center rounded text-white/0 group-hover:text-white/40 hover:!text-white/70 hover:bg-white/[0.08] transition-all text-[10px]"
              >
                ×
              </button>

              <div className="p-2.5 pr-6">
                {/* Top row: icon + title + severity */}
                <div className="flex items-center gap-1.5 mb-1">
                  <Tooltip text={cfg.tip}>
                    <span style={{ color: cfg.color }} className="text-[11px] cursor-help">
                      {cfg.icon}
                    </span>
                  </Tooltip>
                  <span className="text-[9px] font-bold tracking-wider" style={{ color: cfg.color }}>
                    {alert.title}
                  </span>
                  {alert.severity === 'high' && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-red-500/20 text-red-400/80">
                      HIGH
                    </span>
                  )}
                </div>

                {/* Message */}
                <div className="text-white/70 text-[9px] leading-relaxed mb-1">
                  {alert.message}
                </div>

                {/* Product categories */}
                {alert.categories && alert.categories.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mb-1">
                    <span className="text-[7px] text-white/30">PRODUCTS:</span>
                    {alert.categories.slice(0, 4).map(cat => (
                      <span key={cat} className="text-[7px] px-1 py-0.5 rounded bg-white/[0.06] text-white/55">
                        {cat}
                      </span>
                    ))}
                    {alert.categories.length > 4 && (
                      <span className="text-[7px] text-white/30">+{alert.categories.length - 4}</span>
                    )}
                  </div>
                )}

                {/* Action + time */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-white/40">→</span>
                    <span className="text-[8px] text-cyan-400/80 italic">{alert.action}</span>
                  </div>
                  <span className="text-white/40 text-[8px]">{timeAgo(alert.firstSeen)}</span>
                </div>
              </div>
            </div>
          )
        })}

        {/* Empty state */}
        {visibleAlerts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-white/20">
            <div className="text-[20px] mb-2 opacity-30">◇</div>
            <div className="text-[10px]">No alerts detected</div>
            <div className="text-[8px] mt-1">Monitoring venue behavior...</div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .neural-scrollbar::-webkit-scrollbar { width: 3px; }
        .neural-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .neural-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
      `}</style>

      {detailAlert && (
        <AlertDetailModal alert={detailAlert} onClose={() => setDetailAlert(null)} />
      )}
    </div>
  )
}
