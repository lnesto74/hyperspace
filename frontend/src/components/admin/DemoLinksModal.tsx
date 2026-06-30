import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../config/api'
import type { DemoLinkType } from '../../config/demo'
import { Film, Plus, Copy, Check, Trash2, X, Link2, LayoutDashboard } from 'lucide-react'

interface DemoToken {
  token: string
  label: string | null
  venueId: string | null
  linkType: DemoLinkType
  createdBy: string | null
  createdAt: string
  expiresAt: string | null
  revoked: boolean
  useCount: number
  lastUsedAt: string | null
  status: 'active' | 'expired' | 'revoked'
}

interface VenueOption {
  id: string
  name: string
}

function buildLink(token: string): string {
  return `${window.location.origin}/?demo=${token}`
}

export default function DemoLinksModal({ onClose }: { onClose: () => void }) {
  const { token: authToken } = useAuth()
  const [tokens, setTokens] = useState<DemoToken[]>([])
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [label, setLabel] = useState('')
  const [venueId, setVenueId] = useState('')
  const [linkType, setLinkType] = useState<DemoLinkType>('story')
  const [expiresInDays, setExpiresInDays] = useState('30')
  const [isLoading, setIsLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  }), [authToken])

  const fetchData = useCallback(async () => {
    try {
      const [tokRes, venueRes] = await Promise.all([
        fetch(`${API_BASE}/api/demo-access/tokens`, { headers: headers() }),
        fetch(`${API_BASE}/api/venues`),
      ])
      if (tokRes.ok) {
        const rows = await tokRes.json()
        setTokens(rows.map((t: DemoToken) => ({
          ...t,
          linkType: t.linkType === 'dashboard' ? 'dashboard' : 'story',
        })))
      } else setError('Failed to load demo links (superadmin required).')
      if (venueRes.ok) {
        const data = await venueRes.json()
        const list = Array.isArray(data) ? data : (data.venues || [])
        setVenues(list.map((v: { id: string; name: string }) => ({ id: v.id, name: v.name })))
      }
    } catch {
      setError('Failed to load demo links.')
    } finally {
      setIsLoading(false)
    }
  }, [headers])

  useEffect(() => { fetchData() }, [fetchData])

  const createToken = useCallback(async () => {
    if (linkType === 'dashboard' && !venueId) {
      setError('Select a venue for dashboard public links.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/demo-access/tokens`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          label: label.trim() || null,
          venueId: venueId || null,
          linkType,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error || 'Failed to create link.')
        return
      }
      const created: DemoToken = await res.json()
      setTokens((prev) => [{ ...created, linkType: created.linkType || linkType }, ...prev])
      setLabel('')
      try {
        await navigator.clipboard.writeText(buildLink(created.token))
        setCopied(created.token)
        setTimeout(() => setCopied((c) => (c === created.token ? null : c)), 2000)
      } catch { /* clipboard may be blocked */ }
    } catch {
      setError('Failed to create link.')
    } finally {
      setCreating(false)
    }
  }, [headers, label, venueId, expiresInDays, linkType])

  const revokeToken = useCallback(async (tok: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/demo-access/tokens/${encodeURIComponent(tok)}`, {
        method: 'DELETE',
        headers: headers(),
      })
      if (res.ok) {
        setTokens((prev) => prev.map((t) => (t.token === tok ? { ...t, revoked: true, status: 'revoked' } : t)))
      }
    } catch { /* ignore */ }
  }, [headers])

  const copyLink = useCallback(async (tok: string) => {
    try {
      await navigator.clipboard.writeText(buildLink(tok))
      setCopied(tok)
      setTimeout(() => setCopied((c) => (c === tok ? null : c)), 2000)
    } catch { /* ignore */ }
  }, [])

  const venueName = (id: string | null) => venues.find((v) => v.id === id)?.name || (id ? 'Pinned venue' : 'First venue')

  const statusBadge = (status: DemoToken['status']) => {
    const map: Record<DemoToken['status'], string> = {
      active: 'bg-emerald-500/15 text-emerald-400',
      expired: 'bg-amber-500/15 text-amber-400',
      revoked: 'bg-gray-600/30 text-gray-400',
    }
    return <span className={`px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded font-semibold ${map[status]}`}>{status}</span>
  }

  const typeBadge = (type: DemoLinkType) => {
    if (type === 'dashboard') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded font-semibold bg-cyan-500/15 text-cyan-400">
          <LayoutDashboard className="w-3 h-3" /> Dashboard
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded font-semibold bg-violet-500/15 text-violet-400">
        <Film className="w-3 h-3" /> Story
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[40rem] max-w-[94vw] max-h-[88vh] flex flex-col bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <Link2 className="w-5 h-5 text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">Demo Links</h2>
              <p className="text-[11px] text-gray-500">
                Shareable links that skip login — 3D story tour or Esselunga Executive dashboard
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-gray-800 space-y-3">
          <div className="flex bg-gray-800/80 rounded-lg p-0.5 border border-gray-700/50">
            <button
              type="button"
              onClick={() => setLinkType('story')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
                linkType === 'story' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" /> 3D Story tour
            </button>
            <button
              type="button"
              onClick={() => setLinkType('dashboard')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
                linkType === 'dashboard' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard public link
            </button>
          </div>

          <div className="grid grid-cols-12 gap-2.5">
            <div className="col-span-5">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={linkType === 'dashboard' ? 'e.g. Treviglio executive' : 'e.g. Treviglio customer'}
                className="w-full px-2.5 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="col-span-4">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Venue {linkType === 'dashboard' && <span className="text-cyan-500">*</span>}
              </label>
              <select
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">{linkType === 'dashboard' ? 'Select venue…' : 'First / current venue'}</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Expires</label>
              <select
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Never</option>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
          </div>
          <button
            onClick={createToken}
            disabled={creating}
            className={`flex items-center gap-2 px-3.5 py-2 text-sm font-medium disabled:opacity-60 text-white rounded-lg transition-colors ${
              linkType === 'dashboard' ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            <Plus className="w-4 h-4" />
            {creating
              ? 'Generating…'
              : linkType === 'dashboard'
                ? 'Generate dashboard public link'
                : 'Generate demo link'}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : tokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Link2 className="w-8 h-8 text-gray-700 mb-2" />
              <p className="text-sm text-gray-500">No links yet. Generate one above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tokens.map((t) => {
                const active = t.status === 'active'
                return (
                  <div key={t.token} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${active ? 'border-gray-700 bg-gray-800/50' : 'border-gray-800 bg-gray-900/40 opacity-70'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white font-medium truncate">{t.label || 'Untitled link'}</span>
                        {typeBadge(t.linkType || 'story')}
                        {statusBadge(t.status)}
                      </div>
                      <p className="text-[11px] text-gray-500 truncate">
                        {venueName(t.venueId)} · {t.useCount} open{t.useCount === 1 ? '' : 's'}
                        {t.expiresAt ? ` · expires ${new Date(t.expiresAt).toLocaleDateString()}` : ' · no expiry'}
                      </p>
                      {active && (
                        <p className="text-[10px] text-gray-600 font-mono truncate mt-0.5">{buildLink(t.token)}</p>
                      )}
                    </div>
                    {active && (
                      <button
                        onClick={() => copyLink(t.token)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-700/60 hover:bg-gray-700 rounded-lg transition-colors"
                        title="Copy link"
                      >
                        {copied === t.token ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied === t.token ? 'Copied' : 'Copy'}
                      </button>
                    )}
                    {!t.revoked && (
                      <button
                        onClick={() => revokeToken(t.token)}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700/60 rounded-lg transition-colors"
                        title="Revoke link"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
