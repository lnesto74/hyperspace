import { useState, useRef, useEffect, useCallback } from 'react'
import { 
  Camera, RefreshCw, Loader2, Download, ZoomIn, ZoomOut, 
  RotateCcw, Eye, EyeOff, AlertCircle, Wifi, WifiOff
} from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface PointCloudViewerProps {
  tailscaleIp: string
  lidarIp: string
  lidarModel?: string
  onClose: () => void
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const WS_BASE = API_BASE.replace('http://', 'ws://').replace('https://', 'wss://')

export default function PointCloudViewer({
  tailscaleIp,
  lidarIp,
  lidarModel = 'RS16',
  onClose,
}: PointCloudViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const pointsRef = useRef<THREE.Points | null>(null)
  const animationRef = useRef<number | null>(null)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pointCount, setPointCount] = useState(0)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [showAxes, setShowAxes] = useState(true)
  const [colorMode, setColorMode] = useState<'height' | 'intensity' | 'distance'>('height')
  const [pointSize, setPointSize] = useState(2)
  const [streamMode, setStreamMode] = useState<'http' | 'websocket'>('http')
  const [wsConnected, setWsConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const frameCountRef = useRef(0)
  const lastFpsTimeRef = useRef(Date.now())

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    )
    camera.position.set(10, 10, 10)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    rendererRef.current = renderer

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.screenSpacePanning = true
    controls.minDistance = 1
    controls.maxDistance = 100
    controlsRef.current = controls

    // Grid helper
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x333333)
    scene.add(gridHelper)

    // Axes helper
    const axesHelper = new THREE.AxesHelper(5)
    axesHelper.name = 'axes'
    scene.add(axesHelper)

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      renderer.dispose()
      controls.dispose()
    }
  }, [])

  // Toggle axes visibility
  useEffect(() => {
    if (!sceneRef.current) return
    const axes = sceneRef.current.getObjectByName('axes')
    if (axes) {
      axes.visible = showAxes
    }
  }, [showAxes])

  // Fetch point cloud snapshot
  const fetchSnapshot = useCallback(async () => {
    if (!sceneRef.current) return

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(
        `${API_BASE}/api/edge-commissioning/pcl/snapshot?` +
        `tailscaleIp=${tailscaleIp}&lidarIp=${lidarIp}&` +
        `duration=200&maxPoints=50000&downsample=1&format=json&model=${lidarModel}`
      )

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Failed to fetch point cloud')
      }

      const data = await res.json()

      if (!data.success || !data.points || data.points.length === 0) {
        throw new Error('No point cloud data received')
      }

      // Parse compact points array [x,y,z,i, x,y,z,i, ...]
      const numPoints = data.points.length / 4
      const positions = new Float32Array(numPoints * 3)
      const colors = new Float32Array(numPoints * 3)

      let minZ = Infinity, maxZ = -Infinity
      let minDist = Infinity, maxDist = -Infinity

      // First pass: find ranges for coloring
      for (let i = 0; i < numPoints; i++) {
        const x = data.points[i * 4]
        const y = data.points[i * 4 + 1]
        const z = data.points[i * 4 + 2]
        const dist = Math.sqrt(x * x + y * y + z * z)

        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
        if (dist < minDist) minDist = dist
        if (dist > maxDist) maxDist = dist
      }

      const zRange = maxZ - minZ || 1
      const distRange = maxDist - minDist || 1

      // Second pass: populate geometry
      for (let i = 0; i < numPoints; i++) {
        const x = data.points[i * 4]
        const y = data.points[i * 4 + 1]
        const z = data.points[i * 4 + 2]
        const intensity = data.points[i * 4 + 3] / 255

        positions[i * 3] = x
        positions[i * 3 + 1] = z // Swap Y/Z for Three.js coordinate system
        positions[i * 3 + 2] = -y

        // Color based on mode
        let color: THREE.Color
        switch (colorMode) {
          case 'intensity':
            color = new THREE.Color().setHSL(0.6, 1, intensity * 0.5 + 0.25)
            break
          case 'distance': {
            const dist = Math.sqrt(x * x + y * y + z * z)
            const t = (dist - minDist) / distRange
            color = new THREE.Color().setHSL(0.7 - t * 0.7, 1, 0.5)
            break
          }
          case 'height':
          default: {
            const t = (z - minZ) / zRange
            color = new THREE.Color().setHSL(0.7 - t * 0.7, 1, 0.5)
            break
          }
        }

        colors[i * 3] = color.r
        colors[i * 3 + 1] = color.g
        colors[i * 3 + 2] = color.b
      }

      // Remove old points
      if (pointsRef.current) {
        sceneRef.current.remove(pointsRef.current)
        pointsRef.current.geometry.dispose()
        ;(pointsRef.current.material as THREE.PointsMaterial).dispose()
      }

      // Create new points geometry
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      const material = new THREE.PointsMaterial({
        size: pointSize * 0.01,
        vertexColors: true,
        sizeAttenuation: true,
      })

      const points = new THREE.Points(geometry, material)
      sceneRef.current.add(points)
      pointsRef.current = points

      setPointCount(numPoints)
      setLastUpdate(new Date())
    } catch (err: any) {
      console.error('Point cloud fetch error:', err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [tailscaleIp, lidarIp, lidarModel, colorMode, pointSize])

  // Initial fetch
  useEffect(() => {
    fetchSnapshot()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh (HTTP polling mode)
  useEffect(() => {
    if (!autoRefresh || streamMode !== 'http') return

    const interval = setInterval(fetchSnapshot, 1000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchSnapshot, streamMode])

  // Update points from binary buffer (WebSocket mode)
  const updatePointsFromBuffer = useCallback((buffer: ArrayBuffer) => {
    if (!sceneRef.current) return

    const floatArray = new Float32Array(buffer)
    const numPoints = floatArray.length / 4 // x, y, z, intensity

    if (numPoints === 0) return

    const positions = new Float32Array(numPoints * 3)
    const colors = new Float32Array(numPoints * 3)

    let minZ = Infinity, maxZ = -Infinity

    // First pass: find Z range
    for (let i = 0; i < numPoints; i++) {
      const z = floatArray[i * 4 + 2]
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const zRange = maxZ - minZ || 1

    // Second pass: populate geometry
    for (let i = 0; i < numPoints; i++) {
      const x = floatArray[i * 4]
      const y = floatArray[i * 4 + 1]
      const z = floatArray[i * 4 + 2]
      // intensity at floatArray[i * 4 + 3] - not used in height color mode

      positions[i * 3] = x
      positions[i * 3 + 1] = z // Swap Y/Z for Three.js
      positions[i * 3 + 2] = -y

      // Color by height (fast path for streaming)
      const t = (z - minZ) / zRange
      const color = new THREE.Color().setHSL(0.7 - t * 0.7, 1, 0.5)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }

    // Update or create points
    if (pointsRef.current) {
      const geometry = pointsRef.current.geometry
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
    } else {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

      const material = new THREE.PointsMaterial({
        size: pointSize * 0.01,
        vertexColors: true,
        sizeAttenuation: true,
      })

      const points = new THREE.Points(geometry, material)
      sceneRef.current.add(points)
      pointsRef.current = points
    }

    setPointCount(numPoints)
    setLastUpdate(new Date())

    // Update FPS counter
    frameCountRef.current++
    const now = Date.now()
    if (now - lastFpsTimeRef.current >= 1000) {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
      lastFpsTimeRef.current = now
    }
  }, [pointSize])

  // WebSocket streaming mode
  useEffect(() => {
    if (streamMode !== 'websocket' || !autoRefresh) {
      // Disconnect if switching away from WebSocket mode
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
        setWsConnected(false)
      }
      return
    }

    const wsUrl = `${WS_BASE}/ws/pcl?tailscaleIp=${tailscaleIp}&lidarIp=${lidarIp}&model=${lidarModel}&downsample=2`
    console.log('[PointCloud] Connecting WebSocket:', wsUrl)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      console.log('[PointCloud] WebSocket connected')
      setWsConnected(true)
      setError(null)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        updatePointsFromBuffer(event.data)
      } else {
        // JSON message (metadata or error)
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'error') {
            setError(msg.error)
          } else if (msg.type === 'connected') {
            console.log('[PointCloud] Stream connected to', msg.lidarIp)
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    ws.onerror = (err) => {
      console.error('[PointCloud] WebSocket error:', err)
      setError('WebSocket connection error')
      setWsConnected(false)
    }

    ws.onclose = () => {
      console.log('[PointCloud] WebSocket disconnected')
      setWsConnected(false)
    }

    return () => {
      ws.close()
      wsRef.current = null
      setWsConnected(false)
    }
  }, [streamMode, autoRefresh, tailscaleIp, lidarIp, lidarModel, updatePointsFromBuffer])

  // Reset camera view
  const resetView = () => {
    if (!cameraRef.current || !controlsRef.current) return
    cameraRef.current.position.set(10, 10, 10)
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }

  // Download PLY
  const downloadPly = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/edge-commissioning/pcl/snapshot?` +
        `tailscaleIp=${tailscaleIp}&lidarIp=${lidarIp}&` +
        `duration=200&maxPoints=100000&downsample=1&format=ply&model=${lidarModel}`
      )

      if (!res.ok) throw new Error('Download failed')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pointcloud-${lidarIp.replace(/\./g, '-')}-${Date.now()}.ply`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(`Download failed: ${err.message}`)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Camera className="w-5 h-5 text-blue-400" />
          <div>
            <h2 className="text-lg font-semibold text-white">Point Cloud Viewer</h2>
            <p className="text-sm text-gray-400">
              LiDAR: {lidarIp} • {pointCount.toLocaleString()} points
              {lastUpdate && ` • Updated ${lastUpdate.toLocaleTimeString()}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Color mode */}
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as any)}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
          >
            <option value="height">Color by Height</option>
            <option value="intensity">Color by Intensity</option>
            <option value="distance">Color by Distance</option>
          </select>

          {/* Point size */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPointSize(Math.max(1, pointSize - 1))}
              className="p-1 text-gray-400 hover:text-white"
              title="Smaller points"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-400 w-4 text-center">{pointSize}</span>
            <button
              onClick={() => setPointSize(Math.min(10, pointSize + 1))}
              className="p-1 text-gray-400 hover:text-white"
              title="Larger points"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          {/* Axes toggle */}
          <button
            onClick={() => setShowAxes(!showAxes)}
            className={`p-2 rounded ${showAxes ? 'bg-blue-600' : 'bg-gray-700'} hover:bg-blue-500`}
            title="Toggle axes"
          >
            {showAxes ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>

          {/* Reset view */}
          <button
            onClick={resetView}
            className="p-2 bg-gray-700 rounded hover:bg-gray-600"
            title="Reset view"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Refresh */}
          <button
            onClick={fetchSnapshot}
            disabled={isLoading}
            className="p-2 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-50"
            title="Refresh"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>

          {/* Stream mode toggle */}
          <div className="flex items-center gap-1 bg-gray-700 rounded px-1">
            <button
              onClick={() => setStreamMode('http')}
              className={`px-2 py-1 rounded text-xs ${
                streamMode === 'http' ? 'bg-blue-600 text-white' : 'text-gray-400'
              }`}
              title="HTTP Polling (1 FPS)"
            >
              HTTP
            </button>
            <button
              onClick={() => setStreamMode('websocket')}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                streamMode === 'websocket' ? 'bg-blue-600 text-white' : 'text-gray-400'
              }`}
              title="WebSocket Streaming (10 FPS)"
            >
              {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              WS
            </button>
          </div>

          {/* Auto-refresh/Stream toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1 rounded text-sm flex items-center gap-1 ${
              autoRefresh 
                ? wsConnected && streamMode === 'websocket'
                  ? 'bg-green-600 text-white' 
                  : 'bg-amber-600 text-white'
                : 'bg-gray-700 text-gray-300'
            }`}
          >
            {autoRefresh ? (
              streamMode === 'websocket' && wsConnected ? (
                <>{fps} FPS</>
              ) : (
                'Polling'
              )
            ) : (
              'Stream'
            )}
          </button>

          {/* Download */}
          <button
            onClick={downloadPly}
            className="p-2 bg-gray-700 rounded hover:bg-gray-600"
            title="Download PLY"
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-900/50 border-b border-red-700 flex items-center gap-2 text-red-300">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3D Canvas */}
      <div ref={containerRef} className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full" />

        {/* Loading overlay */}
        {isLoading && pointCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-white">Capturing point cloud...</p>
            </div>
          </div>
        )}

        {/* Controls hint */}
        <div className="absolute bottom-4 left-4 text-xs text-gray-500">
          Left click: Rotate • Right click: Pan • Scroll: Zoom
        </div>

        {/* Stats */}
        <div className="absolute bottom-4 right-4 text-xs text-gray-500 text-right">
          <div>Points: {pointCount.toLocaleString()}</div>
          <div>Model: {lidarModel}</div>
        </div>
      </div>
    </div>
  )
}
