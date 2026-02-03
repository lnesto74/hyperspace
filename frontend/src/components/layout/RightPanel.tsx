import { X, Trash2, RotateCw } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'

export default function RightPanel() {
  const { objects, selectedObjectId, updateObject, removeObject, selectObject } = useVenue()
  const { placements, selectedPlacementId, updatePlacement, removePlacement, selectPlacement, getDeviceById } = useLidar()

  const selectedObject = objects.find(o => o.id === selectedObjectId)
  const selectedPlacement = placements.find(p => p.id === selectedPlacementId)
  const selectedDevice = selectedPlacement ? getDeviceById(selectedPlacement.deviceId) : null

  const handleClose = () => {
    selectObject(null)
    selectPlacement(null)
  }

  return (
    <div className="w-64 flex-shrink-0 h-full bg-panel-bg border-l border-border-dark flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-border-dark flex items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-white">
          {selectedObject ? 'Object Properties' : 'LiDAR Properties'}
        </h2>
        <button onClick={handleClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {selectedObject && (
          <>
            {/* Name */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={selectedObject.name}
                onChange={e => updateObject(selectedObject.id, { name: e.target.value })}
                className="w-full bg-card-bg border border-border-dark rounded px-3 py-2 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>

            {/* Position */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Position (m)</label>
              <div className="grid grid-cols-3 gap-2">
                {(['x', 'z'] as const).map(axis => (
                  <div key={axis}>
                    <span className="text-[10px] text-gray-500 uppercase">{axis}</span>
                    <input
                      type="number"
                      step="0.5"
                      value={selectedObject.position[axis]}
                      onChange={e => updateObject(selectedObject.id, {
                        position: { ...selectedObject.position, [axis]: parseFloat(e.target.value) || 0 }
                      })}
                      className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Scale */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Scale (m)</label>
              <div className="grid grid-cols-3 gap-2">
                {(['x', 'y', 'z'] as const).map(axis => (
                  <div key={axis}>
                    <span className="text-[10px] text-gray-500 uppercase">{axis === 'y' ? 'H' : axis === 'x' ? 'W' : 'D'}</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={selectedObject.scale[axis]}
                      onChange={e => updateObject(selectedObject.id, {
                        scale: { ...selectedObject.scale, [axis]: parseFloat(e.target.value) || 0.1 }
                      })}
                      className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Rotation */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rotation (°)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="15"
                  value={Math.round((selectedObject.rotation.y * 180) / Math.PI)}
                  onChange={e => updateObject(selectedObject.id, {
                    rotation: { ...selectedObject.rotation, y: (parseFloat(e.target.value) || 0) * Math.PI / 180 }
                  })}
                  className="flex-1 bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
                />
                <button
                  onClick={() => updateObject(selectedObject.id, {
                    rotation: { ...selectedObject.rotation, y: selectedObject.rotation.y + Math.PI / 4 }
                  })}
                  className="p-2 bg-card-bg border border-border-dark rounded hover:bg-border-dark transition-colors"
                >
                  <RotateCw className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>

            {/* Color */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Color</label>
              <input
                type="color"
                value={selectedObject.color || '#6366f1'}
                onChange={e => updateObject(selectedObject.id, { color: e.target.value })}
                className="w-full h-8 bg-card-bg border border-border-dark rounded cursor-pointer"
              />
            </div>
          </>
        )}

        {selectedPlacement && (
          <>
            {/* Device Info */}
            <div className="bg-card-bg rounded-lg p-3 border border-border-dark">
              <div className="text-xs text-gray-400 mb-1">Device</div>
              <div className="text-sm text-white font-medium">{selectedDevice?.hostname || 'Unknown'}</div>
              <div className="text-xs text-gray-500 mt-1">{selectedDevice?.tailscaleIp}</div>
            </div>

            {/* Position */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Position (m)</label>
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'z'] as const).map(axis => (
                  <div key={axis}>
                    <span className="text-[10px] text-gray-500 uppercase">{axis}</span>
                    <input
                      type="number"
                      step="0.5"
                      value={selectedPlacement.position[axis]}
                      onChange={e => updatePlacement(selectedPlacement.id, {
                        position: { ...selectedPlacement.position, [axis]: parseFloat(e.target.value) || 0 }
                      })}
                      className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Mount Height */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Mount Height (m)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="10"
                value={selectedPlacement.mountHeight}
                onChange={e => updatePlacement(selectedPlacement.id, { mountHeight: parseFloat(e.target.value) || 3 })}
                className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>

            {/* Rotation */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rotation (°)</label>
              <input
                type="number"
                step="15"
                value={Math.round((selectedPlacement.rotation.y * 180) / Math.PI)}
                onChange={e => updatePlacement(selectedPlacement.id, {
                  rotation: { ...selectedPlacement.rotation, y: (parseFloat(e.target.value) || 0) * Math.PI / 180 }
                })}
                className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>

            {/* FOV */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Field of View (°)</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-gray-500">Horizontal</span>
                  <input
                    type="number"
                    step="5"
                    min="10"
                    max="180"
                    value={selectedPlacement.fovHorizontal}
                    onChange={e => updatePlacement(selectedPlacement.id, { fovHorizontal: parseFloat(e.target.value) || 120 })}
                    className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-gray-500">Vertical</span>
                  <input
                    type="number"
                    step="5"
                    min="10"
                    max="90"
                    value={selectedPlacement.fovVertical}
                    onChange={e => updatePlacement(selectedPlacement.id, { fovVertical: parseFloat(e.target.value) || 30 })}
                    className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Range */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Range (m)</label>
              <input
                type="number"
                step="1"
                min="1"
                max="50"
                value={selectedPlacement.range}
                onChange={e => updatePlacement(selectedPlacement.id, { range: parseFloat(e.target.value) || 10 })}
                className="w-full bg-card-bg border border-border-dark rounded px-2 py-1 text-sm text-white focus:border-highlight focus:outline-none"
              />
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border-dark">
        <button
          onClick={() => {
            if (selectedObject) {
              removeObject(selectedObject.id)
            } else if (selectedPlacement) {
              removePlacement(selectedPlacement.id)
            }
          }}
          className="w-full py-2 px-4 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors flex items-center justify-center gap-2 text-sm"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>
    </div>
  )
}
