/**
 * LaunchPadStage — Dynamic content area rendered LEFT of the drawer.
 *
 * Shows contextual content per step:
 *  - select_dwg:   DWG drag-and-drop zone
 *  - map_fixtures:  2D viewport + classification review prompt
 *  - define_rois:   2D viewport + ROI prompt
 *  - place_lidars:  2D viewport → 3D flythrough hero moment
 *  - commission_edge+: Status cards
 *  - complete:      Celebration screen
 *
 * Does NOT modify any existing component — purely additive.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  FileUp, CheckCircle2, XCircle, Loader2,
  Radar, Wifi, Sparkles, Boxes,
  ChevronRight, Eye, Layers,
} from 'lucide-react'
import type { LaunchPadSession, LaunchPadStepId, AutopilotContext, SelectDwgData } from './launchpadTypes'
import type { DwgGeometry } from './LaunchPadStepper'
import type { MiniFixture, MiniLidar, MiniClassification, MiniRoi } from './MiniDwgViewport'
import Layout3DPreview from '../components/dwgImporter/Layout3DPreview'
import * as api from './launchpadApi'

/* ─── props ─── */
export interface LaunchPadStageProps {
  session: LaunchPadSession
  autopilot: AutopilotContext
  geometry?: DwgGeometry
  onDwgUploaded: (importId: string) => void
  onAcceptClassification: () => void
  onRejectClassification: () => void
  onAcceptRois: () => void
  onDrawRois: () => void
  onAcceptLidars: () => void
  onContinue: () => void
}

/* ─── helpers ─── */
const STEP_LABELS: Record<string, string> = {
  select_dwg: 'Upload Floor Plan',
  map_fixtures: 'Fixture Classification',
  define_rois: 'ROI Zones',
  place_lidars: 'LiDAR Placement',
  commission_edge: 'Edge Commissioning',
  pair_devices: 'Device Pairing',
  validate_stream: 'Stream Validation',
  go_live: 'Go Live',
}

