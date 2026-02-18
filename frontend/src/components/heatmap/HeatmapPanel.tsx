import { useEffect } from 'react'
import { Calendar, BarChart3, Thermometer, ChevronDown, Eye } from 'lucide-react'
import { useHeatmap } from '../../context/HeatmapContext'
import { useVenue } from '../../context/VenueContext'

const KPI_OPTIONS = [
  { value: 'visits', label: 'Visits' },
  { value: 'dwellSec', label: 'Dwell Time' },
]

const TIMEFRAME_OPTIONS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

export default function HeatmapPanel({ isOpen }: { isOpen: boolean }) {
  const { venue } = useVenue()
  const {
    isLoading,
    heatmapData,
    timeframe,
    heightKpi,
    colorKpi,
    opacity,
    setTimeframe,
    setHeightKpi,
    setColorKpi,
    setOpacity,
    loadHeatmap,
  } = useHeatmap()

  useEffect(() => {
    if (isOpen && venue?.id) {
      loadHeatmap(venue.id)
    }
  }, [isOpen, venue?.id, timeframe, loadHeatmap])

  if (!isOpen) return null

  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-xl p-4 shadow-xl z-20 min-w-[400px]">
      <div className="flex items-center gap-3 mb-4">
        <Thermometer className="w-5 h-5 text-orange-400" />
        <span className="font-medium text-white">Heatmap Settings</span>
        {isLoading && (
          <span className="text-xs text-gray-400 ml-auto">Loading...</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        {/* Timeframe Selector */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Timeframe
          </label>
          <div className="relative">
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as 'day' | 'week' | 'month')}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white appearance-none cursor-pointer hover:border-gray-500 transition-colors"
            >
              {TIMEFRAME_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Height KPI Selector */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
            <BarChart3 className="w-3 h-3" /> Height (Extrusion)
          </label>
          <div className="relative">
            <select
              value={heightKpi}
              onChange={(e) => setHeightKpi(e.target.value as 'visits' | 'dwellSec')}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white appearance-none cursor-pointer hover:border-gray-500 transition-colors"
            >
              {KPI_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Color KPI Selector */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
            <Thermometer className="w-3 h-3" /> Color Gradient
          </label>
          <div className="relative">
            <select
              value={colorKpi}
              onChange={(e) => setColorKpi(e.target.value as 'visits' | 'dwellSec')}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white appearance-none cursor-pointer hover:border-gray-500 transition-colors"
            >
              {KPI_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Opacity Slider */}
        <div>
          <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
            <Eye className="w-3 h-3" /> Opacity {Math.round(opacity * 100)}%
          </label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
          />
        </div>
      </div>

      {/* Stats Summary */}
      {heatmapData && (
        <div className="mt-4 pt-3 border-t border-gray-700 flex items-center gap-6 text-xs text-gray-400">
          <span>
            <strong className="text-white">{heatmapData.tiles.length}</strong> tiles with data
          </span>
          <span>
            Max visits: <strong className="text-blue-400">{heatmapData.maxVisits}</strong>
          </span>
          <span>
            Max dwell: <strong className="text-orange-400">{Math.round(heatmapData.maxDwell / 60)}m</strong>
          </span>
        </div>
      )}

      {/* Color Legend */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-gray-400">Low</span>
        <div className="flex-1 h-2 rounded-full" style={{ background: 'linear-gradient(to right, #1e3a5f, #00bcd4, #4caf50, #ffeb3b, #ff9800, #f44336)' }} />
        <span className="text-gray-400">High</span>
      </div>
    </div>
  )
}
