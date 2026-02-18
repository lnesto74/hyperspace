import { v4 as uuidv4 } from 'uuid';

// Smart KPI Templates for different retail scenarios
const SMART_KPI_TEMPLATES = {
  'cashier-queue': {
    id: 'cashier-queue',
    name: 'Cashier Queue Analysis',
    description: 'Automatically detect checkout lanes and create queue zones to measure waiting times',
    icon: 'ShoppingCart',
    objectTypes: ['checkout'],
    namePatterns: ['cashier', 'checkout', 'register', 'till', 'cassa', 'kasse'],
    kpis: [
      { id: 'queueLength', name: 'Queue Length', unit: 'people', description: 'Current number of people waiting' },
      { id: 'avgWaitTime', name: 'Avg Wait Time', unit: 'minutes', description: 'Average time spent in queue' },
      { id: 'maxWaitTime', name: 'Max Wait Time', unit: 'minutes', description: 'Longest wait time recorded' },
      { id: 'serviceRate', name: 'Service Rate', unit: 'people/hr', description: 'Customers served per hour' },
      { id: 'abandonmentRate', name: 'Abandonment Rate', unit: '%', description: 'Percentage who left the queue' },
    ],
    roiConfig: {
      queueDepth: 4.0,      // meters in front of cashier
      queueWidthPadding: 0.2, // extra width on each side
      serviceZoneDepth: 2.5,  // zone right at the counter (extended toward exit)
      color: '#ef4444',       // red for queue zones
      serviceColor: '#22c55e', // green for service zones
    }
  },
  'entrance-flow': {
    id: 'entrance-flow',
    name: 'Entrance Traffic Analysis',
    description: 'Track footfall, entry/exit patterns, and peak hours at entrances',
    icon: 'DoorOpen',
    objectTypes: ['entrance'],
    namePatterns: ['entrance', 'entry', 'exit', 'door', 'gate', 'ingresso', 'uscita'],
    kpis: [
      { id: 'footfall', name: 'Footfall', unit: 'people', description: 'Total entries' },
      { id: 'entryRate', name: 'Entry Rate', unit: 'people/hr', description: 'Entries per hour' },
      { id: 'exitRate', name: 'Exit Rate', unit: 'people/hr', description: 'Exits per hour' },
      { id: 'peakHour', name: 'Peak Hour', unit: 'time', description: 'Busiest hour of the day' },
      { id: 'avgDwellStore', name: 'Avg Store Dwell', unit: 'minutes', description: 'Average time in store' },
    ],
    roiConfig: {
      zoneDepth: 3.0,
      zoneWidthPadding: 0.5,
      color: '#3b82f6',
    }
  },
  'shelf-engagement': {
    id: 'shelf-engagement',
    name: 'Shelf Engagement',
    description: 'Measure customer interaction with product shelves and displays',
    icon: 'Package',
    objectTypes: ['shelf'],
    namePatterns: ['shelf', 'display', 'gondola', 'rack', 'scaffale', 'regal'],
    kpis: [
      { id: 'browsingRate', name: 'Browsing Rate', unit: '%', description: 'Visitors who stopped at shelf' },
      { id: 'avgBrowseTime', name: 'Avg Browse Time', unit: 'seconds', description: 'Time spent looking' },
      { id: 'passbyCount', name: 'Passby Count', unit: 'people', description: 'People who walked past' },
      { id: 'conversionRate', name: 'Engagement Rate', unit: '%', description: 'Stopped vs passed' },
    ],
    roiConfig: {
      engagementDepth: 1.5,
      engagementDepthMin: 0.5,
      engagementDepthMax: 3.0,
      color: '#8b5cf6',
      colorBack: '#a78bfa',
    }
  }
};

export class SmartKpiService {
  constructor(db) {
    this.db = db;
  }

  // Analyze venue objects and return available smart KPI options
  analyzeVenue(venueId) {
    const objects = this.getVenueObjects(venueId);
    const venue = this.getVenue(venueId);
    
    if (!venue) {
      return { error: 'Venue not found', availableKpis: [] };
    }

    const availableKpis = [];
    const detectedObjects = {};

    // Check each template against venue objects
    for (const [templateId, template] of Object.entries(SMART_KPI_TEMPLATES)) {
      const matchingObjects = this.findMatchingObjects(objects, template);
      
      if (matchingObjects.length > 0) {
        detectedObjects[templateId] = matchingObjects;
        availableKpis.push({
          ...template,
          detectedCount: matchingObjects.length,
          detectedObjects: matchingObjects.map(o => ({
            id: o.id,
            name: o.name,
            type: o.type,
            position: o.position,
          })),
          canGenerate: true,
        });
      }
    }

    return {
      venueId,
      venueName: venue.name,
      venueSize: { width: venue.width, depth: venue.depth },
      totalObjects: objects.length,
      availableKpis,
      detectedObjects,
    };
  }

