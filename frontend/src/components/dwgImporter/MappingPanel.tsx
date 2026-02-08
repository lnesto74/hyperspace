import { useState, useEffect } from 'react'
import { Settings, Box, RotateCw, Move, Anchor } from 'lucide-react'
import type { DwgGroup, GroupMapping, CatalogAsset } from './DwgImporterPage'

interface MappingPanelProps {
  group: DwgGroup | null
  mapping: GroupMapping | undefined
  catalog: CatalogAsset[]
  onUpdateMapping: (mapping: GroupMapping | null) => void
}

const ANCHOR_OPTIONS: { value: GroupMapping['anchor']; label: string }[] = [
  { value: 'center', label: 'Center' },
  { value: 'back_center', label: 'Back Center' },
  { value: 'minx_miny', label: 'Min X, Min Y' },
  { value: 'minx_maxy', label: 'Min X, Max Y' },
  { value: 'maxx_miny', label: 'Max X, Min Y' },
  { value: 'maxx_maxy', label: 'Max X, Max Y' },
]

const DEFAULT_MAPPING: GroupMapping = {
  catalog_asset_id: '',
  type: '',
  anchor: 'center',
  offset_m: { x: 0, y: 0, z: 0 },
  rotation_offset_deg: 0
}

export default function MappingPanel({ group, mapping, catalog, onUpdateMapping }: MappingPanelProps) {
  const [localMapping, setLocalMapping] = useState<GroupMapping>(DEFAULT_MAPPING)

  // Sync local state with prop
  useEffect(() => {
    if (mapping) {
      setLocalMapping(mapping)
    } else {
      setLocalMapping(DEFAULT_MAPPING)
    }
  }, [mapping, group?.group_id])

  // Update parent when local changes
  const updateField = <K extends keyof GroupMapping>(field: K, value: GroupMapping[K]) => {
    const updated = { ...localMapping, [field]: value }
    setLocalMapping(updated)
    
    // Only emit if we have an asset selected
    if (updated.catalog_asset_id) {
      onUpdateMapping(updated)
    }
  }

  const updateOffset = (axis: 'x' | 'y' | 'z', value: number) => {
    const updated = {
      ...localMapping,
      offset_m: { ...localMapping.offset_m, [axis]: value }
    }
    setLocalMapping(updated)
    if (updated.catalog_asset_id) {
      onUpdateMapping(updated)
    }
  }

  const handleAssetChange = (assetId: string) => {
    const asset = catalog.find(c => c.id === assetId)
    const updated = {
      ...localMapping,
      catalog_asset_id: assetId,
      type: asset?.type || assetId
    }
    setLocalMapping(updated)
    if (assetId) {
      onUpdateMapping(updated)
    } else {
      onUpdateMapping(null)
    }
  }

  const clearMapping = () => {
    setLocalMapping(DEFAULT_MAPPING)
    onUpdateMapping(null)
  }

  if (!group) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Settings className="w-12 h-12 text-gray-600 mb-4" />
        <p className="text-gray-500 text-sm">
          Select a group from the left panel to configure its 3D asset mapping
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border-dark">
        <h2 className="text-sm font-medium text-white flex items-center gap-2 mb-1">
          <Settings className="w-4 h-4 text-highlight" />
          Mapping Configuration
        </h2>
        <p className="text-xs text-gray-500">
          {group.block || group.layer} • {group.count} instances
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Catalog Asset Selection */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-2 flex items-center gap-1">
            <Box className="w-3 h-3" />
            3D Asset
          </label>
          <select
            value={localMapping.catalog_asset_id}
            onChange={(e) => handleAssetChange(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-border-dark rounded-lg text-sm text-white focus:border-highlight focus:outline-none"
          >
            <option value="">Select an asset...</option>
            {catalog.map(asset => (
              <option key={asset.id} value={asset.id}>
                {asset.name} {asset.hasCustomModel && '(Custom Model)'}
              </option>
            ))}
          </select>
        </div>

        {/* Anchor Selection */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-2 flex items-center gap-1">
            <Anchor className="w-3 h-3" />
            Placement Anchor
          </label>
          <div className="grid grid-cols-2 gap-1">
            {ANCHOR_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateField('anchor', opt.value)}
                className={`px-2 py-1.5 text-xs rounded transition-colors ${
                  localMapping.anchor === opt.value
                    ? 'bg-highlight text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Position Offsets */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-2 flex items-center gap-1">
            <Move className="w-3 h-3" />
            Position Offset (meters)
          </label>
          <div className="space-y-2">
            {(['x', 'z', 'y'] as const).map(axis => (
              <div key={axis} className="flex items-center gap-2">
                <span className="w-4 text-xs text-gray-500 uppercase">{axis}</span>
                <input
                  type="range"
                  min="-5"
                  max="5"
                  step="0.1"
                  value={localMapping.offset_m[axis]}
                  onChange={(e) => updateOffset(axis, parseFloat(e.target.value))}
                  className="flex-1 accent-highlight h-1"
                />
                <input
                  type="number"
                  value={localMapping.offset_m[axis]}
                  onChange={(e) => updateOffset(axis, parseFloat(e.target.value) || 0)}
                  step="0.1"
                  className="w-16 px-2 py-1 bg-gray-800 border border-border-dark rounded text-xs text-white text-right focus:border-highlight focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Rotation Offset */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-2 flex items-center gap-1">
            <RotateCw className="w-3 h-3" />
            Rotation Offset (degrees)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="-180"
              max="180"
              step="15"
              value={localMapping.rotation_offset_deg}
              onChange={(e) => updateField('rotation_offset_deg', parseFloat(e.target.value))}
              className="flex-1 accent-highlight h-1"
            />
            <input
              type="number"
              value={localMapping.rotation_offset_deg}
              onChange={(e) => updateField('rotation_offset_deg', parseFloat(e.target.value) || 0)}
              step="15"
              className="w-16 px-2 py-1 bg-gray-800 border border-border-dark rounded text-xs text-white text-right focus:border-highlight focus:outline-none"
            />
          </div>
          <div className="flex justify-between mt-1">
            {[-90, 0, 90, 180].map(deg => (
              <button
                key={deg}
                onClick={() => updateField('rotation_offset_deg', deg)}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  localMapping.rotation_offset_deg === deg
                    ? 'bg-highlight/20 text-highlight'
                    : 'text-gray-500 hover:text-white'
                }`}
              >
                {deg}°
              </button>
            ))}
          </div>
        </div>

        {/* Group Info */}
        <div className="bg-gray-800/50 rounded-lg p-3">
          <h3 className="text-xs font-medium text-gray-400 mb-2">Group Info</h3>
          <div className="text-xs text-gray-500 space-y-1">
            <div>Layer: <span className="text-gray-300">{group.layer}</span></div>
            {group.block && (
              <div>Block: <span className="text-gray-300">{group.block}</span></div>
            )}
            <div>
              Footprint: <span className="text-gray-300">
                {group.size.w.toFixed(0)} × {group.size.d.toFixed(0)}
              </span>
            </div>
            <div>Instances: <span className="text-gray-300">{group.count}</span></div>
          </div>
        </div>
      </div>

      {/* Footer */}
      {localMapping.catalog_asset_id && (
        <div className="p-4 border-t border-border-dark">
          <button
            onClick={clearMapping}
            className="w-full py-2 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded-lg transition-colors"
          >
            Clear Mapping
          </button>
        </div>
      )}
    </div>
  )
}
