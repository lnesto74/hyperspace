import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Expand, Loader2 } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useHeatmap } from '../../context/HeatmapContext';
import { useVenue } from '../../context/VenueContext';
import { API_BASE } from '../../config/api';
import { getHeatColor, hexToThreeColor, isPointInPolygon } from './heatmapUtils';
import { buildDwgWireframeGroup, disposeObject3D } from '../../utils/dwgWireframe3d';
import { getCategoryVisual } from '../../features/businessReporting/operationsConsole/categoryVisuals';
import type { CategoryRankingRow } from '../../features/businessReporting/components/CategoryRankingPanel';
import type { HeatmapTile } from '../../context/HeatmapContext';
import type { RegionOfInterest } from '../../types';

type MetricMode = 'visits' | 'dwell';

interface HeatmapEmbedPreviewProps {
  venueId: string;
  categories: CategoryRankingRow[];
  timeframe: 'day' | 'week' | 'month';
  metric: MetricMode;
  highlightCategory?: string | null;
  onExpand?: () => void;
}

interface TileEntry {
  mesh: THREE.Mesh;
  tile: HeatmapTile;
}

const ELEVATION = 0.45;
const MAX_EMBED_PIXEL_RATIO = 1.25;

function disposeGroup(group: THREE.Group | null) {
  if (!group) return;
  while (group.children.length > 0) {
    const child = group.children[0];
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat.dispose();
    } else {
      disposeObject3D(child);
    }
    group.remove(child);
  }
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat.dispose();
    }
  });
}

