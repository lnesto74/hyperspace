/**
 * RetailMediaPanel — Compact DOOH campaign performance for the Neural Dashboard
 * 
 * Shows active campaigns with exposure counts, dwell uplift, ROI indicator.
 * Neural style: monospace, dark bg, minimal accent colors.
 */

import { useState, useEffect, useCallback } from 'react'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import AnimatedNumber from './AnimatedNumber'
import Tooltip from './Tooltip'

interface CampaignSummary {
  id: string
  name: string
  screens: number
  targetType: string
  isActive: boolean
  exposures: number
  conversions: number
  conversionRate: number
  avgDci: number
  avgConfidence: number
  liftRel: number | null
  roi: 'positive' | 'negative' | 'neutral'
}

interface MediaData {
  campaigns: CampaignSummary[]
  activeCampaigns: number
  avgConversionRate: number
  totalExposures: number
  enabled: boolean
  dataRange?: string
}

const ROI_COLORS = {
  positive: { dot: 'bg-green-400/80', text: 'text-green-400/70', label: '▲' },
  negative: { dot: 'bg-red-400/80', text: 'text-red-400/70', label: '▼' },
  neutral:  { dot: 'bg-white/30', text: 'text-white/30', label: '—' },
}

export default function RetailMediaPanel({ batchMedia }: { batchMedia?: MediaData | null } = {}) {
  const { venue } = useVenue()
  const [data, setData] = useState<MediaData | null>(null)
  const [range, setRange] = useState<'1h' | '24h' | '7d' | 'all'>('all')

  // Use batch data as initial seed, but allow range buttons to override
  useEffect(() => {
    if (batchMedia && !data) setData(batchMedia)
  }, [batchMedia])

  const fetchMedia = useCallback(async () => {
    if (!venue?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/neural/media-summary?venueId=${venue.id}&range=${range}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) {
      // silent
    }
  }, [venue?.id, range])

  useEffect(() => {
    fetchMedia()
    const interval = setInterval(fetchMedia, 30000)
    return () => clearInterval(interval)
  }, [fetchMedia])

  // Not enabled
  if (data && !data.enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center font-mono text-[10px] text-white/20 p-3">
        <div className="text-[16px] mb-2 opacity-30">◈</div>
        <div>Retail Media</div>
        <div className="text-[8px] mt-1">DOOH Attribution not enabled</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-3 font-mono text-[10px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-white/70 tracking-wider uppercase">
          Retail Media
        </div>
        <div className="flex gap-1">
          {(['1h', '24h', '7d', 'all'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                range === r 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/45 hover:text-white/70'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Data range indicator */}
      {data && data.dataRange && data.dataRange !== range && data.campaigns.length > 0 && (
        <div className="text-[8px] text-amber-400/50 mb-1 text-center">
          Showing all-time data (no events in {range} window)
        </div>
      )}

      {/* Summary row */}
      {data && data.campaigns.length > 0 && (
        <div className="flex items-center gap-3 mb-2 pb-2 border-b border-white/[0.04]">
          <Tooltip text="Number of currently running DOOH campaigns">
            <div className="cursor-help">
              <div className="text-white/50 text-[8px]">ACTIVE</div>
              <AnimatedNumber value={data.activeCampaigns} duration={600} className="text-white/70 text-[12px]" />
            </div>
          </Tooltip>
          <Tooltip text="Total people exposed to media content">
            <div className="cursor-help">
              <div className="text-white/50 text-[8px]">EXPOSURES</div>
              <AnimatedNumber value={data.totalExposures} duration={600} className="text-white/70 text-[12px]" />
            </div>
          </Tooltip>
          <Tooltip text="Average conversion rate across active campaigns">
            <div className="cursor-help">
              <div className="text-white/50 text-[8px]">AVG CONV</div>
            <AnimatedNumber
              value={data.avgConversionRate}
              suffix="%"
              duration={600}
              className={`text-[12px] ${data.avgConversionRate > 20 ? 'text-green-400/70' : data.avgConversionRate > 5 ? 'text-white/50' : 'text-red-400/70'}`}
            />
            </div>
          </Tooltip>
        </div>
      )}

      {/* Campaign list */}
      <div className="flex-1 overflow-y-auto space-y-1.5 neural-scrollbar">
        {data?.campaigns?.map(camp => {
          const roiCfg = ROI_COLORS[camp.roi]
          return (
            <div
              key={camp.id}
              className="rounded border border-white/[0.04] bg-white/[0.02] p-2"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${camp.isActive ? 'bg-green-400/60' : 'bg-white/20'}`} />
                  <span className="text-white/70 text-[9px] truncate max-w-[100px]">
                    {camp.name}
                  </span>
                  <span className="text-white/45 text-[8px]">{camp.screens}scr</span>
                </div>
                <span className={`text-[9px] ${roiCfg.text}`}>
                  {roiCfg.label} {camp.conversionRate}%
                </span>
              </div>
              <div className="flex items-center justify-between text-[8px]">
                <span className="text-white/50">{camp.targetType} · {camp.exposures} exp</span>
                <Tooltip text="Dwell-Conversion Index — media effectiveness score">
                  <span className="text-white/50 cursor-help">DCI {camp.avgDci}{camp.liftRel != null ? ` · lift ${camp.liftRel > 0 ? '+' : ''}${camp.liftRel}%` : ''}</span>
                </Tooltip>
              </div>
            </div>
          )
        })}

        {/* Empty state */}
        {(!data || data.campaigns?.length === 0) && (
          <div className="flex flex-col items-center justify-center h-full text-white/20">
            <div className="text-[16px] mb-2 opacity-30">◈</div>
            <div className="text-[9px]">No campaigns for this venue</div>
            <div className="text-[8px] mt-1 text-white/10">Create campaigns in DOOH Effectiveness</div>
          </div>
        )}
        {/* Campaigns exist but zero exposures */}
        {data && data.campaigns?.length > 0 && data.totalExposures === 0 && (
          <div className="mt-1 pt-1 border-t border-white/[0.04] text-[8px] text-white/20 text-center">
            <div>Awaiting exposure data...</div>
            <div className="text-white/10 mt-0.5">Auto-processing active · Run attribution in PEBLE for instant results</div>
          </div>
        )}
      </div>

      {/* Scrollbar styles */}
      <style>{`
        .neural-scrollbar::-webkit-scrollbar { width: 3px; }
        .neural-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .neural-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
      `}</style>
    </div>
  )
}