  // Find objects matching a template's criteria
  findMatchingObjects(objects, template) {
    return objects.filter(obj => {
      // Check object type
      const typeMatch = template.objectTypes.includes(obj.type);
      
      // Check name patterns (case insensitive)
      const nameMatch = template.namePatterns.some(pattern => 
        obj.name.toLowerCase().includes(pattern.toLowerCase())
      );
      
      return typeMatch || nameMatch;
    });
  }

  // Generate ROIs for a specific smart KPI template
  generateRoisForTemplate(venueId, templateId, options = {}) {
    const template = SMART_KPI_TEMPLATES[templateId];
    if (!template) {
      return { error: 'Unknown template', rois: [] };
    }

    const objects = this.getVenueObjects(venueId);
    const matchingObjects = this.findMatchingObjects(objects, template);

    if (matchingObjects.length === 0) {
      return { error: 'No matching objects found', rois: [] };
    }

    let rois = [];

    switch (templateId) {
      case 'cashier-queue':
        rois = this.generateCashierQueueRois(matchingObjects, template.roiConfig, options);
        break;
      case 'entrance-flow':
        rois = this.generateEntranceRois(matchingObjects, template.roiConfig, options);
        break;
      case 'shelf-engagement':
        rois = this.generateShelfRois(matchingObjects, template.roiConfig, options);
        break;
      default:
        return { error: 'Template ROI generation not implemented', rois: [] };
    }

    return {
      templateId,
      templateName: template.name,
      generatedRois: rois,
      kpis: template.kpis,
    };
  }

