import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Upload, Check, Euro, Info, FileSpreadsheet, Loader2 } from 'lucide-react'
import { API_BASE } from '../../../config/api'

interface EconomicsForm {
  avgBasketValue: number
  grossMarginPct: number
  dailyTransactions: number
  tradingDaysPerWeek: number
  currency: string
  source?: string
  importedFileName?: string | null
}

interface ImportMeta {
  rowCount: number
  dayCount: number
  detectedColumns: Record<string, string | null>
  totals: { revenue: number; cost: number; transactions: number }
}

interface VenueEconomicsModalProps {
  venueId: string
  open: boolean
  onClose: () => void
  onSaved?: () => void
}

// Mirror of backend RECOVERABLE_FRACTION for a live preview.
const FRACTION = { high: [0.015, 0.04], medium: [0.004, 0.015], low: [0.001, 0.004] } as const

const EMPTY: EconomicsForm = {
  avgBasketValue: 0,
  grossMarginPct: 0,
  dailyTransactions: 0,
  tradingDaysPerWeek: 7,
  currency: '€',
}

export default function VenueEconomicsModal({ venueId, open, onClose, onSaved }: VenueEconomicsModalProps) {
  const [form, setForm] = useState<EconomicsForm>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMeta, setImportMeta] = useState<ImportMeta | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !venueId) return
    setLoading(true)
    setImportMeta(null)
    setImportError(null)
    fetch(`${API_BASE}/api/venues/${venueId}/economics`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data?.economics) setForm({ ...EMPTY, ...data.economics }) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, venueId])

  const set = (k: keyof EconomicsForm, v: number | string) => setForm(prev => ({ ...prev, [k]: v }))

  const dailyRevenue = form.avgBasketValue * form.dailyTransactions
  const dailyMargin = dailyRevenue * (form.grossMarginPct / 100)
  const configured = form.avgBasketValue > 0 && form.dailyTransactions > 0 && form.grossMarginPct > 0
  const band = (sev: keyof typeof FRACTION) => {
    const [a, b] = FRACTION[sev]
    return { min: Math.max(1, Math.round(dailyMargin * a)), max: Math.max(2, Math.round(dailyMargin * b)) }
  }
  const cur = form.currency || '€'

  const handleFile = useCallback(async (file: File) => {
    setImporting(true)
    setImportError(null)
    setImportMeta(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/economics/import`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setImportError(data?.error || 'Could not parse file'); return }
      setForm(prev => ({
        ...prev,
        avgBasketValue: data.derived.avgBasketValue ?? prev.avgBasketValue,
        grossMarginPct: data.derived.grossMarginPct ?? prev.grossMarginPct,
        dailyTransactions: data.derived.dailyTransactions ?? prev.dailyTransactions,
        tradingDaysPerWeek: data.derived.tradingDaysPerWeek ?? prev.tradingDaysPerWeek,
        source: 'import',
        importedFileName: data.fileName,
      }))
      setImportMeta(data.meta)
    } catch {
      setImportError('Upload failed')
    } finally {
      setImporting(false)
    }
  }, [venueId])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/venues/${venueId}/economics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) { onSaved?.(); onClose() }
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const detected = importMeta?.detectedColumns || {}
  const detectedList = Object.entries(detected).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[560px] max-h-[88vh] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/60">
          <div className="flex items-center gap-2">
            <Euro className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-white">Venue economics</h2>
              <p className="text-xs text-gray-500">Grounds Profit Radar's € impact in your real numbers</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

          {/* Upload */}
          <div className="rounded-lg border border-dashed border-gray-600 bg-gray-800/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-blue-400" />
                <div>
                  <div className="text-sm font-medium text-white">Import a sales file</div>
                  <div className="text-[11px] text-gray-500">.xlsx / .xls / .csv — auto-fills the fields below</div>
                </div>
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {importing ? 'Parsing…' : 'Choose file'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
              />
            </div>
            {form.importedFileName && !importError && (
              <div className="mt-2 text-[11px] text-emerald-300 flex items-center gap-1"><Check className="w-3 h-3" /> {form.importedFileName}</div>
            )}
            {importError && <div className="mt-2 text-[11px] text-red-400">{importError}</div>}
            {importMeta && (
              <div className="mt-3 text-[11px] text-gray-400 space-y-1 border-t border-gray-700/50 pt-2">
                <div>{importMeta.rowCount.toLocaleString()} rows · {importMeta.dayCount} day{importMeta.dayCount === 1 ? '' : 's'} · revenue {cur}{importMeta.totals.revenue.toLocaleString()} · {importMeta.totals.transactions.toLocaleString()} tx</div>
                {detectedList.length > 0 && <div className="text-gray-500">Detected columns — {detectedList.join(' · ')}</div>}
                <div className="text-amber-400/80">Review the values below, then Save.</div>
              </div>
            )}
          </div>

          {/* Manual fields */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Average basket value" suffix={cur} value={form.avgBasketValue} onChange={v => set('avgBasketValue', v)} step={0.5} />
            <Field label="Gross margin" suffix="%" value={form.grossMarginPct} onChange={v => set('grossMarginPct', v)} step={0.5} max={100} />
            <Field label="Transactions / day" value={form.dailyTransactions} onChange={v => set('dailyTransactions', v)} step={10} />
            <Field label="Trading days / week" value={form.tradingDaysPerWeek} onChange={v => set('tradingDaysPerWeek', v)} step={1} max={7} min={1} />
          </div>

          {/* Derived */}
          <div className="rounded-lg bg-gray-800/60 border border-gray-700/60 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Estimated daily revenue</span>
              <span className="text-white font-medium tabular-nums">{cur}{Math.round(dailyRevenue).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Estimated daily gross margin</span>
              <span className="text-emerald-400 font-semibold tabular-nums">{cur}{Math.round(dailyMargin).toLocaleString()}</span>
            </div>
            <div className="pt-2 border-t border-gray-700/50">
              <div className="text-[11px] text-gray-500 mb-1.5 flex items-center gap-1"><Info className="w-3 h-3" /> Resulting impact bands (per insight)</div>
              {configured ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  {(['high', 'medium', 'low'] as const).map(sev => {
                    const b = band(sev)
                    const c = sev === 'high' ? '#f87171' : sev === 'medium' ? '#fbbf24' : '#60a5fa'
                    return (
                      <div key={sev} className="rounded-md bg-gray-900/60 border border-gray-700/50 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wide" style={{ color: c }}>{sev}</div>
                        <div className="text-[11px] text-white tabular-nums">{cur}{b.min}–{b.max}<span className="text-gray-500">/day</span></div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-gray-500">Fill in basket, margin and daily transactions to ground the € figures. Until then, Profit Radar uses default reference bands.</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-700/60">
          <span className="text-[11px] text-gray-500">Insights recompute within ~30s after saving.</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs text-gray-300 hover:bg-gray-700">Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Save economics
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, suffix, step = 1, min = 0, max }: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  step?: number
  min?: number
  max?: number
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-400">{label}</span>
      <div className="mt-1 flex items-center rounded-md border border-gray-700 bg-gray-800 focus-within:border-emerald-500/60">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={e => {
            let v = Number(e.target.value)
            if (!Number.isFinite(v)) v = 0
            if (min != null) v = Math.max(min, v)
            if (max != null) v = Math.min(max, v)
            onChange(v)
          }}
          className="flex-1 bg-transparent px-2.5 py-1.5 text-sm text-white outline-none tabular-nums"
        />
        {suffix && <span className="px-2 text-xs text-gray-500">{suffix}</span>}
      </div>
    </label>
  )
}
