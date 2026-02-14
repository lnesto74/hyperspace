import { useState, useEffect, useCallback, useRef } from 'react'
import { 
  Package, Tag, Building2, TrendingUp, BarChart3, Grid3X3, 
  Layers, DollarSign, Percent, Eye, Clock, Target, RefreshCw,
  ChevronDown, ChevronUp, HelpCircle
} from 'lucide-react'
import { KPI_DEFINITIONS } from './kpiDefinitions'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function HelpTooltip({ definitionKey }: { definitionKey: string }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const definition = KPI_DEFINITIONS[definitionKey]
  
  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setTooltipPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      })
    }
    setShowTooltip(true)
  }
  
  if (!definition) return null
  
  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip) }}
        className="text-gray-500 hover:text-gray-300 transition-colors"
      >
        <HelpCircle className="w-3 h-3" />
      </button>
      {showTooltip && (
        <div 
          className="fixed w-64 p-2 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl text-xs text-gray-300 leading-relaxed pointer-events-none"
          style={{
            zIndex: 99999,
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {definition}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-600" />
        </div>
      )}
    </div>
  )
}

interface CategoryData {
  category: string
  slotCount: number
  facings: number
  shareOfShelf: number
  avgPositionScore: number
  uniqueSkus: number
  uniqueBrands: number
  subcategories: string[]
  avgPrice: number
  avgMargin: number
  levelDistribution: Record<string, number>
}

interface BrandData {
  brand: string
  slotCount: number
  facings: number
  shareOfShelf: number
  avgPositionScore: number
  uniqueSkus: number
  categories: string[]
  avgPrice: number
  avgMargin: number
}

interface BrandEfficiency {
  brand: string
  shareOfShelf: number
  estimatedShareOfEngagement: number
  efficiencyIndex: number
}

interface SlotData {
  slotIndex: number
  slotType: string
  positionScore: number
  skuCode: string | null
  skuName: string | null
  category: string | null
  brand: string | null
  engagementCount: number
  dwellTimeMs: number
}

interface LevelData {
  levelIndex: number
  levelType: string
  slots: SlotData[]
}

interface EnrichedShelfKPIs {
  shelfId: string
  planogramId: string
  roiId: string | null
  browsingRate: number
  avgBrowseTime: number
  passbyCount: number
  visits?: number
  dwellsCumulative?: number
  dwellRate?: number
  engagementRate?: number
  utilizationRate?: number
  planogramData: {
    totalSlots: number
    occupiedSlots: number
    occupancyRate: number
    numLevels: number
    slotsPerLevel: number
  }
  categoryBreakdown: CategoryData[]
  brandBreakdown: BrandData[]
  brandEfficiency: BrandEfficiency[]
  slotHeatmap: LevelData[]
  revenueMetrics: {
    avgShelfPrice: number
    estimatedEngagementValue: number
    revenuePerVisit: number
  }
}

interface ProductAnalyticsTabProps {
  shelfId: string
  planogramId: string
  roiId?: string
  period?: 'hour' | 'day' | 'week' | 'month'
}

function MetricCard({ 
  icon: Icon, 
  label, 
  value, 
  subValue, 
  color = 'text-blue-400',
  definitionKey
}: { 
  icon: any
  label: string
  value: string | number
  subValue?: string
  color?: string
  definitionKey?: string
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        {definitionKey && <HelpTooltip definitionKey={definitionKey} />}
      </div>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
      {subValue && <div className="text-[10px] text-gray-500 mt-0.5">{subValue}</div>}
    </div>
  )
}