  // Generate queue zones for cashiers
  generateCashierQueueRois(cashiers, config, options = {}) {
    const rois = [];
    
    // For DWG mode, scale depths based on available space
    // options.sceneSize contains { width, depth } of the DWG scene
    let queueDepth = config.queueDepth;
    let serviceZoneDepth = config.serviceZoneDepth;
    
    // Apply roiDimensions overrides if provided
    if (options.roiDimensions) {
      if (options.roiDimensions.service) {
        serviceZoneDepth = options.roiDimensions.service.depth || serviceZoneDepth;
        // Width will be applied per-cashier below
      }
      if (options.roiDimensions.queue) {
        queueDepth = options.roiDimensions.queue.depth || queueDepth;
      }
      console.log(`[SmartKPI] Using custom dimensions: service depth=${serviceZoneDepth}m, queue depth=${queueDepth}m`);
    }
    
    if (options.sceneSize && options.sceneBounds) {
      // Calculate available space from checkout positions to scene edge
      // Checkouts are at specific Z positions, queue extends toward the scene edge
      const { minZ, maxZ } = options.sceneBounds;
      
      // Find the checkout closest to the edge (minimum Z in this case)
      const checkoutMinZ = Math.min(...cashiers.map(c => c.position.z));
      
      // Available space from checkout edge to scene boundary
      // Checkout depth is small (~0.1m), so most space is for service+queue
      const availableDepth = Math.abs(checkoutMinZ - minZ) - 0.2; // 0.2m buffer
      
      if (availableDepth > 0) {
        // Split available space: 25% service, 75% queue
        serviceZoneDepth = Math.min(serviceZoneDepth, availableDepth * 0.25);
        queueDepth = Math.min(queueDepth, availableDepth * 0.75);
      }
      console.log(`[SmartKPI] DWG bounds: checkout at Z=${checkoutMinZ.toFixed(2)}, scene edge at Z=${minZ.toFixed(2)}, available=${availableDepth.toFixed(2)}m`);
      console.log(`[SmartKPI] Scaled depths: service=${serviceZoneDepth.toFixed(2)}m, queue=${queueDepth.toFixed(2)}m`);
    } else {
      // Manual mode: use provided options or defaults
      queueDepth = options.queueDepth || queueDepth;
      serviceZoneDepth = options.serviceZoneDepth || serviceZoneDepth;
    }

    // Sort cashiers by position (left to right, then front to back)
    const sorted = [...cashiers].sort((a, b) => {
      if (Math.abs(a.position.x - b.position.x) < 0.5) {
        return a.position.z - b.position.z;
      }
      return a.position.x - b.position.x;
    });

    // Detect if cashiers are aligned in a row (common retail layout)
    // If so, use a consistent facing direction for all
    const xSpread = Math.max(...sorted.map(c => c.position.x)) - Math.min(...sorted.map(c => c.position.x));
    const zSpread = Math.max(...sorted.map(c => c.position.z)) - Math.min(...sorted.map(c => c.position.z));
    const isHorizontalRow = xSpread > zSpread * 2 && sorted.length > 1;
    const isVerticalRow = zSpread > xSpread * 2 && sorted.length > 1;

    // Determine default facing direction for aligned cashiers
    // For horizontal row: queues go in +Z direction (forward)
    // For vertical row: queues go in +X direction (right)
    let defaultFacingX = 0;
    let defaultFacingZ = 1; // Default: queues go forward (+Z)
    
    if (isVerticalRow) {
      defaultFacingX = 1;
      defaultFacingZ = 0;
    }

    sorted.forEach((cashier, index) => {
      const { position, scale, rotation, name, source } = cashier;
      
      // For aligned rows, use consistent direction; otherwise use individual rotation
      let facingX, facingZ, rotY;
      
      // DWG fixtures have accurate rotation from CAD
      // But rot_deg describes counter orientation, not customer flow direction
      // Customer flow is perpendicular to the counter
      const isDwgFixture = source === 'dwg';
      const hasExplicitRotation = rotation?.y && Math.abs(rotation.y) > 0.01;
      
      if (isDwgFixture && hasExplicitRotation) {
        // DWG fixtures: rot_deg describes counter orientation
        // Queue extends perpendicular to counter, toward +Z (store interior)
        rotY = rotation.y;
        
        // Perpendicular to counter (add 90°)
        const perpendicularRotY = rotY + Math.PI / 2;
        facingZ = Math.cos(perpendicularRotY);
        facingX = Math.sin(perpendicularRotY);
        
        // Flip to +Z direction (toward store interior, not exit)
        if (facingZ < 0) {
          facingZ = -facingZ;
          facingX = -facingX;
        }
      } else if (isHorizontalRow || isVerticalRow) {
        // Manual mode: use consistent facing for aligned cashiers
        facingX = defaultFacingX;
        facingZ = defaultFacingZ;
        rotY = isVerticalRow ? Math.PI / 2 : 0;
      } else {
        // Fallback: use individual cashier rotation
        rotY = rotation?.y || 0;
        facingZ = Math.cos(rotY);
        facingX = Math.sin(rotY);
      }
      
      // Cashier dimensions - for DWG fixtures rotated 90°, swap width/depth
      let cashierWidth = scale?.x || 1.5;
      let cashierDepth = scale?.z || 0.8;
      
      // For DWG fixtures with 90° rotation, the footprint dimensions are swapped
      // Use the smaller dimension as width (perpendicular to queue flow)
      if (isDwgFixture && hasExplicitRotation) {
        // With rot_deg=90, the "depth" in footprint is actually the width in scene
        cashierWidth = Math.min(scale?.x || 1.5, scale?.z || 0.8);
        cashierDepth = Math.max(scale?.x || 1.5, scale?.z || 0.8);
      }
      
      // Queue zone width (use roiDimensions override if provided, otherwise cashier width + padding)
      let actualQueueWidth = cashierWidth + config.queueWidthPadding * 2;
      let actualServiceWidth = actualQueueWidth;
      let serviceOffsetX = 0, serviceOffsetZ = 0;
      let queueOffsetX = 0, queueOffsetZ = 0;
      
      if (options.roiDimensions?.service) {
        if (options.roiDimensions.service.width) actualServiceWidth = options.roiDimensions.service.width;
        serviceOffsetX = options.roiDimensions.service.offsetX || 0;
        serviceOffsetZ = options.roiDimensions.service.offsetZ || 0;
      }
      if (options.roiDimensions?.queue) {
        if (options.roiDimensions.queue.width) actualQueueWidth = options.roiDimensions.queue.width;
        queueOffsetX = options.roiDimensions.queue.offsetX || 0;
        queueOffsetZ = options.roiDimensions.queue.offsetZ || 0;
      }
      
      // ROI rotation: the "depth" dimension should extend in the facing direction
      // In createRectangularRoi, depth extends in +Z before rotation
      // After rotation by θ, depth direction becomes (sin(θ), cos(θ))
      // So to make depth extend in (facingX, facingZ), use θ = atan2(facingX, facingZ)
      const roiRotation = Math.atan2(facingX, facingZ);
      
      // Extra offset toward exit direction (-Z = 1 tile = 1 meter)
      const exitOffset = -1.0;
      
      // Use sequential numbering for unique names (sorted by X position)
      const checkoutNumber = index + 1;
      
      // Service zone (right at the counter, shifted 1m toward exit + user offsets)
      const serviceZone = this.createRectangularRoi({
        name: `Checkout ${checkoutNumber} - Service`,
        centerX: position.x + facingX * (cashierDepth / 2 + serviceZoneDepth / 2 + exitOffset) + serviceOffsetX,
        centerZ: position.z + facingZ * (cashierDepth / 2 + serviceZoneDepth / 2 + exitOffset) + serviceOffsetZ,
        width: actualServiceWidth,
        depth: serviceZoneDepth,
        rotation: roiRotation,
        color: config.serviceColor,
        opacity: 0.4,
        metadata: {
          type: 'smart-kpi',
          template: 'cashier-queue',
          zoneType: 'service',
          cashierId: cashier.id,
          cashierIndex: index,
        }
      });
      rois.push(serviceZone);

      // Queue zone (in front of service zone, shifted 1m toward exit + user offsets)
      const queueZone = this.createRectangularRoi({
        name: `Checkout ${checkoutNumber} - Queue`,
        centerX: position.x + facingX * (cashierDepth / 2 + serviceZoneDepth + queueDepth / 2 + exitOffset) + queueOffsetX,
        centerZ: position.z + facingZ * (cashierDepth / 2 + serviceZoneDepth + queueDepth / 2 + exitOffset) + queueOffsetZ,
        width: actualQueueWidth,
        depth: queueDepth,
        rotation: roiRotation,
        color: config.color,
        opacity: 0.35,
        metadata: {
          type: 'smart-kpi',
          template: 'cashier-queue',
          zoneType: 'queue',
          cashierId: cashier.id,
          cashierIndex: index,
        }
      });
      rois.push(queueZone);
    });

    return rois;
  }

