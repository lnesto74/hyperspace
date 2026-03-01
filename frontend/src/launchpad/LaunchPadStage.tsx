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
import MiniDwgViewport from './MiniDwgViewport'
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

/* ─── Action Stage (lightweight status card — opens existing modals for interactive work) ─── */
function ActionStage({ icon, title, subtitle, isDone, isRunning, actions }: {
  icon: React.ReactNode
  title: string
  subtitle: string
  isDone: boolean
  isRunning: boolean
  actions: Array<{ label: string; onClick: () => void; primary?: boolean; icon?: React.ReactNode }>
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className={`p-6 rounded-full transition-all duration-500 ${
        isDone ? 'bg-green-500/10 text-green-400' :
        isRunning ? 'bg-indigo-500/10 text-indigo-400 animate-pulse' :
        'bg-indigo-500/10 text-indigo-400'
      }`}>
        {isDone ? <CheckCircle2 className="w-16 h-16" /> : icon}
      </div>
      <div className="text-center max-w-sm">
        <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
        <p className="text-sm text-gray-400">{subtitle}</p>
      </div>
      {actions.length > 0 && (
        <div className="flex gap-3 mt-2">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                a.primary
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600'
              }`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
      {isRunning && (
        <div className="flex items-center gap-2 mt-2">
          <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
          <span className="text-xs text-indigo-300">Processing...</span>
        </div>
      )}
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
function Inline3DFlythrough({ layoutVersionId, importId, geometry }: { layoutVersionId: string; importId?: string; geometry?: DwgGeometry }) {
  const [lidarInstances, setLidarInstances] = useState<any[]>([])
  const [lidarModels, setLidarModels] = useState<any[]>([])
  const [scaleCorrection, setScaleCorrection] = useState(1.0)
  const [loaded, setLoaded] = useState(false)

  // Compute focus bounds from ROIs (DXF coordinates)
  const focusBounds = useMemo(() => {
    const rois = geometry?.rois
    if (!rois?.length) return undefined
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    rois.forEach(roi => {
      roi.vertices.forEach(v => {
        minX = Math.min(minX, v.x)
        minY = Math.min(minY, v.y)
        maxX = Math.max(maxX, v.x)
        maxY = Math.max(maxY, v.y)
      })
    })
    if (!isFinite(minX)) return undefined
    const fb = { minX, minY, maxX, maxY }
    console.log(`[Inline3DFlythrough] focusBounds from ${rois.length} ROIs:`, fb)
    return fb
  }, [geometry?.rois])

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
        focusBounds={focusBounds}
        classifications={geometry?.classifications}
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
          geometry={geometry}
        />
      )
    }

    switch (activeStep) {
      case 'select_dwg': {
        const hasDwg = step?.status === 'done'
        if (hasDwg && geometry?.fixtures?.length && geometry?.bounds) {
          return (
            <div className="relative h-full">
              <MiniDwgViewport
                fixtures={geometry.fixtures}
                bounds={geometry.bounds}
                mode="fixtures"
                height="100%"
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
        const groupCount = geometry?.classifications?.length || 0
        const fixtureCount = geometry?.fixtures?.length || 0
        const isDone = step?.status === 'done' || step?.status === 'warning'
        return (
          <ActionStage
            icon={<Boxes className="w-16 h-16" />}
            title="Fixture Classification"
            subtitle={isDone
              ? `${groupCount} groups classified across ${fixtureCount} fixtures`
              : autopilot.state === 'running'
                ? 'Analyzing fixture groups...'
                : `${fixtureCount} fixtures detected in ${groupCount} groups`}
            isDone={isDone}
            isRunning={autopilot.state === 'running'}
            actions={autopilot.state === 'waiting_input' ? [
              { label: 'Classify by Example', onClick: onRejectClassification, icon: <Eye className="w-4 h-4" /> },
              { label: 'Accept Classification', onClick: onAcceptClassification, primary: true, icon: <CheckCircle2 className="w-4 h-4" /> },
            ] : []}
          />
        )
      }

      case 'define_rois': {
        const roiCount = geometry?.rois?.length || 0
        const isDone = step?.status === 'done' || step?.status === 'warning'
        return (
          <ActionStage
            icon={<Layers className="w-16 h-16" />}
            title="ROI Zones"
            subtitle={isDone
              ? `${roiCount} zones defined`
              : autopilot.state === 'running'
                ? 'Checking ROI zones...'
                : roiCount > 0
                  ? `${roiCount} zones found. Review or draw new ones.`
                  : 'No zones defined yet. Draw zones to define tracking regions.'}
            isDone={isDone}
            isRunning={autopilot.state === 'running'}
            actions={autopilot.state === 'waiting_input' ? [
              { label: 'Draw Zones', onClick: onDrawRois, icon: <Layers className="w-4 h-4" /> },
              ...(roiCount > 0 ? [{ label: 'Accept Zones', onClick: onAcceptRois, primary: true, icon: <CheckCircle2 className="w-4 h-4" /> }] : []),
            ] : []}
          />
        )
      }

      case 'place_lidars': {
        const lidarCount = geometry?.lidars?.length || 0
        const isDone = step?.status === 'done' || step?.status === 'warning'
        return (
          <ActionStage
            icon={<Radar className="w-16 h-16" />}
            title="LiDAR Placement"
            subtitle={isDone
              ? `${lidarCount} sensors placed`
              : autopilot.state === 'running'
                ? 'Auto-placing sensors...'
                : `${lidarCount} sensors placed. Review placement.`}
            isDone={isDone}
            isRunning={autopilot.state === 'running'}
            actions={autopilot.state === 'waiting_input' ? [
              { label: 'Accept & Preview 3D', onClick: onAcceptLidars, primary: true, icon: <Boxes className="w-4 h-4" /> },
            ] : []}
          />
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
