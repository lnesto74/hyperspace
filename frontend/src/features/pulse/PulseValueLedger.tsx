import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeCheck, CheckCircle2, Loader2, Send, Zap } from 'lucide-react'
import { API_BASE } from '../../config/api'
import {
  fetchFeed,
  fetchTeams,
  fetchValueLedger,
  saveConfig,
  triggerAutoDispatch,
  type OpsTask,
  type ValueLedger,
} from '../opsDispatch/api'
import {
  formatTime,
  taskDailyEur,
  taskEarnedDaily,
  taskEvidenceLine,
  taskStage,
  taskWeeklyEur,
  taskZoneLabel,
  tasksToday,
} from './pulseTaskUtils'

interface Props {
  venueId: string
  liveUnveiledDaily: number
  currency: string
  refreshKey?: number
  layout?: 'sidebar'
}

function CompactMetric({
  label,
  value,
  currency,
  accent,
}: {
  label: string
  value: number
  currency: string
  accent: 'green' | 'amber' | 'gray'
}) {
  const color = accent === 'green' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-gray-300'
  const dot = accent === 'green' ? 'bg-emerald-400' : accent === 'amber' ? 'bg-amber-400' : 'bg-gray-500'
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5 border-b border-gray-800/50 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="text-[9px] uppercase tracking-wider text-gray-500 truncate">{label}</span>
      </div>
      <span className={`text-base font-mono font-bold tabular-nums shrink-0 ${color}`}>
        {currency}{Math.round(value).toLocaleString()}<span className="text-[9px] font-normal text-gray-600">/d</span>
      </span>
    </div>
  )
}

function HeroMetric({
  label,
  value,
  currency,
  suffix,
  accent,
  large,
}: {
  label: string
  value: number
  currency: string
  suffix?: string
  accent: 'green' | 'amber' | 'gray'
  large?: boolean
}) {
  const styles = {
    green: {
      ring: 'ring-emerald-500/30',
      bg: 'bg-emerald-500/10',
      value: 'text-emerald-300',
      bar: 'bg-emerald-400',
    },
    amber: {
      ring: 'ring-amber-500/30',
      bg: 'bg-amber-500/10',
      value: 'text-amber-300',
      bar: 'bg-amber-400',
    },
    gray: {
      ring: 'ring-gray-600/40',
      bg: 'bg-gray-800/40',
      value: 'text-gray-300',
      bar: 'bg-gray-500',
    },
  }[accent]

  return (
    <div className={`flex-1 min-w-[140px] rounded-lg ring-1 ${styles.ring} ${styles.bg} px-4 py-3`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`h-1.5 w-1.5 rounded-full ${styles.bar}`} />
        <span className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-medium">{label}</span>
      </div>
      <p className={`font-mono tabular-nums font-semibold leading-none ${styles.value} ${large ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'}`}>
        {currency}{Math.round(value).toLocaleString()}
        <span className="text-sm font-normal text-gray-500 ml-1">/day</span>
      </p>
      {suffix && <p className="text-[10px] text-gray-500 font-mono mt-1.5">{suffix}</p>}
    </div>
  )
}

