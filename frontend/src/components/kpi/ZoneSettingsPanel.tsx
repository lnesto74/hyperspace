import { useState, useEffect, useCallback } from 'react'
import { 
  X, Settings, Save, Plus, Trash2, Bell, BellOff, 
  AlertTriangle, Users, Clock, TrendingUp, Activity
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface ZoneSettings {
  dwellThresholdSec: number
  engagementThresholdSec: number
  maxOccupancy: number
  alertsEnabled: boolean
  visitEndGraceSec: number
  minVisitDurationSec: number
}

interface AlertRule {
  id?: number
  roiId: string
  ruleName: string
  ruleType: string
  metric: string
  operator: string
  thresholdValue: number
  severity: string
  enabled: boolean
  messageTemplate: string | null
}

interface ZoneSettingsPanelProps {
  roiId: string
  roiName: string
  roiColor: string
  isOpen: boolean
  onClose: () => void
}

const METRICS = [
  { value: 'occupancy', label: 'Current Occupancy', icon: Users, unit: 'people' },
  { value: 'dwellTime', label: 'Dwell Time', icon: Clock, unit: 'seconds' },
  { value: 'visits', label: 'Total Visits', icon: TrendingUp, unit: 'visits' },
  { value: 'avgTimeSpent', label: 'Avg Time Spent', icon: Clock, unit: 'seconds' },
  { value: 'velocity', label: 'Avg Velocity', icon: Activity, unit: 'm/s' },
]

const OPERATORS = [
  { value: 'gt', label: 'Greater than', symbol: '>' },
  { value: 'gte', label: 'Greater or equal', symbol: '≥' },
  { value: 'lt', label: 'Less than', symbol: '<' },
  { value: 'lte', label: 'Less or equal', symbol: '≤' },
  { value: 'eq', label: 'Equal to', symbol: '=' },
]

const SEVERITIES = [
  { value: 'info', label: 'Info', color: 'bg-blue-500' },
  { value: 'warning', label: 'Warning', color: 'bg-amber-500' },
  { value: 'critical', label: 'Critical', color: 'bg-red-500' },
]

function SettingSlider({ 
  label, value, min, max, step, unit, onChange 
}: { 
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <label className="text-xs text-gray-300">{label}</label>
        <span className="text-xs font-medium text-amber-400">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
      />
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

export default function ZoneSettingsPanel({ roiId, roiName, roiColor, isOpen, onClose }: ZoneSettingsPanelProps) {
  const [settings, setSettings] = useState<ZoneSettings>({
    dwellThresholdSec: 60,
    engagementThresholdSec: 120,
    maxOccupancy: 50,
    alertsEnabled: false,
    visitEndGraceSec: 3,
    minVisitDurationSec: 1,
  })
  const [rules, setRules] = useState<AlertRule[]>([])
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'settings' | 'rules'>('settings')
  const [showRuleWizard, setShowRuleWizard] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/roi/${roiId}/settings`)
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      }
    } catch (err) {
      console.error('Failed to fetch zone settings:', err)
    }
  }, [roiId])

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/roi/${roiId}/rules`)
      if (res.ok) {
        const data = await res.json()
        setRules(data)
      }
    } catch (err) {
      console.error('Failed to fetch zone rules:', err)
    }
  }, [roiId])

  useEffect(() => {
    if (isOpen) {
      fetchSettings()
      fetchRules()
    }
  }, [isOpen, fetchSettings, fetchRules])

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/roi/${roiId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRule = async (rule: AlertRule) => {
    try {
      if (rule.id) {
        await fetch(`${API_BASE}/api/rules/${rule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rule),
        })
      } else {
        await fetch(`${API_BASE}/api/roi/${roiId}/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rule),
        })
      }
      fetchRules()
      setShowRuleWizard(false)
      setEditingRule(null)
    } catch (err) {
      console.error('Failed to save rule:', err)
    }
  }

  const handleDeleteRule = async (ruleId: number) => {
    try {
      await fetch(`${API_BASE}/api/rules/${ruleId}`, { method: 'DELETE' })
      fetchRules()
    } catch (err) {
      console.error('Failed to delete rule:', err)
    }
  }

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      await fetch(`${API_BASE}/api/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      fetchRules()
    } catch (err) {
      console.error('Failed to toggle rule:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: roiColor }} />
            <div>
              <h2 className="text-lg font-semibold text-white">{roiName} Settings</h2>
              <p className="text-xs text-gray-400">Zone-specific KPI thresholds and alerts</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'settings'
                ? 'text-amber-400 border-b-2 border-amber-400 bg-gray-800/50'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4 inline mr-1.5" />
            Thresholds
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'rules'
                ? 'text-amber-400 border-b-2 border-amber-400 bg-gray-800/50'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Bell className="w-4 h-4 inline mr-1.5" />
            Alert Rules
            {rules.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-amber-600 text-white rounded-full">
                {rules.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* Alerts Toggle */}
              <div className="flex items-center justify-between p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                <div className="flex items-center gap-2">
                  {settings.alertsEnabled ? (
                    <Bell className="w-4 h-4 text-amber-400" />
                  ) : (
                    <BellOff className="w-4 h-4 text-gray-500" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-white">Zone Alerts</div>
                    <div className="text-[10px] text-gray-400">Trigger events when thresholds are exceeded</div>
                  </div>
                </div>
                <button
                  onClick={() => setSettings(s => ({ ...s, alertsEnabled: !s.alertsEnabled }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    settings.alertsEnabled ? 'bg-amber-600' : 'bg-gray-700'
                  }`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    settings.alertsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>

              {/* Max Occupancy */}
              <SettingSlider
                label="Max Occupancy"
                value={settings.maxOccupancy}
                min={5}
                max={200}
                step={5}
                unit=" people"
                onChange={(v) => setSettings(s => ({ ...s, maxOccupancy: v }))}
              />

              {/* Dwell Threshold */}
              <SettingSlider
                label="Dwell Threshold"
                value={settings.dwellThresholdSec}
                min={5}
                max={180}
                step={5}
                unit="s"
                onChange={(v) => setSettings(s => ({ ...s, dwellThresholdSec: v }))}
              />

              {/* Engagement Threshold */}
              <SettingSlider
                label="Engagement Threshold"
                value={settings.engagementThresholdSec}
                min={10}
                max={300}
                step={10}
                unit="s"
                onChange={(v) => setSettings(s => ({ ...s, engagementThresholdSec: v }))}
              />

              {/* Visit End Grace */}
              <SettingSlider
                label="Visit End Grace Period"
                value={settings.visitEndGraceSec}
                min={1}
                max={10}
                step={1}
                unit="s"
                onChange={(v) => setSettings(s => ({ ...s, visitEndGraceSec: v }))}
              />

              {/* Min Visit Duration */}
              <SettingSlider
                label="Min Visit Duration"
                value={settings.minVisitDurationSec}
                min={0}
                max={10}
                step={1}
                unit="s"
                onChange={(v) => setSettings(s => ({ ...s, minVisitDurationSec: v }))}
              />
            </div>
          )}

          {activeTab === 'rules' && !showRuleWizard && (
            <div className="space-y-3">
              {/* Add Rule Button */}
              <button
                onClick={() => {
                  setEditingRule({
                    roiId,
                    ruleName: '',
                    ruleType: 'threshold',
                    metric: 'occupancy',
                    operator: 'gte',
                    thresholdValue: 50,
                    severity: 'warning',
                    enabled: true,
                    messageTemplate: null,
                  })
                  setShowRuleWizard(true)
                }}
                className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-700 rounded-lg text-gray-400 hover:text-amber-400 hover:border-amber-600/50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">Add Alert Rule</span>
              </button>

              {/* Rules List */}
              {rules.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No alert rules configured</p>
                  <p className="text-xs text-gray-600 mt-1">Create rules to trigger events in the Activity Ledger</p>
                </div>
              ) : (
                rules.map((rule) => {
                  const metric = METRICS.find(m => m.value === rule.metric)
                  const operator = OPERATORS.find(o => o.value === rule.operator)
                  const severity = SEVERITIES.find(s => s.value === rule.severity)
                  
                  return (
                    <div 
                      key={rule.id}
                      className={`p-3 border rounded-lg transition-colors ${
                        rule.enabled 
                          ? 'bg-gray-800/50 border-gray-700' 
                          : 'bg-gray-800/20 border-gray-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${severity?.color || 'bg-gray-500'}`} />
                            <span className="text-sm font-medium text-white">{rule.ruleName}</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            When <span className="text-amber-400">{metric?.label || rule.metric}</span>{' '}
                            <span className="text-gray-300">{operator?.symbol || rule.operator}</span>{' '}
                            <span className="text-amber-400">{rule.thresholdValue}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleRule(rule)}
                            className={`p-1 rounded transition-colors ${
                              rule.enabled 
                                ? 'text-amber-400 hover:bg-amber-500/20' 
                                : 'text-gray-500 hover:bg-gray-700'
                            }`}
                            title={rule.enabled ? 'Disable' : 'Enable'}
                          >
                            {rule.enabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingRule(rule)
                              setShowRuleWizard(true)
                            }}
                            className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
                            title="Edit"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => rule.id && handleDeleteRule(rule.id)}
                            className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/20 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {activeTab === 'rules' && showRuleWizard && editingRule && (
            <RuleWizard
              rule={editingRule}
              onSave={handleSaveRule}
              onCancel={() => {
                setShowRuleWizard(false)
                setEditingRule(null)
              }}
            />
          )}
        </div>

        {/* Footer */}
        {activeTab === 'settings' && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-700 bg-gray-800">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function RuleWizard({ 
  rule, 
  onSave, 
  onCancel 
}: { 
  rule: AlertRule
  onSave: (rule: AlertRule) => void
  onCancel: () => void
}) {
  const [formData, setFormData] = useState(rule)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-gray-700">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-medium text-white">
          {rule.id ? 'Edit Alert Rule' : 'Create Alert Rule'}
        </h3>
      </div>

      {/* Rule Name */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Rule Name</label>
        <input
          type="text"
          value={formData.ruleName}
          onChange={(e) => setFormData(f => ({ ...f, ruleName: e.target.value }))}
          placeholder="e.g., Max Capacity Alert"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* Metric */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">When this metric...</label>
        <select
          value={formData.metric}
          onChange={(e) => setFormData(f => ({ ...f, metric: e.target.value }))}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-amber-500 focus:outline-none"
        >
          {METRICS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Operator + Threshold */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Is...</label>
          <select
            value={formData.operator}
            onChange={(e) => setFormData(f => ({ ...f, operator: e.target.value }))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-amber-500 focus:outline-none"
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>{o.label} ({o.symbol})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Threshold Value</label>
          <input
            type="number"
            value={formData.thresholdValue}
            onChange={(e) => setFormData(f => ({ ...f, thresholdValue: parseFloat(e.target.value) || 0 }))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:border-amber-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Severity */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Severity</label>
        <div className="flex gap-2">
          {SEVERITIES.map((s) => (
            <button
              key={s.value}
              onClick={() => setFormData(f => ({ ...f, severity: s.value }))}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
                formData.severity === s.value
                  ? 'border-amber-500 bg-amber-500/20 text-white'
                  : 'border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${s.color}`} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message Template */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Custom Message (optional)</label>
        <input
          type="text"
          value={formData.messageTemplate || ''}
          onChange={(e) => setFormData(f => ({ ...f, messageTemplate: e.target.value || null }))}
          placeholder="e.g., Zone capacity exceeded!"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(formData)}
          disabled={!formData.ruleName.trim()}
          className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {rule.id ? 'Update Rule' : 'Create Rule'}
        </button>
      </div>
    </div>
  )
}
