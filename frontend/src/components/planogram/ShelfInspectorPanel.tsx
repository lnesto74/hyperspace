import { useState, useEffect, useRef } from 'react'
import { Layers, Settings, Wand2, Trash2, Minus, Plus, Maximize2, GripVertical } from 'lucide-react'
import { usePlanogram, SkuItem, SlotData, LevelData } from '../../context/PlanogramContext'
import { useVenue } from '../../context/VenueContext'

// Detailed tooltip component
function SlotTooltip({ sku, position }: { sku: SkuItem; position: { x: number; y: number } }) {
  return (
    <div 
      className="fixed z-[100] bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-3 pointer-events-none"
      style={{ left: position.x + 10, top: position.y - 10, maxWidth: 280 }}
    >
      <div className="text-amber-400 font-mono text-xs mb-1">{sku.skuCode}</div>
      <div className="text-white font-medium text-sm mb-2">{sku.name}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {sku.brand && (
          <>
            <span className="text-gray-500">Brand:</span>
            <span className="text-gray-300">{sku.brand}</span>
          </>
        )}
        {sku.category && (
          <>
            <span className="text-gray-500">Category:</span>
            <span className="text-gray-300">{sku.category}</span>
          </>
        )}
        {sku.subcategory && (
          <>
            <span className="text-gray-500">Subcategory:</span>
            <span className="text-gray-300">{sku.subcategory}</span>
          </>
        )}
        {sku.size && (
          <>
            <span className="text-gray-500">Size:</span>
            <span className="text-gray-300">{sku.size}</span>
          </>
        )}
        {sku.price && (
          <>
            <span className="text-gray-500">Price:</span>
            <span className="text-green-400">${sku.price.toFixed(2)}</span>
          </>
        )}
        {sku.margin && (
          <>
            <span className="text-gray-500">Margin:</span>
            <span className="text-blue-400">{sku.margin.toFixed(1)}%</span>
          </>
        )}
      </div>
    </div>
  )
}

