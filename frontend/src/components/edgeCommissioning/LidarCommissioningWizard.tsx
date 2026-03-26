import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../../config/api'
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

const DEFAULT_LIDAR_IP = '192.168.1.200'
const DEFAULT_IP_START = 201

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
  const [foundLidarInfo, setFoundLidarInfo] = useState<{ vendor?: string; model?: string; configurable?: boolean } | null>(null)
  const [targetIp, setTargetIp] = useState<string>(DEFAULT_LIDAR_IP) // For manual IP entry
  const [nextAvailableIp, setNextAvailableIp] = useState<string>('192.168.1.201')
  const [error, setError] = useState<string | null>(null)
  const [scanAttempts, setScanAttempts] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [showManualIp, setShowManualIp] = useState(false)
  const [startingOctet, setStartingOctet] = useState<number>(DEFAULT_IP_START) // Configurable starting IP octet
  const [msopPort, setMsopPort] = useState<number>(6699) // RoboSense default MSOP port
  const [difopPort, setDifopPort] = useState<number>(7788) // RoboSense default DIFOP port
  const [usedIps, setUsedIps] = useState<Set<string>>(new Set())
  const [usedMsopPorts, setUsedMsopPorts] = useState<Set<number>>(new Set())
  const [usedDifopPorts, setUsedDifopPorts] = useState<Set<number>>(new Set())

  const progress = (commissionedLidars.length / totalPlacements) * 100
  const isComplete = commissionedLidars.length >= totalPlacements
  
  // Validation: check if current values conflict with existing
  const ipConflict = usedIps.has(nextAvailableIp)
  const msopConflict = usedMsopPorts.has(msopPort)
  const difopConflict = usedDifopPorts.has(difopPort)
  const hasConflict = ipConflict || msopConflict || difopConflict

  // Load existing commissioned LiDARs, inventory, and calculate next available IP/ports
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load existing commissioned LiDARs from database
        const lidarsRes = await fetch(`${API_BASE}/api/edge-commissioning/commissioned-lidars?venueId=${venueId}&edgeId=${edgeId}`)
        const lidarsData = await lidarsRes.json()
        
        // Also fetch inventory to detect externally-configured LiDARs
        const invRes = await fetch(`${API_BASE}/api/edge-commissioning/inventory?edgeId=${edgeId}&tailscaleIp=${edgeTailscaleIp}`)
        const invData = await invRes.json()
        
        // Merge: use inventory as truth for online LiDARs, supplement with DB records
        const dbLidars = lidarsData.lidars || []
        const invLidars = invData.inventory || []
        
        // Create map of all detected LiDARs (excluding default 192.168.1.200)
        const allLidars: CommissionedLidar[] = []
        const seenIps = new Set<string>()
        const usedMsopPorts = new Set<number>()
        const usedDifopPorts = new Set<number>()
        
        // Add inventory LiDARs (online, may have been configured externally)
        for (const inv of invLidars) {
          if (inv.ip === '192.168.1.200') continue // Skip factory default IP
          if (seenIps.has(inv.ip)) continue
          seenIps.add(inv.ip)
          
          // Track used ports
          if (inv.msopPort) usedMsopPorts.add(inv.msopPort)
          if (inv.difopPort) usedDifopPorts.add(inv.difopPort)
          
          // Check if this IP is in DB
          const dbRecord = dbLidars.find((d: any) => d.assignedIp === inv.ip)
          
          allLidars.push({
            id: dbRecord?.id || `inv-${inv.ip}`,
            lidarId: `lidar-${inv.ip.replace(/\./g, '-')}`,
            assignedIp: inv.ip,
            label: dbRecord?.label || `LiDAR-${inv.ip.split('.').pop()}`,
            status: 'done' as const,
            commissionedAt: dbRecord?.commissionedAt || new Date().toISOString(),
          })
        }
        
        // Add DB records not in inventory (offline but commissioned)
        for (const db of dbLidars) {
          if (seenIps.has(db.assignedIp)) continue
          seenIps.add(db.assignedIp)
          
          allLidars.push({
            id: db.id,
            lidarId: `lidar-${db.assignedIp.replace(/\./g, '-')}`,
            assignedIp: db.assignedIp,
            label: db.label || `LiDAR-${db.assignedIp.split('.').pop()}`,
            status: 'done' as const,
            commissionedAt: db.commissionedAt,
          })
        }
        
        setCommissionedLidars(allLidars)
        setCurrentLidarNumber(allLidars.length + 1)
        
        // Store used IPs and ports for validation
        const ipSet = new Set(allLidars.map(l => l.assignedIp))
        setUsedIps(ipSet)
        setUsedMsopPorts(usedMsopPorts)
        setUsedDifopPorts(usedDifopPorts)
        
        // Calculate next available IP based on all detected LiDARs
        const usedOctets = allLidars.map(l => parseInt(l.assignedIp.split('.').pop() || '0', 10))
        let nextOctet = startingOctet
        while (usedOctets.includes(nextOctet) && nextOctet <= 254) nextOctet++
        setNextAvailableIp(`192.168.1.${nextOctet}`)
        
        // Calculate next available ports
        let nextMsop = 6699
        while (usedMsopPorts.has(nextMsop)) nextMsop++
        setMsopPort(nextMsop)
        
        let nextDifop = 7788
        while (usedDifopPorts.has(nextDifop)) nextDifop++
        setDifopPort(nextDifop)
        
      } catch (err) {
        console.error('Failed to load commissioned lidars:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [venueId, edgeId, edgeTailscaleIp, startingOctet])

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
          setFoundLidarInfo({
            vendor: foundLidar.vendor || 'Unknown',
            model: foundLidar.model || 'Unknown',
            configurable: foundLidar.configurable !== false, // Default true for RoboSense
          })
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
          vendor: foundLidarInfo?.vendor || 'RoboSense',
          model: foundLidarInfo?.model,
        }),
      })
    } catch (err) {
      console.error('Failed to save commissioned lidar:', err)
    }
  }

  // Refresh next available IP (uses startingOctet)
  const refreshNextIp = async (startOctet?: number) => {
    try {
      const octet = startOctet ?? startingOctet
      const res = await fetch(`${API_BASE}/api/edge-commissioning/next-available-ip?venueId=${venueId}&startOctet=${octet}`)
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
      // Use different endpoint based on vendor
      const isLsLidar = foundLidarInfo?.vendor === 'LSLidar'
      const endpoint = isLsLidar 
        ? `${API_BASE}/api/edge-commissioning/proxy-lslidar-config`
        : `${API_BASE}/api/edge-commissioning/proxy-set-ip`
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edgeId,
          tailscaleIp: edgeTailscaleIp,
          currentIp: currentIp,
          newIp: nextAvailableIp,
          // Vendor-specific port options
          msopPort: isLsLidar ? 2345 : msopPort,
          difopPort: isLsLidar ? 2346 : difopPort,
        }),
      })

      const data = await res.json()

      if (data.success || data.ok) {
        setStep('rebooting')
        // LS Lidar reboots faster (~5s), RoboSense takes ~15s
        const rebootTime = isLsLidar ? 5000 : 15000
        setTimeout(() => verifyNewIp(), rebootTime)
      } else {
        setError(data.message || data.error || 'Failed to configure LiDAR')
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

                  {/* Starting IP Configuration */}
                  <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                    <label className="block text-xs text-gray-400 mb-1">Starting IP Address (last octet)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm">192.168.1.</span>
                      <input
                        type="number"
                        min="1"
                        max="254"
                        value={startingOctet}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10)
                          if (!isNaN(val) && val >= 1 && val <= 254) {
                            setStartingOctet(val)
                            refreshNextIp(val)
                          }
                        }}
                        className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-center"
                      />
                      <span className="text-xs text-gray-500">
                        Next: <span className={`font-mono ${ipConflict ? 'text-red-400' : 'text-blue-400'}`}>{nextAvailableIp}</span>
                        {ipConflict && <span className="text-red-400 ml-1">⚠ In use</span>}
                      </span>
                    </div>
                    {ipConflict && (
                      <p className="text-xs text-red-400 mt-1">⚠ IP already assigned. Adjust starting octet.</p>
                    )}
                  </div>

                  {/* RoboSense Port Configuration */}
                  <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                    <label className="block text-xs text-gray-400 mb-2">RoboSense Port Configuration</label>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs">MSOP:</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={msopPort}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val)) setMsopPort(val)
                            else if (e.target.value === '') setMsopPort(6699)
                          }}
                          className={`w-20 px-2 py-1 bg-gray-800 border rounded text-white text-center text-sm ${msopConflict ? 'border-red-500' : 'border-gray-600'}`}
                        />
                        {msopConflict && <span className="text-red-400 text-xs">⚠ In use</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs">DIFOP:</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={difopPort}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val)) setDifopPort(val)
                            else if (e.target.value === '') setDifopPort(7788)
                          }}
                          className={`w-20 px-2 py-1 bg-gray-800 border rounded text-white text-center text-sm ${difopConflict ? 'border-red-500' : 'border-gray-600'}`}
                        />
                        {difopConflict && <span className="text-red-400 text-xs">⚠ In use</span>}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Default: MSOP 6699, DIFOP 7788 (LS Lidar uses fixed ports)</p>
                    {(msopConflict || difopConflict) && (
                      <p className="text-xs text-red-400 mt-1">⚠ Port already assigned to another LiDAR. Choose a different port.</p>
                    )}
                  </div>

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
                      disabled={hasConflict}
                      className={`w-full py-3 text-white rounded-lg font-medium flex items-center justify-center gap-2 ${hasConflict ? 'bg-gray-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
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
              <p className="text-gray-400 text-sm mb-2">
                Found LiDAR at {currentIp}
              </p>
              {foundLidarInfo && (
                <p className="text-blue-400 text-sm mb-4 font-medium">
                  {foundLidarInfo.vendor} {foundLidarInfo.model !== 'Unknown' ? foundLidarInfo.model : ''}
                </p>
              )}

              <div className="bg-gray-700/50 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Current IP:</span>
                  <span className="font-mono text-amber-400">{currentIp}</span>
                </div>
                {foundLidarInfo?.configurable !== false && (
                  <>
                    <div className="flex items-center justify-center my-2">
                      <ArrowRight className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">New IP:</span>
                      <span className="font-mono text-green-400">{nextAvailableIp}</span>
                    </div>
                  </>
                )}
              </div>

              {foundLidarInfo?.configurable === false && (
                <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-3 mb-4 text-sm text-amber-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>This LiDAR cannot be reconfigured via web interface. Use vendor software to change IP.</span>
                </div>
              )}

              {error && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {foundLidarInfo?.configurable !== false ? (
                <button
                  onClick={configureLidar}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                >
                  <Wifi className="w-4 h-4" />
                  Assign New IP Address
                </button>
              ) : (
                <button
                  onClick={() => {
                    // Skip IP change, just register the LiDAR with its current IP
                    const label = `LiDAR-${currentIp?.split('.').pop()}`
                    saveCommissionedLidar(currentIp!, label)
                    setCommissionedLidars(prev => [...prev, {
                      lidarId: `lidar-${currentIp?.replace(/\./g, '-')}`,
                      assignedIp: currentIp!,
                      label,
                      status: 'done',
                    }])
                    setCurrentLidarNumber(prev => prev + 1)
                    setStep('done')
                  }}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Register LiDAR at Current IP
                </button>
              )}
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
