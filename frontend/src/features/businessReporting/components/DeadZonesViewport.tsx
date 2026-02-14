import { useState, useEffect, useMemo } from 'react';
import { MapPin } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface DeadZone {
  id: string;
  name: string;
  utilization: number;
}

interface ROI {
  id: string;
  name: string;
  vertices: { x: number; y?: number; z?: number }[];
  color: string;
}

interface DeadZonesViewportProps {
  venueId: string;
  deadZones: DeadZone[];
}

export default function DeadZonesViewport({ venueId, deadZones }: DeadZonesViewportProps) {
  const [allRois, setAllRois] = useState<ROI[]>([]);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch all ROIs for the venue
  useEffect(() => {
    const fetchRois = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`);
        if (res.ok) {
          const data = await res.json();
          setAllRois(data);
        }
      } catch (err) {
        console.error('Failed to fetch ROIs:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchRois();
  }, [venueId]);

  // Helper to get Y coordinate (supports both y and z)
  const getY = (v: { y?: number; z?: number }) => v.y ?? v.z ?? 0;

  // Calculate viewport bounds from all ROIs
  const bounds = useMemo(() => {
    if (allRois.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const roi of allRois) {
      for (const v of roi.vertices) {
        const vy = getY(v);
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, vy);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, vy);
      }
    }
    // Add padding
    const padX = (maxX - minX) * 0.1 || 10;
    const padY = (maxY - minY) * 0.1 || 10;
    return { 
      minX: minX - padX, 
      minY: minY - padY, 
      maxX: maxX + padX, 
      maxY: maxY + padY 
    };
  }, [allRois]);

  const deadZoneIds = useMemo(() => new Set(deadZones.map(z => z.id)), [deadZones]);

  // Transform world coords to SVG coords
  const toSvg = (x: number, y: number, width: number, height: number) => {
    const { minX, minY, maxX, maxY } = bounds;
    const scaleX = width / (maxX - minX);
    const scaleY = height / (maxY - minY);
    const scale = Math.min(scaleX, scaleY);
    
    const svgX = (x - minX) * scale;
    const svgY = (y - minY) * scale;
    return { x: svgX, y: svgY };
  };

  const svgWidth = 400;
  const svgHeight = 300;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        Loading zones...
      </div>
    );
  }

  if (allRois.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        No zones available
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* SVG Viewport */}
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-medium text-gray-400 mb-3 flex items-center gap-2">
          <MapPin className="w-3 h-3" />
          Store Layout - Dead Zones Highlighted
        </h4>
        <svg 
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto"
          style={{ maxHeight: '250px' }}
        >
          {/* Background */}
          <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="#1a1a1a" />
          
          {/* All ROIs */}
          {allRois.map((roi) => {
            const isDead = deadZoneIds.has(roi.id);
            const isHovered = hoveredZoneId === roi.id;
            const points = roi.vertices
              .map(v => {
                const { x, y } = toSvg(v.x, getY(v), svgWidth, svgHeight);
                return `${x},${y}`;
              })
              .join(' ');
            
            return (
              <g key={roi.id}>
                <polygon
                  points={points}
                  fill={isDead 
                    ? isHovered ? 'rgba(239, 68, 68, 0.6)' : 'rgba(239, 68, 68, 0.3)'
                    : 'rgba(34, 197, 94, 0.15)'
                  }
                  stroke={isDead
                    ? isHovered ? '#ef4444' : '#dc2626'
                    : '#374151'
                  }
                  strokeWidth={isHovered ? 2 : 1}
                  className="transition-all duration-200"
                />
                {/* Show label on hover */}
                {isHovered && roi.vertices.length > 0 && (() => {
                  const centerX = roi.vertices.reduce((sum, v) => sum + v.x, 0) / roi.vertices.length;
                  const centerY = roi.vertices.reduce((sum, v) => sum + getY(v), 0) / roi.vertices.length;
                  const { x, y } = toSvg(centerX, centerY, svgWidth, svgHeight);
                  return (
                    <text
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fff"
                      fontSize="10"
                      fontWeight="bold"
                      className="pointer-events-none"
                    >
                      {roi.name.length > 20 ? roi.name.slice(0, 20) + '...' : roi.name}
                    </text>
                  );
                })()}
              </g>
            );
          })}
        </svg>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500/30 border border-red-600 rounded-sm" />
            Dead Zone
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500/15 border border-gray-600 rounded-sm" />
            Active Zone
          </div>
        </div>
      </div>

      {/* Dead Zones List */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-medium text-gray-400 mb-3">
          Dead Zones ({deadZones.length})
        </h4>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {deadZones.map((zone) => (
            <div
              key={zone.id}
              onMouseEnter={() => setHoveredZoneId(zone.id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              className={`px-3 py-2 rounded-lg cursor-pointer transition-all text-sm ${
                hoveredZoneId === zone.id
                  ? 'bg-red-500/20 border border-red-500/50 text-red-300'
                  : 'bg-gray-700/50 border border-transparent text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="truncate">{zone.name}</span>
                <span className="text-xs text-gray-500 ml-2">{zone.utilization}%</span>
              </div>
            </div>
          ))}
          {deadZones.length === 0 && (
            <p className="text-gray-500 text-sm">No dead zones detected!</p>
          )}
        </div>
      </div>
    </div>
  );
}
