import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import WebSocket from 'ws';

const execAsync = promisify(exec);
const router = Router();

const EDGE_PORT = parseInt(process.env.EDGE_PORT) || 8080;
const EDGE_WS_PORT = parseInt(process.env.EDGE_WS_PORT) || 8081;
const EDGE_HOSTNAME_PATTERNS = ['edge', 'ulisse', 'lidar-edge', 'concentrator'];

// Helper: Get edge device IP from tailscale status
async function getEdgeDevices() {
  try {
    const { stdout } = await execAsync('tailscale status --json');
    const status = JSON.parse(stdout);
    const devices = [];

    if (status.Peer) {
      for (const [id, peer] of Object.entries(status.Peer)) {
        const hostname = peer.HostName?.toLowerCase() || '';
        const matchesPattern = EDGE_HOSTNAME_PATTERNS.some(p => hostname.includes(p));
        const hasEdgeTag = peer.Tags?.includes('tag:edge');

        if (matchesPattern || hasEdgeTag) {
          devices.push({
            edgeId: id,
            hostname: peer.HostName || peer.DNSName?.split('.')[0] || 'unknown',
            tailscaleIp: peer.TailscaleIPs?.[0] || '',
            online: peer.Online || false,
            lastSeen: peer.LastSeen || new Date().toISOString(),
            os: peer.OS || '',
            tags: peer.Tags || [],
          });
        }
      }
    }

    return devices;
  } catch (err) {
    console.error('❌ Failed to get edge devices:', err.message);
    
    // Return mock devices in development
    if (process.env.MOCK_EDGE === 'true') {
      return [
        {
          edgeId: 'mock-edge-001',
          hostname: 'edge-entrance',
          tailscaleIp: '100.64.0.201',
          online: true,
          lastSeen: new Date().toISOString(),
          os: 'linux',
          tags: ['tag:edge'],
        },
        {
          edgeId: 'mock-edge-002',
          hostname: 'edge-checkout',
          tailscaleIp: '100.64.0.202',
          online: true,
          lastSeen: new Date().toISOString(),
          os: 'linux',
          tags: ['tag:edge'],
        },
      ];
    }
    
    throw err;
  }
}

// Helper: Validate tailscale IP is in known edges list
async function validateEdgeIp(edgeId) {
  const edges = await getEdgeDevices();
  const edge = edges.find(e => e.edgeId === edgeId);
  if (!edge) {
    throw new Error(`Edge device ${edgeId} not found in tailnet`);
  }
  if (!edge.online) {
    throw new Error(`Edge device ${edgeId} is offline`);
  }
  return edge;
}

// Helper: Proxy request to edge server
async function proxyToEdge(edge, path, options = {}) {
  const url = `http://${edge.tailscaleIp}:${EDGE_PORT}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Edge returned ${response.status}: ${text}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error(`Request to edge ${edge.hostname} timed out`);
    }
    throw err;
  }
}

// Helper: Compute config hash
function computeConfigHash(config) {
  const sorted = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash('sha256').update(sorted).digest('hex').substring(0, 16);
}

// ============ EDGE DISCOVERY ============

// GET /api/edge-commissioning/scan-edges
router.get('/scan-edges', async (req, res) => {
  try {
    const db = req.app.get('db');
    const devices = await getEdgeDevices();
    
    // Merge with custom display names from database
    const edgesWithNames = devices.map(device => {
      const stored = db.prepare('SELECT display_name, notes FROM edge_devices WHERE edge_id = ?').get(device.edgeId);
      return {
        ...device,
        displayName: stored?.display_name || device.hostname,
        notes: stored?.notes || null,
      };
    });
    
    res.json({
      edges: edgesWithNames,
      scanTime: new Date().toISOString(),
      count: edgesWithNames.length,
    });
  } catch (err) {
    console.error('❌ Edge scan failed:', err.message);
    res.status(500).json({ error: 'Failed to scan for edge devices', message: err.message });
  }
});

// PUT /api/edge-commissioning/edge/:edgeId/name - Update edge display name
router.put('/edge/:edgeId/name', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { edgeId } = req.params;
    const { displayName, notes } = req.body;

    if (!displayName || displayName.trim().length === 0) {
      return res.status(400).json({ error: 'displayName is required' });
    }

    // Get edge info from tailscale
    const edges = await getEdgeDevices();
    const edge = edges.find(e => e.edgeId === edgeId);
    
    const now = new Date().toISOString();
    
    // Upsert the edge device record
    db.prepare(`
      INSERT INTO edge_devices (edge_id, display_name, tailscale_ip, original_hostname, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(edge_id) DO UPDATE SET
        display_name = excluded.display_name,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(
      edgeId,
      displayName.trim(),
      edge?.tailscaleIp || null,
      edge?.hostname || null,
      notes || null,
      now,
      now
    );

    console.log(`✏️ Edge ${edgeId} renamed to "${displayName}"`);
    
    res.json({
      success: true,
      edgeId,
      displayName: displayName.trim(),
      notes: notes || null,
    });
  } catch (err) {
    console.error(`❌ Failed to update edge name:`, err.message);
    res.status(500).json({ error: 'Failed to update edge name', message: err.message });
  }
});

// ============ EDGE LIDAR OPERATIONS ============

// POST /api/edge-commissioning/edge/:edgeId/scan-lidars
router.post('/edge/:edgeId/scan-lidars', async (req, res) => {
  try {
    const { edgeId } = req.params;
    const edge = await validateEdgeIp(edgeId);

    // Proxy to edge's LAN scan endpoint
    const result = await proxyToEdge(edge, '/api/edge/lidar/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000, // LAN scan can take a while
    });

    res.json({
      success: true,
      edgeId,
      hostname: edge.hostname,
      ...result,
    });
  } catch (err) {
    console.error(`❌ LiDAR scan on edge ${req.params.edgeId} failed:`, err.message);
    res.status(500).json({ error: 'Failed to scan LiDARs on edge', message: err.message });
  }
});