  // Generate entrance/exit zones
  generateEntranceRois(entrances, config, options = {}) {
    const rois = [];
    const { zoneDepth = config.zoneDepth } = options;

    entrances.forEach((entrance, index) => {
      const { position, scale, rotation, name } = entrance;
      const entranceWidth = scale?.x || 2.0;
      const zoneWidth = entranceWidth + config.zoneWidthPadding * 2;

      const roi = this.createRectangularRoi({
        name: `${name} - Traffic Zone`,
        centerX: position.x,
        centerZ: position.z,
        width: zoneWidth,
        depth: zoneDepth,
        rotation: rotation?.y || 0,
        color: config.color,
        opacity: 0.35,
        metadata: {
          type: 'smart-kpi',
          template: 'entrance-flow',
          entranceId: entrance.id,
          entranceIndex: index,
        }
      });
      rois.push(roi);
    });

    return rois;
  }

  // Generate shelf engagement zones (both sides - left and right of shelf)
  generateShelfRois(shelves, config, options = {}) {
    const rois = [];
    const { engagementDepth = config.engagementDepth } = options;

    // Sort shelves by position for consistent numbering (X then Z)
    const sortedShelves = [...shelves].sort((a, b) => {
      const dx = (a.position?.x || 0) - (b.position?.x || 0);
      if (Math.abs(dx) > 0.5) return dx;
      return (a.position?.z || 0) - (b.position?.z || 0);
    });

    sortedShelves.forEach((shelf, index) => {
      const { position, scale, rotation, name } = shelf;
      const scaleX = scale?.x || 2.0;
      const scaleZ = scale?.z || 0.5;
      const rotY = rotation?.y || 0;

      // Use sequential numbering for unique names (like checkout zones)
      const shelfNumber = index + 1;
      // Create unique display name: "Shelf 1", "Shelf 2", etc. (or original name if already unique)
      const uniqueName = this.isNameUnique(name, shelves) ? name : `Shelf ${shelfNumber}`;

      // Determine long side (product display) for zone height
      const longSide = Math.max(scaleX, scaleZ);
      
      // Offset from shelf center to zone center
      // Zones go in ±X direction, so offset by scaleX/2 (half the shelf width in X)
      const offset = scaleX / 2 + engagementDepth / 2;

      // Apply rotation - zones always go on LEFT/RIGHT sides (±X direction before rotation)
      const cos = Math.cos(rotY);
      const sin = Math.sin(rotY);
      
      // LEFT zone direction (+X rotated)
      const leftDirX = cos;
      const leftDirZ = sin;
      // RIGHT zone direction (-X rotated)
      const rightDirX = -cos;
      const rightDirZ = -sin;

      // LEFT engagement zone
      const leftRoi = this.createRectangularRoi({
        name: `${uniqueName} - Engagement (Left)`,
        centerX: position.x + leftDirX * offset,
        centerZ: position.z + leftDirZ * offset,
        width: engagementDepth,
        depth: longSide,
        rotation: rotY,
        color: config.color,
        opacity: 0.3,
        metadata: {
          type: 'smart-kpi',
          template: 'shelf-engagement',
          zoneType: 'left',
          shelfId: shelf.id,
          shelfIndex: index,
        }
      });
      rois.push(leftRoi);

      // RIGHT engagement zone
      const rightRoi = this.createRectangularRoi({
        name: `${uniqueName} - Engagement (Right)`,
        centerX: position.x + rightDirX * offset,
        centerZ: position.z + rightDirZ * offset,
        width: engagementDepth,
        depth: longSide,
        rotation: rotY,
        color: config.colorBack || config.color,
        opacity: 0.3,
        metadata: {
          type: 'smart-kpi',
          template: 'shelf-engagement',
          zoneType: 'right',
          shelfId: shelf.id,
          shelfIndex: index,
        }
      });
      rois.push(rightRoi);
    });

    return rois;
  }

