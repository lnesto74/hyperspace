import { useState, useRef, useEffect } from 'react'
import { Upload, Search, Filter, Package, Trash2, ChevronDown, GripVertical, HardDrive, Cloud, Link2, X, Folder, FileSpreadsheet, ArrowLeft, Loader2, Globe } from 'lucide-react'
import { usePlanogram } from '../../context/PlanogramContext'
import type { CatalogCrawlProgress } from '../../context/PlanogramContext'

// Google OAuth config - only needs Client ID
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

interface DriveItem {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
}

export default function SkuLibraryPanel() {
  const {
    catalogs,
    activeCatalog,
    loadCatalog,
    importCatalog,
    crawlCatalogFromWeb,
    deleteCatalog,
    filteredSkuItems,
    selectedSkuIds,
    toggleSkuSelection,
    setSelectedSkuIds,
    categoryFilter,
    setCategoryFilter,
    brandFilter,
    setBrandFilter,
    searchQuery,
    setSearchQuery,
    loading,
    placedSkuIds,
    removeSkuFromSlot,
    hoveredSkuId,
    setHoveredSkuId,
  } = usePlanogram()
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showImportMenu, setShowImportMenu] = useState(false)
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [showCrawlModal, setShowCrawlModal] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [crawlUrl, setCrawlUrl] = useState('https://spesaonline.esselunga.it/commerce/nav/supermercato/store')
  const [crawlName, setCrawlName] = useState('')
  const [crawlMode, setCrawlMode] = useState<'extract' | 'crawl'>('extract')
  const [crawlMaxPages, setCrawlMaxPages] = useState(10)
  const [crawlProgress, setCrawlProgress] = useState<CatalogCrawlProgress | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const importMenuRef = useRef<HTMLDivElement>(null)
  
  // Google Drive browser state
  const [showDriveModal, setShowDriveModal] = useState(false)
  const [driveToken, setDriveToken] = useState<string | null>(null)
  const [driveItems, setDriveItems] = useState<DriveItem[]>([])
  const [drivePath, setDrivePath] = useState<{id: string, name: string}[]>([])
  const [driveLoading, setDriveLoading] = useState(false)
  
  // Close import menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Load folder contents from Google Drive
  const loadDriveFolder = async (folderId: string | null, token: string) => {
    setDriveLoading(true)
    try {
      // Build query - show folder contents
      const parentId = folderId || 'root'
      const query = `'${parentId}' in parents and trashed=false`
      
      const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
        q: query,
        orderBy: 'folder,name',
        pageSize: '100',
        fields: 'files(id,name,mimeType,modifiedTime)',
        // Include files from shared drives
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true'
      })
      
      console.log('Fetching Drive files:', url)
      
      const listRes = await fetch(url, { 
        headers: { Authorization: `Bearer ${token}` } 
      })
      const listData = await listRes.json()
      
      console.log('Drive API response:', listData)
      
      if (listData.error) {
        console.error('Drive API error:', listData.error)
        alert(`Google Drive error: ${listData.error.message}`)
        setDriveLoading(false)
        return
      }
      
      // Filter to show folders and spreadsheet files
      const items = (listData.files || []).filter((f: DriveItem) => 
        f.mimeType === 'application/vnd.google-apps.folder' ||
        f.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        f.mimeType === 'application/vnd.ms-excel' ||
        f.mimeType === 'application/vnd.google-apps.spreadsheet' ||
        f.mimeType === 'text/csv' ||
        f.name.endsWith('.xlsx') ||
        f.name.endsWith('.xls') ||
        f.name.endsWith('.csv')
      )
      
      console.log('Filtered items:', items.length, 'of', listData.files?.length)
      
      setDriveItems(items)
    } catch (err) {
      console.error('Failed to load Drive folder:', err)
      alert('Failed to load Google Drive folder')
    }
    setDriveLoading(false)
  }
  
  // Handle clicking a Drive item (folder or file)
  const handleDriveItemClick = async (item: DriveItem) => {
    if (!driveToken) return
    
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      // Navigate into folder
      setDrivePath([...drivePath, { id: item.id, name: item.name }])
      await loadDriveFolder(item.id, driveToken)
    } else {
      // Download and import file
      setDriveLoading(true)
      try {
        let downloadUrl: string
        let fileName = item.name
        
        // Google Sheets native files need to be EXPORTED, not downloaded
        if (item.mimeType === 'application/vnd.google-apps.spreadsheet') {
          // Export as xlsx
          downloadUrl = `https://www.googleapis.com/drive/v3/files/${item.id}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
          if (!fileName.endsWith('.xlsx')) fileName += '.xlsx'
        } else {
          // Regular file - download directly
          downloadUrl = `https://www.googleapis.com/drive/v3/files/${item.id}?alt=media`
        }
        
        const fileRes = await fetch(downloadUrl, { 
          headers: { Authorization: `Bearer ${driveToken}` } 
        })
        
        if (!fileRes.ok) {
          const errorText = await fileRes.text()
          console.error('Drive download error:', errorText)
          throw new Error(`Download failed: ${fileRes.status}`)
        }
        
        const blob = await fileRes.blob()
        const file = new File([blob], fileName, { type: blob.type })
        await importCatalog(file)
        setShowDriveModal(false)
        setDriveToken(null)
        setDriveItems([])
        setDrivePath([])
      } catch (err) {
        console.error('Failed to download file:', err)
        alert('Failed to download file from Google Drive')
      }
      setDriveLoading(false)
    }
  }
  
  // Navigate back in Drive folder path
  const handleDriveBack = async () => {
    if (!driveToken || drivePath.length === 0) return
    
    const newPath = drivePath.slice(0, -1)
    setDrivePath(newPath)
    const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : null
    await loadDriveFolder(parentId, driveToken)
  }
  
  // Google Drive - uses simple OAuth popup flow
  const handleGoogleDriveConnect = async () => {
    setShowImportMenu(false)
    
    if (!GOOGLE_CLIENT_ID) {
      alert('Google Drive not configured. Add VITE_GOOGLE_CLIENT_ID to your .env file.\n\nGet it from: console.cloud.google.com → APIs & Services → Credentials → Create OAuth Client ID')
      return
    }
    
    // Load Google Identity Services
    const loadGIS = () => new Promise<void>((resolve, reject) => {
      if ((window as any).google?.accounts) {
        resolve()
        return
      }
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
      document.body.appendChild(script)
    })
    
    try {
      await loadGIS()
      
      const google = (window as any).google
      
      // Request OAuth token with Drive scope
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: async (response: any) => {
          if (response.error) {
            console.error('OAuth error:', response)
            return
          }
          
          const accessToken = response.access_token
          setDriveToken(accessToken)
          setShowDriveModal(true)
          setDrivePath([])
          await loadDriveFolder(null, accessToken)
        }
      })
      
      // This opens the Google sign-in popup
      tokenClient.requestAccessToken()
      
    } catch (err) {
      console.error('Google Drive error:', err)
      alert('Failed to connect to Google Drive')
    }
  }
  
  // Import from URL
  const handleUrlImport = async () => {
    if (!importUrl.trim()) return
    
    setImportLoading(true)
    try {
      const response = await fetch(importUrl)
      if (!response.ok) throw new Error('Failed to fetch file')
      
      const blob = await response.blob()
      const fileName = importUrl.split('/').pop() || 'imported.xlsx'
      const file = new File([blob], fileName, { type: blob.type })
      await importCatalog(file)
      setShowUrlModal(false)
      setImportUrl('')
    } catch (err) {
      console.error('URL import failed:', err)
      alert('Failed to import from URL. Make sure the URL is accessible and points to an Excel or CSV file.')
    }
    setImportLoading(false)
  }

  const resetCrawlModal = () => {
    setShowCrawlModal(false)
    setCrawlProgress(null)
    setImportLoading(false)
  }

  const handleWebCrawl = async () => {
    if (!crawlUrl.trim()) return

    setImportLoading(true)
    setCrawlProgress({
      status: 'running',
      progress: { finished: 0, total: 0, message: 'Starting ScrapeGraphAI…' },
    })

    try {
      const result = await crawlCatalogFromWeb({
        url: crawlUrl.trim(),
        name: crawlName.trim() || undefined,
        mode: crawlMode,
        maxPages: crawlMode === 'crawl' ? crawlMaxPages : undefined,
        onProgress: setCrawlProgress,
      })
      setCrawlProgress({
        status: 'completed',
        progress: {
          finished: 1,
          total: 1,
          message: `Imported ${result.itemCount} products`,
        },
        itemCount: result.itemCount,
        catalogId: result.catalogId,
      })
      setTimeout(resetCrawlModal, 1200)
    } catch (err) {
      console.error('Web crawl failed:', err)
      setCrawlProgress((prev) => ({
        status: 'failed',
        progress: prev?.progress || { finished: 0, total: 0, message: 'Failed' },
        error: err instanceof Error ? err.message : 'Crawl failed',
      }))
      setImportLoading(false)
    }
  }
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    try {
      await importCatalog(file)
    } catch (err) {
      console.error('Import failed:', err)
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  
  const handleDragStart = (e: React.DragEvent, skuId: string) => {
    // Get selected IDs but filter out already placed SKUs
    let ids = selectedSkuIds.includes(skuId) ? selectedSkuIds : [skuId]
    ids = ids.filter(id => !placedSkuIds.has(id))
    
    if (ids.length === 0) {
      e.preventDefault()
      return
    }
    
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'sku-items',
      skuItemIds: ids,
    }))
    e.dataTransfer.effectAllowed = 'copy'
    
    // Create custom drag image showing count
    if (ids.length > 1) {
      const dragEl = document.createElement('div')
      dragEl.className = 'bg-amber-600 text-white px-3 py-2 rounded-lg shadow-xl text-sm font-medium'
      dragEl.textContent = `${ids.length} items`
      dragEl.style.position = 'absolute'
      dragEl.style.top = '-1000px'
      document.body.appendChild(dragEl)
      e.dataTransfer.setDragImage(dragEl, 40, 20)
      setTimeout(() => document.body.removeChild(dragEl), 0)
    }
  }
  
  const handleSelectAll = () => {
    if (selectedSkuIds.length === filteredSkuItems.length) {
      setSelectedSkuIds([])
    } else {
      setSelectedSkuIds(filteredSkuItems.map(i => i.id))
    }
  }
  
  return (
    <div className="w-72 bg-panel-bg border-r border-border-dark flex flex-col h-full">
      {/* Spreadsheet URL Import Modal (unchanged — direct file download) */}
      {showUrlModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-96 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Import spreadsheet from URL</h3>
              <button
                onClick={() => { setShowUrlModal(false); setImportUrl('') }}
                className="p-1 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://example.com/catalog.xlsx"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowUrlModal(false); setImportUrl('') }}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleUrlImport}
                disabled={!importUrl.trim() || importLoading}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 rounded text-sm text-white"
              >
                {importLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ScrapeGraphAI Web Crawl Modal */}
      {showCrawlModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-[440px] border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Crawl website (ScrapeGraphAI)</h3>
              </div>
              <button
                onClick={resetCrawlModal}
                className="p-1 text-gray-400 hover:text-white"
                disabled={importLoading && crawlProgress?.status === 'running'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-3">
              Extract grocery products from a store URL. Powered by{' '}
              <a href="https://scrapegraphai.com/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                ScrapeGraphAI
              </a>{' '}
              (free tier: 500 credits).
            </p>

            <label className="text-xs text-gray-400 block mb-1">Store / category URL</label>
            <input
              type="text"
              value={crawlUrl}
              onChange={(e) => setCrawlUrl(e.target.value)}
              placeholder="https://spesaonline.esselunga.it/..."
              disabled={importLoading}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 mb-3 disabled:opacity-60"
            />

            <label className="text-xs text-gray-400 block mb-1">Catalog name (optional)</label>
            <input
              type="text"
              value={crawlName}
              onChange={(e) => setCrawlName(e.target.value)}
              placeholder="Esselunga Store"
              disabled={importLoading}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 mb-3 disabled:opacity-60"
            />

            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setCrawlMode('extract')}
                disabled={importLoading}
                className={`flex-1 px-2 py-1.5 rounded text-xs border ${
                  crawlMode === 'extract'
                    ? 'bg-emerald-700 border-emerald-500 text-white'
                    : 'bg-gray-900 border-gray-600 text-gray-300'
                }`}
              >
                Single page
                <span className="block text-[10px] opacity-70">~10 credits</span>
              </button>
              <button
                type="button"
                onClick={() => setCrawlMode('crawl')}
                disabled={importLoading}
                className={`flex-1 px-2 py-1.5 rounded text-xs border ${
                  crawlMode === 'crawl'
                    ? 'bg-emerald-700 border-emerald-500 text-white'
                    : 'bg-gray-900 border-gray-600 text-gray-300'
                }`}
              >
                Multi-page crawl
                <span className="block text-[10px] opacity-70">more products</span>
              </button>
            </div>

            {crawlMode === 'crawl' && (
              <div className="mb-3">
                <label className="text-xs text-gray-400 block mb-1">Max pages: {crawlMaxPages}</label>
                <input
                  type="range"
                  min={3}
                  max={30}
                  value={crawlMaxPages}
                  onChange={(e) => setCrawlMaxPages(Number(e.target.value))}
                  disabled={importLoading}
                  className="w-full"
                />
              </div>
            )}

            {crawlProgress && (
              <div className="mb-3 p-2 bg-gray-900 rounded border border-gray-700">
                <div className="flex items-center gap-2 text-xs text-gray-300 mb-1">
                  {(crawlProgress.status === 'running' || crawlProgress.status === 'queued') && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  )}
                  <span>{crawlProgress.progress.message}</span>
                </div>
                {crawlProgress.progress.total > 0 && (
                  <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (crawlProgress.progress.finished / crawlProgress.progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                {crawlProgress.error && (
                  <p className="text-xs text-red-400 mt-2">{crawlProgress.error}</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={resetCrawlModal}
                disabled={importLoading && crawlProgress?.status === 'running'}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleWebCrawl}
                disabled={!crawlUrl.trim() || importLoading}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 rounded text-sm text-white flex items-center gap-1.5"
              >
                {importLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Crawling…
                  </>
                ) : (
                  'Start crawl'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Google Drive Browser Modal */}
      {showDriveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg w-[500px] max-h-[70vh] border border-gray-700 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Google Drive</h3>
              </div>
              <button
                onClick={() => {
                  setShowDriveModal(false)
                  setDriveToken(null)
                  setDriveItems([])
                  setDrivePath([])
                }}
                className="p-1 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Breadcrumb path */}
            <div className="flex items-center gap-1 px-3 py-2 bg-gray-900/50 text-xs">
              <button
                onClick={() => {
                  setDrivePath([])
                  driveToken && loadDriveFolder(null, driveToken)
                }}
                className="text-blue-400 hover:text-blue-300"
              >
                My Drive
              </button>
              {drivePath.map((folder, idx) => (
                <span key={folder.id} className="flex items-center gap-1">
                  <span className="text-gray-500">/</span>
                  <button
                    onClick={async () => {
                      const newPath = drivePath.slice(0, idx + 1)
                      setDrivePath(newPath)
                      driveToken && await loadDriveFolder(folder.id, driveToken)
                    }}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>
            
            {/* Back button */}
            {drivePath.length > 0 && (
              <button
                onClick={handleDriveBack}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700/50"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}
            
            {/* File/Folder list */}
            <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px]">
              {driveLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                </div>
              ) : driveItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm">
                  <Folder className="w-8 h-8 mb-2 opacity-50" />
                  No folders or Excel/CSV files here
                </div>
              ) : (
                <div className="p-2">
                  {driveItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleDriveItemClick(item)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-700/50 text-left"
                    >
                      {item.mimeType === 'application/vnd.google-apps.folder' ? (
                        <Folder className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                      ) : (
                        <FileSpreadsheet className="w-5 h-5 text-green-500 flex-shrink-0" />
                      )}
                      <span className="text-sm text-white truncate flex-1">{item.name}</span>
                      {item.mimeType !== 'application/vnd.google-apps.folder' && (
                        <span className="text-xs text-gray-500">Click to import</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="px-3 py-2 border-t border-gray-700 text-xs text-gray-500">
              Click a folder to open it, or click a file to import
            </div>
          </div>
        </div>
      )}
      
      {/* Header */}
      <div className="p-3 border-b border-border-dark">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Package className="w-4 h-4 text-amber-500" />
            SKU Library
          </h2>
          
          {/* Import dropdown */}
          <div className="relative" ref={importMenuRef}>
            <button
              onClick={() => setShowImportMenu(!showImportMenu)}
              className="flex items-center gap-1 p-1.5 bg-amber-600 hover:bg-amber-700 rounded text-white transition-colors"
              title="Import catalog"
            >
              <Upload className="w-3.5 h-3.5" />
              <ChevronDown className="w-3 h-3" />
            </button>
            
            {showImportMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1">
                <button
                  onClick={() => {
                    setShowImportMenu(false)
                    fileInputRef.current?.click()
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700 text-left"
                >
                  <HardDrive className="w-4 h-4 text-gray-400" />
                  Upload from Device
                </button>
                <button
                  onClick={handleGoogleDriveConnect}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700 text-left"
                >
                  <Cloud className="w-4 h-4 text-blue-400" />
                  Google Drive
                </button>
                <button
                  onClick={() => {
                    setShowImportMenu(false)
                    setShowUrlModal(true)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700 text-left"
                >
                  <Link2 className="w-4 h-4 text-green-400" />
                  Spreadsheet URL
                </button>
                <button
                  onClick={() => {
                    setShowImportMenu(false)
                    setShowCrawlModal(true)
                    setCrawlProgress(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700 text-left"
                >
                  <Globe className="w-4 h-4 text-emerald-400" />
                  Crawl website
                </button>
              </div>
            )}
          </div>
          
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
        
        {/* Catalog selector */}
        <select
          value={activeCatalog?.id || ''}
          onChange={(e) => e.target.value && loadCatalog(e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white"
        >
          <option value="">Select catalog...</option>
          {catalogs.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>
      
      {/* Search & Filters */}
      {activeCatalog && (
        <div className="p-2 border-b border-border-dark space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search SKUs..."
              className="w-full pl-8 pr-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-white placeholder-gray-500"
            />
          </div>
          
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <Filter className="w-3 h-3" />
            Filters
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          
          {showFilters && (
            <div className="space-y-2">
              <select
                value={categoryFilter || ''}
                onChange={(e) => setCategoryFilter(e.target.value || null)}
                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
              >
                <option value="">All Categories</option>
                {activeCatalog.categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              
              <select
                value={brandFilter || ''}
                onChange={(e) => setBrandFilter(e.target.value || null)}
                className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white"
              >
                <option value="">All Brands</option>
                {activeCatalog.brands.map(brand => (
                  <option key={brand} value={brand}>{brand}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      
      {/* Selection controls */}
      {activeCatalog && filteredSkuItems.length > 0 && (
        <div className="px-2 py-1.5 border-b border-border-dark flex items-center justify-between">
          <button
            onClick={handleSelectAll}
            className="text-[10px] text-amber-500 hover:text-amber-400"
          >
            {selectedSkuIds.length === filteredSkuItems.length ? 'Deselect All' : 'Select All'}
          </button>
          {selectedSkuIds.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-400 font-medium">
                {selectedSkuIds.length} selected
              </span>
              <span className="text-[9px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                Drag to place
              </span>
            </div>
          ) : (
            <span className="text-[10px] text-gray-500">
              Click items to select
            </span>
          )}
        </div>
      )}
      
      {/* SKU List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            Loading...
          </div>
        ) : !activeCatalog ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-xs p-4 text-center">
            <Package className="w-8 h-8 mb-2 opacity-50" />
            Select or import a catalog to view SKUs
          </div>
        ) : filteredSkuItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-xs">
            No SKUs match filters
          </div>
        ) : (
          <div className="p-1">
            {filteredSkuItems.map(item => {
              const isPlaced = placedSkuIds.has(item.id)
              const isSelected = selectedSkuIds.includes(item.id)
              
              return (
                <div
                  key={item.id}
                  draggable={!isPlaced}
                  onDragStart={(e) => !isPlaced && handleDragStart(e, item.id)}
                  onClick={() => !isPlaced && toggleSkuSelection(item.id)}
                  onMouseEnter={() => setHoveredSkuId(item.id)}
                  onMouseLeave={() => setHoveredSkuId(null)}
                  className={`
                    flex items-center gap-2 p-2 rounded mb-1 transition-all relative
                    ${hoveredSkuId === item.id 
                      ? 'bg-orange-600/30 border-2 border-orange-500 ring-2 ring-orange-500/30 scale-[1.02]'
                      : isPlaced 
                        ? 'bg-green-900/20 border border-green-600/30 cursor-default opacity-70' 
                        : isSelected 
                          ? 'bg-amber-600/20 border border-amber-600/50 cursor-pointer' 
                          : 'bg-gray-800/50 border border-transparent hover:bg-gray-700/50 cursor-pointer'
                    }
                  `}
                >
                  {isPlaced ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeSkuFromSlot(item.id)
                      }}
                      className="w-4 h-4 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded flex-shrink-0"
                      title="Remove from shelf"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : (
                    <GripVertical className="w-3 h-3 text-gray-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] font-mono ${isPlaced ? 'text-green-400' : 'text-amber-400'}`}>
                        {item.skuCode}
                      </span>
                      {isPlaced && (
                        <span className="text-[8px] bg-green-600/30 text-green-300 px-1 rounded">
                          PLACED
                        </span>
                      )}
                    </div>
                    <div className={`text-xs truncate ${isPlaced ? 'text-gray-400' : 'text-white'}`}>
                      {item.name}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500">
                      {item.brand && <span>{item.brand}</span>}
                      {item.brand && item.size && <span>•</span>}
                      {item.size && <span>{item.size}</span>}
                    </div>
                    {item.category && (
                      <div className="text-[10px] text-gray-400">{item.category} {item.subcategory && `› ${item.subcategory}`}</div>
                    )}
                  </div>
                  {item.price && (
                    <div className="text-[10px] text-green-500 flex-shrink-0">
                      ${item.price.toFixed(2)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Footer with catalog info */}
      {activeCatalog && (
        <div className="p-2 border-t border-border-dark flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-gray-500">{filteredSkuItems.length} of {activeCatalog.items.length} items</span>
            {placedSkuIds.size > 0 && (
              <span className="text-green-400">{placedSkuIds.size} placed</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-600">
              {filteredSkuItems.filter(i => !placedSkuIds.has(i.id)).length} available
            </span>
            <button
              onClick={() => deleteCatalog(activeCatalog.id)}
              className="p-1 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded"
              title="Delete catalog"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
