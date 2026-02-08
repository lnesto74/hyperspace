import { useState, useRef, useCallback } from 'react'
import { Upload, FileUp, AlertCircle } from 'lucide-react'

interface UploadCardProps {
  onUpload: (file: File) => Promise<void>
  dwgSupported?: boolean
}

export default function UploadCard({ onUpload, dwgSupported = false }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop()
    if (ext !== 'dxf' && ext !== 'dwg') {
      setError('Please upload a .dxf or .dwg file')
      return
    }

    setIsUploading(true)
    setError(null)
    try {
      await onUpload(file)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsUploading(false)
    }
  }, [onUpload])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFile(file)
    }
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFile(file)
    }
  }, [handleFile])

  return (
    <div className="max-w-lg w-full">
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
          transition-all duration-200
          ${isDragging 
            ? 'border-highlight bg-highlight/10' 
            : 'border-gray-600 hover:border-gray-500 hover:bg-gray-800/50'
          }
          ${isUploading ? 'pointer-events-none opacity-50' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf,.dwg"
          onChange={handleInputChange}
          className="hidden"
        />
        
        <div className="flex flex-col items-center gap-4">
          {isUploading ? (
            <>
              <div className="w-16 h-16 rounded-full bg-highlight/20 flex items-center justify-center">
                <FileUp className="w-8 h-8 text-highlight animate-pulse" />
              </div>
              <p className="text-white font-medium">Processing file...</p>
            </>
          ) : (
            <>
              <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
                isDragging ? 'bg-highlight/30' : 'bg-gray-700'
              }`}>
                <Upload className={`w-8 h-8 transition-colors ${isDragging ? 'text-highlight' : 'text-gray-400'}`} />
              </div>
              <div>
                <p className="text-white font-medium mb-1">
                  Drop your DXF file here
                </p>
                <p className="text-gray-500 text-sm">
                  or click to browse
                </p>
              </div>
              <p className="text-gray-600 text-xs">
                {dwgSupported 
                  ? 'Supports .dwg and .dxf files' 
                  : 'Supports .dxf files (DWG requires server-side converter)'}
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="mt-6 p-4 bg-gray-800/50 rounded-lg">
        <h3 className="text-sm font-medium text-white mb-2">Supported Entities</h3>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• <span className="text-gray-300">INSERT</span> - Block references (best for fixtures)</li>
          <li>• <span className="text-gray-300">LWPOLYLINE</span> - Closed polylines</li>
          <li>• <span className="text-gray-300">POLYLINE</span> - Closed polygons</li>
        </ul>
        <p className="text-xs text-gray-500 mt-2">
          Text, dimensions, and hatches are ignored by default.
        </p>
      </div>
    </div>
  )
}
