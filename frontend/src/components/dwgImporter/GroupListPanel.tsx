import { useMemo, useEffect, useRef } from 'react'
import { Layers, CheckCircle2, AlertCircle, Search, Trash2, Pencil, Check, X, Sparkles, Loader2, Filter, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { DwgGroup, GroupMapping, DwgFixture } from './DwgImporterPage'
import { API_BASE } from '../../config/api'

export interface AiSmartFilterResult {
  group_id: string
  category: string
  should_filter: boolean
  filter_reason: string | null
  confidence: number
  translated_name?: string
  reasoning: string
}

export interface AiSmartFilterResponse {
  analysis_summary: string
  groups: AiSmartFilterResult[]
  filter_stats: {
    total_groups: number
    to_filter: number
    to_keep: number
    by_category: Record<string, number>
    by_filter_reason: Record<string, number>
  }
  cached: boolean
  model: string
  latencyMs: number
}

interface GroupListPanelProps {
  groups: DwgGroup[]
  fixtures: DwgFixture[]
  mappings: Record<string, GroupMapping>
  selectedGroupId: string | null
  onSelectGroup: (groupId: string | null) => void
  hoveredFixtureId?: string | null
  onDeleteGroup?: (groupId: string) => void
  customNames?: Record<string, string>
  onUpdateName?: (groupId: string, name: string) => void
  unitScaleToM?: number
  importId?: string
  onApplyAiFilter?: (groupIds: string[]) => void
  onApplyAiMappings?: (mappings: Record<string, { type: string }>) => void
}

export default function GroupListPanel({ 
  groups,
  fixtures,
  mappings, 
  selectedGroupId, 
  onSelectGroup,
  hoveredFixtureId,
  onDeleteGroup,
  customNames = {},
  onUpdateName,
  unitScaleToM = 1,
  importId,
  onApplyAiFilter,
  onApplyAiMappings
}: GroupListPanelProps) {
  // AI Smart Filter state
  const [aiFilterLoading, setAiFilterLoading] = useState(false)
  const [aiFilterResult, setAiFilterResult] = useState<AiSmartFilterResponse | null>(null)
  const [aiFilterError, setAiFilterError] = useState<string | null>(null)
  const [showAiPreview, setShowAiPreview] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const groupRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Find which group the hovered fixture belongs to
  const hoveredGroupId = useMemo(() => {
    if (!hoveredFixtureId) return null
    const fixture = fixtures.find(f => f.id === hoveredFixtureId)
    return fixture?.group_id || null
  }, [hoveredFixtureId, fixtures])

  // Scroll to hovered group
  useEffect(() => {
    if (hoveredGroupId && groupRefs.current.has(hoveredGroupId)) {
      const element = groupRefs.current.get(hoveredGroupId)
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [hoveredGroupId])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'mapped' | 'unmapped'>('all')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  
  const startEditing = (groupId: string, currentName: string) => {
    setEditingGroupId(groupId)
    setEditingName(currentName)
  }
  
  const saveEdit = () => {
    if (editingGroupId && onUpdateName && editingName.trim()) {
      onUpdateName(editingGroupId, editingName.trim())
    }
    setEditingGroupId(null)
    setEditingName('')
  }
  
  const cancelEdit = () => {
    setEditingGroupId(null)
    setEditingName('')
  }
  
  const getDisplayName = (group: DwgGroup) => {
    return customNames[group.group_id] || group.block || `${group.layer} Shape`
  }

  // AI Smart Filter handler
  const handleAiSmartFilter = async () => {
    if (!importId) return
    setAiFilterLoading(true)
    setAiFilterError(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/dwg/import/${importId}/ai-smart-filter`, {
        method: 'POST'
      })
      
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'AI analysis failed')
      }
      
      const data: AiSmartFilterResponse = await res.json()
      setAiFilterResult(data)
      setShowAiPreview(true)
    } catch (err) {
      setAiFilterError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setAiFilterLoading(false)
    }
  }

  // Apply AI filter (delete recommended groups)
  const handleApplyFilter = () => {
    console.log('[AI Filter] handleApplyFilter called', { aiFilterResult, onApplyAiFilter: !!onApplyAiFilter })
    if (!aiFilterResult || !onApplyAiFilter) {
      console.warn('[AI Filter] Missing aiFilterResult or onApplyAiFilter')
      return
    }
    const groupsToFilter = aiFilterResult.groups
      .filter(g => g.should_filter)
      .map(g => g.group_id)
    console.log('[AI Filter] Filtering', groupsToFilter.length, 'groups')
    onApplyAiFilter(groupsToFilter)
    setShowAiPreview(false)
  }

  // Apply AI mappings (classify groups)
  const handleApplyMappings = () => {
    if (!aiFilterResult || !onApplyAiMappings) return
    const mappings: Record<string, { type: string }> = {}
    for (const g of aiFilterResult.groups) {
      if (!g.should_filter) {
        mappings[g.group_id] = { type: g.category }
      }
    }
    onApplyAiMappings(mappings)
  }

  // Get AI classification for a group
  const getAiClassification = (groupId: string) => {
    return aiFilterResult?.groups.find(g => g.group_id === groupId)
  }

  // Sort groups by count (descending)
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => b.count - a.count)
  }, [groups])

  // Filter groups
  const filteredGroups = useMemo(() => {
    return sortedGroups.filter(group => {
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        const matchesBlock = group.block?.toLowerCase().includes(search)
        const matchesLayer = group.layer?.toLowerCase().includes(search)
        if (!matchesBlock && !matchesLayer) return false
      }

      // Status filter
      if (filterStatus === 'mapped' && !mappings[group.group_id]) return false
      if (filterStatus === 'unmapped' && mappings[group.group_id]) return false

      return true
    })
  }, [sortedGroups, searchTerm, filterStatus, mappings])

  // Statistics
  const stats = useMemo(() => {
    const total = groups.length
    const mapped = groups.filter(g => mappings[g.group_id]).length
    const totalFixtures = groups.reduce((sum, g) => sum + g.count, 0)
    return { total, mapped, unmapped: total - mapped, totalFixtures }
  }, [groups, mappings])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border-dark">
        <h2 className="text-sm font-medium text-white flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-highlight" />
          Fixture Groups
        </h2>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search groups..."
            className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-border-dark rounded-lg text-sm text-white placeholder-gray-500 focus:border-highlight focus:outline-none"
          />
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1">
          {(['all', 'mapped', 'unmapped'] as const).map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                filterStatus === status
                  ? 'bg-highlight text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {status === 'all' && `All (${stats.total})`}
              {status === 'mapped' && `Mapped (${stats.mapped})`}
              {status === 'unmapped' && `Unmapped (${stats.unmapped})`}
            </button>
          ))}
        </div>

        {/* AI Quick Clean Button */}
        {importId && onApplyAiFilter && (
          <button
            onClick={handleAiSmartFilter}
            disabled={aiFilterLoading}
            className="mt-2 w-full px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {aiFilterLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing with AI...</>
            ) : (
              <><Wand2 className="w-4 h-4" /> AI Quick Clean</>
            )}
          </button>
        )}

        {aiFilterError && (
          <div className="mt-2 p-2 bg-red-900/30 border border-red-500/50 rounded text-xs text-red-400">
            {aiFilterError}
          </div>
        )}
      </div>

      {/* AI Preview Panel */}
      {showAiPreview && aiFilterResult && (
        <div className="p-3 bg-gradient-to-b from-purple-900/30 to-indigo-900/30 border-b border-purple-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white">AI Analysis Complete</span>
            </div>
            <button
              onClick={() => setShowAiPreview(false)}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <p className="text-xs text-gray-300 mb-3">{aiFilterResult.analysis_summary}</p>
          
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div className="bg-green-900/30 border border-green-500/30 rounded p-2">
              <div className="text-green-400 font-medium">{aiFilterResult.filter_stats.to_keep}</div>
              <div className="text-gray-400">Groups to Keep</div>
            </div>
            <div className="bg-red-900/30 border border-red-500/30 rounded p-2">
              <div className="text-red-400 font-medium">{aiFilterResult.filter_stats.to_filter}</div>
              <div className="text-gray-400">Groups to Filter</div>
            </div>
          </div>

          <div className="text-xs text-gray-400 mb-3">
            <div className="font-medium text-gray-300 mb-1">Categories:</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(aiFilterResult.filter_stats.by_category).map(([cat, count]) => (
                <span key={cat} className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-300">
                  {cat}: {count}
                </span>
              ))}
            </div>
          </div>

          {Object.keys(aiFilterResult.filter_stats.by_filter_reason || {}).length > 0 && (
            <div className="text-xs text-gray-400 mb-3">
              <div className="font-medium text-gray-300 mb-1">Filter reasons:</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(aiFilterResult.filter_stats.by_filter_reason).map(([reason, count]) => (
                  <span key={reason} className="px-1.5 py-0.5 bg-red-900/30 rounded text-red-300">
                    {reason}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleApplyFilter}
              className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded flex items-center justify-center gap-1.5"
            >
              <Filter className="w-3.5 h-3.5" />
              Remove {aiFilterResult.filter_stats.to_filter} Groups
            </button>
            <button
              onClick={handleApplyMappings}
              className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Auto-Map Types
            </button>
          </div>

          <div className="mt-2 text-[10px] text-gray-500 text-center">
            {aiFilterResult.cached ? 'Cached result' : `${(aiFilterResult.latencyMs / 1000).toFixed(1)}s`} • {aiFilterResult.model}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="px-4 py-2 bg-gray-800/50 border-b border-border-dark text-xs text-gray-400">
        {stats.totalFixtures} total fixtures in {stats.total} groups
      </div>

      {/* Group List */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredGroups.map(group => {
          const isMapped = !!mappings[group.group_id]
          const isSelected = selectedGroupId === group.group_id
          const isHovered = hoveredGroupId === group.group_id
          const mapping = mappings[group.group_id]

          return (
            <div
              key={group.group_id}
              ref={(el) => { if (el) groupRefs.current.set(group.group_id, el as unknown as HTMLButtonElement) }}
              onClick={() => onSelectGroup(isSelected ? null : group.group_id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectGroup(isSelected ? null : group.group_id) }}
              className={`group w-full p-3 rounded-lg text-left transition-all cursor-pointer ${
                isSelected
                  ? 'bg-highlight/20 border border-highlight'
                  : isHovered
                    ? 'bg-purple-900/40 border border-purple-500 ring-1 ring-purple-500'
                    : 'bg-gray-800/50 border border-transparent hover:bg-gray-800 hover:border-gray-700'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {isMapped ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    )}
                    {editingGroupId === group.group_id ? (
                      <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit()
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          className="flex-1 px-2 py-0.5 bg-gray-900 border border-highlight rounded text-sm text-white focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={saveEdit}
                          className="p-1 hover:bg-green-900/50 rounded text-green-400"
                          title="Save"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 hover:bg-red-900/50 rounded text-red-400"
                          title="Cancel"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm text-white font-medium truncate">
                          {getDisplayName(group)}
                        </span>
                        {onUpdateName && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              startEditing(group.group_id, getDisplayName(group))
                            }}
                            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit name"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <div>Layer: <span className="text-gray-400">{group.layer}</span></div>
                    <div>
                      Size: <span className="text-gray-400">
                        {(group.size.w * unitScaleToM).toFixed(3)}m × {(group.size.d * unitScaleToM).toFixed(3)}m
                      </span>
                    </div>
                    {mapping && (
                      <div className="text-green-400/80">
                        → {mapping.type}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    isSelected ? 'bg-highlight text-white' : 'bg-gray-700 text-gray-300'
                  }`}>
                    {group.count}
                  </span>
                  <span className="text-[10px] text-gray-500">instances</span>
                  {(isHovered || isSelected) && onDeleteGroup && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteGroup(group.group_id)
                      }}
                      className="p-1 rounded bg-red-900/50 hover:bg-red-700 text-red-400 hover:text-white transition-colors"
                      title="Delete this group"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {filteredGroups.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            No groups match your filter
          </div>
        )}
      </div>
    </div>
  )
}
