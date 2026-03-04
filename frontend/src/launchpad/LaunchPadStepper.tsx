/**
 * LaunchPad Stepper — Minimal vertical timeline using CSS grid
 * 
 * Layout: 2-column grid  [40px rail] [1fr content]
 * The rail column contains both the dot AND the connecting line,
 * both centered via flexbox — no absolute positioning.
 */

import {
  FileUp, Boxes, SquareDashedBottom, Radar, Server, Link, Activity, Rocket,
  Check, AlertTriangle, Loader2, X, ExternalLink, FileText, ChevronRight, Sparkles, Pencil, Zap, MousePointerClick,
} from 'lucide-react'
import type { LaunchPadStep, LaunchPadStepId, StepStatus } from './launchpadTypes'
import type { AutoPlaceSettings } from './launchpadApi'
import MiniDwgViewport from './MiniDwgViewport'
import type { MiniFixture, MiniClassification, MiniRoi, MiniLidar } from './MiniDwgViewport'

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  FileUp, Boxes, SquareDashedBottom, Radar, Server, Link, Activity, Rocket,
}

export interface DwgImportItem {
  import_id: string
  filename: string
  has_layout: boolean
  created_at: string
  fixture_count?: number
  group_count?: number
}

export interface DwgGeometry {
  fixtures: MiniFixture[]
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  classifications?: MiniClassification[]
  rois?: MiniRoi[]
  lidars?: MiniLidar[]
}

interface LaunchPadStepperProps {
  steps: LaunchPadStep[]
  currentStepId: LaunchPadStepId
  expandedStepId: LaunchPadStepId | null
  onExpandStep: (stepId: LaunchPadStepId | null) => void
  onRunStep: (stepId: LaunchPadStepId) => void
  onOpenStep: (stepId: LaunchPadStepId) => void
  /** Available DWG imports for inline selection */
  availableImports?: DwgImportItem[]
  /** Called when user picks a DWG import inline */
  onSelectImport?: (importId: string) => void
  /** Geometry data for mini viewport rendering */
  geometry?: DwgGeometry
  /** AI Enhance — calls GPT-4o Vision to improve classifications */
  onAiEnhance?: () => void
  /** Whether AI enhancement is currently running */
  aiEnhancing?: boolean
  /** Whether AI enhancement has been applied */
  aiEnhanced?: boolean
  /** Open the ROI drawing modal */
  onDrawRois?: () => void
  /** Run auto-place LiDARs using ROIs */
  onAutoPlace?: () => void
  /** Whether auto-place is running */
  autoPlacing?: boolean
  /** Open Classify by Example modal */
  onClassifyByExample?: () => void
  /** Auto-place settings */
  autoPlaceSettings?: AutoPlaceSettings
  /** Called when user changes auto-place settings */
  onAutoPlaceSettingsChange?: (settings: AutoPlaceSettings) => void
  /** Available LiDAR models for the model picker */
  lidarModels?: Array<{ id: string; name: string; range_m: number; dome_mode: boolean }>
  /** LiDAR interaction callbacks for coverage modal */
  onLidarUpdate?: (id: string, x: number, z: number) => void
  onLidarAdd?: (x: number, z: number) => void
  onLidarDelete?: (id: string) => void
  /** Open 3D preview modal */
  onOpen3DPreview?: () => void
  /** Layout version ID for LiDAR schedule */
  dwgLayoutId?: string
  /** DXF unit → meters scale */
  unitScaleToM?: number
}

/* ─── style helpers ─── */

function dotClass(status: StepStatus, isCurrent: boolean): string {
  const base = 'rounded-full flex items-center justify-center transition-all duration-200'
  const big = `${base} w-8 h-8 border`
  const sm  = `${base} w-2.5 h-2.5`
  switch (status) {
    case 'done':    return `${big} bg-green-500/15 border-green-500/50 text-green-400`
    case 'warning': return `${big} bg-amber-500/15 border-amber-500/40 text-amber-400`
    case 'error':   return `${big} bg-red-500/15 border-red-500/40 text-red-400`
    case 'running': return `${big} bg-blue-500/15 border-blue-500/50 text-blue-400`
    case 'waiting': return `${big} bg-purple-500/15 border-purple-500/40 text-purple-400`
    case 'ready':   return `${big} bg-indigo-500/15 border-indigo-500/50 text-indigo-400`
    case 'skipped': return `${sm} bg-gray-600`
    case 'locked':
    default:
      return isCurrent
        ? `${big} bg-indigo-500/15 border-indigo-500/50 text-indigo-400`
        : `${sm} bg-gray-600`
  }
}