/* ─── DWG Drop Zone ─── */
function DwgDropZone({ venueId, onUploaded }: { venueId?: string | null; onUploaded: (id: string) => void }) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop()
    if (ext !== 'dxf' && ext !== 'dwg') {
      setError('Please upload a .dxf or .dwg file')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const result = await api.uploadDwgFile(file, venueId || undefined)
      setSuccess(`${result.filename} — ${result.fixture_count} fixtures found`)
      setTimeout(() => onUploaded(result.import_id), 800)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }, [venueId, onUploaded])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <input
        ref={inputRef}
        type="file"
        accept=".dwg,.dxf"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        className={`
          relative w-full max-w-md aspect-square rounded-2xl border-2 border-dashed
          flex flex-col items-center justify-center gap-4 cursor-pointer
          transition-all duration-300
          ${isDragging
            ? 'border-indigo-400 bg-indigo-500/10 scale-105'
            : uploading
              ? 'border-indigo-500/50 bg-indigo-500/5'
              : success
                ? 'border-green-500/50 bg-green-500/5'
                : error
                  ? 'border-red-500/50 bg-red-500/5'
                  : 'border-gray-600 bg-gray-800/30 hover:border-indigo-500/50 hover:bg-indigo-500/5'
          }
        `}
      >
        {uploading ? (
          <>
            <Loader2 className="w-12 h-12 text-indigo-400 animate-spin" />
            <p className="text-sm text-indigo-300 font-medium">Parsing floor plan...</p>
          </>
        ) : success ? (
          <>
            <CheckCircle2 className="w-12 h-12 text-green-400" />
            <p className="text-sm text-green-300 font-medium">{success}</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center">
              <FileUp className="w-8 h-8 text-indigo-400" />
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-300 font-medium">
                {isDragging ? 'Drop your DWG file here' : 'Drag & drop your DWG file'}
              </p>
              <p className="text-xs text-gray-500 mt-1">or click to browse · .dwg / .dxf</p>
            </div>
          </>
        )}
        {error && (
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-xs text-red-300">{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── 2D Viewport (inline SVG, reuses DwgSvg logic without importing MiniDwgViewport) ─── */
function InlineViewport({ fixtures, bounds, classifications, rois, lidars, label }: {
  fixtures?: MiniFixture[]
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  classifications?: MiniClassification[]
  rois?: MiniRoi[]
  lidars?: MiniLidar[]
  label: string
}) {
  if (!fixtures?.length || !bounds) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No geometry data available
      </div>
    )
  }

  const pad = 20
  const vbMinX = bounds.minX - pad
  const vbMinY = bounds.minY - pad
  const vbW = (bounds.maxX - bounds.minX) + pad * 2
  const vbH = (bounds.maxY - bounds.minY) + pad * 2

  // Build a map from groupId → type for coloring
  const clsMap = useMemo(() => {
    const m: Record<string, string> = {}
    classifications?.forEach(c => { m[c.groupId] = c.suggestedType })
    return m
  }, [classifications])

  const getColor = (f: MiniFixture) => {
    const t = clsMap[f.group_id || ''] || 'default'
    const colors: Record<string, string> = {
      shelf: '#6366f1', wall: '#64748b', checkout: '#22c55e',
      entrance: '#f59e0b', pillar: '#78716c', digital_display: '#8b5cf6',
      default: '#4b5563',
    }
    return colors[t] || colors.default
  }

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-3 left-3 px-2 py-1 bg-gray-900/80 rounded text-[10px] text-gray-400 font-medium z-10">
        {label}
      </div>
      <svg
        viewBox={`${vbMinX} ${vbMinY} ${vbW} ${vbH}`}
        className="w-full h-full"
        style={{ background: '#0a0a0f' }}
      >
        {/* ROIs */}
        {rois?.map((roi, i) => (
          <polygon
            key={roi.name + i}
            points={roi.vertices.map(p => `${p.x},${p.y}`).join(' ')}
            fill={roi.color + '18'}
            stroke={roi.color}
            strokeWidth={vbW * 0.002}
            strokeDasharray={`${vbW * 0.005} ${vbW * 0.003}`}
          />
        ))}
        {/* Fixtures */}
        {fixtures.map(f => (
          <rect
            key={f.id}
            x={f.x - f.w / 2}
            y={f.y - f.d / 2}
            width={f.w}
            height={f.d}
            transform={`rotate(${-(f.rot_deg || 0)} ${f.x} ${f.y})`}
            fill={getColor(f)}
            opacity={0.6}
            rx={vbW * 0.001}
          />
        ))}
        {/* LiDARs */}
        {lidars?.map((l, i) => (
          <g key={l.id || `lidar-${i}`}>
            <circle cx={l.x} cy={l.z} r={l.range_m * 100} fill="rgba(56,189,248,0.06)" stroke="rgba(56,189,248,0.2)" strokeWidth={1} strokeDasharray="6 3" />
            <circle cx={l.x} cy={l.z} r={8} fill="#38bdf8" opacity={0.9} />
            <circle cx={l.x} cy={l.z} r={3} fill="white" />
          </g>
        ))}
      </svg>
    </div>
  )
}

