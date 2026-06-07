import { useState, useMemo, useEffect } from 'react'
import { TrendingUp, ClipboardList, Check, Send, Loader2, AlertCircle, Sparkles } from 'lucide-react'
import type { ProfitRadarInsight } from '../../../types'
import { dispatchTask, fetchShelfProducts } from '../../opsDispatch/api'
import { applicableLevers, recoveryForLever, LEVER_BY_ID, formatCurrency, formatUnit, type Lever } from '../recoveryModel'

function legacyRoleForType(type: string): 'merchandiser' | 'cashier' {
  return type === 'staff_misallocation' ? 'cashier' : 'merchandiser'
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, backgroundColor: color }} />
    </div>
  )
}

/**
 * Turns an insight into an action. When the backend attached fingerprint-driven
 * economics (insight.economics), the € is computed bottom-up from the real SKUs
 * on the shelf, the zone's traffic, and the behavioral fingerprint — and the
 * shopper can switch the lever (layout / pricing / signage / cross-merch) to see
 * how each action's recovery differs. Falls back to the legacy band otherwise.
 */
interface ImpactSimulatorProps {
  insight: ProfitRadarInsight
  venueId?: string
  roiId?: string | null
  zoneName?: string
  variant?: 'default' | 'theater'
}

export default function ImpactSimulator({ insight, venueId, roiId, zoneName, variant = 'default' }: ImpactSimulatorProps) {
  const econ = insight.economics
  const [effortPct, setEffortPct] = useState(60)
  const [leverId, setLeverId] = useState<string>(econ?.recommendedLeverId || 'layout')
  const [done, setDone] = useState<Set<string>>(new Set())
  const [dispatchState, setDispatchState] = useState<'idle' | 'sending' | 'sent' | 'queued' | 'error'>('idle')
  const [dispatchMsg, setDispatchMsg] = useState<string>('')
  const effort = effortPct / 100
  const isTheater = variant === 'theater'

  // Reset the lever to the recommended one when the insight changes.
  useEffect(() => {
    setLeverId(econ?.recommendedLeverId || 'layout')
    setDispatchState('idle'); setDispatchMsg('')
  }, [insight.id, econ?.recommendedLeverId])

  const levers: Lever[] = useMemo(() => (econ ? applicableLevers(econ) : []), [econ])
  const selectedLever = LEVER_BY_ID[leverId] || levers[0]

  const expected = useMemo(() => (econ ? recoveryForLever(econ, leverId, effort, 'expected') : null), [econ, leverId, effort])
  const conservative = useMemo(() => (econ ? recoveryForLever(econ, leverId, effort, 'conservative') : null), [econ, leverId, effort])
  const aggressive = useMemo(() => (econ ? recoveryForLever(econ, leverId, effort, 'aggressive') : null), [econ, leverId, effort])

  const role: 'merchandiser' | 'cashier' = selectedLever?.role || legacyRoleForType(insight.type)
  const cur = (econ?.currency || insight.impact.currency) === 'EUR' ? '€' : (econ?.currency || insight.impact.currency)

  // Legacy fallback values (no economics on the insight).
  const legacyDay = insight.impact.min + (insight.impact.max - insight.impact.min) * effort
  const legacyWeek = legacyDay * 7

  const dispatch = async () => {
    if (!venueId || dispatchState === 'sending') return
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
          zoneName: zoneName || insight.title,
          roiId: roiId || null,
          suggestedFix: insight.suggestedFix,
          impact: insight.impact,
          lever: selectedLever ? { id: selectedLever.id, label: selectedLever.label } : undefined,
          projectedPerWeek: expected?.perWeek,
          products,
          insightId: insight.id,
        },
      })
      if (res.sent) {
        setDispatchState('sent')
        setDispatchMsg(`Sent to ${res.assigned?.displayName || 'team'}`)
      } else {
        setDispatchState('queued')
        setDispatchMsg(
          res.reason === 'no_subscriber'
            ? `No ${role === 'cashier' ? 'cashier' : 'merchandiser'} subscribed — share the invite link`
            : res.reason === 'not_configured'
              ? 'Telegram not enabled — open Team & Telegram'
              : 'Queued',
        )
      }
    } catch (e: any) {
      setDispatchState('error')
      setDispatchMsg(e.message || 'Dispatch failed')
    }
  }

  const act = (id: string) => setDone(prev => new Set(prev).add(id))

  return (
    <div className={isTheater ? 'overflow-hidden' : 'rounded-lg border border-emerald-700/40 bg-emerald-500/5 overflow-hidden'}>
      {!isTheater && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-emerald-700/30">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-white">Impact Simulator</span>
          <span className="ml-auto text-[10px] text-emerald-300/80">projected — apply the fix</span>
        </div>
      )}

      <div className={`${isTheater ? 'px-4 py-3' : 'p-4'} space-y-4`}>
        {econ ? (
          <>
            {/* Lever selector — the fingerprint recommends one; the rest show why
                they recover less (low match). */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-gray-400">Action lever</span>
                {econ.recommendedLeverId && (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <Sparkles className="w-3 h-3" /> Recommended by fingerprint
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {levers.map(l => {
                  const r = recoveryForLever(econ, l.id, effort, 'expected')
                  const isSel = l.id === leverId
                  const isRec = l.id === econ.recommendedLeverId
                  return (
                    <button
                      key={l.id}
                      onClick={() => setLeverId(l.id)}
                      title={`${l.blurb} · fingerprint match ${Math.round(r.match * 100)}%`}
                      className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                        isSel
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-gray-800/60 text-gray-300 border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      {l.label}
                      {isRec && <span className="ml-1 text-emerald-300">★</span>}
                      <span className={`ml-1 ${isSel ? 'text-emerald-100' : 'text-gray-500'}`}>{Math.round(r.match * 100)}%</span>
                    </button>
                  )
                })}
              </div>
              {selectedLever && (
                <p className="text-[10px] text-gray-500 mt-1.5">{selectedLever.blurb}.</p>
              )}
            </div>

            {/* effort */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-gray-400">{role === 'cashier' ? 'Staffing effort' : 'Execution effort'}</span>
                <span className="text-emerald-300 font-medium tabular-nums">{effortPct}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={effortPct}
                onChange={e => setEffortPct(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
            </div>

            {/* fingerprint match for the chosen lever */}
            {expected && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-400">Fingerprint match · capture</span>
                  <span className="tabular-nums">
                    <span className="text-emerald-300 font-semibold">{Math.round(expected.match * 100)}%</span>
                    <span className="text-gray-600 mx-1">→</span>
                    <span className="text-emerald-400/80">{Math.round(expected.capture * 100)}% of gap</span>
                  </span>
                </div>
                <MiniBar value={expected.match} color="#34d399" />
              </div>
            )}

            {/* € recovered — bottom-up, with a conservative→aggressive range */}
            <div className={`rounded-md bg-gray-900/60 border border-gray-700/60 px-3 ${isTheater ? 'py-3' : 'py-2.5'}`}>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Projected recovery</div>
              <div className="flex items-baseline gap-1.5">
                <span className={`${isTheater ? 'text-2xl' : 'text-xl'} font-bold text-emerald-400 tabular-nums`}>
                  +{formatCurrency(cur, expected?.perWeek || 0)}
                </span>
                <span className="text-xs text-gray-500">/ week</span>
              </div>
              <div className="text-[10px] text-gray-500">
                ≈ {formatCurrency(cur, expected?.perDay || 0)} / day · {formatCurrency(cur, expected?.perYear || 0)} / yr at {effortPct}% effort
              </div>
              {conservative && aggressive && (
                <div className="text-[10px] text-gray-600 mt-0.5">
                  range {formatCurrency(cur, conservative.perWeek)}–{formatCurrency(cur, aggressive.perWeek)} / wk
                </div>
              )}
            </div>

            {/* grounding — what the number is built from */}
            <div className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-700/40 pt-2">
              {econ.isQueue ? (
                <>{econ.exposedPerDay.toLocaleString()} shoppers/day · ~{(econ.benchmark * 100).toFixed(1)}% baskets abandoned at peak · {formatUnit(cur, econ.marginPerUnit)} margin/basket</>
              ) : (
                <>{econ.exposedPerDay.toLocaleString()} shoppers/day · {Math.round((econ.conversionRate ?? econ.engagement) * 100)}% buy today (target {Math.round(econ.benchmark * 100)}%) ·
                {' '}{formatUnit(cur, econ.marginPerUnit)} margin/unit
                {econ.skuCount > 0 && <> over {econ.skuCount} SKUs</>} ·
                {' '}{Math.round(econ.winnable * 100)}% winnable</>
              )}
              {econ.basis === 'shelf'
                ? <span className="text-emerald-500/70"> · grounded in this shelf&apos;s SKUs</span>
                : econ.basis === 'economics'
                  ? <span className="text-emerald-500/60"> · store economics (set per-shelf prices for precision)</span>
                  : <span className="text-amber-500/60"> · reference estimate — add economics</span>}
            </div>
          </>
        ) : (
          /* Legacy fallback */
          <div className={`rounded-md bg-gray-900/60 border border-gray-700/60 px-3 ${isTheater ? 'py-3' : 'py-2.5'}`}>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">Projected recovery</div>
            <div className="flex items-baseline gap-1.5">
              <span className={`${isTheater ? 'text-2xl' : 'text-xl'} font-bold text-emerald-400 tabular-nums`}>
                +{cur}{Math.round(legacyWeek).toLocaleString()}
              </span>
              <span className="text-xs text-gray-500">/ week</span>
            </div>
            <div className="text-[10px] text-gray-500">≈ {cur}{Math.round(legacyDay).toLocaleString()} / day at {effortPct}% effort</div>
            <input
              type="range"
              min={10}
              max={100}
              value={effortPct}
              onChange={e => setEffortPct(Number(e.target.value))}
              className="w-full accent-emerald-500 mt-2"
            />
          </div>
        )}

        {/* actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={dispatch}
            disabled={!venueId || dispatchState === 'sending' || dispatchState === 'sent'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:cursor-default ${
              dispatchState === 'sent'
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                : dispatchState === 'queued' || dispatchState === 'error'
                  ? 'bg-amber-600/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
            title={!venueId ? 'Venue required' : 'Send a Telegram task to the responsible team'}
          >
            {dispatchState === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : dispatchState === 'sent' ? <Check className="w-3.5 h-3.5" />
              : (dispatchState === 'queued' || dispatchState === 'error') ? <AlertCircle className="w-3.5 h-3.5" />
              : <Send className="w-3.5 h-3.5" />}
            {dispatchState === 'sent' ? 'Dispatched'
              : dispatchState === 'sending' ? 'Dispatching…'
              : role === 'cashier' ? 'Send to checkout team' : 'Dispatch to merchandiser'}
          </button>
          <button
            onClick={() => act('plan')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              done.has('plan')
                ? 'bg-gray-700 text-emerald-300 border border-emerald-500/30'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`}
          >
            {done.has('plan') ? <Check className="w-3.5 h-3.5" /> : <ClipboardList className="w-3.5 h-3.5" />}
            {done.has('plan') ? 'Added to plan' : 'Add to action plan'}
          </button>
        </div>
        {dispatchMsg && (
          <p className={`text-[10px] ${dispatchState === 'sent' ? 'text-emerald-400/80' : dispatchState === 'error' ? 'text-red-400/80' : 'text-amber-300/80'}`}>
            {dispatchMsg}
          </p>
        )}
      </div>
    </div>
  )
}
