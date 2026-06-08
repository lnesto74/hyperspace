import { useEffect, useMemo, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import type { ProfitRadarInsight, ZoneFieldEntry } from '../../types'
import { dispatchTask, fetchShelfProducts } from '../opsDispatch/api'
import { LEVER_BY_ID, legacyRoleForType } from './pulseDispatch'
import PulseFingerprintBars from './PulseFingerprintBars'
import {
  dominantSignal,
  fingerprintBars,
  patternLabel,
  shortTitle,
  weeklyRecovery,
} from './pulseUtils'

interface Props {
  insight: ProfitRadarInsight
  venueId: string
  zoneField: ZoneFieldEntry | null
  liveTrackCount: number
  onOpenTelegram?: () => void
}

function ChainStep({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col min-w-0 flex-1">
      <span className="text-[8px] uppercase tracking-[0.2em] text-gray-600">{label}</span>
      <span className="text-[11px] text-gray-300 font-mono truncate mt-0.5">{value}</span>
    </div>
  )
}

export default function PulseStoryPanel({
  insight,
  venueId,
  zoneField,
  liveTrackCount,
  onOpenTelegram,
}: Props) {
  const [effort, setEffort] = useState(60)
  const [dispatchState, setDispatchState] = useState<'idle' | 'sending' | 'sent' | 'queued' | 'error'>('idle')
  const [dispatchMsg, setDispatchMsg] = useState('')

  const roiId = (insight.dataBasis?.roiId as string | undefined) ?? null
  const econ = insight.economics
  const leverId = econ?.recommendedLeverId || 'layout'
  const lever = LEVER_BY_ID[leverId]
  const role = lever?.role || legacyRoleForType(insight.type)
  const bars = useMemo(() => fingerprintBars(insight, zoneField), [insight, zoneField])
  const weekEur = weeklyRecovery(insight)
  const cur = insight.impact.currency === 'EUR' ? '€' : insight.impact.currency

  useEffect(() => {
    setDispatchState('idle')
    setDispatchMsg('')
    setEffort(60)
  }, [insight.id])

  const gapLine = useMemo(() => {
    const db = insight.dataBasis || {}
    if (typeof db.engagement === 'number' && typeof db.avoidance === 'number') {
      return `${Math.round(db.avoidance * 100)}% avoid · ${Math.round(db.engagement * 100)}% engage`
    }
    if (typeof db.queueScore === 'number') {
      return `queue pressure ${Math.round(db.queueScore * 100)}%`
    }
    return insight.summary.split('.')[0] || insight.why.split('.')[0]
  }, [insight])

  const deploy = async () => {
    if (dispatchState === 'sending') return
    setDispatchState('sending')
    setDispatchMsg('')
    try {
      const products = role === 'merchandiser' && roiId ? await fetchShelfProducts(roiId) : []
      const res = await dispatchTask({
        venueId,
        role,
        kind: role === 'cashier' ? 'checkout' : 'merchandising',
        title: insight.title,
        body: insight.suggestedFix,
        payload: {
          type: insight.type,
          zoneName: (insight.dataBasis?.zone as string) || insight.title,
          roiId,
          suggestedFix: insight.suggestedFix,
          impact: insight.impact,
          lever: lever ? { id: lever.id, label: lever.label } : undefined,
          projectedPerWeek: weekEur ?? undefined,
          products,
          insightId: insight.id,
        },
      })
      if (res.sent) {
        setDispatchState('sent')
        setDispatchMsg(`→ ${res.assigned?.displayName || 'team'}`)
      } else {
        setDispatchState('queued')
        setDispatchMsg(
          res.reason === 'no_subscriber' ? 'no subscriber' : res.reason === 'not_configured' ? 'link telegram' : 'queued',
        )
        if (res.reason === 'not_configured' && onOpenTelegram) onOpenTelegram()
      }
    } catch {
      setDispatchState('error')
      setDispatchMsg('failed')
    }
  }

  const trackN = zoneField?.trackCount ?? (insight.dataBasis?.trackCount as number | undefined) ?? liveTrackCount
  const valueLine = weekEur != null
    ? `${cur}${Math.round(weekEur)}/wk recoverable`
    : `${cur}${insight.impact.min}–${insight.impact.max}/day`

  return (
    <div className="border-t border-gray-800/90 bg-[#060a12]/95 backdrop-blur-sm px-5 py-4 shrink-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 flex items-center gap-1 min-w-0">
          <ChainStep label="move" value={`${trackN} shoppers`} />
          <span className="text-gray-700 px-1">→</span>
          <ChainStep label="pattern" value={dominantSignal(insight, zoneField)} />
          <span className="text-gray-700 px-1">→</span>
          <ChainStep label="gap" value={gapLine} />
          <span className="text-gray-700 px-1">→</span>
          <ChainStep label="value" value={valueLine} />
        </div>
        <div className="w-28 shrink-0 hidden md:block">
          <PulseFingerprintBars bars={bars} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-200 font-medium truncate">{shortTitle(insight.title, 48)}</p>
          <p className="text-[10px] text-gray-500 mt-1 line-clamp-2 font-mono leading-relaxed">
            {patternLabel(insight).toLowerCase()} · {(insight.confidence * 100).toFixed(0)}% conf · {insight.suggestedFix}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex flex-col items-end gap-0.5 w-24">
            <span className="text-[8px] uppercase tracking-wider text-gray-600">effort</span>
            <input
              type="range"
              min={20}
              max={100}
              value={effort}
              onChange={e => setEffort(Number(e.target.value))}
              className="w-full h-1 accent-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={deploy}
            disabled={dispatchState === 'sending'}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-4 py-2 rounded border border-cyan-500/40 text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
          >
            {dispatchState === 'sending' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            deploy
          </button>
          {dispatchMsg && (
            <span className={`text-[10px] font-mono ${dispatchState === 'sent' ? 'text-green-400' : 'text-gray-500'}`}>
              {dispatchMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