  // Check if a name is unique among a list of objects
  isNameUnique(name, objects) {
    const count = objects.filter(obj => obj.name === name).length;
    return count <= 1;
  }

  // Create a rectangular ROI with rotation support
  createRectangularRoi({ name, centerX, centerZ, width, depth, rotation = 0, color, opacity, metadata }) {
    const halfW = width / 2;
    const halfD = depth / 2;
    
    // Corner points before rotation
    const corners = [
      { x: -halfW, z: -halfD },
      { x: halfW, z: -halfD },
      { x: halfW, z: halfD },
      { x: -halfW, z: halfD },
    ];

    // Apply rotation and translation
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    
    const vertices = corners.map(c => ({
      x: centerX + c.x * cos - c.z * sin,
      z: centerZ + c.x * sin + c.z * cos,
    }));

    return {
      id: uuidv4(),
      name,
      vertices,
      color,
      opacity,
      metadata,
    };
  }

  // Delete existing smart-kpi zones for a specific template
  // dwgLayoutId: null = manual mode, non-null = DWG mode
  deleteExistingSmartKpiZones(venueId, templateId, dwgLayoutId = null) {
    // Define name patterns for each template to identify auto-generated zones
    const templatePatterns = {
      'cashier-queue': ['- Queue', '- Service'],
      'entrance-flow': ['- Traffic Zone'],
      'shelf-engagement': ['- Engagement'],  // Matches both "- Engagement (Front)" and "- Engagement (Back)"
    };

    const patterns = templatePatterns[templateId];
    if (!patterns || patterns.length === 0) return 0;

    // Get ROIs for this venue filtered by mode
    let rows;
    if (dwgLayoutId) {
      // DWG mode - only delete from this specific layout
      rows = this.db.prepare('SELECT id, name FROM regions_of_interest WHERE venue_id = ? AND dwg_layout_id = ?').all(venueId, dwgLayoutId);
    } else {
      // Manual mode - only delete manual zones (dwg_layout_id IS NULL)
      rows = this.db.prepare('SELECT id, name FROM regions_of_interest WHERE venue_id = ? AND dwg_layout_id IS NULL').all(venueId);
    }
    
    let deletedCount = 0;
    const deleteStmt = this.db.prepare('DELETE FROM regions_of_interest WHERE id = ?');
    
    for (const row of rows) {
      // Check if this ROI name contains any of the template's patterns
      const isSmartKpiZone = patterns.some(pattern => row.name.includes(pattern));
      if (isSmartKpiZone) {
        deleteStmt.run(row.id);
        deletedCount++;
      }
    }

    const modeStr = dwgLayoutId ? `DWG layout ${dwgLayoutId}` : 'manual mode';
    console.log(`🗑️ Deleted ${deletedCount} existing ${templateId} zones for venue ${venueId} (${modeStr})`);
    return deletedCount;
  }

