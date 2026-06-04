import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, X, Link2, Check, Copy, Users, Trash2, ChevronUp, ChevronDown, Bot, Activity, Settings2, TrendingUp, Clock } from 'lucide-react'
import { API_BASE } from '../../config/api'
import {
  fetchTeams,
  saveConfig,
  reorderPool,
  removeSubscriber,
  sendTest,
  fetchFeed,
  type OpsTeamsResponse,
  type OpsTask,
  type OpsSummary,
} from './api'

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: 'Queued', color: '#6b7280' },
  notified: { label: 'Sent', color: '#38bdf8' },
  acknowledged: { label: "Ack'd", color: '#a78bfa' },
  completed: { label: 'Done', color: '#34d399' },
  verified: { label: 'Verified', color: '#10b981' },
}

function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

interface Props {
  venueId: string
  isOpen: boolean
  onClose: () => void
}

export default function TeamTelegramModal({ venueId, isOpen, onClose }: Props) {
  const [data, setData] = useState<OpsTeamsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [botToken, setBotToken] = useState('')
  const [tokenDirty, setTokenDirty] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [appBaseUrl, setAppBaseUrl] = useState('')

  const [tab, setTab] = useState<'setup' | 'activity'>('setup')
  const [feed, setFeed] = useState<OpsTask[]>([])
  const [summary, setSummary] = useState<OpsSummary | null>(null)
  const pollRef = useRef<number>()

  const loadFeed = useCallback(async () => {
    try {
      const res = await fetchFeed(venueId)
      setFeed(res.tasks || [])
      setSummary(res.summary || null)
    } catch { /* ignore */ }
  }, [venueId])

  useEffect(() => {
    if (!isOpen || tab !== 'activity') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined }
      return
    }
    loadFeed()
    pollRef.current = window.setInterval(loadFeed, 6000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [isOpen, tab, loadFeed])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchTeams(venueId)
      setData(res)
      setEnabled(res.config.enabled)
      setAppBaseUrl(res.config.appBaseUrl || '')
      setBotToken('')
      setTokenDirty(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [venueId])

  useEffect(() => {
    if (isOpen && venueId) load()
  }, [isOpen, venueId, load])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const payload: Record<string, any> = { enabled, appBaseUrl: appBaseUrl.trim() }
      if (tokenDirty && botToken.trim()) payload.botToken = botToken.trim()
      const res = await saveConfig(venueId, payload)
      setData(res)
      setEnabled(res.config.enabled)
      setBotToken('')
      setTokenDirty(false)
      setSuccess('Saved')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await sendTest(venueId)
      if (res.sent) setSuccess(`Test task sent to ${res.assigned?.displayName || 'merchandiser'}`)
      else setSuccess(res.reason === 'no_subscriber' ? 'No merchandiser subscribed yet — share the invite link' : 'Saved, but not sent (check token & enabled)')
      load()
      setTimeout(() => setSuccess(null), 5000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTesting(false)
    }
  }

  const copyInvite = () => {
    const link = data?.inviteLink
    if (!link) return
    navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const move = async (role: string, id: string, dir: -1 | 1) => {
    const pool = data?.pools.find(p => p.id === role)
    if (!pool) return
    const ids = [...pool.memberIds]
    const idx = ids.indexOf(id)
    const swap = idx + dir
    if (swap < 0 || swap >= ids.length) return
    ;[ids[idx], ids[swap]] = [ids[swap], ids[idx]]
    try { setData(await reorderPool(venueId, role, ids)) } catch (e: any) { setError(e.message) }
  }

  const remove = async (id: string) => {
    try { setData(await removeSubscriber(venueId, id)) } catch (e: any) { setError(e.message) }
  }

  if (!isOpen) return null

  const cfg = data?.config
  const canTest = !!cfg?.hasToken && enabled

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col bg-gray-950 border border-gray-700 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-sky-500/10 text-sky-400">
              <Send className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-white">Team & Telegram</h2>
              <p className="text-[11px] text-gray-500">Dispatch fixes to merchandisers & checkout teams</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 pt-2 border-b border-gray-800 bg-gray-900/60">
          {([['setup', 'Setup', Settings2], ['activity', 'Dispatch activity', Activity]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${tab === id ? 'border-sky-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{error}</div>}
          {success && <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">{success}</div>}

          {tab === 'activity' ? (
            <ActivityLedger feed={feed} summary={summary} />
          ) : loading ? (
            <div className="py-10 text-center text-gray-500 text-sm">Loading…</div>
          ) : (
            <>
              {/* Telegram bot config */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Bot className="w-4 h-4 text-sky-400" /> Telegram Bot
                  </h3>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-gray-400">Enabled</span>
                    <button type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled(!enabled)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-sky-500' : 'bg-gray-700'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </label>
                </div>
                {cfg?.configured ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                    <Check className="w-3.5 h-3.5" />
                    Token on disk{cfg.tokenLast4 ? <> (…{cfg.tokenLast4})</> : null}
                    {cfg.botUsername && <span className="text-emerald-400/70">· @{cfg.botUsername}</span>}
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                    Paste the full @BotFather token (format 123456789:ABCdef…) to connect.
                  </div>
                )}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                    Bot token {cfg?.hasToken && <span className="normal-case text-emerald-500/80">· saved (blank = keep)</span>}
                  </label>
                  <input type="text" autoComplete="off" value={botToken}
                    onChange={e => { setBotToken(e.target.value); setTokenDirty(true) }}
                    placeholder={cfg?.hasToken ? `Saved — ends …${cfg.tokenLast4 || '????'}` : '123456789:ABCdefGHI…'}
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-sky-500" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">App URL (for mobile task links)</label>
                  <input type="url" value={appBaseUrl} onChange={e => setAppBaseUrl(e.target.value)}
                    placeholder="https://app.yourstore.com"
                    className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-sky-500" />
                  <p className="text-[10px] text-gray-600 mt-1">Public URL of this app — used in the "Open map" link sent to the team.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={save} disabled={saving}
                    className="px-4 py-2 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/40 text-xs font-bold uppercase tracking-wider hover:bg-sky-500/30 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={test} disabled={testing || !canTest}
                    className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 text-xs font-bold uppercase tracking-wider hover:bg-gray-700 disabled:opacity-40">
                    {testing ? 'Sending…' : 'Send test task'}
                  </button>
                </div>
              </div>

              {/* Invite link */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1"><Link2 className="w-4 h-4 text-sky-400" /> Team invite link</h3>
                <p className="text-[11px] text-gray-500 mb-3">Share this with your team. They tap it, pick a role, and start receiving tasks.</p>
                {data?.inviteLink ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate text-[11px] font-mono text-gray-300 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2">{data.inviteLink}</code>
                    <button onClick={copyInvite} className="px-3 py-2 rounded-lg border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 text-xs flex items-center gap-1.5">
                      {copied ? <><Check className="w-3.5 h-3.5" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-300/80">Save a valid bot token & enable to generate the invite link.</p>
                )}
              </div>

              {/* Roster / pools */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-sky-400" /> Roles & round-robin</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(data?.pools || []).map(pool => {
                    const members = pool.memberIds
                      .map(id => data?.subscribers.find(s => s.id === id))
                      .filter(Boolean) as NonNullable<OpsTeamsResponse['subscribers'][number]>[]
                    return (
                      <div key={pool.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] font-bold text-gray-300">{pool.label}</span>
                          <span className="text-[10px] font-mono text-sky-400">{pool.liveCount}/{pool.count}</span>
                        </div>
                        {pool.nextPrimaryName && <p className="text-[10px] text-emerald-400/90 mb-2 truncate">Next: {pool.nextPrimaryName}</p>}
                        <ul className="space-y-1">
                          {members.map((m, idx) => (
                            <li key={m.id} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${m.telegramLinked ? 'border-emerald-500/30 bg-emerald-500/5 text-gray-200' : 'border-gray-700 text-gray-400'}`}>
                              <span className="truncate flex-1">{m.displayName}</span>
                              <button disabled={idx === 0} onClick={() => move(pool.id, m.id, -1)} className="text-gray-600 hover:text-white disabled:opacity-30"><ChevronUp className="w-3 h-3" /></button>
                              <button disabled={idx === members.length - 1} onClick={() => move(pool.id, m.id, 1)} className="text-gray-600 hover:text-white disabled:opacity-30"><ChevronDown className="w-3 h-3" /></button>
                              <button onClick={() => remove(m.id)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                            </li>
                          ))}
                          {members.length === 0 && <li className="text-[9px] text-gray-600 italic px-1">No one yet — share invite</li>}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.open
  return (
    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: `${m.color}22`, color: m.color }}>
      {m.label}
    </span>
  )
}

function ActivityLedger({ feed, summary }: { feed: OpsTask[]; summary: OpsSummary | null }) {
  const [openToken, setOpenToken] = useState<string | null>(null)
  const cur = summary?.currency || '€'

  return (
    <div className="space-y-4">
      {/* Execution roll-up */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Dispatched', value: summary?.dispatched ?? 0, color: '#38bdf8' },
          { label: "Ack'd", value: summary?.acknowledged ?? 0, color: '#a78bfa' },
          { label: 'Completed', value: summary?.completed ?? 0, color: '#34d399' },
          { label: 'Verified', value: summary?.verified ?? 0, color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-900/60 px-2 py-2 text-center">
            <div className="text-lg font-bold tabular-nums" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] uppercase tracking-wide text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>
      {!!summary?.weeklyActioned && (
        <div className="rounded-lg border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-gray-300">Recoverable value actioned</span>
          <span className="ml-auto text-sm font-bold text-emerald-300 tabular-nums">{cur}{summary.weeklyActioned.toLocaleString()} / wk</span>
        </div>
      )}

      {/* Ledger */}
      {feed.length === 0 ? (
        <div className="py-10 text-center text-gray-600 text-sm">No tasks dispatched yet.</div>
      ) : (
        <ul className="space-y-2">
          {feed.map(t => {
            const isOpen = openToken === t.token
            return (
              <li key={t.token} className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
                <button onClick={() => setOpenToken(isOpen ? null : t.token)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800/40">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_META[t.status]?.color || '#6b7280' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-200 truncate">{t.title || t.payload?.zoneName || t.kind}</p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {t.roleLabel} · {t.assignedName || 'unassigned'} · {timeAgo(t.createdAt)}
                    </p>
                  </div>
                  <StatusChip status={t.status} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 border-t border-gray-800 space-y-2">
                    {t.payload?.suggestedFix && <p className="text-[11px] text-gray-400">{t.payload.suggestedFix}</p>}
                    {t.verification && (
                      <div className="rounded-lg border border-emerald-700/30 bg-emerald-900/10 px-2.5 py-1.5">
                        <span className="text-[9px] uppercase tracking-wide text-emerald-500">
                          {t.verification.source === 'measured' ? 'Outcome confirmed' : 'Projected outcome'}
                        </span>
                        <p className="text-[11px] text-emerald-300">{t.verification.summary}</p>
                      </div>
                    )}
                    {t.proof?.photoUrl && (
                      <img src={`${API_BASE}${t.proof.photoUrl}`} alt="proof" className="w-full max-h-44 object-cover rounded-lg border border-gray-800" />
                    )}
                    {t.proof?.note && <p className="text-[11px] text-gray-400 italic">“{t.proof.note}”</p>}
                    {/* Ledger timeline */}
                    <ul className="space-y-1 pt-1">
                      {(t.ledger || []).map((l, i) => (
                        <li key={i} className="flex items-start gap-2 text-[10px]">
                          <Clock className="w-3 h-3 text-gray-600 mt-0.5 shrink-0" />
                          <span className="text-gray-500 shrink-0">{timeAgo(l.ts)}</span>
                          <span className="text-gray-400">{l.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
