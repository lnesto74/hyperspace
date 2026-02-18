import { useEffect, useState } from 'react'
import { Package, Cpu, Check, AlertTriangle, ChevronDown, Box, Download, ExternalLink, Wrench, Server } from 'lucide-react'
import { useEdgeCommissioning, AlgorithmProvider } from '../../context/EdgeCommissioningContext'
import ConversionServiceForm from './ConversionServiceForm'

interface ProviderSelectionPanelProps {
  disabled?: boolean
  mqttBrokerUrl: string
  onMqttBrokerUrlChange: (url: string) => void
}

type TabMode = 'select' | 'convert'

export default function ProviderSelectionPanel({ disabled = false, mqttBrokerUrl, onMqttBrokerUrlChange }: ProviderSelectionPanelProps) {
  const [tabMode, setTabMode] = useState<TabMode>('select')
  
  const {
    providers,
    selectedProviderId,
    isLoadingProviders,
    loadProviders,
    selectProvider,
    getSelectedProvider,
  } = useEdgeCommissioning()

  // Load providers on mount
  useEffect(() => {
    if (providers.length === 0) {
      loadProviders()
    }
  }, [providers.length, loadProviders])

  // Auto-select first provider if none selected
  useEffect(() => {
    if (providers.length > 0 && !selectedProviderId) {
      selectProvider(providers[0].providerId)
    }
  }, [providers, selectedProviderId, selectProvider])

  const selectedProvider = getSelectedProvider()

  const handleBuildComplete = () => {
    // Reload providers after build completes
    loadProviders()
    // Switch back to select tab
    setTabMode('select')
  }

  return (
    <div className="space-y-4">
      {/* Tab Selector */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
        <button
          onClick={() => setTabMode('select')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            tabMode === 'select'
              ? 'bg-purple-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <Box className="w-4 h-4" />
          Select Existing
        </button>
        <button
          onClick={() => setTabMode('convert')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            tabMode === 'convert'
              ? 'bg-purple-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <Wrench className="w-4 h-4" />
          Convert .deb
        </button>
      </div>

      {/* Tab Content */}
      {tabMode === 'select' ? (
        <>
          {/* Provider Dropdown */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Select Algorithm Provider</label>
            {isLoadingProviders ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <div className="w-4 h-4 border-2 border-gray-500 border-t-purple-500 rounded-full animate-spin" />
                Loading providers...
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedProviderId || ''}
                  onChange={(e) => selectProvider(e.target.value || null)}
                  disabled={disabled || providers.length === 0}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 pr-10 text-white appearance-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
                >
                  <option value="">Select a provider...</option>
                  {providers.map((provider) => (
                    <option key={provider.providerId} value={provider.providerId}>
                      {provider.name} v{provider.version}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Selected Provider Details */}
          {selectedProvider && (
            <ProviderDetails provider={selectedProvider} />
          )}

          {/* MQTT Broker Configuration */}
          <div className="bg-gray-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <Server className="w-4 h-4 text-blue-400" />
              <span className="font-medium">MQTT Broker (Main Server)</span>
            </div>
            <input
              type="text"
              value={mqttBrokerUrl}
              onChange={(e) => onMqttBrokerUrlChange(e.target.value)}
              placeholder="mqtt://100.110.178.91:1883"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500">
              The HER provider will publish trajectories to this MQTT broker. Use your Mac's Tailscale IP.
            </p>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 text-amber-400 text-sm bg-amber-500/10 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              HER deploy will stop the simulator and start the provider container.
              Real LiDAR data will be processed and published.
            </span>
          </div>
        </>
      ) : (
        <ConversionServiceForm onBuildComplete={handleBuildComplete} />
      )}
    </div>
  )
}

function ProviderDetails({ provider }: { provider: AlgorithmProvider }) {
  const isDocker = provider.packageType === 'docker'
  const isDeb = provider.packageType === 'deb'

  return (
    <div className="bg-gray-900/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-purple-400" />
          <span className="font-medium text-white">{provider.name}</span>
          <span className="text-gray-400 text-sm">v{provider.version}</span>
        </div>
        {/* Package Type Badge */}
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          isDocker ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
        }`}>
          {isDocker ? (
            <><Box className="w-3 h-3 inline mr-1" />Docker</>
          ) : (
            <><Download className="w-3 h-3 inline mr-1" />.deb</>
          )}
        </span>
      </div>

      <div className="grid gap-2 text-sm">
        {/* Package Source - Docker or .deb */}
        {isDocker && provider.dockerImage && (
          <div className="flex items-start gap-2">
            <span className="text-gray-400 w-20 flex-shrink-0">Image:</span>
            <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded text-xs break-all">
              {provider.dockerImage}
            </code>
          </div>
        )}

        {isDeb && provider.debPackage && (
          <>
            <div className="flex items-start gap-2">
              <span className="text-gray-400 w-20 flex-shrink-0">Package:</span>
              <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded text-xs">
                {provider.debPackage.packageName}
              </code>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-gray-400 w-20 flex-shrink-0">APT Repo:</span>
              <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded text-xs break-all">
                {provider.debPackage.aptRepo}
              </code>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-gray-400 w-20 flex-shrink-0">Service:</span>
              <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded text-xs">
                {provider.debPackage.serviceName}
              </code>
            </div>
          </>
        )}

        {/* Supported LiDARs */}
        <div className="flex items-start gap-2">
          <span className="text-gray-400 w-20 flex-shrink-0">LiDARs:</span>
          <div className="flex flex-wrap gap-1">
            {provider.supportedLidarModels.map((model) => (
              <span
                key={model}
                className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-xs"
              >
                {model}
              </span>
            ))}
          </div>
        </div>

        {/* GPU Requirement */}
        <div className="flex items-center gap-2">
          <span className="text-gray-400 w-20 flex-shrink-0">GPU:</span>
          <div className="flex items-center gap-1">
            {provider.requiresGpu ? (
              <>
                <Cpu className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400">Required (NVIDIA CUDA)</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-green-400">Not required (CPU only)</span>
              </>
            )}
          </div>
        </div>

        {/* Notes */}
        {provider.notes && (
          <div className="flex items-start gap-2">
            <span className="text-gray-400 w-20 flex-shrink-0">Notes:</span>
            <span className="text-gray-300">{provider.notes}</span>
          </div>
        )}

        {/* Documentation Link */}
        {provider.docsUrl && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 w-20 flex-shrink-0">Docs:</span>
            <a 
              href={provider.docsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 flex items-center gap-1"
            >
              {provider.docsUrl.replace(/^https?:\/\//, '')}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
