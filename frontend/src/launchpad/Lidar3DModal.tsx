/**
 * Lidar3DModal — Wraps the existing Layout3DPreview in a full-screen modal
 * for the LaunchPad's 3D preview step. Does NOT modify the original component.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Radar, Box } from 'lucide-react'
import Layout3DPreview from '../components/dwgImporter/Layout3DPreview'
import * as api from './launchpadApi'

type ModalTab = 'lidar' | 'twin'

interface RoiBounds {
  minX: number; minY: number; maxX: number; maxY: number
}

interface Classification {
  groupId: string
  suggestedType: string
  confidence: number
}

interface Lidar3DModalProps {
  layoutVersionId: string
  importId?: string
  onClose: () => void
  /** ROI vertices for computing camera focus bounds */
  rois?: Array<{ vertices: Array<{ x: number; y: number }> }>
  /** Classifications to apply types to raw fixtures */
  classifications?: Classification[]
}

export default function Lidar3DModal({ layoutVersionId, importId, onClose, rois, classifications }: Lidar3DModalProps) {
  const [lidarInstances, setLidarInstances] = useState<any[]>([])
  const [lidarModels, setLidarModels] = useState<any[]>([])
  const [scaleCorrection, setScaleCorrection] = useState(1.0)
  const [activeTab, setActiveTab] = useState<ModalTab>('lidar')

  // Load LiDAR data
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
          range_m: models.find(m => m.id === inst.model_id)?.range_m || 20,
        })))
        setLidarModels(models)
      } catch (err) {
        console.error('[Lidar3DModal] Failed to load LiDAR data:', err)
      }
    })()
  }, [layoutVersionId])

  // Load scale correction from localStorage
  useEffect(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('launchpad-autoplace-settings') || '{}')
      if (settings.scaleMultiplier) setScaleCorrection(settings.scaleMultiplier)
    } catch { /* ignore */ }
  }, [])

  // Compute focus bounds from ROIs
  const focusBounds = useMemo<RoiBounds | undefined>(() => {
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
    return { minX, minY, maxX, maxY }
  }, [rois])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-[92vw] h-[88vh] max-w-[1600px] bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header with tabs */}
        <div className="flex items-center justify-between px-4 py-0 bg-gray-950 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-0">
            {/* Tab: LiDAR Preview */}
            <button
              onClick={() => setActiveTab('lidar')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'lidar'
                  ? 'text-indigo-400 border-indigo-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              <Radar className="w-3.5 h-3.5" />
              LiDAR Preview
            </button>
            {/* Tab: Digital Twin */}
            <button
              onClick={() => setActiveTab('twin')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'twin'
                  ? 'text-emerald-400 border-emerald-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              Digital Twin
            </button>
            <span className="text-[10px] text-gray-600 ml-3">
              {lidarInstances.length} sensors · scale {scaleCorrection}×
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3D Preview — full remaining space */}
        <div className="flex-1 overflow-hidden">
          <Layout3DPreview
            key={activeTab}
            layoutVersionId={layoutVersionId}
            importId={importId}
            lidarInstances={activeTab === 'lidar' ? lidarInstances : []}
            lidarModels={activeTab === 'lidar' ? lidarModels : []}
            scaleCorrection={scaleCorrection}
            focusBounds={focusBounds}
            classifications={classifications}
          />
        </div>
      </div>
    </div>
  )
}
