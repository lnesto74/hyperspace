/**
 * DoohScreenZones - 3D visualization of DOOH screen exposure zones
 * 
 * Renders viewing cone/trapezoid zones for each DOOH screen in the 3D scene.
 * Shows SEZ (Screen Exposure Zone) and optional AZ (Attention Zone) with
 * semi-transparent shading and edge rays.
 */

import { useMemo } from 'react'
import * as THREE from 'three'

interface DoohScreen {
  id: string
  name: string
  position: { x: number; y: number; z: number }
  yawDeg: number
  mountHeightM: number
  sezPolygon: { x: number; z: number }[]
  azPolygon?: { x: number; z: number }[] | null
  enabled: boolean
}

interface DoohScreenZonesProps {
  screens: DoohScreen[]
  visible: boolean
  showLabels?: boolean
  sezColor?: string
  azColor?: string
  opacity?: number
}

function ZonePolygon({ 
  polygon, 
  height, 
  color, 
  opacity,
  position,
}: { 
  polygon: { x: number; z: number }[]
  height: number
  color: string
  opacity: number
  position: { x: number; y: number; z: number }
}) {
  const geometry = useMemo(() => {
    if (!polygon || polygon.length < 3) return null
    
    // Create shape from polygon points
    const shape = new THREE.Shape()
    shape.moveTo(polygon[0].x, polygon[0].z)
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i].x, polygon[i].z)
    }
    shape.closePath()
    
    // Extrude to create 3D volume
    const extrudeSettings = {
      depth: height,
      bevelEnabled: false,
    }
    
    return new THREE.ExtrudeGeometry(shape, extrudeSettings)
  }, [polygon, height])
  
  const edgeGeometry = useMemo(() => {
    if (!polygon || polygon.length < 3) return null
    
    // Create lines for the edges (rays from screen)
    const points: THREE.Vector3[] = []
    
    // Bottom edges
    for (let i = 0; i < polygon.length; i++) {
      points.push(new THREE.Vector3(polygon[i].x, 0, polygon[i].z))
      points.push(new THREE.Vector3(polygon[(i + 1) % polygon.length].x, 0, polygon[(i + 1) % polygon.length].z))
    }
    
    // Top edges
    for (let i = 0; i < polygon.length; i++) {
      points.push(new THREE.Vector3(polygon[i].x, height, polygon[i].z))
      points.push(new THREE.Vector3(polygon[(i + 1) % polygon.length].x, height, polygon[(i + 1) % polygon.length].z))
    }
    
    // Vertical edges
    for (let i = 0; i < polygon.length; i++) {
      points.push(new THREE.Vector3(polygon[i].x, 0, polygon[i].z))
      points.push(new THREE.Vector3(polygon[i].x, height, polygon[i].z))
    }
    
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    return geo
  }, [polygon, height])
  
  if (!geometry || !edgeGeometry) return null
  
  return (
    <group>
      {/* Filled zone with transparency */}
      <mesh 
        geometry={geometry} 
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
      >
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={opacity * 0.3} 
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      
      {/* Edge lines (rays) */}
      <lineSegments geometry={edgeGeometry}>
        <lineBasicMaterial color={color} transparent opacity={opacity * 0.8} linewidth={2} />
      </lineSegments>
    </group>
  )
}

function ScreenMarker({
  screen,
  color,
}: {
  screen: DoohScreen
  color: string
}) {
  const yawRad = (screen.yawDeg || 0) * Math.PI / 180
  
  // Direction arrow
  const arrowPoints = useMemo(() => {
    const length = 1.5
    const dirX = Math.sin(yawRad)
    const dirZ = Math.cos(yawRad)
    
    return [
      new THREE.Vector3(screen.position.x, screen.mountHeightM, screen.position.z),
      new THREE.Vector3(
        screen.position.x + dirX * length,
        screen.mountHeightM,
        screen.position.z + dirZ * length
      ),
    ]
  }, [screen.position, screen.mountHeightM, yawRad])
  
  const arrowGeometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(arrowPoints)
  }, [arrowPoints])
  
  return (
    <group>
      {/* Screen position marker */}
      <mesh position={[screen.position.x, screen.mountHeightM, screen.position.z]}>
        <boxGeometry args={[0.8, 0.5, 0.1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      
      {/* Direction arrow */}
      <line geometry={arrowGeometry}>
        <lineBasicMaterial color={color} linewidth={3} />
      </line>
      
      {/* Vertical pole */}
      <mesh position={[screen.position.x, screen.mountHeightM / 2, screen.position.z]}>
        <cylinderGeometry args={[0.03, 0.03, screen.mountHeightM, 8]} />
        <meshStandardMaterial color="#666666" />
      </mesh>
    </group>
  )
}

export default function DoohScreenZones({
  screens,
  visible,
  showLabels = true,
  sezColor = '#9333ea',  // Purple
  azColor = '#f59e0b',   // Amber
  opacity = 0.6,
}: DoohScreenZonesProps) {
  if (!visible || !screens || screens.length === 0) return null
  
  const enabledScreens = screens.filter(s => s.enabled)
  
  return (
    <group name="dooh-screen-zones">
      {enabledScreens.map((screen) => (
        <group key={screen.id} name={`dooh-screen-${screen.id}`}>
          {/* Screen marker with direction arrow */}
          <ScreenMarker screen={screen} color={sezColor} />
          
          {/* SEZ Zone (Screen Exposure Zone) */}
          {screen.sezPolygon && screen.sezPolygon.length >= 3 && (
            <ZonePolygon
              polygon={screen.sezPolygon}
              height={screen.mountHeightM + 0.5}
              color={sezColor}
              opacity={opacity}
              position={screen.position}
            />
          )}
          
          {/* AZ Zone (Attention Zone) - inner zone if defined */}
          {screen.azPolygon && screen.azPolygon.length >= 3 && (
            <ZonePolygon
              polygon={screen.azPolygon}
              height={screen.mountHeightM + 0.3}
              color={azColor}
              opacity={opacity * 0.8}
              position={screen.position}
            />
          )}
        </group>
      ))}
    </group>
  )
}