export default function HeatmapEmbedPreview({
  venueId,
  categories,
  timeframe,
  metric,
  highlightCategory = null,
  onExpand,
}: HeatmapEmbedPreviewProps) {
  const { venue, objects, loadVenue } = useVenue();
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
  const zoneLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const tileEntriesRef = useRef<TileEntry[]>([]);
  const animRef = useRef<number | null>(null);
  const inViewRef = useRef(true);
  const tabHiddenRef = useRef(false);
  const loadGenRef = useRef(0);
  const regionsGenRef = useRef(0);

  const [sceneReady, setSceneReady] = useState(false);
  const [tileVersion, setTileVersion] = useState(0);
  const [embedRegions, setEmbedRegions] = useState<RegionOfInterest[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);

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
    () => embedRegions.filter(r => categoryByRoiId.has(r.id)),
    [embedRegions, categoryByRoiId],
  );

  const tileInCategory = useCallback((tile: HeatmapTile, roiIds: Set<string>) => {
    if (!roiIds.size) return false;
    return shelfRegions.some(
      zone => roiIds.has(zone.id) && isPointInPolygon({ x: tile.x, z: tile.z }, zone.vertices),
    );
  }, [shelfRegions]);

  const heightKpi = metric === 'visits' ? 'visits' : 'dwellSec';
  const colorKpi = metric === 'visits' ? 'visits' : 'dwellSec';

  // Load venue for 3D scene only when not already loaded in context
  useEffect(() => {
    if (!venueId || venue?.id === venueId) return;
    void loadVenue(venueId, undefined, { silent: true });
  }, [venueId, venue?.id, loadVenue]);

  // Fetch shelf ROIs locally — do NOT use RoiContext (MainViewport overwrites it with DWG-only ROIs)
  useEffect(() => {
    if (!venueId) {
      setEmbedRegions([]);
      return;
    }

    const gen = ++regionsGenRef.current;
    setRegionsLoading(true);

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`);
        if (!res.ok) throw new Error('Failed to load shelf zones');
        const data: RegionOfInterest[] = await res.json();
        if (gen !== regionsGenRef.current) return;
        setEmbedRegions(data);
      } catch (err) {
        console.error('[HeatmapEmbedPreview] Failed to load regions:', err);
        if (gen === regionsGenRef.current) setEmbedRegions([]);
      } finally {
        if (gen === regionsGenRef.current) setRegionsLoading(false);
      }
    })();

    return () => {
      regionsGenRef.current += 1;
    };
  }, [venueId]);

  useEffect(() => {
    setTimeframe(timeframe);
  }, [timeframe, setTimeframe]);

  useEffect(() => {
    if (!venueId) return;
    const gen = ++loadGenRef.current;
    loadHeatmap(venueId).then(() => {
      if (gen !== loadGenRef.current) return;
    });
    return () => {
      loadGenRef.current += 1;
    };
  }, [venueId, timeframe, loadHeatmap]);

  // Pause GPU work when scrolled off-screen or tab hidden
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      entries => { inViewRef.current = entries[0]?.isIntersecting ?? true; },
      { threshold: 0.05 },
    );
    io.observe(el);

    const onVis = () => {
      tabHiddenRef.current = document.hidden;
      if (!document.hidden) {
        const rect = el.getBoundingClientRect();
        inViewRef.current = rect.top < window.innerHeight && rect.bottom > 0;
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [sceneReady]);

  // Three.js scene — init once per venue footprint, not on every context update
  useEffect(() => {
    if (!canvasRef.current || !venue?.id || venue.id !== venueId) {
      setSceneReady(false);
      return;
    }

    const container = canvasRef.current;
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

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

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_EMBED_PIXEL_RATIO));
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

    tileEntriesRef.current = [];
    pulseLinesRef.current = [];
    zoneLinesRef.current = new Map();
    setTileVersion(0);
    setSceneReady(true);

    let lastFrame = 0;
    const animate = (now: number) => {
      animRef.current = requestAnimationFrame(animate);
      if (tabHiddenRef.current || !inViewRef.current) return;
      // Cap ~30fps for embed preview — enough for orbit + pulse, half the GPU cost
      if (now - lastFrame < 33) return;
      lastFrame = now;

      controls.update();

      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.004));
      for (const line of pulseLinesRef.current) {
        (line.material as THREE.LineBasicMaterial).opacity = pulse;
      }

      renderer.render(scene, camera);
    };
    animRef.current = requestAnimationFrame(animate);

    const ro = new ResizeObserver(() => {
      if (!container || !renderer || !camera) return;
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      tileEntriesRef.current = [];
      pulseLinesRef.current = [];
      zoneLinesRef.current = new Map();
      heatmapGroupRef.current = null;
      zoneGroupRef.current = null;
      dwgGroupRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      setSceneReady(false);
    };
  }, [venue?.id, venueId, venue?.width, venue?.depth, venue?.height]);

  // DWG wireframe
  useEffect(() => {
    const host = dwgGroupRef.current;
    if (!host || !sceneReady) return;
    while (host.children.length > 0) {
      disposeObject3D(host.children[0]);
      host.remove(host.children[0]);
    }
    if (objects.length > 0) {
      host.add(buildDwgWireframeGroup(objects, { plane: 'pedestal', highContrast: true, showFill: true }));
    }
  }, [objects, sceneReady]);

  // Zone outlines — build once per shelf region set
  useEffect(() => {
    const group = zoneGroupRef.current;
    if (!group || !sceneReady) return;

    disposeGroup(group);
    pulseLinesRef.current = [];
    zoneLinesRef.current = new Map();

    shelfRegions.forEach(zone => {
      const cat = categoryByRoiId.get(zone.id) ?? 'Uncategorized';
      const visual = getCategoryVisual(cat);

      const pts = zone.vertices.map(v => new THREE.Vector3(v.x, 0.04, v.z));
      pts.push(pts[0].clone());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: hexToThreeColor(visual.color),
          transparent: true,
          opacity: 0.55,
        }),
      );
      group.add(line);
      zoneLinesRef.current.set(zone.id, line);
    });
  }, [shelfRegions, categoryByRoiId, sceneReady]);

  // Highlight — update line + tile opacity only (no geometry rebuild)
  useEffect(() => {
    if (!sceneReady) return;

    pulseLinesRef.current = [];
    for (const [zoneId, line] of zoneLinesRef.current) {
      const isHighlight = highlightRoiIds.has(zoneId);
      const dimmed = !!highlightCategory && !isHighlight;
      const mat = line.material as THREE.LineBasicMaterial;
      mat.opacity = dimmed ? 0.12 : isHighlight ? 1 : 0.55;
      mat.needsUpdate = true;
      if (isHighlight && highlightCategory) {
        pulseLinesRef.current.push(line);
      }
    }

    for (const { mesh, tile } of tileEntriesRef.current) {
      const inHighlight = !highlightCategory || tileInCategory(tile, highlightRoiIds);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = inHighlight ? 0.88 : 0.08;
      mat.emissiveIntensity = inHighlight ? 0.28 : 0.04;
      mat.needsUpdate = true;
    }
  }, [highlightCategory, highlightRoiIds, tileInCategory, sceneReady, tileVersion]);

  // Build heat tiles once — NOT on every hover (was melting laptops)
  useEffect(() => {
    const group = heatmapGroupRef.current;
    if (!group || !sceneReady || !heatmapData?.tiles?.length || !shelfRegions.length) return;

    disposeGroup(group);
    tileEntriesRef.current = [];

    const { tileSize, tiles } = heatmapData;
    const values = tiles.map(t => t[colorKpi]).filter(v => v > 0);
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 1;
    const maxNorm = Math.min(
      colorKpi === 'visits' ? heatmapData.maxVisits : heatmapData.maxDwell,
      p95 * 2,
    ) || 1;

    for (const tile of tiles) {
      const inShelf = shelfRegions.some(z => isPointInPolygon({ x: tile.x, z: tile.z }, z.vertices));
      if (!inShelf) continue;

      const heightValue = tile[heightKpi];
      const colorValue = tile[colorKpi];
      const normH = maxNorm > 0 ? Math.min(heightValue / maxNorm, 1.4) : 0;
      const barH = 0.04 + normH * 1.1;
      const color = getHeatColor(colorValue, maxNorm);

      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.88,
        emissive: color,
        emissiveIntensity: 0.28,
      });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(tileSize * 0.82, barH, tileSize * 0.82),
        mat,
      );
      mesh.position.set(tile.x, ELEVATION + barH / 2, tile.z);
      group.add(mesh);
      tileEntriesRef.current.push({ mesh, tile });
    }
    setTileVersion(v => v + 1);
  }, [heatmapData, shelfRegions, heightKpi, colorKpi, sceneReady]);

  const expectedShelfZones = useMemo(
    () => categories.reduce((n, c) => n + (c.roiIds?.length ?? 0), 0),
    [categories],
  );

  const showEmpty = sceneReady
    && !isLoading
    && !regionsLoading
    && (!heatmapData?.tiles?.length || !shelfRegions.length);

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
        {(regionsLoading || (isLoading && !heatmapData?.tiles?.length)) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/60 pointer-events-none">
            <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
          </div>
        )}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500 z-10 pointer-events-none px-4 text-center">
            {!shelfRegions.length && expectedShelfZones > 0
              ? 'Shelf zones could not be matched to the floor plan'
              : !shelfRegions.length
                ? 'No mapped shelf zones for categories'
                : 'No heatmap data for this period'}
          </div>
        )}
        <div ref={canvasRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