/* ─── Prompt Card ─── */
function PromptCard({ title, message, actions }: {
  title: string
  message: string
  actions: Array<{ label: string; onClick: () => void; primary?: boolean; icon?: React.ReactNode }>
}) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-20 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-xl p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
        <p className="text-xs text-gray-400 mb-3">{message}</p>
        <div className="flex gap-2">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                a.primary
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
              }`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Status Card (for edge/pairing/stream steps) ─── */
function StatusStage({ stepId, session, onContinue }: {
  stepId: LaunchPadStepId
  session: LaunchPadSession
  onContinue: () => void
}) {
  const step = session.steps.find(s => s.id === stepId)
  const isDone = step?.status === 'done' || step?.status === 'warning'
  const isError = step?.status === 'error'

  const icons: Record<string, React.ReactNode> = {
    commission_edge: <Wifi className="w-16 h-16" />,
    pair_devices: <Radar className="w-16 h-16" />,
    validate_stream: <Eye className="w-16 h-16" />,
    go_live: <Sparkles className="w-16 h-16" />,
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className={`p-6 rounded-full ${
        isDone ? 'bg-green-500/10 text-green-400' :
        isError ? 'bg-red-500/10 text-red-400' :
        'bg-indigo-500/10 text-indigo-400 animate-pulse'
      }`}>
        {icons[stepId] || <Layers className="w-16 h-16" />}
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-white mb-1">
          {STEP_LABELS[stepId] || stepId}
        </h3>
        <p className="text-sm text-gray-400 max-w-sm">
          {step?.error || (isDone ? 'Step completed successfully' : 'Checking...')}
        </p>
      </div>
      {isDone && (
        <button
          onClick={onContinue}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Continue <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

/* ─── 3D Flythrough (inline, not modal) ─── */
function Inline3DFlythrough({ layoutVersionId, importId }: { layoutVersionId: string; importId?: string }) {
  const [lidarInstances, setLidarInstances] = useState<any[]>([])
  const [lidarModels, setLidarModels] = useState<any[]>([])
  const [scaleCorrection, setScaleCorrection] = useState(1.0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const [instances, models] = await Promise.all([
          api.listLidarInstances(layoutVersionId),
          api.listLidarModels(),
        ])
        setLidarInstances(instances.map(inst => ({
          id: inst.id,
          x_m: inst.x_m,
          z_m: inst.z_m,
          y_m: inst.mount_y_m || 3,
          mount_y_m: inst.mount_y_m || 3,
          yaw_deg: 0,
          model_id: inst.model_id,
          source: inst.source,
          range_m: models.find((m: any) => m.id === inst.model_id)?.range_m || 20,
        })))
        setLidarModels(models)
        setLoaded(true)
      } catch (err) {
        console.error('[Inline3DFlythrough] Failed to load data:', err)
      }
    })()
  }, [layoutVersionId])

  useEffect(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('launchpad-autoplace-settings') || '{}')
      if (settings.scaleMultiplier) setScaleCorrection(settings.scaleMultiplier)
    } catch { /* ignore */ }
  }, [])

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full h-full relative">
      <div className="absolute top-3 left-3 px-2 py-1 bg-gray-900/80 backdrop-blur-sm rounded text-[10px] text-purple-300 font-medium z-10 flex items-center gap-1.5">
        <Boxes className="w-3 h-3" />
        3D Preview · {lidarInstances.length} sensors
      </div>
      <Layout3DPreview
        layoutVersionId={layoutVersionId}
        importId={importId}
        lidarInstances={lidarInstances}
        lidarModels={lidarModels}
        scaleCorrection={scaleCorrection}
      />
    </div>
  )
}

/* ─── Completion Celebration ─── */
function CompletionStage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-green-400" />
        </div>
        <div className="absolute inset-0 rounded-full bg-green-400/10 animate-ping" />
      </div>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Commissioning Complete!</h2>
        <p className="text-sm text-gray-400 max-w-sm">
          Your store is fully configured and ready for live tracking.
        </p>
      </div>
    </div>
  )
}

/* ─── Main Stage Component ─── */
export default function LaunchPadStage({
  session,
  autopilot,
  geometry,
  onDwgUploaded,
  onAcceptClassification,
  onRejectClassification,
  onAcceptRois,
  onDrawRois,
  onAcceptLidars,
  onContinue,
}: LaunchPadStageProps) {
  const activeStep = autopilot.activeStepId
  const step = session.steps.find(s => s.id === activeStep)

  // Get DWG data for 3D preview
  const dwgData = useMemo(() => {
    const dwgStep = session.steps.find(s => s.id === 'select_dwg')
    return dwgStep?.data as SelectDwgData | null
  }, [session])

  // Show 3D flythrough when place_lidars is done
  const show3D = autopilot.show3DFlythrough && dwgData?.layoutVersionId

  // Determine what to render
  const renderContent = () => {
    // Completion state
    if (autopilot.state === 'complete' || session.isComplete) {
      return <CompletionStage />
    }

    // 3D flythrough hero moment
    if (show3D && dwgData?.layoutVersionId) {
      return (
        <Inline3DFlythrough
          layoutVersionId={dwgData.layoutVersionId}
          importId={dwgData.importId || undefined}
        />
      )
    }

    switch (activeStep) {
      case 'select_dwg': {
        const hasDwg = step?.status === 'done'
        if (hasDwg && geometry) {
          return (
            <div className="relative h-full">
              <InlineViewport
                fixtures={geometry.fixtures}
                bounds={geometry.bounds}
                label="Floor Plan Loaded"
              />
              {autopilot.state === 'running' && (
                <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full z-10">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-[11px] text-green-300 font-medium">DWG loaded</span>
                </div>
              )}
            </div>
          )
        }
        return <DwgDropZone venueId={session.venueId} onUploaded={onDwgUploaded} />
      }

      case 'map_fixtures': {
        return (
          <div className="relative h-full">
            <InlineViewport
              fixtures={geometry?.fixtures}
              bounds={geometry?.bounds}
              classifications={geometry?.classifications}
              label={`Fixture Classification · ${Object.keys(geometry?.classifications || {}).length} groups`}
            />
            {autopilot.state === 'waiting_input' && autopilot.waitingFor === 'classification_review' && (
              <PromptCard
                title="Review Classification"
                message={`${Object.keys(geometry?.classifications || {}).length} fixture groups classified. Accept or refine?`}
                actions={[
                  { label: 'Classify by Example', onClick: onRejectClassification, icon: <Eye className="w-3.5 h-3.5" /> },
                  { label: 'Accept', onClick: onAcceptClassification, primary: true, icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
                ]}
              />
            )}
          </div>
        )
      }

      case 'define_rois': {
        return (
          <div className="relative h-full">
            <InlineViewport
              fixtures={geometry?.fixtures}
              bounds={geometry?.bounds}
              classifications={geometry?.classifications}
              rois={geometry?.rois}
              label={`ROI Zones · ${geometry?.rois?.length || 0} zones`}
            />
            {autopilot.state === 'waiting_input' && autopilot.waitingFor === 'roi_drawing' && (
              <PromptCard
                title="Define ROI Zones"
                message={geometry?.rois?.length
                  ? `${geometry.rois.length} zones found. Accept or draw new zones?`
                  : 'No ROI zones defined yet. Draw zones to define tracking regions.'}
                actions={[
                  { label: 'Draw Zones', onClick: onDrawRois, icon: <Layers className="w-3.5 h-3.5" /> },
                  ...(geometry?.rois?.length ? [{ label: 'Accept', onClick: onAcceptRois, primary: true, icon: <CheckCircle2 className="w-3.5 h-3.5" /> }] : []),
                ]}
              />
            )}
          </div>
        )
      }

      case 'place_lidars': {
        return (
          <div className="relative h-full">
            <InlineViewport
              fixtures={geometry?.fixtures}
              bounds={geometry?.bounds}
              classifications={geometry?.classifications}
              rois={geometry?.rois}
              lidars={geometry?.lidars}
              label={`LiDAR Placement · ${geometry?.lidars?.length || 0} sensors`}
            />
            {autopilot.state === 'waiting_input' && (
              <PromptCard
                title="LiDAR Auto-Placement Complete"
                message={`${geometry?.lidars?.length || 0} sensors placed. Accept placement?`}
                actions={[
                  { label: 'Accept & Preview 3D', onClick: onAcceptLidars, primary: true, icon: <Boxes className="w-3.5 h-3.5" /> },
                ]}
              />
            )}
          </div>
        )
      }

      case 'commission_edge':
      case 'pair_devices':
      case 'validate_stream':
      case 'go_live':
        return <StatusStage stepId={activeStep} session={session} onContinue={onContinue} />

      default:
        return null
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-950 overflow-hidden">
      {/* Stage header — step indicator with animation */}
      <div className="h-10 border-b border-gray-800 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-3 flex-1">
          {session.steps.map((s, i) => {
            const isDone = s.status === 'done' || s.status === 'warning'
            const isActive = s.id === activeStep
            const isError = s.status === 'error'
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                {i > 0 && <div className={`w-4 h-px ${isDone ? 'bg-green-500/50' : 'bg-gray-700'}`} />}
                <div
                  className={`w-2 h-2 rounded-full transition-all duration-500 ${
                    isDone ? 'bg-green-400 scale-100' :
                    isActive ? 'bg-indigo-400 scale-125 animate-pulse' :
                    isError ? 'bg-red-400' :
                    'bg-gray-700'
                  }`}
                  title={s.label}
                />
              </div>
            )
          })}
        </div>
        {activeStep && (
          <span className="text-[10px] text-gray-500 font-medium">
            {STEP_LABELS[activeStep]}
          </span>
        )}
      </div>

      {/* Stage content */}
      <div className="flex-1 relative overflow-hidden">
        {renderContent()}

        {/* Running indicator overlay */}
        {autopilot.state === 'running' && autopilot.stageMessage && (
          <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/30 rounded-full z-20">
            <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
            <span className="text-[11px] text-indigo-300 font-medium">{autopilot.stageMessage}</span>
          </div>
        )}
      </div>
    </div>
  )
}