  // Save generated ROIs to database (replaces existing ones for the template)
  // dwgLayoutId: null = manual mode, non-null = DWG mode
  saveRois(venueId, rois, templateId, dwgLayoutId = null) {
    // First, delete existing zones for this template (filtered by mode)
    if (templateId) {
      this.deleteExistingSmartKpiZones(venueId, templateId, dwgLayoutId);
    }

    const now = new Date().toISOString();
    const savedRois = [];

    for (const roi of rois) {
      const roiData = {
        id: roi.id,
        venueId,
        dwgLayoutId,  // Mode separation
        name: roi.name,
        vertices: roi.vertices,
        color: roi.color,
        opacity: roi.opacity,
        metadata: roi.metadata || null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        const stmt = this.db.prepare(`
          INSERT INTO regions_of_interest (id, venue_id, dwg_layout_id, name, vertices, color, opacity, metadata_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          roiData.id,
          roiData.venueId,
          roiData.dwgLayoutId,
          roiData.name,
          JSON.stringify(roiData.vertices),
          roiData.color,
          roiData.opacity,
          roiData.metadata ? JSON.stringify(roiData.metadata) : null,
          roiData.createdAt,
          roiData.updatedAt
        );
        savedRois.push(roiData);
      } catch (err) {
        console.error('Failed to save ROI:', err);
      }
    }

    return savedRois;
  }

  // Helper: Get venue objects
  getVenueObjects(venueId) {
    const rows = this.db.prepare('SELECT * FROM venue_objects WHERE venue_id = ?').all(venueId);
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      type: row.type,
      name: row.name,
      position: { x: row.position_x, y: row.position_y, z: row.position_z },
      rotation: { x: row.rotation_x, y: row.rotation_y, z: row.rotation_z },
      scale: { x: row.scale_x, y: row.scale_y, z: row.scale_z },
      color: row.color,
    }));
  }

  // Helper: Get venue
  getVenue(venueId) {
    return this.db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
  }

  // ==================== DWG MODE SUPPORT ====================

  /**
   * Get DWG layout data with fixtures transformed to Three.js scene coordinates
   * 
   * Coordinate transformation (must match dwgImport.js as-venue-bootstrap):
   * 1. DWG fixtures are in mm (pose2d.x, pose2d.y)
   * 2. Convert to meters using unit_scale_to_m * scaleCorrection
   * 3. Calculate center from RAW DWG BOUNDS (not fixture bounds)
   * 4. Apply shift to center on venue floor
   */
  getDwgLayoutFixtures(layoutId, venue) {
    const layout = this.db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(layoutId);
    if (!layout) return null;

    const layoutData = JSON.parse(layout.layout_json);
    const { fixtures, unit_scale_to_m: unitScale, bounds: rawBounds } = layoutData;

    if (!fixtures || fixtures.length === 0) return { fixtures: [], layoutData };

    // Get scaleCorrection from venue transform if available, default to 1.0
    let scaleCorrection = 1.0;
    if (venue.dwg_transform_json) {
      try {
        const transform = JSON.parse(venue.dwg_transform_json);
        scaleCorrection = transform.scaleCorrection || 1.0;
      } catch (e) {}
    }
    const effectiveScale = unitScale * scaleCorrection;

    // Use RAW DWG bounds for center offset (SAME as dwgImport.js bootstrap)
    const dwgBounds = rawBounds || { minX: 0, maxX: 20000, minY: 0, maxY: 15000 };
    const centerX = ((dwgBounds.minX + dwgBounds.maxX) / 2) * effectiveScale;
    const centerZ = ((dwgBounds.minY + dwgBounds.maxY) / 2) * effectiveScale;

    // Calculate fixture bounds for venue sizing
    let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity;
    fixtures.forEach(fixture => {
      const { footprint, pose2d } = fixture;
      const points = footprint?.points || [];
      
      if (points.length > 0) {
        points.forEach(pt => {
          fMinX = Math.min(fMinX, pt.x);
          fMaxX = Math.max(fMaxX, pt.x);
          fMinY = Math.min(fMinY, pt.y);
          fMaxY = Math.max(fMaxY, pt.y);
        });
      } else if (pose2d) {
        const hw = (footprint?.w || 1000) / 2;
        const hd = (footprint?.d || 1000) / 2;
        fMinX = Math.min(fMinX, pose2d.x - hw);
        fMaxX = Math.max(fMaxX, pose2d.x + hw);
        fMinY = Math.min(fMinY, pose2d.y - hd);
        fMaxY = Math.max(fMaxY, pose2d.y + hd);
      }
    });

    // Calculate shift to center on venue floor (SAME as dwgImport.js bootstrap)
    const contentCenterX = ((fMinX + fMaxX) / 2) * effectiveScale - centerX;
    const contentCenterZ = ((fMinY + fMaxY) / 2) * effectiveScale - centerZ;
    const venueFloorCenterX = venue.width / 2;
    const venueFloorCenterZ = venue.depth / 2;
    const shiftX = venueFloorCenterX - contentCenterX;
    const shiftZ = venueFloorCenterZ - contentCenterZ;

    console.log(`[SmartKPI] Raw DWG bounds: ${dwgBounds.minX?.toFixed(0)} to ${dwgBounds.maxX?.toFixed(0)} x ${dwgBounds.minY?.toFixed(0)} to ${dwgBounds.maxY?.toFixed(0)}`);
    console.log(`[SmartKPI] Center offset: ${centerX.toFixed(2)}, ${centerZ.toFixed(2)}, effectiveScale: ${effectiveScale}`);
    console.log(`[SmartKPI] Shift to venue floor: ${shiftX.toFixed(2)}, ${shiftZ.toFixed(2)}`);

    // Transform fixtures to Three.js scene coordinates (centered on venue floor)
    const transformedFixtures = fixtures.map(fixture => {
      const points = fixture.footprint?.points || [];
      let xRaw, zRaw;
      
      // Use centroid for polygon fixtures (same as bootstrap)
      if (points.length >= 3) {
        const sumX = points.reduce((sum, pt) => sum + pt.x, 0);
        const sumY = points.reduce((sum, pt) => sum + pt.y, 0);
        xRaw = (sumX / points.length) * effectiveScale - centerX;
        zRaw = (sumY / points.length) * effectiveScale - centerZ;
      } else {
        xRaw = fixture.pose2d.x * effectiveScale - centerX;
        zRaw = fixture.pose2d.y * effectiveScale - centerZ;
      }
      
      // Apply shift to center on venue floor (SAME as bootstrap)
      const sceneX = xRaw + shiftX;
      const sceneZ = zRaw + shiftZ;

      // Get fixture dimensions in meters
      const widthM = (fixture.footprint?.w || fixture.group_size?.w || 1000) * effectiveScale;
      const depthM = (fixture.footprint?.d || fixture.group_size?.d || 1000) * effectiveScale;

      // Get fixture type from mapping
      const fixtureType = fixture.mapping?.type || 'unknown';

      return {
        id: fixture.id,
        venueId: venue.id,
        type: fixtureType,
        name: fixture.mapping?.custom_name || `${fixtureType}-${fixture.id.slice(-4)}`,
        position: { x: sceneX, y: 0, z: sceneZ },
        rotation: { x: 0, y: -(fixture.pose2d.rot_deg || 0) * Math.PI / 180, z: 0 }, // Negate like bootstrap
        scale: { x: widthM, y: 1, z: depthM },
        source: 'dwg',
        originalFixture: fixture,
      };
    });

    return { fixtures: transformedFixtures, layoutData, effectiveScale, centerX, centerZ, shiftX, shiftZ };
  }

  /**
   * Analyze DWG layout and return available smart KPI options
   */
  analyzeDwgLayout(layoutId, venueId) {
    const venue = this.getVenue(venueId);
    if (!venue) {
      return { error: 'Venue not found', availableKpis: [] };
    }

    const dwgData = this.getDwgLayoutFixtures(layoutId, venue);
    if (!dwgData) {
      return { error: 'DWG layout not found', availableKpis: [] };
    }

    const { fixtures } = dwgData;
    const availableKpis = [];
    const detectedObjects = {};

    // Check each template against DWG fixtures
    for (const [templateId, template] of Object.entries(SMART_KPI_TEMPLATES)) {
      const matchingFixtures = this.findMatchingDwgFixtures(fixtures, template);
      
      if (matchingFixtures.length > 0) {
        detectedObjects[templateId] = matchingFixtures;
        availableKpis.push({
          ...template,
          detectedCount: matchingFixtures.length,
          detectedObjects: matchingFixtures.map(f => ({
            id: f.id,
            name: f.name,
            type: f.type,
            position: f.position,
          })),
          canGenerate: true,
        });
      }
    }

    return {
      layoutId,
      venueId,
      venueName: venue.name,
      venueSize: { width: venue.width, depth: venue.depth },
      totalFixtures: fixtures.length,
      availableKpis,
      detectedObjects,
      mode: 'dwg',
    };
  }

  /**
   * Find DWG fixtures matching a template's criteria
   */
  findMatchingDwgFixtures(fixtures, template) {
    return fixtures.filter(fixture => {
      // Check fixture type from mapping
      const typeMatch = template.objectTypes.includes(fixture.type);
      
      // Check name patterns (case insensitive)
      const nameMatch = template.namePatterns.some(pattern => 
        fixture.name.toLowerCase().includes(pattern.toLowerCase()) ||
        fixture.type.toLowerCase().includes(pattern.toLowerCase())
      );
      
      return typeMatch || nameMatch;
    });
  }

  /**
   * Generate ROIs for a DWG layout template
   * 
   * IMPORTANT: For DWG venues, we use venue_objects (which have correct scale from bootstrap)
   * instead of re-reading from DWG layout (which would have raw footprint dimensions).
   */
  generateRoisForDwgTemplate(layoutId, venueId, templateId, options = {}) {
    const template = SMART_KPI_TEMPLATES[templateId];
    if (!template) {
      return { error: 'Unknown template', rois: [] };
    }

    const venue = this.getVenue(venueId);
    if (!venue) {
      return { error: 'Venue not found', rois: [] };
    }

    // Use venue_objects instead of DWG layout fixtures
    // venue_objects already have correct scale from the DWG bootstrap process
    const venueObjects = this.getVenueObjects(venueId);
    if (!venueObjects || venueObjects.length === 0) {
      return { error: 'No venue objects found', rois: [] };
    }
    
    console.log(`[SmartKPI DWG] Using ${venueObjects.length} venue_objects for ROI generation`);

    const matchingFixtures = this.findMatchingDwgFixtures(venueObjects, template);

    if (matchingFixtures.length === 0) {
      return { error: 'No matching fixtures found', rois: [] };
    }

    // Calculate scene size and bounds from venue objects
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    venueObjects.forEach(f => {
      minX = Math.min(minX, f.position.x);
      maxX = Math.max(maxX, f.position.x);
      minZ = Math.min(minZ, f.position.z);
      maxZ = Math.max(maxZ, f.position.z);
    });
    const sceneSize = {
      width: maxX - minX,
      depth: maxZ - minZ,
    };
    const sceneBounds = { minX, maxX, minZ, maxZ };
    console.log(`[SmartKPI] DWG scene size: ${sceneSize.width.toFixed(2)}m x ${sceneSize.depth.toFixed(2)}m`);
    console.log(`[SmartKPI] DWG scene bounds: X=[${minX.toFixed(2)}, ${maxX.toFixed(2)}], Z=[${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`);

    // Merge scene size and bounds into options for DWG mode
    const dwgOptions = { ...options, sceneSize, sceneBounds };

    let rois = [];

    // Use the same ROI generation logic as manual mode
    // The fixtures are already transformed to scene coordinates
    switch (templateId) {
      case 'cashier-queue':
        rois = this.generateCashierQueueRois(matchingFixtures, template.roiConfig, dwgOptions);
        break;
      case 'entrance-flow':
        rois = this.generateEntranceRois(matchingFixtures, template.roiConfig, options);
        break;
      case 'shelf-engagement':
        rois = this.generateShelfRois(matchingFixtures, template.roiConfig, options);
        break;
      default:
        return { error: 'Template ROI generation not implemented', rois: [] };
    }

    return {
      templateId,
      templateName: template.name,
      generatedRois: rois,
      kpis: template.kpis,
      mode: 'dwg',
    };
  }

  // Get all templates (for UI display)
  static getTemplates() {
    return Object.values(SMART_KPI_TEMPLATES).map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      kpis: t.kpis,
    }));
  }
}

export default SmartKpiService;