function dotIcon(status: StepStatus, Icon: React.FC<{ className?: string }>) {
  switch (status) {
    case 'done':    return <Check className="w-3.5 h-3.5" />
    case 'warning': return <AlertTriangle className="w-3 h-3" />
    case 'error':   return <X className="w-3 h-3" />
    case 'running': return <Loader2 className="w-3.5 h-3.5 animate-spin" />
    case 'waiting': return <Loader2 className="w-3.5 h-3.5 animate-pulse" />
    case 'locked':
    case 'skipped': return null
    default:        return <Icon className="w-3.5 h-3.5" />
  }
}

function lineColor(status: StepStatus): string {
  if (status === 'done' || status === 'warning') return 'bg-green-500/40'
  if (status === 'running' || status === 'waiting') return 'bg-indigo-500/30'
  return 'bg-gray-700/50'
}

function tagColor(status: StepStatus): string {
  switch (status) {
    case 'done': return 'text-green-400'
    case 'warning': return 'text-amber-400'
    case 'error': return 'text-red-400'
    case 'running': return 'text-blue-400'
    case 'waiting': return 'text-purple-400'
    case 'ready': return 'text-indigo-400'
    default: return 'text-gray-600'
  }
}

function tagText(status: StepStatus): string {
  switch (status) {
    case 'done': return 'Complete'
    case 'warning': return 'Warnings'
    case 'error': return 'Failed'
    case 'running': return 'Checking'
    case 'waiting': return 'In progress'
    case 'ready': return 'Ready'
    case 'skipped': return 'Skipped'
    case 'locked': return ''
    default: return ''
  }
}

const isActive = (s: StepStatus) => !['locked', 'skipped'].includes(s)

/* ─── component ─── */

