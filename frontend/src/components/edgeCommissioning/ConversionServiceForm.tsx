/**
 * ConversionServiceForm - DEB → Docker Conversion Service UI
 * 
 * Form for uploading .deb packages and building Docker-based Provider Modules.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Upload,
  Package,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  Info,
  Copy,
  FileCode,
  Cpu,
  X,
  Plus,
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

interface ConversionFormData {
  providerId: string
  displayName: string
  version: string
  supportedLidars: string[]
  requiresGpu: boolean
  runCommand: string[]
  ubuntuBase: '20.04' | '22.04'
  notes: string
  docsUrl: string
  website: string
  licenseMode: 'none' | 'env_var' | 'license_file' | 'online_activation'
  licenseEnvVarName: string
}

interface BuildStatus {
  id: string
  status: 'queued' | 'building' | 'pushing' | 'succeeded' | 'failed'
  logs: string
  dockerImageTag?: string
  dockerImageDigest?: string
  errorMessage?: string
}

const SUPPORTED_LIDARS = [
  'Livox LS',
  'Livox Mid-360',
  'Quanergy M8',
  'Quanergy S3',
  'RoboSense RS-LiDAR-16',
  'RoboSense RS-LiDAR-32',
  'Ouster OS1',
  'Velodyne VLP-16',
  'Hesai XT32',
]

interface ConversionServiceFormProps {
  onBuildComplete?: (providerId: string) => void
}

export default function ConversionServiceForm({ onBuildComplete }: ConversionServiceFormProps) {
  const [formData, setFormData] = useState<ConversionFormData>({
    providerId: '',
    displayName: '',
    version: '1.0.0',
    supportedLidars: [],
    requiresGpu: false,
    runCommand: ['/usr/bin/vendor_tracker'],
    ubuntuBase: '22.04',
    notes: '',
    docsUrl: '',
    website: '',
    licenseMode: 'none',
    licenseEnvVarName: '',
  })

  const [debFiles, setDebFiles] = useState<File[]>([])
  const [licenseFile, setLicenseFile] = useState<File | null>(null)
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null)
  const [isBuilding, setIsBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  // Poll for build status
  useEffect(() => {
    if (!buildStatus || !['queued', 'building', 'pushing'].includes(buildStatus.status)) {
      return
    }

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/algorithm-providers/conversion/builds/${buildStatus.id}`)
        if (res.ok) {
          const data = await res.json()
          setBuildStatus(data)
          
          if (data.status === 'succeeded') {
            setIsBuilding(false)
            onBuildComplete?.(data.providerId)
          } else if (data.status === 'failed') {
            setIsBuilding(false)
            setError(data.errorMessage || 'Build failed')
          }
        }
      } catch (err) {
        console.error('Failed to poll build status:', err)
      }
    }, 2000)

    return () => clearInterval(pollInterval)
  }, [buildStatus, onBuildComplete])

  const handleDebFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter(f => f.name.toLowerCase().endsWith('.deb'))
    setDebFiles(prev => [...prev, ...validFiles])
  }, [])

  const removeDebFile = useCallback((index: number) => {
    setDebFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleLicenseFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setLicenseFile(file)
    }
  }, [])

  const toggleLidar = useCallback((lidar: string) => {
    setFormData(prev => ({
      ...prev,
      supportedLidars: prev.supportedLidars.includes(lidar)
        ? prev.supportedLidars.filter(l => l !== lidar)
        : [...prev.supportedLidars, lidar],
    }))
  }, [])

  const addRunCommandArg = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      runCommand: [...prev.runCommand, ''],
    }))
  }, [])

  const updateRunCommandArg = useCallback((index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      runCommand: prev.runCommand.map((arg, i) => i === index ? value : arg),
    }))
  }, [])

  const removeRunCommandArg = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      runCommand: prev.runCommand.filter((_, i) => i !== index),
    }))
  }, [])

  const handleSubmit = async () => {
    setError(null)
    
    // Validate
    if (!formData.providerId) {
      setError('Provider ID is required')
      return
    }
    if (!formData.displayName) {
      setError('Display name is required')
      return
    }
    if (!formData.version) {
      setError('Version is required')
      return
    }
    if (debFiles.length === 0) {
      setError('At least one .deb file is required')
      return
    }
    if (formData.runCommand.length === 0 || !formData.runCommand[0]) {
      setError('Run command is required')
      return
    }
    if (formData.supportedLidars.length === 0) {
      setError('Select at least one supported LiDAR')
      return
    }

    setIsBuilding(true)

    try {
      const formDataObj = new FormData()
      
      // Add metadata as JSON
      formDataObj.append('metadata', JSON.stringify({
        providerId: formData.providerId.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        displayName: formData.displayName,
        version: formData.version,
        supportedLidars: formData.supportedLidars,
        requiresGpu: formData.requiresGpu,
        runCommand: formData.runCommand.filter(arg => arg.trim() !== ''),
        ubuntuBase: formData.ubuntuBase,
        notes: formData.notes,
        docsUrl: formData.docsUrl,
        website: formData.website,
        licenseMode: formData.licenseMode,
        licenseEnvVarName: formData.licenseEnvVarName,
      }))

      // Add .deb files
      for (const file of debFiles) {
        formDataObj.append('debFiles', file)
      }

      // Add license file if provided
      if (licenseFile && formData.licenseMode !== 'none') {
        formDataObj.append('licenseFile', licenseFile)
      }

      const res = await fetch(`${API_BASE}/api/algorithm-providers/conversion/build`, {
        method: 'POST',
        body: formDataObj,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start build')
      }

      const data = await res.json()
      setBuildStatus({
        id: data.buildId,
        status: 'queued',
        logs: '',
      })
      setShowLogs(true)

    } catch (err: any) {
      setError(err.message || 'Failed to start build')
      setIsBuilding(false)
    }
  }

  const copyDigest = () => {
    if (buildStatus?.dockerImageDigest) {
      navigator.clipboard.writeText(buildStatus.dockerImageDigest)
    }
  }

  return (
    <div className="space-y-6">
      {/* Info Panel */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-200">
            <p className="font-medium mb-2">Provider Module Requirements</p>
            <ul className="list-disc list-inside space-y-1 text-blue-300">
              <li>Publish MQTT messages to <code className="bg-blue-900/50 px-1 rounded">hyperspace/trajectories/{'{edgeId}'}</code> with QoS 1</li>
              <li>Positions in meters, venue frame (X-East, Y-Up, Z-North), origin at ROI SW corner</li>
              <li>One message per tracked object per frame</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Build Status */}
      {buildStatus && (
        <div className={`rounded-lg p-4 ${
          buildStatus.status === 'succeeded' ? 'bg-green-500/10 border border-green-500/30' :
          buildStatus.status === 'failed' ? 'bg-red-500/10 border border-red-500/30' :
          'bg-purple-500/10 border border-purple-500/30'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {buildStatus.status === 'succeeded' && <CheckCircle className="w-5 h-5 text-green-400" />}
              {buildStatus.status === 'failed' && <XCircle className="w-5 h-5 text-red-400" />}
              {['queued', 'building', 'pushing'].includes(buildStatus.status) && (
                <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
              )}
              <span className="font-medium text-white">
                {buildStatus.status === 'queued' && 'Build Queued...'}
                {buildStatus.status === 'building' && 'Building Docker Image...'}
                {buildStatus.status === 'pushing' && 'Pushing to Registry...'}
                {buildStatus.status === 'succeeded' && 'Build Succeeded!'}
                {buildStatus.status === 'failed' && 'Build Failed'}
              </span>
            </div>
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="text-sm text-gray-400 hover:text-white"
            >
              {showLogs ? 'Hide Logs' : 'Show Logs'}
            </button>
          </div>

          {buildStatus.status === 'succeeded' && buildStatus.dockerImageDigest && (
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 bg-gray-800 px-3 py-2 rounded text-xs text-gray-300 overflow-x-auto">
                {buildStatus.dockerImageDigest}
              </code>
              <button
                onClick={copyDigest}
                className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                title="Copy digest"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          )}

          {showLogs && buildStatus.logs && (
            <pre className="bg-gray-900 rounded p-3 text-xs text-gray-400 max-h-64 overflow-y-auto font-mono">
              {buildStatus.logs}
            </pre>
          )}

          {buildStatus.errorMessage && (
            <p className="text-red-400 text-sm mt-2">{buildStatus.errorMessage}</p>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        {/* Provider Identity */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Provider ID *</label>
            <input
              type="text"
              value={formData.providerId}
              onChange={(e) => setFormData(prev => ({ ...prev, providerId: e.target.value }))}
              placeholder="e.g., quanergy-tracker"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              disabled={isBuilding}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Display Name *</label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
              placeholder="e.g., Quanergy Tracker"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              disabled={isBuilding}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Version *</label>
            <input
              type="text"
              value={formData.version}
              onChange={(e) => setFormData(prev => ({ ...prev, version: e.target.value }))}
              placeholder="e.g., 1.0.0"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              disabled={isBuilding}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Ubuntu Base</label>
            <select
              value={formData.ubuntuBase}
              onChange={(e) => setFormData(prev => ({ ...prev, ubuntuBase: e.target.value as '20.04' | '22.04' }))}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              disabled={isBuilding}
            >
              <option value="22.04">Ubuntu 22.04 LTS</option>
              <option value="20.04">Ubuntu 20.04 LTS</option>
            </select>
          </div>
        </div>

        {/* .deb Files Upload */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            <Upload className="w-4 h-4 inline mr-1" />
            .deb Package Files *
          </label>
          <div className="border-2 border-dashed border-gray-600 rounded-lg p-4 hover:border-purple-500/50 transition-colors">
            <input
              type="file"
              accept=".deb"
              multiple
              onChange={handleDebFileChange}
              className="hidden"
              id="deb-upload"
              disabled={isBuilding}
            />
            <label
              htmlFor="deb-upload"
              className="flex flex-col items-center cursor-pointer"
            >
              <Package className="w-8 h-8 text-gray-500 mb-2" />
              <span className="text-sm text-gray-400">Click to upload .deb files</span>
              <span className="text-xs text-gray-500 mt-1">Max 500MB per file, up to 10 files</span>
            </label>
          </div>
          {debFiles.length > 0 && (
            <div className="mt-2 space-y-1">
              {debFiles.map((file, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                  <span className="text-sm text-gray-300">{file.name}</span>
                  <button
                    onClick={() => removeDebFile(i)}
                    className="text-gray-500 hover:text-red-400"
                    disabled={isBuilding}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Run Command */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            <FileCode className="w-4 h-4 inline mr-1" />
            Run Command (JSON array) *
          </label>
          <div className="space-y-2">
            {formData.runCommand.map((arg, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-6">[{i}]</span>
                <input
                  type="text"
                  value={arg}
                  onChange={(e) => updateRunCommandArg(i, e.target.value)}
                  placeholder={i === 0 ? '/usr/bin/executable' : '--flag value'}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
                  disabled={isBuilding}
                />
                {i > 0 && (
                  <button
                    onClick={() => removeRunCommandArg(i)}
                    className="p-2 text-gray-500 hover:text-red-400"
                    disabled={isBuilding}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addRunCommandArg}
              className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300"
              disabled={isBuilding}
            >
              <Plus className="w-4 h-4" />
              Add argument
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Environment variables available: $MQTT_BROKER, $MQTT_TOPIC, $EDGE_ID, $VENUE_ID, $CONFIG_FILE
          </p>
        </div>

        {/* Supported LiDARs */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Supported LiDARs *</label>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_LIDARS.map((lidar) => (
              <button
                key={lidar}
                onClick={() => toggleLidar(lidar)}
                disabled={isBuilding}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  formData.supportedLidars.includes(lidar)
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {lidar}
              </button>
            ))}
          </div>
        </div>

        {/* GPU Requirement */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.requiresGpu}
              onChange={(e) => setFormData(prev => ({ ...prev, requiresGpu: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500"
              disabled={isBuilding}
            />
            <Cpu className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-300">Requires GPU (NVIDIA CUDA)</span>
          </label>
        </div>

        {/* Optional Fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Documentation URL</label>
            <input
              type="url"
              value={formData.docsUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, docsUrl: e.target.value }))}
              placeholder="https://docs.example.com"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              disabled={isBuilding}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
              placeholder="https://example.com"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
              disabled={isBuilding}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Notes</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Additional notes about this provider..."
            rows={2}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm resize-none"
            disabled={isBuilding}
          />
        </div>

        {/* Build Button */}
        <button
          onClick={handleSubmit}
          disabled={isBuilding || debFiles.length === 0}
          className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
        >
          {isBuilding ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Building...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Build Provider Module
            </>
          )}
        </button>
      </div>
    </div>
  )
}
