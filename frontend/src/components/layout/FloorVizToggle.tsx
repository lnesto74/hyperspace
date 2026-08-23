import { Radio, Wind } from 'lucide-react'
import { useViewMode } from '../../App'

/**
 * Flow field ↔ Live tracks switch. Shown only after Enter Workspace
 * (ModeBar hides it while the landing overlay is up).
 */
export default function FloorVizToggle({ className = '' }: { className?: string }) {
  const { floorViz, setFloorViz } = useViewMode()

  return (
    <div
      className={`inline-flex rounded-lg border border-gray-700/70 bg-gray-900/80 p-0.5 ${className}`}
      role="tablist"
      aria-label="Floor visualisation"
    >
      <button
        type="button"
        role="tab"
        aria-selected={floorViz === 'flow'}
        onClick={() => setFloorViz('flow')}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
          floorViz === 'flow'
            ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-500/30'
            : 'text-gray-400 hover:text-gray-200 border border-transparent'
        }`}
      >
        <Wind className="w-3.5 h-3.5" />
        Flow field
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={floorViz === 'tracks'}
        onClick={() => setFloorViz('tracks')}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
          floorViz === 'tracks'
            ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-500/30'
            : 'text-gray-400 hover:text-gray-200 border border-transparent'
        }`}
      >
        <Radio className="w-3.5 h-3.5" />
        Live tracks
      </button>
    </div>
  )
}
