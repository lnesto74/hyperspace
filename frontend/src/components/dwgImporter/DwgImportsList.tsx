import { useState, useEffect } from 'react'
import { FileUp, Folder, Clock, CheckCircle2, AlertCircle, Trash2, Pencil, Check, X } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface DwgImportItem {
  import_id: string
  filename: string
  units: string
  status: string
  created_at: string
  layout_count?: number
}

interface DwgImportsListProps {
  onSelectImport: (importId: string) => void
  onUploadNew: () => void
  dwgSupported: boolean
}

export default function DwgImportsList({ onSelectImport, onUploadNew, dwgSupported }: DwgImportsListProps) {
  const [imports, setImports] = useState<DwgImportItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  useEffect(() => {
    const fetchImports = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dwg/imports`)
        if (res.ok) {
          const data = await res.json()
          setImports(data)
        } else {
          setError('Failed to load imports')
        }
      } catch (err) {
        setError('Failed to connect to server')
      } finally {
        setIsLoading(false)
      }
    }
    fetchImports()
  }, [])

  const handleDelete = async (importId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this DWG import and all its layouts?')) return
    
    try {
      const res = await fetch(`${API_BASE}/api/dwg/import/${importId}`, { method: 'DELETE' })
      if (res.ok) {
        setImports(prev => prev.filter(i => i.import_id !== importId))
      }
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const startEditing = (importId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(importId)
    setEditingName(currentName)
  }

  const saveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editingId || !editingName.trim()) {
      cancelEdit()
      return
    }
    
    try {
      const res = await fetch(`${API_BASE}/api/dwg/import/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: editingName.trim() })
      })
      if (res.ok) {
        setImports(prev => prev.map(i => 
          i.import_id === editingId ? { ...i, filename: editingName.trim() } : i
        ))
      }
    } catch (err) {
      console.error('Failed to update name:', err)
    }
    cancelEdit()
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingName('')
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">DWG Importer</h1>
        <p className="text-gray-400">
          Import DWG/DXF floor plans and convert them to 3D layouts
        </p>
      </div>

      {/* Upload New Card */}
      <div 
        onClick={onUploadNew}
        className="mb-6 p-6 border-2 border-dashed border-gray-700 rounded-xl hover:border-highlight hover:bg-highlight/5 cursor-pointer transition-all group"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gray-800 group-hover:bg-highlight/20 flex items-center justify-center transition-colors">
            <FileUp className="w-7 h-7 text-gray-400 group-hover:text-highlight" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-white group-hover:text-highlight transition-colors">
              Upload New DWG/DXF
            </h3>
            <p className="text-sm text-gray-500">
              {dwgSupported 
                ? 'Supports .dwg and .dxf files' 
                : 'Supports .dxf files (install LibreDWG for .dwg)'}
            </p>
          </div>
        </div>
      </div>

      {/* Previous Imports */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
          Previous Imports
        </h2>
        <span className="text-xs text-gray-500">{imports.length} files</span>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : error ? (
        <div className="text-center py-12 text-red-400">{error}</div>
      ) : imports.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Folder className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No DWG files imported yet</p>
          <p className="text-sm mt-1">Upload your first file to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {imports.map(item => (
            <div
              key={item.import_id}
              onClick={() => onSelectImport(item.import_id)}
              className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg hover:bg-gray-800 hover:border-gray-600 cursor-pointer transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center">
                  <Folder className="w-5 h-5 text-gray-400" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {editingId === item.import_id ? (
                      <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(e as unknown as React.MouseEvent)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          className="flex-1 px-2 py-1 bg-gray-900 border border-highlight rounded text-sm text-white focus:outline-none"
                          autoFocus
                        />
                        <button
                          onClick={saveEdit}
                          className="p-1.5 hover:bg-green-900/50 rounded text-green-400"
                          title="Save"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelEdit() }}
                          className="p-1.5 hover:bg-red-900/50 rounded text-red-400"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-sm font-medium text-white truncate">
                          {item.filename}
                        </h3>
                        <button
                          onClick={(e) => startEditing(item.import_id, item.filename, e)}
                          className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Edit name"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    {editingId !== item.import_id && item.status === 'generated' && (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <CheckCircle2 className="w-3 h-3" />
                        Layout Ready
                      </span>
                    )}
                    {editingId !== item.import_id && item.status === 'imported' && (
                      <span className="flex items-center gap-1 text-xs text-amber-400">
                        <AlertCircle className="w-3 h-3" />
                        Needs Mapping
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(item.created_at)}
                    </span>
                    <span>Units: {item.units}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleDelete(item.import_id, e)}
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