function CategoryBreakdownChart({ categories }: { categories: CategoryData[] }) {
  const [expanded, setExpanded] = useState(false)
  const displayCategories = expanded ? categories : categories.slice(0, 5)
  
  if (categories.length === 0) {
    return <div className="text-gray-500 text-sm text-center py-4">No category data available</div>
  }

  const maxSlots = Math.max(...categories.map(c => c.slotCount), 1)

  return (
    <div className="space-y-2">
      {displayCategories.map((cat, idx) => (
        <div key={cat.category} className="group">
          <div className="flex items-center justify-between text-sm mb-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 w-4">{idx + 1}.</span>
              <span className="text-white font-medium">{cat.category}</span>
              <span className="text-xs text-gray-500">({cat.uniqueSkus} SKUs)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-purple-400">{cat.shareOfShelf.toFixed(1)}%</span>
              <span className="text-xs text-gray-400">{cat.slotCount} slots</span>
            </div>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all"
              style={{ width: `${(cat.slotCount / maxSlots) * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500">
            <span>Avg Position: <span className="text-purple-300">{cat.avgPositionScore}</span></span>
            <span>Avg Price: <span className="text-green-300">${cat.avgPrice.toFixed(2)}</span></span>
            <span>{cat.uniqueBrands} brands</span>
          </div>
        </div>
      ))}
      {categories.length > 5 && (
        <button 
          onClick={() => setExpanded(!expanded)}
          className="w-full text-xs text-gray-400 hover:text-white flex items-center justify-center gap-1 py-2"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? 'Show less' : `Show ${categories.length - 5} more`}
        </button>
      )}
    </div>
  )
}

function BrandEfficiencyChart({ brands }: { brands: BrandEfficiency[] }) {
  if (brands.length === 0) {
    return <div className="text-gray-500 text-sm text-center py-4">No brand data available</div>
  }

  return (
    <div className="space-y-3">
      {brands.slice(0, 6).map((brand) => {
        const efficiency = brand.efficiencyIndex
        const isOutperforming = efficiency > 1
        const color = isOutperforming ? 'text-green-400' : efficiency < 0.8 ? 'text-red-400' : 'text-yellow-400'
        const bgColor = isOutperforming ? 'bg-green-500' : efficiency < 0.8 ? 'bg-red-500' : 'bg-yellow-500'
        
        return (
          <div key={brand.brand} className="flex items-center gap-3">
            <div className="w-24 truncate text-sm text-white">{brand.brand}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-4 bg-gray-700 rounded relative overflow-hidden">
                  {/* Share of shelf bar */}
                  <div 
                    className="absolute inset-y-0 left-0 bg-gray-500/50"
                    style={{ width: `${Math.min(brand.shareOfShelf, 100)}%` }}
                  />
                  {/* Share of engagement bar */}
                  <div 
                    className={`absolute inset-y-0 left-0 ${bgColor} opacity-70`}
                    style={{ width: `${Math.min(brand.estimatedShareOfEngagement, 100)}%` }}
                  />
                </div>
                <div className={`text-xs font-medium w-12 text-right ${color}`}>
                  {efficiency.toFixed(2)}x
                </div>
              </div>
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-4 text-[10px] text-gray-500 justify-center mt-2">
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 bg-gray-500/50 rounded" />
          <span>Share of Shelf</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 bg-green-500/70 rounded" />
          <span>Est. Engagement</span>
        </div>
      </div>
    </div>
  )
}

function PositionHeatmap({ levels }: { levels: LevelData[] }) {
  if (levels.length === 0) {
    return <div className="text-gray-500 text-sm text-center py-4">No heatmap data available</div>
  }

  // Reverse levels so bottom (level 0) is at bottom of visual
  const reversedLevels = [...levels].reverse()

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'bg-green-500'
    if (score >= 50) return 'bg-yellow-500'
    if (score >= 30) return 'bg-orange-500'
    return 'bg-red-500'
  }

  const getLevelLabel = (type: string) => {
    switch (type) {
      case 'eye-level': return '👁️ Eye'
      case 'waist': return '🖐️ Waist'
      case 'stretch': return '⬆️ Stretch'
      case 'stooping': return '⬇️ Stoop'
      default: return type
    }
  }

  return (
    <div className="space-y-1">
      {reversedLevels.map((level) => (
        <div key={level.levelIndex} className="flex items-center gap-2">
          <div className="w-16 text-[10px] text-gray-400 text-right">
            {getLevelLabel(level.levelType)}
          </div>
          <div className="flex-1 flex gap-0.5">
            {level.slots.map((slot) => (
              <div
                key={slot.slotIndex}
                className={`flex-1 h-8 rounded ${slot.skuCode ? getScoreColor(slot.positionScore) : 'bg-gray-700'} 
                  opacity-${slot.skuCode ? '80' : '30'} 
                  hover:opacity-100 transition-opacity cursor-pointer relative group`}
                title={slot.skuCode 
                  ? `${slot.skuName}\n${slot.category} | ${slot.brand}\nScore: ${slot.positionScore}`
                  : 'Empty slot'}
              >
                {slot.skuCode && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[8px] text-white font-medium truncate px-0.5">
                      {slot.positionScore}
                    </span>
                  </div>
                )}
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block 
                  bg-gray-900 border border-gray-600 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap z-20">
                  {slot.skuCode ? (
                    <>
                      <div className="font-medium">{slot.skuName}</div>
                      <div className="text-gray-400">{slot.category} • {slot.brand}</div>
                      <div className="text-purple-300">Position Score: {slot.positionScore}</div>
                    </>
                  ) : (
                    <span className="text-gray-400">Empty Slot</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      
      {/* Legend */}
      <div className="flex items-center gap-3 justify-center mt-3 text-[10px] text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded" />
          <span>70+</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-yellow-500 rounded" />
          <span>50-69</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-orange-500 rounded" />
          <span>30-49</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-500 rounded" />
          <span>&lt;30</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-gray-700 rounded opacity-30" />
          <span>Empty</span>
        </div>
      </div>
    </div>
  )
}

export default function ProductAnalyticsTab({ 
  shelfId, 
  planogramId, 
  roiId, 
  period = 'day' 
}: ProductAnalyticsTabProps) {
  const [data, setData] = useState<EnrichedShelfKPIs | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'overview' | 'categories' | 'brands' | 'heatmap'>('overview')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const url = new URL(`${API_BASE}/api/shelf/${shelfId}/enriched-kpis`)
      url.searchParams.set('planogramId', planogramId)
      url.searchParams.set('period', period)
      if (roiId) url.searchParams.set('roiId', roiId)
      
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to fetch enriched KPIs')
      const result = await res.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [shelfId, planogramId, roiId, period])

  useEffect(() => {
    if (shelfId && planogramId) {
      fetchData()
    }
  }, [fetchData, shelfId, planogramId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Package className="w-8 h-8 mb-2 opacity-50" />
        <p>{error || 'No product analytics data available'}</p>
        <p className="text-xs mt-1">Ensure a planogram is configured for this shelf</p>
      </div>
    )
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'categories', label: 'Categories', icon: Tag },
    { id: 'brands', label: 'Brands', icon: Building2 },
    { id: 'heatmap', label: 'Position Map', icon: Grid3X3 },
  ]

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id as any)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors
              ${activeSection === id 
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Overview Section */}
      {activeSection === 'overview' && (
        <div className="space-y-4">
          {/* Shelf-Specific KPIs */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Package className="w-3.5 h-3.5" />
              Shelf Engagement
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard
                icon={Eye}
                label="Browsing Rate"
                value={`${data.browsingRate.toFixed(1)}%`}
                subValue="Visitors who stopped"
                color="text-purple-400"
                definitionKey="browsingRate"
              />
              <MetricCard
                icon={Clock}
                label="Avg Browse Time"
                value={`${data.avgBrowseTime}s`}
                subValue="Time at shelf"
                color="text-blue-400"
                definitionKey="avgBrowseTime"
              />
              <MetricCard
                icon={Target}
                label="Passby Count"
                value={data.passbyCount}
                subValue="Walked past"
                color="text-orange-400"
                definitionKey="passbyCount"
              />
            </div>
          </div>

          {/* Planogram Stats */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" />
              Planogram Status
            </h4>
            <div className="grid grid-cols-4 gap-2">
              <MetricCard
                icon={Grid3X3}
                label="Total Slots"
                value={data.planogramData.totalSlots}
                color="text-gray-400"
                definitionKey="totalSlots"
              />
              <MetricCard
                icon={Package}
                label="Occupied"
                value={data.planogramData.occupiedSlots}
                subValue={`${data.planogramData.occupancyRate.toFixed(0)}%`}
                color="text-green-400"
                definitionKey="occupiedSlots"
              />
              <MetricCard
                icon={Layers}
                label="Levels"
                value={data.planogramData.numLevels}
                color="text-blue-400"
              />
              <MetricCard
                icon={BarChart3}
                label="Categories"
                value={data.categoryBreakdown.length}
                color="text-purple-400"
              />
            </div>
          </div>

          {/* Revenue Metrics */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5" />
              Revenue Estimates
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard
                icon={DollarSign}
                label="Avg Shelf Price"
                value={`$${data.revenueMetrics.avgShelfPrice.toFixed(2)}`}
                color="text-green-400"
                definitionKey="avgShelfPrice"
              />
              <MetricCard
                icon={TrendingUp}
                label="Est. Engagement Value"
                value={`$${data.revenueMetrics.estimatedEngagementValue.toFixed(0)}`}
                subValue="Based on dwells"
                color="text-green-400"
                definitionKey="estimatedEngagementValue"
              />
              <MetricCard
                icon={Percent}
                label="Revenue/Visit"
                value={`$${data.revenueMetrics.revenuePerVisit.toFixed(2)}`}
                color="text-green-400"
                definitionKey="revenuePerVisit"
              />
            </div>
          </div>

          {/* Utilization if available */}
          {data.utilizationRate !== undefined && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" />
                Utilization
              </h4>
              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  icon={Clock}
                  label="Utilization Rate"
                  value={`${data.utilizationRate?.toFixed(1) || 0}%`}
                  subValue="Time occupied"
                  color="text-cyan-400"
                  definitionKey="utilizationRate"
                />
                <MetricCard
                  icon={Eye}
                  label="Dwell Rate"
                  value={`${data.dwellRate?.toFixed(1) || 0}%`}
                  color="text-yellow-400"
                  definitionKey="dwellRate"
                />
                <MetricCard
                  icon={Target}
                  label="Engagement Rate"
                  value={`${data.engagementRate?.toFixed(1) || 0}%`}
                  color="text-green-400"
                  definitionKey="engagementRate"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Categories Section */}
      {activeSection === 'categories' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <Tag className="w-4 h-4 text-purple-400" />
              Category Breakdown
            </h4>
            <span className="text-xs text-gray-400">
              {data.categoryBreakdown.length} categories
            </span>
          </div>
          <CategoryBreakdownChart categories={data.categoryBreakdown} />
        </div>
      )}

      {/* Brands Section */}
      {activeSection === 'brands' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-400" />
              Brand Efficiency Index
            </h4>
            <span className="text-xs text-gray-400">
              Engagement vs Shelf Space
            </span>
          </div>
          <BrandEfficiencyChart brands={data.brandEfficiency} />
          
          <div className="border-t border-gray-700 pt-4">
            <h4 className="text-sm font-medium text-white mb-3">Brand Details</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {data.brandBreakdown.map((brand) => (
                <div key={brand.brand} className="flex items-center justify-between text-xs bg-gray-800/30 p-2 rounded">
                  <div>
                    <span className="text-white font-medium">{brand.brand}</span>
                    <span className="text-gray-500 ml-2">({brand.uniqueSkus} SKUs)</span>
                  </div>
                  <div className="flex items-center gap-4 text-gray-400">
                    <span>{brand.slotCount} slots</span>
                    <span>${brand.avgPrice.toFixed(2)} avg</span>
                    <span className="text-purple-300">{brand.shareOfShelf.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Heatmap Section */}
      {activeSection === 'heatmap' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <Grid3X3 className="w-4 h-4 text-green-400" />
              Position Value Heatmap
            </h4>
            <span className="text-xs text-gray-400">
              Higher scores = better visibility
            </span>
          </div>
          <PositionHeatmap levels={data.slotHeatmap} />
          
          <div className="bg-gray-800/30 rounded-lg p-3 text-xs text-gray-400">
            <p className="font-medium text-white mb-1">Position Scoring</p>
            <ul className="space-y-1">
              <li>• <span className="text-purple-300">Eye-level</span> positions get 1.5x multiplier</li>
              <li>• <span className="text-blue-300">Center slots</span> get +20% bonus</li>
              <li>• <span className="text-orange-300">End caps</span> get +40% bonus (promotional)</li>
              <li>• <span className="text-red-300">Stooping/Stretch</span> levels have lower scores</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