export default function ShelfInspectorPanel() {
  const {
    activePlanogram,
    activeShelfId,
    activeShelfPlanogram,
    saveShelfPlanogram,
    autoFillShelf,
    activeCatalog,
  } = usePlanogram()
  
  const { objects } = useVenue()
  
  const [numLevels, setNumLevels] = useState(4)
  const [slotWidthM, setSlotWidthM] = useState(0.1)
  const [showAutoFill, setShowAutoFill] = useState(false)
  const [autoFillCategory, setAutoFillCategory] = useState<string>('')
  const [autoFillDistribution, setAutoFillDistribution] = useState<'equal' | 'weighted'>('equal')
  const [dragSource, setDragSource] = useState<{levelIndex: number, slotIndex: number} | null>(null)
  const [dragOver, setDragOver] = useState<{levelIndex: number, slotIndex: number} | null>(null)
  const [tooltipSku, setTooltipSku] = useState<SkuItem | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{x: number, y: number}>({ x: 0, y: 0 })
  
  // Get selected shelf object
  const selectedShelf = objects.find(o => o.id === activeShelfId)
  const shelfWidth = selectedShelf?.scale?.x || 2.0
  const slotsPerLevel = Math.floor(shelfWidth / slotWidthM)
  
  // Update local state when shelf planogram changes
  useEffect(() => {
    if (activeShelfPlanogram) {
      setNumLevels(activeShelfPlanogram.numLevels)
      setSlotWidthM(activeShelfPlanogram.slotWidthM)
    }
  }, [activeShelfPlanogram])
  
  // Save settings
  const handleSaveSettings = async () => {
    if (!activeShelfId) return
    await saveShelfPlanogram(activeShelfId, {
      numLevels,
      slotWidthM,
      slots: activeShelfPlanogram?.slots || { levels: [] },
    })
  }
  
  // Handle auto-fill
  const handleAutoFill = async () => {
    if (!activeShelfId || !activeCatalog || !autoFillCategory) return
    await autoFillShelf(activeShelfId, {
      catalogId: activeCatalog.id,
      category: autoFillCategory,
      distribution: autoFillDistribution,
      shelfWidth,
    })
    setShowAutoFill(false)
  }
  
  // Clear shelf
  const handleClearShelf = async () => {
    if (!activeShelfId) return
    await saveShelfPlanogram(activeShelfId, {
      numLevels,
      slotWidthM,
      slots: { levels: [] },
    })
  }
  
  // Get SKU details for slot
  const getSkuForSlot = (skuItemId: string | null): SkuItem | null => {
    if (!skuItemId || !activeCatalog) return null
    return activeCatalog.items.find(i => i.id === skuItemId) || null
  }
  
  // Handle drag start from a slot
  const handleSlotDragStart = (e: React.DragEvent, levelIndex: number, slotIndex: number, skuItemId: string) => {
    setDragSource({ levelIndex, slotIndex })
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'slot-reposition',
      levelIndex,
      slotIndex,
      skuItemId,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }
  
  // Handle drag over a slot
  const handleSlotDragOver = (e: React.DragEvent, levelIndex: number, slotIndex: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver({ levelIndex, slotIndex })
  }
  
  // Handle drag leave
  const handleSlotDragLeave = () => {
    setDragOver(null)
  }
  
  // Handle drop on a slot
  const handleSlotDrop = async (e: React.DragEvent, targetLevelIndex: number, targetSlotIndex: number) => {
    e.preventDefault()
    setDragOver(null)
    setDragSource(null)
    
    if (!activeShelfId || !activeShelfPlanogram) return
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      
      if (data.type === 'slot-reposition') {
        const { levelIndex: sourceLevelIndex, slotIndex: sourceSlotIndex, skuItemId } = data
        
        // Don't do anything if dropping on same slot
        if (sourceLevelIndex === targetLevelIndex && sourceSlotIndex === targetSlotIndex) return
        
        // Clone the current slots structure
        const newLevels: LevelData[] = JSON.parse(JSON.stringify(activeShelfPlanogram.slots?.levels || []))
        
        // Ensure source level exists
        let sourceLevel = newLevels.find(l => l.levelIndex === sourceLevelIndex)
        if (!sourceLevel) {
          sourceLevel = { levelIndex: sourceLevelIndex, slots: [] }
          newLevels.push(sourceLevel)
        }
        
        // Ensure target level exists
        let targetLevel = newLevels.find(l => l.levelIndex === targetLevelIndex)
        if (!targetLevel) {
          targetLevel = { levelIndex: targetLevelIndex, slots: [] }
          newLevels.push(targetLevel)
        }
        
        // Find source slot and remove item
        const sourceSlot = sourceLevel.slots?.find(s => s.slotIndex === sourceSlotIndex)
        if (sourceSlot) {
          sourceSlot.skuItemId = null
        }
        
        // Find or create target slot and add item
        let targetSlot = targetLevel.slots?.find(s => s.slotIndex === targetSlotIndex)
        if (targetSlot) {
          // Swap if target has an item
          if (targetSlot.skuItemId && sourceSlot) {
            sourceSlot.skuItemId = targetSlot.skuItemId
          }
          targetSlot.skuItemId = skuItemId
        } else {
          if (!targetLevel.slots) targetLevel.slots = []
          targetLevel.slots.push({
            slotIndex: targetSlotIndex,
            skuItemId,
            facingSpan: 1,
          })
        }
        
        // Clean up empty slots
        newLevels.forEach(level => {
          if (level.slots) {
            level.slots = level.slots.filter(s => s.skuItemId !== null)
          }
        })
        
        // Save updated planogram
        await saveShelfPlanogram(activeShelfId, {
          numLevels,
          slotWidthM,
          slots: { levels: newLevels },
        })
      }
    } catch (err) {
      console.error('Drop failed:', err)
    }
  }
  
  // Handle drag end
  const handleDragEnd = () => {
    setDragSource(null)
    setDragOver(null)
  }
  
  if (!activePlanogram) {
    return (
      <div className="w-80 bg-panel-bg border-l border-border-dark flex flex-col h-full">
        <div className="p-4 text-center text-gray-500 text-sm">
          <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
          Select or create a planogram to begin
        </div>
      </div>
    )
  }
  
  if (!activeShelfId) {
    return (
      <div className="w-80 bg-panel-bg border-l border-border-dark flex flex-col h-full">
        <div className="p-3 border-b border-border-dark">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" />
            Shelf Inspector
          </h2>
        </div>
        <div className="p-4 text-center text-gray-500 text-sm">
          Click a shelf in the 3D view to edit its planogram
        </div>
      </div>
    )
  }
  
  return (
    <div className="w-80 bg-panel-bg border-l border-border-dark flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border-dark">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-500" />
          Shelf Inspector
        </h2>
        <div className="text-[10px] text-gray-500 mt-1">
          {selectedShelf?.name || activeShelfId}
        </div>
      </div>
      
      {/* Settings */}
      <div className="p-3 border-b border-border-dark space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-400">Shelf Settings</span>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Levels</label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setNumLevels(Math.max(1, numLevels - 1))}
                className="p-1 bg-gray-700 hover:bg-gray-600 rounded"
              >
                <Minus className="w-3 h-3 text-gray-300" />
              </button>
              <input
                type="number"
                value={numLevels}
                onChange={(e) => setNumLevels(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-12 text-center px-1 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
              />
              <button
                onClick={() => setNumLevels(numLevels + 1)}
                className="p-1 bg-gray-700 hover:bg-gray-600 rounded"
              >
                <Plus className="w-3 h-3 text-gray-300" />
              </button>
            </div>
          </div>
          
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Slot Width (m)</label>
            <input
              type="number"
              value={slotWidthM}
              onChange={(e) => setSlotWidthM(Math.max(0.05, parseFloat(e.target.value) || 0.1))}
              step={0.01}
              className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
            />
          </div>
        </div>
        
        <div className="flex items-center justify-between text-[10px] text-gray-500">
          <span>Shelf: {shelfWidth.toFixed(2)}m × {slotsPerLevel} slots/level</span>
          <button
            onClick={handleSaveSettings}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white"
          >
            Apply
          </button>
        </div>
      </div>
      
      {/* Actions */}
      <div className="p-3 border-b border-border-dark flex gap-2">
        <button
          onClick={() => setShowAutoFill(!showAutoFill)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
            showAutoFill ? 'bg-purple-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
        >
          <Wand2 className="w-3.5 h-3.5" />
          Auto-fill
        </button>
        <button
          onClick={handleClearShelf}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 bg-gray-700 hover:bg-red-600/50 rounded text-xs text-gray-300 hover:text-white transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>
      
      {/* Auto-fill panel */}
      {showAutoFill && activeCatalog && (
        <div className="p-3 border-b border-border-dark bg-purple-900/20 space-y-2">
          <div className="text-xs text-purple-300 font-medium">Auto-fill by Category</div>
          <select
            value={autoFillCategory}
            onChange={(e) => setAutoFillCategory(e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-800 border border-purple-600/50 rounded text-xs text-white"
          >
            <option value="">Select category...</option>
            {activeCatalog.categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <label className="flex items-center gap-1 text-[10px] text-gray-400">
              <input
                type="radio"
                name="distribution"
                checked={autoFillDistribution === 'equal'}
                onChange={() => setAutoFillDistribution('equal')}
                className="w-3 h-3"
              />
              Equal
            </label>
            <label className="flex items-center gap-1 text-[10px] text-gray-400">
              <input
                type="radio"
                name="distribution"
                checked={autoFillDistribution === 'weighted'}
                onChange={() => setAutoFillDistribution('weighted')}
                className="w-3 h-3"
              />
              By Margin
            </label>
          </div>
          <button
            onClick={handleAutoFill}
            disabled={!autoFillCategory}
            className="w-full py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-white"
          >
            Apply Auto-fill
          </button>
        </div>
      )}
      
      {/* Planogram Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-gray-500">Planogram View</span>
          <button className="p-1 text-gray-500 hover:text-white">
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
        
        <div className="bg-gray-900 rounded border border-gray-700 p-2">
          {/* Render levels from top to bottom */}
          {Array.from({ length: numLevels }, (_, i) => numLevels - 1 - i).map(levelIndex => {
            const level = activeShelfPlanogram?.slots?.levels?.find(l => l.levelIndex === levelIndex)
            
            return (
              <div key={levelIndex} className="mb-1 last:mb-0">
                <div className="text-[9px] text-gray-600 mb-0.5">L{levelIndex + 1}</div>
                <div className="flex gap-0.5 bg-gray-800/50 p-1 rounded">
                  {Array.from({ length: slotsPerLevel }, (_, slotIndex) => {
                    const slot = level?.slots?.find(s => s.slotIndex === slotIndex)
                    const sku = getSkuForSlot(slot?.skuItemId || null)
                    const isDragSource = dragSource?.levelIndex === levelIndex && dragSource?.slotIndex === slotIndex
                    const isDragOver = dragOver?.levelIndex === levelIndex && dragOver?.slotIndex === slotIndex
                    
                    return (
                      <div
                        key={slotIndex}
                        draggable={!!sku}
                        onDragStart={(e) => sku && slot?.skuItemId && handleSlotDragStart(e, levelIndex, slotIndex, slot.skuItemId)}
                        onDragOver={(e) => handleSlotDragOver(e, levelIndex, slotIndex)}
                        onDragLeave={handleSlotDragLeave}
                        onDrop={(e) => handleSlotDrop(e, levelIndex, slotIndex)}
                        onDragEnd={handleDragEnd}
                        onMouseEnter={(e) => {
                          if (sku) {
                            setTooltipSku(sku)
                            setTooltipPos({ x: e.clientX, y: e.clientY })
                          }
                        }}
                        onMouseMove={(e) => {
                          if (sku && tooltipSku) {
                            setTooltipPos({ x: e.clientX, y: e.clientY })
                          }
                        }}
                        onMouseLeave={() => setTooltipSku(null)}
                        className={`
                          flex-1 min-w-[20px] h-10 rounded text-[8px] flex items-center justify-center
                          transition-all cursor-pointer relative
                          ${isDragSource 
                            ? 'opacity-50 border-2 border-dashed border-amber-400' 
                            : isDragOver 
                              ? 'bg-blue-600/40 border-2 border-blue-400 scale-105' 
                              : sku 
                                ? 'bg-amber-600/30 border border-amber-600/50 text-amber-200 hover:bg-amber-600/40' 
                                : 'bg-gray-700/30 border border-gray-700 text-gray-600 hover:bg-gray-600/30'
                          }
                          ${sku ? 'cursor-grab active:cursor-grabbing' : ''}
                        `}
                      >
                        {sku ? (
                          <div className="truncate px-0.5 text-center leading-tight flex items-center gap-0.5">
                            <GripVertical className="w-2 h-2 opacity-50 flex-shrink-0" />
                            <span>{sku.name.substring(0, 6)}</span>
                          </div>
                        ) : (
                          <span className="opacity-50">{slotIndex + 1}</span>
                        )}
                        {isDragOver && !sku && (
                          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20 rounded">
                            <span className="text-blue-300 text-[10px]">Drop</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        
        {/* Stats */}
        {activeShelfPlanogram && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-800/50 rounded p-2">
              <div className="text-lg font-bold text-white">
                {activeShelfPlanogram.slots?.levels?.reduce((sum, l) => 
                  sum + (l.slots?.filter(s => s.skuItemId).length || 0), 0) || 0}
              </div>
              <div className="text-[9px] text-gray-500">Placed</div>
            </div>
            <div className="bg-gray-800/50 rounded p-2">
              <div className="text-lg font-bold text-white">
                {numLevels * slotsPerLevel}
              </div>
              <div className="text-[9px] text-gray-500">Total Slots</div>
            </div>
            <div className="bg-gray-800/50 rounded p-2">
              <div className="text-lg font-bold text-amber-500">
                {Math.round((activeShelfPlanogram.slots?.levels?.reduce((sum, l) => 
                  sum + (l.slots?.filter(s => s.skuItemId).length || 0), 0) || 0) / (numLevels * slotsPerLevel) * 100)}%
              </div>
              <div className="text-[9px] text-gray-500">Fill Rate</div>
            </div>
          </div>
        )}
      </div>
      
      {/* Tooltip */}
      {tooltipSku && <SlotTooltip sku={tooltipSku} position={tooltipPos} />}
    </div>
  )
}