// GET /api/edge-commissioning/edge/:edgeId/inventory
router.get('/edge/:edgeId/inventory', async (req, res) => {
  try {
    const { edgeId } = req.params;
    const edge = await validateEdgeIp(edgeId);

    // Proxy to edge's inventory endpoint
    const result = await proxyToEdge(edge, '/api/edge/lidar/inventory', {
      method: 'GET',
      timeout: 10000,
    });

    res.json({
      success: true,
      edgeId,
      hostname: edge.hostname,
      tailscaleIp: edge.tailscaleIp,
      ...result,
    });
  } catch (err) {
    console.error(`❌ Inventory fetch from edge ${req.params.edgeId} failed:`, err.message);
    
    // Return mock data in development
    if (process.env.MOCK_EDGE === 'true') {
      return res.json({
        success: true,
        edgeId: req.params.edgeId,
        hostname: 'mock-edge',
        tailscaleIp: '100.64.0.201',
        lidars: [
          { lidarId: 'lidar-001', ip: '192.168.10.21', mac: 'AA:BB:CC:DD:EE:01', vendor: 'Livox', model: 'Mid-360', reachable: true, ports: [56000] },
          { lidarId: 'lidar-002', ip: '192.168.10.22', mac: 'AA:BB:CC:DD:EE:02', vendor: 'Livox', model: 'Mid-360', reachable: true, ports: [56000] },
          { lidarId: 'lidar-003', ip: '192.168.10.23', mac: 'AA:BB:CC:DD:EE:03', vendor: 'Ouster', model: 'OS1-32', reachable: false, ports: [] },
        ],
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch edge inventory', message: err.message });
  }
});

// GET /api/edge-commissioning/edge/:edgeId/status
router.get('/edge/:edgeId/status', async (req, res) => {
  try {
    const { edgeId } = req.params;
    const edge = await validateEdgeIp(edgeId);

    // Proxy to edge's status endpoint
    const result = await proxyToEdge(edge, '/api/edge/status', {
      method: 'GET',
      timeout: 5000,
    });

    res.json({
      success: true,
      edgeId,
      hostname: edge.hostname,
      tailscaleIp: edge.tailscaleIp,
      online: true,
      ...result,
    });
  } catch (err) {
    console.error(`❌ Status fetch from edge ${req.params.edgeId} failed:`, err.message);
    
    // Return offline status
    res.json({
      success: false,
      edgeId: req.params.edgeId,
      online: false,
      error: err.message,
    });
  }
});

// ============ LIDAR COMMISSIONING ============

// POST /api/edge-commissioning/proxy-scan - Scan for LiDARs at specific IPs
router.post('/proxy-scan', async (req, res) => {
  try {
    const { edgeId, tailscaleIp, targetIps } = req.body;

    if (!tailscaleIp) {
      return res.status(400).json({ ok: false, error: 'tailscaleIp is required' });
    }

    const url = `http://${tailscaleIp}:${EDGE_PORT}/api/edge/lidar/scan`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetIps, quickScan: false }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();
      res.json(data);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  } catch (err) {
    console.error('❌ Proxy scan failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/edge-commissioning/proxy-set-ip - Set LiDAR IP via edge
router.post('/proxy-set-ip', async (req, res) => {
  try {
    const { edgeId, tailscaleIp, currentIp, newIp, destIp } = req.body;

    if (!tailscaleIp || !currentIp || !newIp) {
      return res.status(400).json({ 
        success: false, 
        error: 'tailscaleIp, currentIp, and newIp are required' 
      });
    }

    const url = `http://${tailscaleIp}:${EDGE_PORT}/api/edge/lidar/set-ip`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // Longer timeout for reboot

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentIp, newIp, destIp: destIp || tailscaleIp.replace(/\.\d+$/, '.102') }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();
      res.json(data);
    } catch (err) {
      clearTimeout(timeout);
      // Timeout likely means LiDAR is rebooting - that's success
      if (err.name === 'AbortError') {
        return res.json({ 
          success: true, 
          message: 'LiDAR is rebooting with new IP',
          newIp,
          rebootDetected: true,
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('❌ Proxy set-ip failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/edge-commissioning/proxy-config/:ip - Get LiDAR config via edge
router.get('/proxy-config', async (req, res) => {
  try {
    const { tailscaleIp, lidarIp } = req.query;

    if (!tailscaleIp || !lidarIp) {
      return res.status(400).json({ success: false, error: 'tailscaleIp and lidarIp are required' });
    }

    const url = `http://${tailscaleIp}:${EDGE_PORT}/api/edge/lidar/get-config/${lidarIp}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      const data = await response.json();
      res.json(data);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  } catch (err) {
    console.error('❌ Proxy get-config failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ POINT CLOUD STREAMING ============

// GET /api/edge-commissioning/pcl/snapshot - Get point cloud snapshot from LiDAR via edge
router.get('/pcl/snapshot', async (req, res) => {
  try {
    const { tailscaleIp, lidarIp, duration = 100, maxPoints = 30000, downsample = 2, format = 'json', model = 'RS16' } = req.query;

    if (!tailscaleIp || !lidarIp) {
      return res.status(400).json({ success: false, error: 'tailscaleIp and lidarIp are required' });
    }

    const url = `http://${tailscaleIp}:${EDGE_PORT}/api/edge/pcl/snapshot?ip=${lidarIp}&duration=${duration}&maxPoints=${maxPoints}&downsample=${downsample}&format=${format}&model=${model}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout for point cloud capture

    console.log(`📡 Proxying point cloud snapshot from ${lidarIp} via edge ${tailscaleIp}`);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      // For binary format, pipe the response directly
      if (format === 'binary') {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Point-Count', response.headers.get('X-Point-Count') || '0');
        res.setHeader('X-Lidar-IP', lidarIp);
        const buffer = await response.arrayBuffer();
        return res.send(Buffer.from(buffer));
      }

      // For PLY format
      if (format === 'ply') {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="pointcloud-${lidarIp.replace(/\./g, '-')}.ply"`);
        const text = await response.text();
        return res.send(text);
      }

      // JSON format
      const data = await response.json();
      res.json(data);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  } catch (err) {
    console.error('❌ Point cloud snapshot failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/edge-commissioning/pcl/snapshot - Same as GET but with body params
router.post('/pcl/snapshot', async (req, res) => {
  try {
    const { tailscaleIp, lidarIp, duration = 100, maxPoints = 30000, downsample = 2, format = 'json', model = 'RS16' } = req.body;

    if (!tailscaleIp || !lidarIp) {
      return res.status(400).json({ success: false, error: 'tailscaleIp and lidarIp are required' });
    }

    const url = `http://${tailscaleIp}:${EDGE_PORT}/api/edge/pcl/snapshot`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    console.log(`📡 Proxying point cloud snapshot from ${lidarIp} via edge ${tailscaleIp}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: lidarIp, duration, maxPoints, downsample, format, model }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // For binary format, pipe the response directly
      if (format === 'binary') {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Point-Count', response.headers.get('X-Point-Count') || '0');
        res.setHeader('X-Lidar-IP', lidarIp);
        const buffer = await response.arrayBuffer();
        return res.send(Buffer.from(buffer));
      }

      // For PLY format
      if (format === 'ply') {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="pointcloud-${lidarIp.replace(/\./g, '-')}.ply"`);
        const text = await response.text();
        return res.send(text);
      }

      // JSON format
      const data = await response.json();
      res.json(data);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  } catch (err) {
    console.error('❌ Point cloud snapshot failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ PLACEMENTS (READ-ONLY) ============

// GET /api/edge-commissioning/placements
router.get('/placements', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    // Get venue info
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
    console.log(`🔍 Venue lookup: ${venueId} -> dwg_layout_version_id: ${venue?.dwg_layout_version_id || 'NULL'}`);

    // For Edge Commissioning, we only show DWG-based lidar_instances (from LiDAR Planner)
    // Manual lidar_placements are legacy and not used for commissioning
    let dwgPlacements = [];
    let roiBounds = null;
    let dwgLayout = null;
    
    if (venue?.dwg_layout_version_id) {
      const dwgRows = db.prepare(`
        SELECT i.*, m.name as model_name, m.hfov_deg, m.vfov_deg, m.range_m
        FROM lidar_instances i
        LEFT JOIN lidar_models m ON i.model_id = m.id
        WHERE i.layout_version_id = ?
      `).all(venue.dwg_layout_version_id);
      
      dwgPlacements = dwgRows.map(row => ({
        id: row.id,
        venueId: venueId,
        layoutVersionId: row.layout_version_id,
        source: row.source,
        modelId: row.model_id,
        modelName: row.model_name,
        position: { x: row.x_m, y: row.mount_y_m, z: row.z_m },
        rotation: { x: 0, y: row.yaw_deg * Math.PI / 180, z: 0 },
        mountHeight: row.mount_y_m,
        fovHorizontal: row.hfov_deg || 360,
        fovVertical: row.vfov_deg || 30,
        range: row.range_m || 10,
        enabled: true,
      }));

      // Try to fetch saved LiDAR ROI and layout from dwg_layout_versions
      try {
        const layoutVersion = db.prepare(`
          SELECT lv.lidar_roi_json, lv.layout_json, di.unit_scale_to_m 
          FROM dwg_layout_versions lv
          LEFT JOIN dwg_imports di ON lv.import_id = di.id
          WHERE lv.id = ?
        `).get(venue.dwg_layout_version_id);
        if (layoutVersion?.lidar_roi_json) {
          const roiVertices = JSON.parse(layoutVersion.lidar_roi_json);
          if (roiVertices && roiVertices.length >= 3) {
            const xs = roiVertices.map(v => v.x);
            const zs = roiVertices.map(v => v.z);
            roiBounds = {
              minX: Math.min(...xs),
              maxX: Math.max(...xs),
              minZ: Math.min(...zs),
              maxZ: Math.max(...zs),
            };
            console.log(`📐 ROI from lidar_roi_json: X[${roiBounds.minX.toFixed(1)}, ${roiBounds.maxX.toFixed(1)}] Z[${roiBounds.minZ.toFixed(1)}, ${roiBounds.maxZ.toFixed(1)}]`);
          }
        }
        // Parse DWG layout for wireframe visualization
        if (layoutVersion?.layout_json) {
          const layoutData = JSON.parse(layoutVersion.layout_json);
          dwgLayout = {
            fixtures: layoutData.fixtures || [],
            bounds: layoutData.bounds || null,
            unitScaleToM: layoutVersion.unit_scale_to_m || 0.001,
          };
          console.log(`🗺️ DWG layout: ${dwgLayout.fixtures.length} fixtures`);
        }
      } catch (e) {
        console.warn('Failed to fetch layout data:', e.message);
      }

      // Fallback: Calculate ROI bounds from LiDAR positions (with margin)
      if (!roiBounds && dwgPlacements.length > 0) {
        const xs = dwgPlacements.map(p => p.position.x);
        const zs = dwgPlacements.map(p => p.position.z);
        const margin = 10; // 10m margin around LiDAR positions
        roiBounds = {
          minX: Math.min(...xs) - margin,
          maxX: Math.max(...xs) + margin,
          minZ: Math.min(...zs) - margin,
          maxZ: Math.max(...zs) + margin,
        };
        console.log(`📐 ROI from LiDAR positions (fallback): X[${roiBounds.minX.toFixed(1)}, ${roiBounds.maxX.toFixed(1)}] Z[${roiBounds.minZ.toFixed(1)}, ${roiBounds.maxZ.toFixed(1)}]`);
      }
    }

    console.log(`📍 Placements: ${dwgPlacements.length} DWG LiDAR instances`);
    if (roiBounds) {
      console.log(`📐 Computed bounds: X[${roiBounds.minX.toFixed(1)}, ${roiBounds.maxX.toFixed(1)}] Z[${roiBounds.minZ.toFixed(1)}, ${roiBounds.maxZ.toFixed(1)}]`);
    }

    res.json({
      placements: dwgPlacements,
      count: dwgPlacements.length,
      roiBounds,
      dwgLayout: dwgLayout || null,
    });
  } catch (err) {
    console.error('❌ Failed to fetch placements:', err.message);
    res.status(500).json({ error: 'Failed to fetch placements', message: err.message });
  }
});

// ============ PAIRINGS ============

// GET /api/edge-commissioning/pairings
router.get('/pairings', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, edgeId } = req.query;

    let query = 'SELECT * FROM edge_lidar_pairings WHERE 1=1';
    const params = [];

    if (venueId) {
      query += ' AND venue_id = ?';
      params.push(venueId);
    }
    if (edgeId) {
      query += ' AND edge_id = ?';
      params.push(edgeId);
    }

    query += ' ORDER BY created_at DESC';

    const rows = db.prepare(query).all(...params);
    const pairings = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      edgeId: row.edge_id,
      edgeTailscaleIp: row.edge_tailscale_ip,
      placementId: row.placement_id,
      lidarId: row.lidar_id,
      lidarIp: row.lidar_ip,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ pairings, count: pairings.length });
  } catch (err) {
    console.error('❌ Failed to fetch pairings:', err.message);
    res.status(500).json({ error: 'Failed to fetch pairings', message: err.message });
  }
});

// POST /api/edge-commissioning/pairings
router.post('/pairings', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, edgeId, edgeTailscaleIp, placementId, lidarId, lidarIp } = req.body;

    if (!venueId || !edgeId || !placementId || !lidarId) {
      return res.status(400).json({ error: 'venueId, edgeId, placementId, and lidarId are required' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    // Upsert: replace existing pairing for this placement
    db.prepare(`
      INSERT INTO edge_lidar_pairings (id, venue_id, edge_id, edge_tailscale_ip, placement_id, lidar_id, lidar_ip, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(venue_id, placement_id) DO UPDATE SET
        edge_id = excluded.edge_id,
        edge_tailscale_ip = excluded.edge_tailscale_ip,
        lidar_id = excluded.lidar_id,
        lidar_ip = excluded.lidar_ip,
        updated_at = excluded.updated_at
    `).run(id, venueId, edgeId, edgeTailscaleIp || null, placementId, lidarId, lidarIp || null, now, now);

    res.status(201).json({
      success: true,
      pairing: {
        id,
        venueId,
        edgeId,
        edgeTailscaleIp,
        placementId,
        lidarId,
        lidarIp,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err) {
    console.error('❌ Failed to create pairing:', err.message);
    res.status(500).json({ error: 'Failed to create pairing', message: err.message });
  }
});

// DELETE /api/edge-commissioning/pairings/cleanup-orphaned - Remove pairings referencing non-existent placements
// NOTE: This must be defined BEFORE /pairings/:id to avoid :id matching 'cleanup-orphaned'
router.delete('/pairings/cleanup-orphaned', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    // Find orphaned pairings (placement_id not in lidar_instances or lidar_placements)
    const orphanedPairings = db.prepare(`
      SELECT p.id, p.placement_id, p.lidar_id 
      FROM edge_lidar_pairings p
      WHERE p.venue_id = ?
        AND p.placement_id NOT IN (SELECT id FROM lidar_instances)
        AND p.placement_id NOT IN (SELECT id FROM lidar_placements)
    `).all(venueId);

    if (orphanedPairings.length === 0) {
      return res.json({ success: true, deleted: 0, message: 'No orphaned pairings found' });
    }

    // Delete orphaned pairings
    const result = db.prepare(`
      DELETE FROM edge_lidar_pairings 
      WHERE venue_id = ?
        AND placement_id NOT IN (SELECT id FROM lidar_instances)
        AND placement_id NOT IN (SELECT id FROM lidar_placements)
    `).run(venueId);

    console.log(`🧹 Cleaned up ${result.changes} orphaned pairings for venue ${venueId}`);
    res.json({ 
      success: true, 
      deleted: result.changes,
      orphanedPairings: orphanedPairings.map(p => ({ id: p.id, placementId: p.placement_id, lidarId: p.lidar_id }))
    });
  } catch (err) {
    console.error('❌ Failed to cleanup orphaned pairings:', err.message);
    res.status(500).json({ error: 'Failed to cleanup orphaned pairings', message: err.message });
  }
});

// DELETE /api/edge-commissioning/pairings/by-placement/:placementId
router.delete('/pairings/by-placement/:placementId', (req, res) => {
  try {
    const db = req.app.get('db');
    const { placementId } = req.params;
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    const result = db.prepare('DELETE FROM edge_lidar_pairings WHERE venue_id = ? AND placement_id = ?').run(venueId, placementId);

    res.json({ success: true, deleted: result.changes });
  } catch (err) {
    console.error('❌ Failed to delete pairing:', err.message);
    res.status(500).json({ error: 'Failed to delete pairing', message: err.message });
  }
});

// DELETE /api/edge-commissioning/pairings/:id
router.delete('/pairings/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;

    const result = db.prepare('DELETE FROM edge_lidar_pairings WHERE id = ?').run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Pairing not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to delete pairing:', err.message);
    res.status(500).json({ error: 'Failed to delete pairing', message: err.message });
  }
});

// ============ DEPLOYMENT ============

// POST /api/edge-commissioning/edge/:edgeId/deploy
router.post('/edge/:edgeId/deploy', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { edgeId } = req.params;
    const { venueId } = req.body;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId is required in request body' });
    }

    // Validate edge
    const edge = await validateEdgeIp(edgeId);

    // Get all pairings for this edge+venue
    const pairings = db.prepare(`
      SELECT * FROM edge_lidar_pairings 
      WHERE venue_id = ? AND edge_id = ?
    `).all(venueId, edgeId);

    if (pairings.length === 0) {
      return res.status(400).json({ error: 'No pairings found for this edge and venue' });
    }

    // Get venue info
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // Get ROI bounds from DWG layout if available
    let roiBounds = null;
    let roiVertices = null;
    if (venue.dwg_layout_version_id) {
      const layoutVersion = db.prepare('SELECT layout_json FROM dwg_layout_versions WHERE id = ?').get(venue.dwg_layout_version_id);
      if (layoutVersion?.layout_json) {
        const layoutData = JSON.parse(layoutVersion.layout_json);
        if (layoutData.bounds) {
          roiBounds = {
            minX: layoutData.bounds.minX || 0,
            maxX: layoutData.bounds.maxX || venue.width,
            minZ: layoutData.bounds.minY || 0, // DWG uses Y for what we call Z
            maxZ: layoutData.bounds.maxY || venue.depth,
          };
        }
      }
      
      // Also check for ROI defined in regions_of_interest (LiDAR planning ROI)
      const roi = db.prepare(`
        SELECT vertices FROM regions_of_interest 
        WHERE venue_id = ? AND dwg_layout_id = ? 
        ORDER BY created_at DESC LIMIT 1
      `).get(venueId, venue.dwg_layout_version_id);
      
      if (roi?.vertices) {
        try {
          roiVertices = JSON.parse(roi.vertices);
          // Calculate bounds from vertices
          const xs = roiVertices.map(v => v.x);
          const zs = roiVertices.map(v => v.z || v.y); // Handle both x,z and x,y formats
          roiBounds = {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minZ: Math.min(...zs),
            maxZ: Math.max(...zs),
          };
        } catch (e) {
          console.warn('Failed to parse ROI vertices:', e.message);
        }
      }
    }

    // Fallback to venue dimensions if no ROI found
    if (!roiBounds) {
      roiBounds = {
        minX: 0,
        maxX: venue.width || 20,
        minZ: 0,
        maxZ: venue.depth || 15,
      };
    }

    // Calculate venue dimensions from ROI
    const venueWidth = roiBounds.maxX - roiBounds.minX;
    const venueDepth = roiBounds.maxZ - roiBounds.minZ;

    console.log(`📐 ROI bounds: X[${roiBounds.minX.toFixed(2)}, ${roiBounds.maxX.toFixed(2)}] Z[${roiBounds.minZ.toFixed(2)}, ${roiBounds.maxZ.toFixed(2)}]`);
    console.log(`📐 Venue dimensions: ${venueWidth.toFixed(2)}m x ${venueDepth.toFixed(2)}m`);

    // Get placements with model info
    const placementIds = pairings.map(p => p.placement_id);
    const lidarConfigs = [];

    for (const pairing of pairings) {
      // Try lidar_placements first
      let placement = db.prepare('SELECT * FROM lidar_placements WHERE id = ?').get(pairing.placement_id);
      let modelInfo = { name: 'Unknown', hfov_deg: 360, vfov_deg: 30, range_m: 10, dome_mode: true };

      if (placement) {
        modelInfo = {
          name: 'Manual Placement',
          hfov_deg: placement.fov_horizontal,
          vfov_deg: placement.fov_vertical,
          range_m: placement.range,
          dome_mode: true,
        };
      } else {
        // Try lidar_instances (DWG-based)
        const instance = db.prepare(`
          SELECT i.*, m.name as model_name, m.hfov_deg, m.vfov_deg, m.range_m, m.dome_mode
          FROM lidar_instances i
          LEFT JOIN lidar_models m ON i.model_id = m.id
          WHERE i.id = ?
        `).get(pairing.placement_id);

        if (instance) {
          placement = {
            position_x: instance.x_m,
            position_y: instance.mount_y_m,
            position_z: instance.z_m,
            rotation_y: instance.yaw_deg * Math.PI / 180,
            mount_height: instance.mount_y_m,
          };
          modelInfo = {
            name: instance.model_name || 'Unknown',
            hfov_deg: instance.hfov_deg || 360,
            vfov_deg: instance.vfov_deg || 30,
            range_m: instance.range_m || 10,
            dome_mode: !!instance.dome_mode,
          };
        }
      }

      if (!placement) {
        console.warn(`⚠️ Placement ${pairing.placement_id} not found, skipping`);
        continue;
      }

      // Transform coordinates to ROI-relative (SW corner = 0,0)
      const transformedX = placement.position_x - roiBounds.minX;
      const transformedZ = placement.position_z - roiBounds.minZ;

      lidarConfigs.push({
        lidarId: pairing.lidar_id,
        ip: pairing.lidar_ip,
        model: modelInfo,
        extrinsics: {
          x_m: transformedX,
          y_m: placement.mount_height || placement.position_y,
          z_m: transformedZ,
          yaw_deg: (placement.rotation_y || 0) * 180 / Math.PI,
          pitch_deg: 0,
          roll_deg: 0,
        },
        // Also include original DWG coordinates for reference
        dwgCoordinates: {
          x_m: placement.position_x,
          z_m: placement.position_z,
        },
      });
    }

    if (lidarConfigs.length === 0) {
      return res.status(400).json({ error: 'No valid placements found for paired LiDARs' });
    }

    // Build extrinsics package
    const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    const deploymentId = uuidv4();

    // Transform ROI vertices to relative coordinates if available
    let transformedRoiVertices = null;
    if (roiVertices) {
      transformedRoiVertices = roiVertices.map(v => ({
        x: v.x - roiBounds.minX,
        z: (v.z || v.y) - roiBounds.minZ,
      }));
    }

    const extrinsicsPackage = {
      deploymentId,
      edgeId,
      venueId,
      mqtt: {
        broker: MQTT_BROKER,
        topic: `hyperspace/trajectories/${edgeId}`,
        qos: 1,
      },
      lidars: lidarConfigs,
      coordinateFrame: {
        origin: 'ROI SW corner at floor level',
        roiOffset: { x: roiBounds.minX, z: roiBounds.minZ },
        axis: 'X-East, Y-Up, Z-North',
        units: 'meters',
      },
      venueBounds: {
        width: venueWidth,
        depth: venueDepth,
        minX: 0,
        maxX: venueWidth,
        minZ: 0,
        maxZ: venueDepth,
        floorY: 0,
        ceilingY: venue.height || 4.5,
      },
      roiVertices: transformedRoiVertices,
      operationalParams: {
        groundPlaneY: 0,
        ceilingY: venue.height || 4.5,
        minDetectionHeight: 0.3,
        maxDetectionHeight: 2.2,
        publishRateHz: 10,
      },
    };

    const configHash = computeConfigHash(extrinsicsPackage);

    // Deploy to edge
    let edgeResponse;
    try {
      edgeResponse = await proxyToEdge(edge, '/api/edge/config/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extrinsicsPackage),
        timeout: 15000,
      });
    } catch (err) {
      // Store failed deploy attempt
      const historyId = uuidv4();
      db.prepare(`
        INSERT INTO edge_deploy_history (id, venue_id, edge_id, edge_tailscale_ip, config_hash, config_json, status, edge_response_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(historyId, venueId, edgeId, edge.tailscaleIp, configHash, JSON.stringify(extrinsicsPackage), 'failed', JSON.stringify({ error: err.message }));

      return res.status(500).json({
        success: false,
        deploymentId,
        configHash,
        error: 'Failed to deploy to edge',
        message: err.message,
      });
    }

    // Store successful deploy
    const historyId = uuidv4();
    db.prepare(`
      INSERT INTO edge_deploy_history (id, venue_id, edge_id, edge_tailscale_ip, config_hash, config_json, status, edge_response_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(historyId, venueId, edgeId, edge.tailscaleIp, configHash, JSON.stringify(extrinsicsPackage), 'applied', JSON.stringify(edgeResponse));

    res.json({
      success: true,
      deploymentId,
      configHash,
      appliedConfigHash: edgeResponse.appliedConfigHash || configHash,
      edgeResponse,
      lidarCount: lidarConfigs.length,
    });
  } catch (err) {
    console.error(`❌ Deploy to edge ${req.params.edgeId} failed:`, err.message);
    res.status(500).json({ error: 'Failed to deploy to edge', message: err.message });
  }
});

// GET /api/edge-commissioning/export-config - Export config JSON for algorithm provider (offline handoff)
router.get('/export-config', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, edgeId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    // Get venue info
    const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // Get ROI bounds from DWG layout if available
    let roiBounds = null;
    let roiVertices = null;
    if (venue.dwg_layout_version_id) {
      const layoutVersion = db.prepare('SELECT layout_json FROM dwg_layout_versions WHERE id = ?').get(venue.dwg_layout_version_id);
      if (layoutVersion?.layout_json) {
        const layoutData = JSON.parse(layoutVersion.layout_json);
        if (layoutData.bounds) {
          roiBounds = {
            minX: layoutData.bounds.minX || 0,
            maxX: layoutData.bounds.maxX || venue.width,
            minZ: layoutData.bounds.minY || 0,
            maxZ: layoutData.bounds.maxY || venue.depth,
          };
        }
      }
      
      const roi = db.prepare(`
        SELECT vertices FROM regions_of_interest 
        WHERE venue_id = ? AND dwg_layout_id = ? 
        ORDER BY created_at DESC LIMIT 1
      `).get(venueId, venue.dwg_layout_version_id);
      
      if (roi?.vertices) {
        try {
          roiVertices = JSON.parse(roi.vertices);
          const xs = roiVertices.map(v => v.x);
          const zs = roiVertices.map(v => v.z || v.y);
          roiBounds = {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minZ: Math.min(...zs),
            maxZ: Math.max(...zs),
          };
        } catch (e) {
          console.warn('Failed to parse ROI vertices:', e.message);
        }
      }
    }

    if (!roiBounds) {
      roiBounds = {
        minX: 0,
        maxX: venue.width || 20,
        minZ: 0,
        maxZ: venue.depth || 15,
      };
    }

    const venueWidth = roiBounds.maxX - roiBounds.minX;
    const venueDepth = roiBounds.maxZ - roiBounds.minZ;

    // Get pairings
    let pairingsQuery = 'SELECT * FROM edge_lidar_pairings WHERE venue_id = ?';
    const params = [venueId];
    if (edgeId) {
      pairingsQuery += ' AND edge_id = ?';
      params.push(edgeId);
    }
    const pairings = db.prepare(pairingsQuery).all(...params);

    // Build LiDAR configs
    const lidarConfigs = [];
    for (const pairing of pairings) {
      let placement = db.prepare('SELECT * FROM lidar_placements WHERE id = ?').get(pairing.placement_id);
      let modelInfo = { name: 'Unknown', hfov_deg: 360, vfov_deg: 30, range_m: 10, dome_mode: true };

      if (!placement) {
        const instance = db.prepare(`
          SELECT i.*, m.name as model_name, m.hfov_deg, m.vfov_deg, m.range_m, m.dome_mode
          FROM lidar_instances i
          LEFT JOIN lidar_models m ON i.model_id = m.id
          WHERE i.id = ?
        `).get(pairing.placement_id);

        if (instance) {
          placement = {
            position_x: instance.x_m,
            position_y: instance.mount_y_m,
            position_z: instance.z_m,
            rotation_y: instance.yaw_deg * Math.PI / 180,
            mount_height: instance.mount_y_m,
          };
          modelInfo = {
            name: instance.model_name || 'Unknown',
            hfov_deg: instance.hfov_deg || 360,
            vfov_deg: instance.vfov_deg || 30,
            range_m: instance.range_m || 10,
            dome_mode: !!instance.dome_mode,
          };
        }
      } else {
        modelInfo = {
          name: 'Manual Placement',
          hfov_deg: placement.fov_horizontal,
          vfov_deg: placement.fov_vertical,
          range_m: placement.range,
          dome_mode: true,
        };
      }

      if (!placement) continue;

      const transformedX = placement.position_x - roiBounds.minX;
      const transformedZ = placement.position_z - roiBounds.minZ;

      lidarConfigs.push({
        lidarId: pairing.lidar_id,
        ip: pairing.lidar_ip,
        model: modelInfo,
        extrinsics: {
          x_m: transformedX,
          y_m: placement.mount_height || placement.position_y,
          z_m: transformedZ,
          yaw_deg: (placement.rotation_y || 0) * 180 / Math.PI,
          pitch_deg: 0,
          roll_deg: 0,
        },
      });
    }

    // Transform ROI vertices
    let transformedRoiVertices = null;
    if (roiVertices) {
      transformedRoiVertices = roiVertices.map(v => ({
        x: v.x - roiBounds.minX,
        z: (v.z || v.y) - roiBounds.minZ,
      }));
    }

    const exportConfig = {
      exportedAt: new Date().toISOString(),
      edgeId: edgeId || 'all-edges',
      venueId,
      venueName: venue.name,
      coordinateFrame: {
        origin: 'ROI SW corner at floor level',
        roiOffset: { x: roiBounds.minX, z: roiBounds.minZ },
        axis: 'X-East, Y-Up, Z-North',
        units: 'meters',
      },
      venueBounds: {
        width: venueWidth,
        depth: venueDepth,
        minX: 0,
        maxX: venueWidth,
        minZ: 0,
        maxZ: venueDepth,
        floorY: 0,
        ceilingY: venue.height || 4.5,
      },
      roiVertices: transformedRoiVertices,
      lidars: lidarConfigs,
      operationalParams: {
        groundPlaneY: 0,
        ceilingY: venue.height || 4.5,
        minDetectionHeight: 0.3,
        maxDetectionHeight: 2.2,
        publishRateHz: 10,
      },
      mqttTemplate: {
        broker: '<MQTT_BROKER_URL>',
        topic: `hyperspace/trajectories/<edgeId>`,
        qos: 1,
      },
      notes: {
        coordinateTransform: 'All coordinates are relative to ROI SW corner. Original DWG coordinates can be recovered by adding roiOffset.',
        mqttFormat: 'Algorithm should publish JSON with { timestamp, edgeId, venueId, tracks: [{ trackId, x, y, z, vx, vy, vz, confidence, class }] }',
      },
    };

    res.json(exportConfig);
  } catch (err) {
    console.error('❌ Failed to export config:', err.message);
    res.status(500).json({ error: 'Failed to export config', message: err.message });
  }
});

// GET /api/edge-commissioning/deploy-history
router.get('/deploy-history', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, edgeId, limit = 20 } = req.query;

    let query = 'SELECT * FROM edge_deploy_history WHERE 1=1';
    const params = [];

    if (venueId) {
      query += ' AND venue_id = ?';
      params.push(venueId);
    }
    if (edgeId) {
      query += ' AND edge_id = ?';
      params.push(edgeId);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const rows = db.prepare(query).all(...params);
    const history = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      edgeId: row.edge_id,
      edgeTailscaleIp: row.edge_tailscale_ip,
      configHash: row.config_hash,
      status: row.status,
      edgeResponse: row.edge_response_json ? JSON.parse(row.edge_response_json) : null,
      createdAt: row.created_at,
    }));

    res.json({ history, count: history.length });
  } catch (err) {
    console.error('❌ Failed to fetch deploy history:', err.message);
    res.status(500).json({ error: 'Failed to fetch deploy history', message: err.message });
  }
});

// ============ COMMISSIONED LIDARS ============

// GET /api/edge-commissioning/commissioned-lidars
router.get('/commissioned-lidars', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, edgeId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId is required' });
    }

    let query = 'SELECT * FROM commissioned_lidars WHERE venue_id = ?';
    const params = [venueId];

    if (edgeId) {
      query += ' AND edge_id = ?';
      params.push(edgeId);
    }

    query += ' ORDER BY assigned_ip ASC';

    const rows = db.prepare(query).all(...params);
    const lidars = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      edgeId: row.edge_id,
      assignedIp: row.assigned_ip,
      label: row.label,
      originalIp: row.original_ip,
      vendor: row.vendor,
      model: row.model,
      macAddress: row.mac_address,
      commissionedAt: row.commissioned_at,
      lastSeenAt: row.last_seen_at,
      status: row.status,
    }));

    res.json({ lidars, count: lidars.length });
  } catch (err) {
    console.error('❌ Failed to fetch commissioned lidars:', err.message);
    res.status(500).json({ error: 'Failed to fetch commissioned lidars', message: err.message });
  }
});

// POST /api/edge-commissioning/commissioned-lidars
router.post('/commissioned-lidars', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, edgeId, assignedIp, label, originalIp, vendor, model, macAddress } = req.body;

    if (!venueId || !edgeId || !assignedIp) {
      return res.status(400).json({ error: 'venueId, edgeId, and assignedIp are required' });
    }

    const id = `cl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Upsert - update if IP already exists for venue
    const existing = db.prepare('SELECT id FROM commissioned_lidars WHERE venue_id = ? AND assigned_ip = ?')
      .get(venueId, assignedIp);

    if (existing) {
      db.prepare(`
        UPDATE commissioned_lidars 
        SET edge_id = ?, label = ?, original_ip = ?, vendor = ?, model = ?, mac_address = ?, 
            commissioned_at = datetime('now'), status = 'active'
        WHERE id = ?
      `).run(edgeId, label || null, originalIp || '192.168.1.200', vendor || 'RoboSense', 
             model || null, macAddress || null, existing.id);

      res.json({ success: true, id: existing.id, updated: true });
    } else {
      db.prepare(`
        INSERT INTO commissioned_lidars (id, venue_id, edge_id, assigned_ip, label, original_ip, vendor, model, mac_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, venueId, edgeId, assignedIp, label || null, originalIp || '192.168.1.200', 
             vendor || 'RoboSense', model || null, macAddress || null);

      res.json({ success: true, id, created: true });
    }
  } catch (err) {
    console.error('❌ Failed to save commissioned lidar:', err.message);
    res.status(500).json({ error: 'Failed to save commissioned lidar', message: err.message });
  }
});

// DELETE /api/edge-commissioning/commissioned-lidars/:id
router.delete('/commissioned-lidars/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;

    db.prepare('DELETE FROM commissioned_lidars WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Failed to delete commissioned lidar:', err.message);
    res.status(500).json({ error: 'Failed to delete commissioned lidar', message: err.message });
  }
});

// GET /api/edge-commissioning/next-available-ip
router.get('/next-available-ip', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId is required' });
    }

    // Get all assigned IPs for this venue
    const rows = db.prepare('SELECT assigned_ip FROM commissioned_lidars WHERE venue_id = ? AND status = ?')
      .all(venueId, 'active');

    const usedIps = new Set(rows.map(r => r.assigned_ip));

    // Find next available IP starting from 201
    let nextOctet = 201;
    while (usedIps.has(`192.168.1.${nextOctet}`) && nextOctet < 255) {
      nextOctet++;
    }

    if (nextOctet >= 255) {
      return res.status(400).json({ error: 'No available IP addresses' });
    }

    res.json({ 
      nextIp: `192.168.1.${nextOctet}`,
      usedCount: usedIps.size,
      usedIps: Array.from(usedIps).sort(),
    });
  } catch (err) {
    console.error('❌ Failed to get next available IP:', err.message);
    res.status(500).json({ error: 'Failed to get next available IP', message: err.message });
  }
});

// ============ WEBSOCKET PROXY FOR POINT CLOUD STREAMING ============

// Setup WebSocket proxy server for point cloud streaming
// Call this from the main server with the HTTP server instance
export function setupPointCloudWebSocket(httpServer) {
  // Use noServer mode to avoid conflicting with Socket.IO's WebSocket handling
  const wss = new WebSocket.Server({ noServer: true });
  
  // Handle upgrade requests manually, only for /ws/pcl path
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
    console.log(`[WS Upgrade] Path: ${pathname}, URL: ${request.url}`);
    
    // Only handle /ws/pcl requests, let Socket.IO handle others
    if (pathname === '/ws/pcl') {
      console.log(`[WS Upgrade] Handling point cloud WebSocket`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Don't close socket for other paths - Socket.IO will handle them
  });
  
  wss.on('connection', (clientWs, req) => {
    const url = new URL(req.url, `http://localhost`);
    const tailscaleIp = url.searchParams.get('tailscaleIp');
    const lidarIp = url.searchParams.get('lidarIp') || '192.168.1.200';
    const model = url.searchParams.get('model') || 'RS16';
    const downsample = url.searchParams.get('downsample') || '2';
    
    if (!tailscaleIp) {
      clientWs.send(JSON.stringify({ type: 'error', error: 'tailscaleIp is required' }));
      clientWs.close();
      return;
    }
    
    console.log(`📡 [WS Proxy] Client connected for LiDAR ${lidarIp} via edge ${tailscaleIp}`);
    
    // Connect to edge server's WebSocket
    const edgeWsUrl = `ws://${tailscaleIp}:${EDGE_WS_PORT}/?ip=${lidarIp}&model=${model}&downsample=${downsample}`;
    let edgeWs;
    
    try {
      edgeWs = new WebSocket(edgeWsUrl);
    } catch (err) {
      console.error(`❌ [WS Proxy] Failed to connect to edge: ${err.message}`);
      clientWs.send(JSON.stringify({ type: 'error', error: `Failed to connect to edge: ${err.message}` }));
      clientWs.close();
      return;
    }
    
    edgeWs.on('open', () => {
      console.log(`✅ [WS Proxy] Connected to edge ${tailscaleIp}:${EDGE_WS_PORT}`);
      clientWs.send(JSON.stringify({ type: 'connected', edgeIp: tailscaleIp, lidarIp }));
    });
    
    edgeWs.on('message', (data, isBinary) => {
      // Forward data from edge to client
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });
    
    edgeWs.on('error', (err) => {
      console.error(`❌ [WS Proxy] Edge connection error: ${err.message}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    });
    
    edgeWs.on('close', () => {
      console.log(`📡 [WS Proxy] Edge connection closed for ${lidarIp}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    });
    
    // Handle client disconnect
    clientWs.on('close', () => {
      console.log(`📡 [WS Proxy] Client disconnected for ${lidarIp}`);
      if (edgeWs.readyState === WebSocket.OPEN) {
        edgeWs.close();
      }
    });
    
    clientWs.on('error', (err) => {
      console.error(`❌ [WS Proxy] Client error: ${err.message}`);
    });
  });
  
  console.log('🔌 Point cloud WebSocket proxy ready at /ws/pcl');
  return wss;
}

export default router;
