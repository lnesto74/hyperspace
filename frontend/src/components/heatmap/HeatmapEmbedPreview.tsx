import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Expand, Loader2 } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useHeatmap } from '../../context/HeatmapContext';
import { useRoi } from '../../context/RoiContext';
import { useVenue } from '../../context/VenueContext';
import { getHeatColor, hexToThreeColor, isPointInPolygon } from './heatmapUtils';
import { buildDwgWireframeGroup, disposeObject3D } from '../../utils/dwgWireframe3d';
import { getCategoryVisual } from '../../features/businessReporting/operationsConsole/categoryVisuals';
import type { CategoryRankingRow } from '../../features/businessReporting/components/CategoryRankingPanel';

type MetricMode = 'visits' | 'dwell';

interface HeatmapEmbedPreviewProps {
  venueId: string;
  categories: CategoryRankingRow[];
  timeframe: 'day' | 'week' | 'month';
  metric: MetricMode;
  highlightCategory?: string | null;
  onExpand?: () => void;
}

const ELEVATION = 0.45;

export default function HeatmapEmbedPreview({
  venueId,
  categories,
  timeframe,
  metric,
  highlightCategory = null,
  onExpand,
}: HeatmapEmbedPreviewProps) {
  const { venue, objects, loadVenue } = useVenue();
  const { regions, loadRegions } = useRoi();
  const { heatmapData, isLoading, loadHeatmap, setTimeframe } = useHeatmap();

  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const heatmapGroupRef = useRef<THREE.Group | null>(null);
  const zoneGroupRef = useRef<THREE.Group | null>(null);
  const dwgGroupRef = useRef<THREE.Group | null>(null);
  const pulseLinesRef = useRef<THREE.Line[]>([]);
  const animRef = useRef<number | null>(null);
  const highlightRef = useRef<string | null>(null);

  highlightRef.current = highlightCategory;

  const categoryByRoiId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of categories) {
      for (const id of row.roiIds ?? []) {
        map.set(id, row.category);
      }
    }
    return map;
  }, [categories]);

  const highlightRoiIds = useMemo(() => {
    if (!highlightCategory) return new Set<string>();
    const row = categories.find(c => c.category === highlightCategory);
    return new Set(row?.roiIds ?? []);
  }, [highlightCategory, categories]);

  const shelfRegions = useMemo(
    () => regions.filter(r => categoryByRoiId.has(r.id)),
    [regions, categoryByRoiId],
  );

  const tileInCategory = useCallback((tile: { x: number; z: number }, roiIds: Set<string>) => {
    if (!roiIds.size) return true;
    return shelfRegions.some(
      zone => roiIds.has(zone.id) && isPointInPolygon({ x: tile.x, z: tile.z }, zone.vertices),
    );
  }, [shelfRegions]);

  useEffect(() => {
    if (venueId) {
      loadVenue(venueId);
      loadRegions(venueId);
    }
  }, [venueId, loadVenue, loadRegions]);

  useEffect(() => {
    setTimeframe(timeframe);
  }, [timeframe, setTimeframe]);

  useEffect(() => {
    if (venueId) loadHeatmap(venueId);
  }, [venueId, timeframe, loadHeatmap]);

  const heightKpi = metric === 'visits' ? 'visits' : 'dwellSec';
  const colorKpi = metric === 'visits' ? 'visits' : 'dwellSec';

  // Three.js scene lifecycle
  useEffect(() => {
    if (!canvasRef.current || !venue?.id || venue.id !== venueId) return;

    const container = canvasRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    camera.position.set(
      venue.width / 2,
      Math.max(venue.width, venue.depth) * 0.65,
      venue.depth / 2 + venue.depth * 0.55,
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(venue.width / 2, 0, venue.depth / 2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.minDistance = 4;
    controls.maxDistance = Math.max(venue.width, venue.depth) * 2;
    controls.update();
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(venue.width, venue.height * 2, venue.depth);
    scene.add(dir);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(venue.width, venue.depth),
      new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.75 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(venue.width / 2, 0, venue.depth / 2);
    scene.add(floor);

    const heatmapGroup = new THREE.Group();
    scene.add(heatmapGroup);
    heatmapGroupRef.current = heatmapGroup;

    const zoneGroup = new THREE.Group();
    scene.add(zoneGroup);
    zoneGroupRef.current = zoneGroup;

    const dwgGroup = new THREE.Group();
    scene.add(dwgGroup);
    dwgGroupRef.current = dwgGroup;

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      controls.update();

      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(Date.now() * 0.004));
      for (const line of pulseLinesRef.current) {
        const mat = line.material as THREE.LineBasicMaterial;
        mat.opacity = pulse;
      }

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (animRef.current) cancelAnimationFrame(animRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      pulseLinesRef.current = [];
      sceneRef.current = null;
    };
  }, [venue?.id, venueId, venue?.width, venue?.depth, venue?.height]);

  // DWG wireframe
  useEffect(() => {
    const host = dwgGroupRef.current;
    if (!host) return;
    while (host.children.length > 0) {
      disposeObject3D(host.children[0]);
      host.remove(host.children[0]);
    }
    if (objects.length > 0) {
      host.add(buildDwgWireframeGroup(objects, { plane: 'pedestal', highContrast: true, showFill: true }));
    }
  }, [objects]);

  // Zone outlines — colored by category, pulse when highlighted
  useEffect(() => {
    const group = zoneGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      group.remove(child);
    }
    pulseLinesRef.current = [];

    shelfRegions.forEach(zone => {
      const cat = categoryByRoiId.get(zone.id) ?? 'Uncategorized';
      const visual = getCategoryVisual(cat);
      const isHighlight = highlightRoiIds.has(zone.id);
      const dimmed = highlightCategory && !isHighlight;

      const pts = zone.vertices.map(v => new THREE.Vector3(v.x, 0.04, v.z));
      pts.push(pts[0].clone());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: hexToThreeColor(visual.color),
          transparent: true,
          opacity: dimmed ? 0.15 : isHighlight ? 1 : 0.65,
        }),
      );
      group.add(line);
      if (isHighlight && highlightCategory) {
        pulseLinesRef.current.push(line);
      }
    });
  }, [shelfRegions, categoryByRoiId, highlightCategory, highlightRoiIds]);

  // Heat tiles
  useEffect(() => {
    const group = heatmapGroupRef.current;
    if (!group || !heatmapData?.tiles?.length) return;

    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Mesh;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      group.remove(child);
    }

    const { tileSize, tiles } = heatmapData;
    const values = tiles.map(t => t[colorKpi]).filter(v => v > 0);
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 1;
    const maxNorm = Math.min(
      colorKpi === 'visits' ? heatmapData.maxVisits : heatmapData.maxDwell,
      p95 * 2,
    ) || 1;

    tiles.forEach(tile => {
      const inShelf = shelfRegions.some(z => isPointInPolygon({ x: tile.x, z: tile.z }, z.vertices));
      if (!inShelf) return;

      const inHighlight = !highlightCategory || tileInCategory(tile, highlightRoiIds);
      const heightValue = tile[heightKpi];
      const colorValue = tile[colorKpi];
      const normH = maxNorm > 0 ? Math.min(heightValue / maxNorm, 1.4) : 0;
      const barH = 0.04 + normH * 1.1;
      const color = getHeatColor(colorValue, maxNorm);

      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: inHighlight ? 0.82 : 0.1,
        emissive: color,
        emissiveIntensity: inHighlight ? 0.22 : 0.05,
      });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(tileSize * 0.82, barH, tileSize * 0.82),
        mat,
      );
      mesh.position.set(tile.x, ELEVATION + barH / 2, tile.z);
      group.add(mesh);
    });
  }, [heatmapData, shelfRegions, heightKpi, colorKpi, highlightCategory, highlightRoiIds, tileInCategory]);

  return (
    <div className="flex flex-col h-full min-h-[240px]">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[10px] text-gray-500">
          {highlightCategory ? `${highlightCategory} zones` : 'All category zones'}
        </span>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="text-[10px] text-gray-400 hover:text-white inline-flex items-center gap-1"
          >
            <Expand className="w-3 h-3" /> Full screen
          </button>
        )}
      </div>
      <div className="relative flex-1 rounded-lg border border-gray-700/60 bg-gray-950 overflow-hidden min-h-[220px]">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80">
            <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
          </div>
        )}
        {!isLoading && !heatmapData?.tiles?.length && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500">
            No heatmap data for this period
          </div>
        )}
        <div ref={canvasRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
