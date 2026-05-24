import { Activity, Eye, Layers, Radar } from 'lucide-react'

export default function ProtocolGuide() {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Three-layer protocol</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="rounded-lg bg-gray-900/80 p-3 border border-blue-900/50">
          <div className="flex items-center gap-1.5 text-blue-300 font-medium mb-1">
            <Eye className="w-3.5 h-3.5" /> Layer 1 — Perception
          </div>
          <p className="text-gray-400 leading-relaxed">
            Raw MQTT capture with reconciler OFF. Fragmentation, teleports, short-lived IDs — algo supplier territory.
          </p>
        </div>
        <div className="rounded-lg bg-gray-900/80 p-3 border border-purple-900/50">
          <div className="flex items-center gap-1.5 text-purple-300 font-medium mb-1">
            <Activity className="w-3.5 h-3.5" /> Layer 2 — Reconciler
          </div>
          <p className="text-gray-400 leading-relaxed">
            Same file replayed through Trajectory Quality configs. Compare continuity vs false merges.
          </p>
        </div>
        <div className="rounded-lg bg-gray-900/80 p-3 border border-emerald-900/50">
          <div className="flex items-center gap-1.5 text-emerald-300 font-medium mb-1">
            <Radar className="w-3.5 h-3.5" /> Layer 3 — Structural
          </div>
          <p className="text-gray-400 leading-relaxed">
            Blindspots, birth/death maps, occlusion mix. LiDAR placement and floorplan — not fixable by sliders alone.
          </p>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 mt-3">
        Run on DO: <code className="text-gray-400">node analysis/run_benchmark.mjs --file … --capture-id …</code>
      </p>
    </div>
  )
}
