import { useState, useEffect, useCallback } from 'react'
import { 
  Radio, Check, X, AlertCircle, RefreshCw, Loader2, 
  ArrowRight, CheckCircle2, Cable, Wifi, Edit3
} from 'lucide-react'

interface CommissionedLidar {
  id?: string
  lidarId: string
  assignedIp: string
  label: string
  status: 'pending' | 'configuring' | 'rebooting' | 'verifying' | 'done' | 'failed'
  commissionedAt?: string
  error?: string
}

interface LidarCommissioningWizardProps {
  venueId: string
  edgeId: string
  edgeTailscaleIp: string
  edgeHostname: string
  totalPlacements: number
  onClose: () => void
  onComplete: () => void
}

type WizardStep = 'intro' | 'waiting' | 'scanning' | 'found' | 'configuring' | 'rebooting' | 'verifying' | 'done' | 'complete'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const DEFAULT_LIDAR_IP = '192.168.1.200'
const IP_START = 201

export default function LidarCommissioningWizard({
  venueId,
  edgeId,
  edgeTailscaleIp,
  edgeHostname,
  totalPlacements,
  onClose,
  onComplete,
}: LidarCommissioningWizardProps) {
  const [step, setStep] = useState<WizardStep>('intro')
  const [commissionedLidars, setCommissionedLidars] = useState<CommissionedLidar[]>([])
  const [currentLidarNumber, setCurrentLidarNumber] = useState(1)
  const [currentIp, setCurrentIp] = useState<string | null>(null)
  const [targetIp, setTargetIp] = useState<string>(DEFAULT_LIDAR_IP) // For manual IP entry
  const [nextAvailableIp, setNextAvailableIp] = useState<string>('192.168.1.201')
  const [error, setError] = useState<string | null>(null)
  const [scanAttempts, setScanAttempts] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [showManualIp, setShowManualIp] = useState(false)

  const progress = (commissionedLidars.length / totalPlacements) * 100
  const isComplete = commissionedLidars.length >= totalPlacements

  // Load existing commissioned LiDARs and next available IP on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load existing commissioned LiDARs
        const lidarsRes = await fetch(`${API_BASE}/api/edge-commissioning/commissioned-lidars?venueId=${venueId}&edgeId=${edgeId}`)
        const lidarsData = await lidarsRes.json()
        
        if (lidarsData.lidars) {
          const existing = lidarsData.lidars.map((l: any) => ({
            id: l.id,
            lidarId: `lidar-${l.assignedIp.replace(/\./g, '-')}`,
            assignedIp: l.assignedIp,
            label: l.label || `LiDAR-${l.assignedIp.split('.').pop()}`,
            status: 'done' as const,
            commissionedAt: l.commissionedAt,
          }))
          setCommissionedLidars(existing)
          setCurrentLidarNumber(existing.length + 1)
        }

        // Get next available IP
        const ipRes = await fetch(`${API_BASE}/api/edge-commissioning/next-available-ip?venueId=${venueId}`)
        const ipData = await ipRes.json()
        if (ipData.nextIp) {
          setNextAvailableIp(ipData.nextIp)
        }
      } catch (err) {
        console.error('Failed to load commissioned lidars:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [venueId, edgeId])

  // Scan for LiDAR at target IP
  const scanForLidar = useCallback(async () => {
    setStep('scanning')
    setError(null)
    setScanAttempts(prev => prev + 1)

    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/proxy-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edgeId,
          tailscaleIp: edgeTailscaleIp,
          targetIps: [targetIp],
        }),
      })

      const data = await res.json()

      if (data.ok && data.foundCount > 0) {
        const foundLidar = data.lidars.find((l: any) => l.ip === targetIp)
        if (foundLidar) {
          setCurrentIp(targetIp)
          setStep('found')
          return
        }
      }

      // Not found
      setStep('waiting')
      if (scanAttempts >= 2) {
        setError(`No LiDAR found at ${targetIp}. Make sure the LiDAR is connected and powered on.`)
      }
    } catch (err: any) {
      setError(`Scan failed: ${err.message}`)
      setStep('waiting')
    }
  }, [edgeId, edgeTailscaleIp, targetIp, scanAttempts])

  // Save commissioned LiDAR to database
  const saveCommissionedLidar = async (assignedIp: string, label: string) => {
    try {
      await fetch(`${API_BASE}/api/edge-commissioning/commissioned-lidars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId,
          edgeId,
          assignedIp,
          label,
          originalIp: currentIp,
          vendor: 'RoboSense',
        }),
      })
    } catch (err) {
      console.error('Failed to save commissioned lidar:', err)
    }
  }

  // Refresh next available IP
  const refreshNextIp = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/next-available-ip?venueId=${venueId}`)
      const data = await res.json()
      if (data.nextIp) {
        setNextAvailableIp(data.nextIp)
      }
    } catch (err) {
      console.error('Failed to get next IP:', err)
    }
  }

  // Configure LiDAR with new IP
  const configureLidar = async () => {
    if (!currentIp) return

    setStep('configuring')
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/proxy-set-ip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edgeId,
          tailscaleIp: edgeTailscaleIp,
          currentIp: currentIp,
          newIp: nextAvailableIp,
        }),
      })

      const data = await res.json()

      if (data.success) {
        setStep('rebooting')
        // Wait for LiDAR to reboot
        setTimeout(() => verifyNewIp(), 15000)
      } else {
        setError(data.message || 'Failed to configure LiDAR')
        setStep('found')
      }
    } catch (err: any) {
      setError(`Configuration failed: ${err.message}`)
      setStep('found')
    }
  }

  // Verify LiDAR is reachable at new IP
  const verifyNewIp = async () => {
    setStep('verifying')

    try {
      const res = await fetch(`${API_BASE}/api/edge-commissioning/proxy-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edgeId,
          tailscaleIp: edgeTailscaleIp,
          targetIps: [nextAvailableIp],
        }),
      })

      const data = await res.json()

      if (data.ok && data.foundCount > 0) {
        // Success! Add to commissioned list and save to database
        const label = `LiDAR-${nextAvailableIp.split('.').pop()}`
        const newLidar: CommissionedLidar = {
          lidarId: `lidar-${nextAvailableIp.replace(/\./g, '-')}`,
          assignedIp: nextAvailableIp,
          label,
          status: 'done',
        }

        await saveCommissionedLidar(nextAvailableIp, label)
        setCommissionedLidars(prev => [...prev, newLidar])
        setCurrentLidarNumber(prev => prev + 1)
        setCurrentIp(null)
        setTargetIp(DEFAULT_LIDAR_IP) // Reset to default for next LiDAR
        setStep('done')
        setScanAttempts(0)
        await refreshNextIp()
      } else {
        // Retry verification
        setTimeout(() => verifyNewIp(), 5000)
      }
    } catch (err: any) {
      // Retry on network error
      setTimeout(() => verifyNewIp(), 5000)
    }
  }

  // Continue to next LiDAR
  const continueToNext = () => {
    if (isComplete) {
      setStep('complete')
    } else {
      setStep('waiting')
      setScanAttempts(0)
    }
  }

  // Finish wizard
  const finishWizard = () => {
    onComplete()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">LiDAR Commissioning Wizard</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="text-sm text-gray-400 mt-1">
            Edge: {edgeHostname} • {totalPlacements} LiDARs needed
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{commissionedLidars.length} of {totalPlacements} commissioned</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'intro' && (
            <div className="text-center">
              {isLoading ? (
                <>
                  <Loader2 className="w-12 h-12 mx-auto text-blue-400 animate-spin mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">Loading...</h3>
                  <p className="text-gray-400 text-sm">Fetching commissioned LiDARs...</p>
                </>
              ) : (
                <>
                  <Radio className="w-12 h-12 mx-auto text-blue-400 mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">
                    {commissionedLidars.length > 0 ? 'Continue Commissioning' : 'Ready to Commission LiDARs'}
                  </h3>
                  <p className="text-gray-400 text-sm mb-4">
                    {commissionedLidars.length > 0 
                      ? `${commissionedLidars.length} LiDARs already commissioned. ${totalPlacements - commissionedLidars.length} remaining.`
                      : `This wizard will guide you through configuring ${totalPlacements} LiDARs.`
                    }
                  </p>

                  {/* Show already commissioned LiDARs */}
                  {commissionedLidars.length > 0 && (
                    <div className="bg-gray-700/50 rounded-lg p-3 mb-4 max-h-32 overflow-auto text-left">
                      <div className="text-xs text-gray-400 mb-2">Already Commissioned:</div>
                      <div className="space-y-1">
                        {commissionedLidars.map((lidar) => (
                          <div key={lidar.assignedIp} className="flex items-center justify-between text-sm">
                            <span className="font-mono text-green-400">{lidar.assignedIp}</span>
                            <span className="text-gray-500">{lidar.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-700/50 rounded-lg p-4 text-left text-sm text-gray-300 mb-6">
                    <p className="font-medium text-white mb-2">Before you start:</p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>Have all {totalPlacements - commissionedLidars.length} remaining LiDARs ready</li>
                      <li>Connect them one at a time to the edge network</li>
                      <li>Factory LiDARs use IP: {DEFAULT_LIDAR_IP}</li>
                    </ul>
                  </div>

                  {isComplete ? (
                    <button
                      onClick={finishWizard}
                      className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" />
                      All LiDARs Commissioned - Finish
                    </button>
                  ) : (
                    <button
                      onClick={() => setStep('waiting')}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                    >
                      {commissionedLidars.length > 0 ? 'Continue Commissioning' : 'Start Commissioning'}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'waiting' && (
            <div className="text-center">
              <Cable className="w-12 h-12 mx-auto text-amber-400 mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                Connect LiDAR #{currentLidarNumber}
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                Connect a LiDAR to the edge network, then click Scan.
              </p>

              {/* Target IP selector */}
              <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">Scanning for IP:</span>
                  <button
                    onClick={() => setShowManualIp(!showManualIp)}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    {showManualIp ? 'Use Default' : 'Custom IP'}
                  </button>
                </div>
                {showManualIp ? (
                  <input
                    type="text"
                    value={targetIp}
                    onChange={(e) => setTargetIp(e.target.value)}
                    placeholder="192.168.1.xxx"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white font-mono text-center text-sm focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  <div className="font-mono text-amber-400 text-center">{targetIp}</div>
                )}
                {targetIp !== DEFAULT_LIDAR_IP && (
                  <p className="text-xs text-amber-400 mt-2">
                    ⚠️ Recommissioning existing LiDAR at {targetIp}
                  </p>
                )}
              </div>

              {error && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                onClick={scanForLidar}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Scan for LiDAR
              </button>
            </div>
          )}

          {step === 'scanning' && (
            <div className="text-center">
              <Loader2 className="w-12 h-12 mx-auto text-blue-400 animate-spin mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">Scanning Network...</h3>
              <p className="text-gray-400 text-sm">
                Looking for LiDAR at {targetIp}
              </p>
            </div>
          )}

          {step === 'found' && (
            <div className="text-center">
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-400 mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">LiDAR Found!</h3>
              <p className="text-gray-400 text-sm mb-4">
                Found LiDAR at {currentIp}
              </p>

              <div className="bg-gray-700/50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Current IP:</span>
                  <span className="font-mono text-amber-400">{currentIp}</span>
                </div>
                <div className="flex items-center justify-center my-2">
                  <ArrowRight className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">New IP:</span>
                  <span className="font-mono text-green-400">{nextAvailableIp}</span>
                </div>
              </div>

              {error && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                onClick={configureLidar}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                <Wifi className="w-4 h-4" />
                Assign New IP Address
              </button>
            </div>
          )}

          {step === 'configuring' && (
            <div className="text-center">
              <Loader2 className="w-12 h-12 mx-auto text-amber-400 animate-spin mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">Configuring LiDAR...</h3>
              <p className="text-gray-400 text-sm">
                Sending new IP configuration to LiDAR
              </p>
            </div>
          )}

          {step === 'rebooting' && (
            <div className="text-center">
              <RefreshCw className="w-12 h-12 mx-auto text-amber-400 animate-spin mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">LiDAR Rebooting...</h3>
              <p className="text-gray-400 text-sm mb-2">
                The LiDAR is applying the new IP address.
              </p>
              <p className="text-gray-500 text-xs">
                This takes about 15-20 seconds...
              </p>
            </div>
          )}

          {step === 'verifying' && (
            <div className="text-center">
              <Loader2 className="w-12 h-12 mx-auto text-blue-400 animate-spin mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">Verifying New IP...</h3>
              <p className="text-gray-400 text-sm">
                Checking if LiDAR is reachable at {nextAvailableIp}
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center">
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-400 mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">LiDAR Commissioned!</h3>
              <p className="text-gray-400 text-sm mb-4">
                Successfully assigned IP {commissionedLidars[commissionedLidars.length - 1]?.assignedIp}
              </p>

              <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 mb-6 text-sm text-green-300">
                <p className="font-medium">📝 Label this LiDAR:</p>
                <p className="font-mono text-lg mt-1">
                  {commissionedLidars[commissionedLidars.length - 1]?.label}
                </p>
              </div>

              {!isComplete ? (
                <div>
                  <p className="text-gray-400 text-sm mb-4">
                    {totalPlacements - commissionedLidars.length} more LiDARs to go.
                    Disconnect this one and connect the next.
                  </p>
                  <button
                    onClick={continueToNext}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                  >
                    Continue to Next LiDAR
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setStep('complete')}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  All Done!
                </button>
              )}
            </div>
          )}

          {step === 'complete' && (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto bg-green-500 rounded-full flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-lg font-medium text-white mb-2">All LiDARs Commissioned!</h3>
              <p className="text-gray-400 text-sm mb-6">
                Successfully configured {commissionedLidars.length} LiDARs.
              </p>

              <div className="bg-gray-700/50 rounded-lg p-3 mb-6 max-h-40 overflow-auto">
                {commissionedLidars.map((lidar, idx) => (
                  <div key={lidar.assignedIp} className="flex items-center justify-between py-1 text-sm">
                    <span className="text-gray-400">#{idx + 1}</span>
                    <span className="font-mono text-green-400">{lidar.assignedIp}</span>
                    <span className="text-gray-500">{lidar.label}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={finishWizard}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
              >
                Finish & Scan LiDARs
              </button>
            </div>
          )}
        </div>

        {/* Footer - Commissioned list (collapsed) */}
        {commissionedLidars.length > 0 && step !== 'complete' && (
          <div className="border-t border-gray-700 p-3 bg-gray-750">
            <div className="text-xs text-gray-400 mb-2">Commissioned ({commissionedLidars.length}):</div>
            <div className="flex flex-wrap gap-2">
              {commissionedLidars.map(lidar => (
                <span 
                  key={lidar.assignedIp}
                  className="text-xs px-2 py-1 bg-green-900/30 text-green-400 rounded font-mono"
                >
                  {lidar.assignedIp.split('.').pop()}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