function ActionEvidenceRow({ task, currency, compact }: { task: OpsTask; currency: string; compact?: boolean }) {
  const stage = taskStage(task)
  const daily = taskDailyEur(task)
  const earned = taskEarnedDaily(task)
  const weekly = taskWeeklyEur(task)
  const ts = formatTime(task.verifiedAt || task.completedAt || task.acknowledgedAt || task.createdAt)
  const Icon = stage.earned ? BadgeCheck : stage.key === 'done' ? CheckCircle2 : Send
  const photoUrl = task.proof?.photoUrl
    ? (task.proof.photoUrl.startsWith('http') ? task.proof.photoUrl : `${API_BASE}${task.proof.photoUrl}`)
    : null

  return (
    <div className={`flex items-stretch gap-2 rounded border px-2 py-2 ${stage.pill} ${compact ? 'text-[10px]' : ''}`}>
      {photoUrl && !compact && (
        <img
          src={photoUrl}
          alt="Proof"
          className="w-12 h-12 rounded object-cover shrink-0 border border-gray-700/80"
        />
      )}
      <div className={`w-1 shrink-0 rounded-full ${stage.bar}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold tracking-wider ${stage.text}`}>
            <Icon className="w-3 h-3" />
            {stage.label}
          </span>
          <span className="text-[11px] text-gray-200 font-medium truncate">{taskZoneLabel(task)}</span>
          {ts && <span className="text-[10px] text-gray-500 font-mono ml-auto">{ts}</span>}
        </div>
        <p className="text-[10px] text-gray-400 font-mono mt-1 truncate">{taskEvidenceLine(task)}</p>
      </div>
      <div className="shrink-0 text-right pl-2">
        {stage.earned ? (
          <>
            <p className="text-lg font-mono font-bold tabular-nums text-emerald-300 leading-none">
              +{currency}{Math.round(earned)}
            </p>
            <p className="text-[9px] text-emerald-500/80 font-mono">/day earned</p>
            <p className="text-[9px] text-gray-600 font-mono">{currency}{Math.round(weekly)}/wk</p>
          </>
        ) : (
          <>
            <p className={`text-base font-mono font-semibold tabular-nums leading-none ${stage.text}`}>
              {currency}{Math.round(daily)}
            </p>
            <p className="text-[9px] text-gray-600 font-mono">/day at stake</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function PulseValueLedger({
  venueId,
  liveUnveiledDaily,
  currency,
  refreshKey = 0,
  layout,
}: Props) {
  const [ledger, setLedger] = useState<ValueLedger | null>(null)
  const [tasks, setTasks] = useState<OpsTask[]>([])
  const [autoDispatch, setAutoDispatch] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [ledgerData, feed, teams] = await Promise.all([
          fetchValueLedger(venueId, liveUnveiledDaily),
          fetchFeed(venueId),
          fetchTeams(venueId),
        ])
        if (!cancelled) {
          setLedger(ledgerData)
          setTasks(feed.tasks || [])
          setAutoDispatch(!!teams.config?.autoDispatchEnabled)
        }
      } catch {
        if (!cancelled) {
          setLedger(null)
          setTasks([])
        }
      }
    }
    load()
    const iv = window.setInterval(load, 12_000)
    return () => {
      cancelled = true
      window.clearInterval(iv)
    }
  }, [venueId, liveUnveiledDaily, refreshKey])

  const toggleAutoDispatch = useCallback(async () => {
    if (autoSaving) return
    const next = !autoDispatch
    setAutoSaving(true)
    try {
      const res = await saveConfig(venueId, { autoDispatchEnabled: next })
      setAutoDispatch(!!res.config?.autoDispatchEnabled)
      if (next) await triggerAutoDispatch(venueId)
    } catch {
      /* keep previous state */
    } finally {
      setAutoSaving(false)
    }
  }, [autoDispatch, autoSaving, venueId])

  const cur = ledger?.currency || currency
  const today = ledger?.today
  const todayTasks = useMemo(() => tasksToday(tasks), [tasks])
  const earnedTasks = useMemo(() => todayTasks.filter(t => taskEarnedDaily(t) > 0), [todayTasks])

  const verifiedToday = today?.verifiedDaily ?? 0
  const pipelineToday = today?.pipelineDaily ?? 0
  const latent = Math.round(today?.discoveredLive ?? liveUnveiledDaily)

  if (layout === 'sidebar') {
    return (
      <div className="shrink-0 flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="shrink-0 px-3 pt-3 pb-2 border-b border-gray-800/60">
          <CompactMetric label="earned today" value={verifiedToday} currency={cur} accent="green" />
          <CompactMetric label="in flight" value={pipelineToday} currency={cur} accent="amber" />
          <CompactMetric label="latent at risk" value={latent} currency={cur} accent="gray" />
          <button
            type="button"
            onClick={toggleAutoDispatch}
            disabled={autoSaving}
            className={`mt-2 w-full flex items-center justify-center gap-1.5 text-[9px] uppercase tracking-wider px-2 py-1.5 rounded border transition-colors disabled:opacity-50 ${
              autoDispatch
                ? 'border-cyan-500/50 text-cyan-200 bg-cyan-500/10'
                : 'border-gray-700 text-gray-500 hover:border-gray-600'
            }`}
          >
            {autoSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            auto-dispatch {autoDispatch ? 'on' : 'off'}
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-3 py-2 overflow-hidden">
          <span className="text-[9px] uppercase tracking-[0.2em] text-gray-500 shrink-0 mb-1.5">evidence today</span>
          {todayTasks.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
              {todayTasks.slice(0, 12).map(task => (
                <ActionEvidenceRow key={task.token} task={task} currency={cur} compact />
              ))}
            </div>
          ) : (
            <p className="text-[9px] font-mono text-gray-600 leading-relaxed">
              {autoDispatch ? 'Auto-send active — evidence appears when team marks done.' : 'Deploy a signal or enable auto-dispatch.'}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-gray-800/60 bg-gradient-to-b from-[#050810] to-[#030508] px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-3 flex-1 min-w-0">
          <HeroMetric
            label="earned today"
            value={verifiedToday}
            currency={cur}
            suffix={earnedTasks.length > 0
              ? `${earnedTasks.length} action${earnedTasks.length === 1 ? '' : 's'} verified by floor team`
              : 'verified after merchandiser marks done'}
            accent="green"
            large
          />
          <HeroMetric
            label="in flight"
            value={pipelineToday}
            currency={cur}
            suffix={today ? `${today.counts.pipeline} dispatched · awaiting done + verify` : undefined}
            accent="amber"
          />
          <HeroMetric
            label="latent at risk"
            value={latent}
            currency={cur}
            suffix="live signals not yet actioned"
            accent="gray"
          />
        </div>

        <button
          type="button"
          onClick={toggleAutoDispatch}
          disabled={autoSaving}
          className={`shrink-0 flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-3 py-2 rounded-md border transition-colors mt-1 disabled:opacity-50 ${
            autoDispatch
              ? 'border-cyan-500/50 text-cyan-200 bg-cyan-500/10'
              : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400'
          }`}
          title={autoDispatch
            ? 'Server sends top signal to Telegram every 5 min — click for manual only'
            : 'Manual deploy only — click to auto-dispatch top signal every 5 min'}
        >
          {autoSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          auto-dispatch {autoDispatch ? 'on' : 'off'}
        </button>
      </div>

      {todayTasks.length > 0 ? (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">evidence today</span>
            <span className="text-[10px] font-mono text-gray-600">
              dispatched → on it → done → earned
            </span>
          </div>
          <div className="space-y-2 max-h-[168px] overflow-y-auto pr-1">
            {todayTasks.slice(0, 8).map(task => (
              <ActionEvidenceRow key={task.token} task={task} currency={cur} />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[11px] font-mono text-gray-600 border border-dashed border-gray-800 rounded-md px-4 py-3">
          {autoDispatch
            ? 'No actions dispatched yet today — the server will auto-send the top signal to Telegram every 5 min. Earned value appears here when the team marks done.'
            : 'No actions dispatched today — use Deploy on a signal, or turn on auto-dispatch. Earned value appears here when the team marks done.'}
        </p>
      )}
    </div>
  )
}