export default function LaunchPadStepper({
  steps, currentStepId, expandedStepId, onExpandStep, onRunStep, onOpenStep,
  availableImports, onSelectImport, geometry,
  onAiEnhance, aiEnhancing, aiEnhanced, onDrawRois, onAutoPlace, autoPlacing, onClassifyByExample,
  autoPlaceSettings, onAutoPlaceSettingsChange, lidarModels,
  onLidarUpdate, onLidarAdd, onLidarDelete, onOpen3DPreview,
  dwgLayoutId, unitScaleToM,
}: LaunchPadStepperProps) {
  return (
    <div className="grid pr-3" style={{ gridTemplateColumns: '40px 1fr' }}>
      {steps.map((step, idx) => {
        const Icon = ICON_MAP[step.icon] || Rocket
        const isExpanded = expandedStepId === step.id
        const isCurrent = currentStepId === step.id
        const isLast = idx === steps.length - 1
        const clickable = step.status !== 'locked'

        return (
          <div key={step.id} className="contents">
            {/* ── RAIL CELL (col 1): dot + line segment below ── */}
            <div className="flex flex-col items-center">
              {/* Dot */}
              <div className={dotClass(step.status, isCurrent)}>
                {dotIcon(step.status, Icon)}
              </div>
              {/* Line segment to next step */}
              {!isLast && (
                <div className={`flex-1 w-px ${lineColor(step.status)} transition-colors duration-500`} />
              )}
            </div>

            {/* ── CONTENT CELL (col 2) ── */}
            <div className="min-w-0 pb-6">
              {/* Clickable label row */}
              <div
                className={`pt-1 pl-2 pr-1 rounded-md transition-colors ${
                  clickable ? 'cursor-pointer hover:bg-white/[0.03]' : 'opacity-40'
                }`}
                onClick={() => clickable && onExpandStep(isExpanded ? null : step.id)}
              >
                <div className="flex items-baseline gap-2">
                  <span className={`text-[13px] font-medium leading-tight ${
                    isActive(step.status) ? 'text-gray-100' : 'text-gray-500'
                  }`}>
                    {step.label}
                  </span>
                  {step.status === 'done' && step.completedAt && (
                    <span className="text-[10px] text-gray-600 tabular-nums whitespace-nowrap">
                      {new Date(step.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                {isActive(step.status) && (
                  <span className={`text-[11px] leading-none ${tagColor(step.status)}`}>
                    {tagText(step.status)}
                  </span>
                )}
              </div>

              {/* Expanded detail card */}
              {isExpanded && clickable && (
                <div className="pl-2 pt-2 pr-1">
                  <StepDetailCard
                    step={step}
                    onRun={() => onRunStep(step.id)}
                    onOpen={() => onOpenStep(step.id)}
                    availableImports={availableImports}
                    onSelectImport={onSelectImport}
                    geometry={geometry}
                    onAiEnhance={onAiEnhance}
                    aiEnhancing={aiEnhancing}
                    aiEnhanced={aiEnhanced}
                    onDrawRois={onDrawRois}
                    onAutoPlace={onAutoPlace}
                    autoPlacing={autoPlacing}
                    onClassifyByExample={onClassifyByExample}
                    autoPlaceSettings={autoPlaceSettings}
                    onAutoPlaceSettingsChange={onAutoPlaceSettingsChange}
                    lidarModels={lidarModels}
                    onLidarUpdate={onLidarUpdate}
                    onLidarAdd={onLidarAdd}
                    onLidarDelete={onLidarDelete}
                    onOpen3DPreview={onOpen3DPreview}
                    dwgLayoutId={dwgLayoutId}
                    unitScaleToM={unitScaleToM}
                  />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── fixture type colors ─── */

const FIXTURE_TYPE_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  shelf:           { bg: 'bg-blue-500/10',   text: 'text-blue-300',   border: 'border-blue-500/20',   dot: 'bg-blue-400' },
  wall:            { bg: 'bg-gray-500/10',   text: 'text-gray-300',   border: 'border-gray-500/20',   dot: 'bg-gray-400' },
  checkout:        { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/20', dot: 'bg-purple-400' },
  entrance:        { bg: 'bg-emerald-500/10',text: 'text-emerald-300',border: 'border-emerald-500/20',dot: 'bg-emerald-400' },
  pillar:          { bg: 'bg-slate-500/10',  text: 'text-slate-300',  border: 'border-slate-500/20',  dot: 'bg-slate-400' },
  digital_display: { bg: 'bg-cyan-500/10',   text: 'text-cyan-300',   border: 'border-cyan-500/20',   dot: 'bg-cyan-400' },
  radio:           { bg: 'bg-pink-500/10',   text: 'text-pink-300',   border: 'border-pink-500/20',   dot: 'bg-pink-400' },
  custom:          { bg: 'bg-amber-500/10',  text: 'text-amber-300',  border: 'border-amber-500/20',  dot: 'bg-amber-400' },
  unknown:         { bg: 'bg-red-500/8',     text: 'text-red-300/70', border: 'border-red-500/15',    dot: 'bg-red-400/60' },
}

const FIXTURE_TYPE_LABELS: Record<string, string> = {
  shelf: 'Shelves', wall: 'Walls', checkout: 'Checkouts', entrance: 'Entrances',
  pillar: 'Pillars', digital_display: 'Displays', radio: 'Audio', custom: 'Custom', unknown: 'Unrecognized',
}

/* ─── expanded detail card ─── */

function StepDetailCard({ step, onRun, onOpen, availableImports, onSelectImport, geometry, onAiEnhance, aiEnhancing, aiEnhanced, onDrawRois, onAutoPlace, autoPlacing, onClassifyByExample, autoPlaceSettings, onAutoPlaceSettingsChange, lidarModels, onLidarUpdate, onLidarAdd, onLidarDelete, onOpen3DPreview, dwgLayoutId, unitScaleToM }: {
  step: LaunchPadStep
  onRun: () => void
  onOpen: () => void
  availableImports?: DwgImportItem[]
  onSelectImport?: (importId: string) => void
  geometry?: DwgGeometry
  onAiEnhance?: () => void
  aiEnhancing?: boolean
  aiEnhanced?: boolean
  onDrawRois?: () => void
  onAutoPlace?: () => void
  autoPlacing?: boolean
  onClassifyByExample?: () => void
  autoPlaceSettings?: AutoPlaceSettings
  onAutoPlaceSettingsChange?: (settings: AutoPlaceSettings) => void
  lidarModels?: Array<{ id: string; name: string; range_m: number; dome_mode: boolean }>
  onLidarUpdate?: (id: string, x: number, z: number) => void
  onLidarAdd?: (x: number, z: number) => void
  onLidarDelete?: (id: string) => void
  onOpen3DPreview?: () => void
  dwgLayoutId?: string
  unitScaleToM?: number
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-gray-500 leading-relaxed">{step.description}</p>

      {step.error && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-md px-2.5 py-1.5">
          <X className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
          <span className="text-[11px] text-red-300">{step.error}</span>
        </div>
      )}

      {step.warnings.length > 0 && step.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
          <span className="text-[11px] text-amber-300">{w}</span>
        </div>
      ))}

      <StepDataDisplay
        step={step}
        availableImports={availableImports}
        onSelectImport={onSelectImport}
        geometry={geometry}
        onAiEnhance={onAiEnhance}
        aiEnhancing={aiEnhancing}
        aiEnhanced={aiEnhanced}
        onDrawRois={onDrawRois}
        onAutoPlace={onAutoPlace}
        autoPlacing={autoPlacing}
        onClassifyByExample={onClassifyByExample}
        autoPlaceSettings={autoPlaceSettings}
        onAutoPlaceSettingsChange={onAutoPlaceSettingsChange}
        onLidarUpdate={onLidarUpdate}
        onLidarAdd={onLidarAdd}
        onLidarDelete={onLidarDelete}
        onOpen3DPreview={onOpen3DPreview}
        lidarModels={lidarModels}
        dwgLayoutId={dwgLayoutId}
        unitScaleToM={unitScaleToM}
      />

      <div className="flex gap-2 pt-0.5">
        {(step.status === 'ready' || step.status === 'error' || step.status === 'warning') && (
          <button
            onClick={(e) => { e.stopPropagation(); onRun() }}
            className="flex-1 h-7 flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-md transition-colors"
          >
            {step.status === 'error' ? 'Retry' : 'Check'}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onOpen() }}
          className="flex-1 h-7 flex items-center justify-center gap-1 bg-white/[0.06] hover:bg-white/[0.1] text-gray-300 text-[11px] font-medium rounded-md transition-colors border border-white/[0.06]"
        >
          Open <ExternalLink className="w-3 h-3 opacity-50" />
        </button>
      </div>
    </div>
  )
}

// ─── Step Data Display (Rich Inline Content) ────────────────────

function StepDataDisplay({ step, availableImports, onSelectImport, geometry, onAiEnhance, aiEnhancing, aiEnhanced, onDrawRois, onAutoPlace, autoPlacing, onClassifyByExample, autoPlaceSettings, onAutoPlaceSettingsChange, lidarModels, onLidarUpdate, onLidarAdd, onLidarDelete, onOpen3DPreview, dwgLayoutId, unitScaleToM }: {
  step: LaunchPadStep
  availableImports?: DwgImportItem[]
  onSelectImport?: (importId: string) => void
  geometry?: DwgGeometry
  onAiEnhance?: () => void
  aiEnhancing?: boolean
  aiEnhanced?: boolean
  onDrawRois?: () => void
  onAutoPlace?: () => void
  autoPlacing?: boolean
  onClassifyByExample?: () => void
  autoPlaceSettings?: AutoPlaceSettings
  onAutoPlaceSettingsChange?: (settings: AutoPlaceSettings) => void
  lidarModels?: Array<{ id: string; name: string; range_m: number; dome_mode: boolean }>
  onLidarUpdate?: (id: string, x: number, z: number) => void
  onLidarAdd?: (x: number, z: number) => void
  onLidarDelete?: (id: string) => void
  onOpen3DPreview?: () => void
  dwgLayoutId?: string
  unitScaleToM?: number
}) {
  if (!step.data && step.id !== 'select_dwg' && step.id !== 'define_rois' && step.id !== 'place_lidars' && step.id !== 'map_fixtures') return null
  const data = step.data as unknown as Record<string, unknown>
  const s = 'text-[11px]'

  switch (step.id) {
    case 'select_dwg': {
      const d = data as { importId?: string; filename?: string; fixtureCount?: number; groupCount?: number } | null
      return (
        <div className="space-y-2">
          {/* Mini viewport — floor plan preview (show classifications if available) */}
          {geometry && geometry.fixtures.length > 0 && (
            <MiniDwgViewport
              fixtures={geometry.fixtures}
              bounds={geometry.bounds}
              classifications={geometry.classifications}
              rois={geometry.rois}
              mode={geometry.classifications?.length ? 'classification' : 'fixtures'}
              height={220}
            />
          )}

          {/* Currently selected DWG */}
          {d?.filename && (
            <div className="flex items-center gap-2 bg-green-500/8 border border-green-500/20 rounded-md px-2.5 py-2">
              <FileText className="w-3.5 h-3.5 text-green-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-green-300 truncate">{d.filename}</div>
                <div className="text-[10px] text-green-400/60">{d.fixtureCount} fixtures · {d.groupCount} groups</div>
              </div>
            </div>
          )}
          {!d?.filename && (
            <div className="text-[11px] text-amber-400/80 italic">No DWG selected</div>
          )}

          {/* Available imports — inline picker */}
          {availableImports && availableImports.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Available imports</div>
              <div className="max-h-36 overflow-y-auto space-y-1 scrollbar-thin">
                {availableImports.map(imp => {
                  const isSelected = d?.importId === imp.import_id
                  return (
                    <div
                      key={imp.import_id}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!isSelected && onSelectImport) onSelectImport(imp.import_id)
                      }}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-500/15 border border-indigo-500/30'
                          : 'bg-white/[0.03] border border-transparent hover:bg-white/[0.06] hover:border-white/10'
                      }`}
                    >
                      <FileText className={`w-3 h-3 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-gray-500'}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`text-[11px] truncate ${isSelected ? 'text-indigo-300 font-medium' : 'text-gray-400'}`}>
                          {imp.filename}
                        </div>
                        <div className="text-[10px] text-gray-600">
                          {imp.has_layout ? '✓ Layout ready' : 'Needs mapping'}
                          {imp.fixture_count ? ` · ${imp.fixture_count} fixtures` : ''}
                        </div>
                      </div>
                      {isSelected && <Check className="w-3 h-3 text-indigo-400 shrink-0" />}
                      {!isSelected && <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )
    }

    case 'map_fixtures': {
      const d = data as {
        totalGroups?: number
        mappedGroups?: number
        classifications?: Array<{
          groupId: string
          blockName: string | null
          layerName: string
          count: number
          suggestedType: string
          confidence: number
          reason: string
          accepted: boolean
        }>
      } | null

      if (!d?.classifications?.length) {
        // Step data has no classifications — but geometry may have saved DB mapping
        const hasGeomClass = geometry?.classifications && geometry.classifications.length > 0
        return (
          <div className="space-y-2">
            {geometry && geometry.fixtures.length > 0 && (
              <MiniDwgViewport
                fixtures={geometry.fixtures}
                bounds={geometry.bounds}
                classifications={geometry.classifications}
                rois={geometry.rois}
                mode={hasGeomClass ? 'classification' : 'fixtures'}
                height={220}
              />
            )}
            {!hasGeomClass && <div className={`${s} text-amber-400/80`}>No fixture classifications yet</div>}
            {onClassifyByExample && (
              <button
                onClick={(e) => { e.stopPropagation(); onClassifyByExample() }}
                className="w-full h-8 flex items-center justify-center gap-1.5 bg-cyan-500/15 border border-cyan-500/30 rounded-lg text-cyan-400 hover:bg-cyan-500/25 transition-colors text-[11px] font-medium"
              >
                <MousePointerClick className="w-3.5 h-3.5" /> Classify by Example
              </button>
            )}
          </div>
        )
      }

      // Mini viewport — fixtures color-coded by classification type
      const miniClassifications: MiniClassification[] = d.classifications.map(c => ({
        groupId: c.groupId,
        suggestedType: c.suggestedType,
        confidence: c.confidence,
      }))

      // Group classifications by type
      const byType: Record<string, { count: number; instances: number; avgConf: number; items: typeof d.classifications }> = {}
      for (const c of d.classifications) {
        const type = c.confidence >= 0.5 ? c.suggestedType : 'unknown'
        if (!byType[type]) byType[type] = { count: 0, instances: 0, avgConf: 0, items: [] }
        byType[type].count++
        byType[type].instances += c.count
        byType[type].items.push(c)
      }
      for (const t of Object.keys(byType)) {
        byType[t].avgConf = byType[t].items.reduce((s, c) => s + c.confidence, 0) / byType[t].count
      }

      // Sort: high confidence first, unknown last
      const sortedTypes = Object.entries(byType).sort(([a, ad], [b, bd]) => {
        if (a === 'unknown') return 1
        if (b === 'unknown') return -1
        return bd.avgConf - ad.avgConf
      })

      const total = d.totalGroups || d.classifications.length
      const mapped = d.mappedGroups || 0

      return (
        <div className="space-y-2">
          {/* Mini viewport — fixtures color-coded by type */}
          {geometry && geometry.fixtures.length > 0 && (
            <MiniDwgViewport
              fixtures={geometry.fixtures}
              bounds={geometry.bounds}
              classifications={miniClassifications}
              rois={geometry.rois}
              mode="classification"
              height={220}
            />
          )}

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-gray-400">{mapped}/{total} groups mapped</span>
              <span className="text-gray-500">{total > 0 ? Math.round((mapped / total) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-green-500 rounded-full transition-all duration-500"
                style={{ width: `${total > 0 ? (mapped / total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Classify by Example button */}
          {onClassifyByExample && (
            <button
              onClick={(e) => { e.stopPropagation(); onClassifyByExample() }}
              className="w-full h-8 flex items-center justify-center gap-1.5 bg-cyan-500/15 border border-cyan-500/30 rounded-lg text-cyan-400 hover:bg-cyan-500/25 transition-colors text-[11px] font-medium"
            >
              <MousePointerClick className="w-3.5 h-3.5" /> Classify by Example
            </button>
          )}

          {/* AI Enhance button */}
          {onAiEnhance && (
            <button
              onClick={(e) => { e.stopPropagation(); onAiEnhance() }}
              disabled={aiEnhancing}
              className={`w-full h-8 flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-all border ${
                aiEnhanced
                  ? 'bg-violet-500/10 border-violet-500/30 text-violet-300'
                  : aiEnhancing
                  ? 'bg-violet-500/10 border-violet-500/20 text-violet-400 animate-pulse cursor-wait'
                  : 'bg-violet-600/20 border-violet-500/30 text-violet-300 hover:bg-violet-600/30 hover:border-violet-500/50'
              }`}
            >
              {aiEnhancing ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing with GPT-4o Vision…</>
              ) : aiEnhanced ? (
                <><Sparkles className="w-3.5 h-3.5" /> AI Enhanced ✓</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5" /> AI Enhance (GPT-4o Vision)</>
              )}
            </button>
          )}

          {/* Type breakdown */}
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Classification breakdown</div>
            {sortedTypes.map(([type, info]) => {
              const colors = FIXTURE_TYPE_COLORS[type] || FIXTURE_TYPE_COLORS.unknown
              const label = FIXTURE_TYPE_LABELS[type] || type
              const confLabel = info.avgConf >= 0.8 ? 'high' : info.avgConf >= 0.5 ? 'medium' : 'low'
              const confColor = info.avgConf >= 0.8 ? 'text-green-400' : info.avgConf >= 0.5 ? 'text-amber-400' : 'text-red-400'
              return (
                <div key={type} className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${colors.bg} border ${colors.border}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className={`text-[11px] font-medium ${colors.text}`}>{label}</span>
                      <span className="text-[10px] text-gray-500">{info.count} group{info.count > 1 ? 's' : ''} · {info.instances} fixtures</span>
                    </div>
                  </div>
                  <span className={`text-[9px] ${confColor} shrink-0`}>{confLabel}</span>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    case 'define_rois': {
      const d = data as { roiCount?: number; roiNames?: string[] }
      return (
        <div className="space-y-2">
          {/* Mini viewport — ROI zones overlaid on floor plan */}
          {geometry && geometry.fixtures.length > 0 && (
            <MiniDwgViewport
              fixtures={geometry.fixtures}
              bounds={geometry.bounds}
              classifications={geometry.classifications}
              rois={geometry.rois}
              mode="rois"
              height={220}
            />
          )}
          <div className={`${s} text-gray-500`}>
            {d?.roiCount ? (
              <div className="space-y-1">
                {d.roiNames?.map((name, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-sm bg-indigo-400 shrink-0" />
                    <span className="text-gray-300">{name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-amber-400/80">No zones yet — draw analytics zones on the floor plan</span>
            )}
          </div>
          {onDrawRois && (
            <button
              onClick={(e) => { e.stopPropagation(); onDrawRois() }}
              className="w-full h-8 flex items-center justify-center gap-1.5 bg-amber-500/15 border border-amber-500/30 rounded-lg text-amber-400 hover:bg-amber-500/25 transition-colors text-[11px] font-medium"
            >
              <Pencil className="w-3.5 h-3.5" />
              Draw Zones
            </button>
          )}
        </div>
      )
    }

    case 'place_lidars': {
      const d = data as { sensorCount?: number; coveragePct?: number; modelName?: string; meetsCoverage?: boolean; kCoveragePct?: number } | null
      const hasSensors = d && d.sensorCount && d.sensorCount > 0
      const covPct = ((d?.coveragePct || 0) * 100).toFixed(1)
      return (
        <div className="space-y-2">
          {/* Mini viewport — LiDAR coverage (interactive in modal) */}
          {geometry && geometry.fixtures.length > 0 && (
            <MiniDwgViewport
              fixtures={geometry.fixtures}
              bounds={geometry.bounds}
              rois={geometry.rois}
              lidars={geometry.lidars}
              mode="lidars"
              height={220}
              onLidarUpdate={onLidarUpdate}
              onLidarAdd={onLidarAdd}
              onLidarDelete={onLidarDelete}
              dwgLayoutId={dwgLayoutId}
              unitScaleToM={unitScaleToM}
            />
          )}
          {/* 3D Preview button */}
          {hasSensors && onOpen3DPreview && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpen3DPreview() }}
              className="w-full h-8 flex items-center justify-center gap-1.5 bg-purple-500/15 border border-purple-500/30 rounded-lg text-purple-400 hover:bg-purple-500/25 transition-colors text-[11px] font-medium"
            >
              <Boxes className="w-3.5 h-3.5" /> 3D Preview
            </button>
          )}
          {hasSensors ? (
            <>
              <div className={`${s} text-gray-400`}>{d.sensorCount} sensors{d.modelName ? ` · ${d.modelName}` : ''}</div>
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className={d.meetsCoverage ? 'text-green-400' : 'text-amber-400'}>{covPct}% coverage</span>
                  <span className="text-gray-500">target 95%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${d.meetsCoverage ? 'bg-green-500' : 'bg-amber-500'}`}
                    style={{ width: `${Math.min(parseFloat(covPct), 100)}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className={`${s} text-amber-400/80`}>No LiDARs placed yet — run auto-placement using your ROI zones</div>
          )}
          {/* Auto-Place Settings */}
          {autoPlaceSettings && onAutoPlaceSettingsChange && (
            <div className="space-y-2 bg-gray-800/40 border border-gray-700/50 rounded-lg p-2.5">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Auto-Place Settings</div>
              {/* LiDAR Model */}
              <div>
                <label className="text-[10px] text-gray-500 mb-0.5 block">LiDAR Model</label>
                {lidarModels && lidarModels.length > 0 ? (
                  <select
                    value={autoPlaceSettings.modelId || ''}
                    onChange={(e) => { onAutoPlaceSettingsChange({ ...autoPlaceSettings, modelId: e.target.value || undefined }) }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-6 text-[10px] bg-gray-800 border border-gray-700 rounded text-white px-1.5"
                  >
                    {lidarModels.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.range_m}m{m.dome_mode ? ', dome' : ''})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-[10px] text-amber-400/70 italic">No LiDAR models found — using defaults (10m range, dome)</div>
                )}
              </div>
              {/* Scale Correction */}
              <div>
                <label className="text-[10px] text-gray-500 mb-0.5 block">Scale Correction</label>
                <div className="flex gap-1">
                  {[
                    { label: '1× mm', value: 1 },
                    { label: '10× cm', value: 10 },
                    { label: '1000× m', value: 1000 },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={(e) => { e.stopPropagation(); onAutoPlaceSettingsChange({ ...autoPlaceSettings, scaleMultiplier: opt.value }) }}
                      className={`flex-1 h-6 text-[10px] rounded transition-colors ${
                        autoPlaceSettings.scaleMultiplier === opt.value
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                          : 'bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* K-Coverage + Mount Height in a row */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-gray-500 mb-0.5 block">K-Coverage</label>
                  <select
                    value={autoPlaceSettings.kRequired}
                    onChange={(e) => { onAutoPlaceSettingsChange({ ...autoPlaceSettings, kRequired: Number(e.target.value) }) }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-6 text-[10px] bg-gray-800 border border-gray-700 rounded text-white px-1.5"
                  >
                    <option value={1}>1 (single)</option>
                    <option value={2}>2 (overlap)</option>
                    <option value={3}>3 (high)</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-gray-500 mb-0.5 block">Mount Height</label>
                  <select
                    value={autoPlaceSettings.mountHeightM}
                    onChange={(e) => { onAutoPlaceSettingsChange({ ...autoPlaceSettings, mountHeightM: Number(e.target.value) }) }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full h-6 text-[10px] bg-gray-800 border border-gray-700 rounded text-white px-1.5"
                  >
                    <option value={2.5}>2.5m</option>
                    <option value={3}>3.0m</option>
                    <option value={3.5}>3.5m</option>
                    <option value={4}>4.0m</option>
                    <option value={5}>5.0m</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          {onAutoPlace && (
            <button
              onClick={(e) => { e.stopPropagation(); onAutoPlace() }}
              disabled={autoPlacing}
              className="w-full h-8 flex items-center justify-center gap-1.5 bg-cyan-500/15 border border-cyan-500/30 rounded-lg text-cyan-400 hover:bg-cyan-500/25 disabled:opacity-50 disabled:cursor-wait transition-colors text-[11px] font-medium"
            >
              {autoPlacing ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Placing LiDARs...</>
              ) : (
                <><Zap className="w-3.5 h-3.5" /> {hasSensors ? 'Re-run Auto-Place' : 'Auto-Place LiDARs'}</>
              )}
            </button>
          )}
        </div>
      )
    }

    case 'commission_edge': {
      const d = data as { edgeHostname?: string; edgeOnline?: boolean; scannedLidarCount?: number; neededLidarCount?: number; missingLidars?: boolean }
      if (!d?.edgeHostname) return null
      const missing = (d.neededLidarCount || 0) - (d.scannedLidarCount || 0)
      return (
        <div className={`${s} space-y-1.5`}>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${d.edgeOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-gray-300 font-medium">{d.edgeHostname}</span>
            <span className={`text-[10px] ${d.edgeOnline ? 'text-green-400' : 'text-red-400'}`}>{d.edgeOnline ? 'online' : 'offline'}</span>
          </div>
          <div className={d.missingLidars ? 'text-amber-400' : 'text-green-400'}>
            {d.scannedLidarCount}/{d.neededLidarCount} LiDARs scanned
          </div>
          {d.missingLidars && missing > 0 && (
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-md px-2.5 py-1.5 text-amber-300/90 leading-relaxed">
              {missing} LiDAR{missing > 1 ? 's' : ''} still needed — connect to edge network and commission.
            </div>
          )}
        </div>
      )
    }

    case 'pair_devices': {
      const d = data as { pairedCount?: number; totalPlacements?: number; allPaired?: boolean }
      if (!d) return null
      return (
        <div className="space-y-1">
          <div className={`${s} text-gray-400`}>
            <span className={d.allPaired ? 'text-green-400' : 'text-amber-400'}>{d.pairedCount}/{d.totalPlacements}</span> paired
          </div>
          {(d.totalPlacements || 0) > 0 && (
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${d.allPaired ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${(d.totalPlacements || 0) > 0 ? ((d.pairedCount || 0) / (d.totalPlacements || 1)) * 100 : 0}%` }}
              />
            </div>
          )}
        </div>
      )
    }

    case 'validate_stream': {
      const d = data as { mqttConnected?: boolean; lidarStatuses?: Array<{ connected: boolean; lidarId?: string }> }
      if (!d) return null
      return (
        <div className={`${s} space-y-1`}>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${d.mqttConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className={d.mqttConnected ? 'text-green-400' : 'text-red-400'}>MQTT {d.mqttConnected ? 'connected' : 'disconnected'}</span>
          </div>
          {d.lidarStatuses?.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5 ml-1">
              <span className={`w-1 h-1 rounded-full ${l.connected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-gray-500">{l.lidarId || `LiDAR ${i + 1}`}</span>
            </div>
          ))}
        </div>
      )
    }

    case 'go_live': {
      const d = data as { isLive?: boolean; activeTrackCount?: number }
      if (!d?.isLive) return null
      return (
        <div className={`${s} text-green-400 flex items-center gap-1.5`}>
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          Live · {d.activeTrackCount} tracks
        </div>
      )
    }

    default:
      return null
  }
}
