// Venue types
export interface Venue {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  tileSize: number;
  gridExtentMultiplier?: number;
  gridOpacity?: number;
  createdAt: string;
  updatedAt: string;
  scene_source?: 'manual' | 'dwg';
  dwg_layout_version_id?: string;
  dwg_transform_json?: string;
  company_id?: string | null;
}

export interface VenueObject {
  id: string;
  venueId: string;
  type: ObjectType;
  name: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  color?: string;
  metadata?: {
    source?: string;
    dwg_fixture_id?: string;
    dwg_layout_version_id?: string;
    dwg_footprint_points?: { x: number; z: number }[] | null;
    dwg_center_x?: number;
    dwg_center_z?: number;
    [key: string]: any;
  } | null;
}

export type BuiltInObjectType = 'shelf' | 'wall' | 'checkout' | 'entrance' | 'pillar' | 'custom' | 'digital_display' | 'radio' | 'fridge';
export type ObjectType = BuiltInObjectType | (string & {});

// LiDAR types
export interface LidarDevice {
  id: string;
  hostname: string;
  ipAddress: string;
  tailscaleIp: string;
  status: LidarStatus;
  lastSeen: string;
  model?: string;
  firmware?: string;
}

export type LidarStatus = 'online' | 'offline' | 'connecting' | 'error';

export interface LidarPlacement {
  id: string;
  venueId: string;
  deviceId?: string; // Optional - allows unassigned positions from LiDAR Planner
  position: Vector3;
  rotation: Vector3;
  mountHeight: number;
  fovHorizontal: number;
  fovVertical: number;
  range: number;
  enabled: boolean;
}

// Tracking types
export interface Track {
  id: string;
  trackKey: string;
  deviceId: string;
  timestamp: number;
  position: Vector3;
  venuePosition: Vector3;
  velocity: Vector3;
  objectType: TrackObjectType;
  boundingBox?: BoundingBox; // For person/object dimensions
  color?: string; // Unique color per track
  /** Set by server when track belongs to the current perception frame. */
  inLiveFrame?: boolean;
  originalPerceptionId?: string;
}

export interface BoundingBox {
  width: number;  // Diameter for person (x)
  height: number; // Height of person (y)
  depth: number;  // Diameter for person (z)
}

export type TrackObjectType = 'person' | 'cart' | 'unknown';

export interface TrackWithTrail extends Track {
  trail: Vector3[];
}

// Common types
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DiscoveryScanResult {
  devices: LidarDevice[];
  scanTime: string;
  duration: number;
}

// WebSocket event types
export interface TracksEvent {
  venueId: string;
  tracks: Track[];
  /** Unique perception IDs in the current frame — matches fast3dis object count. */
  frameOccupancy?: number;
  liveFrameTs?: number | null;
}

export interface LidarStatusEvent {
  deviceId: string;
  status: LidarStatus;
  message?: string;
}

export interface TrackRemovedEvent {
  trackKey: string;
}

// Object library presets
export interface ObjectPreset {
  type: ObjectType;
  name: string;
  icon: string;
  defaultScale: Vector3;
  color: string;
}

// Region of Interest (ROI) types
export interface Vector2 {
  x: number;
  z: number;
}

export interface RoiMetadata {
  type?: string;
  template?: string;
  zoneType?: string;
  shelfId?: string;
  shelfIndex?: number;
  planogramId?: string;
  [key: string]: any;
}

export interface RegionOfInterest {
  id: string;
  venueId: string;
  name: string;
  vertices: Vector2[];
  color: string;
  opacity: number;
  createdAt: string;
  updatedAt: string;
  metadata?: RoiMetadata;
}

// --- Profit Radar types ---
export const INTENT_AXIS_NAMES = [
  'exploration', 'goal_directedness', 'urgency', 'commitment',
  'hesitation', 'confusion', 'social_groupness', 'avoidance',
  'waiting_queueing', 'engagement_with_POI', 'churn_exit_intent', 'friction'
] as const;

export type IntentAxisName = typeof INTENT_AXIS_NAMES[number];

export type IntentAxes = Record<IntentAxisName, number>;

export interface TrackAxesEvent {
  venueId: string;
  tracks: { trackKey: string; axes: IntentAxes; position: Vector3 }[];
  timestamp: number;
}

export interface ZoneFieldEntry {
  roiId: string;
  roiName: string;
  dominant: IntentAxisName;
  dominantScore: number;
  means: IntentAxes;
  trackCount: number;
  trackKeys: string[];
}

export interface BehaviorCluster {
  id: string;
  dominant: IntentAxisName;
  dominantScore: number;
  memberCount: number;
  trackKeys: string[];
  meanAxes: IntentAxes;
  trajectory: {
    avgStops: number;
    avgDwellSec: number;
    totalDurationSec: number;
    zonesVisited: string[];
    zoneStops: { zoneName: string; dwellSec: number }[];
    journeyType: string;
  };
  anchorZoneId: string | null;
  anchorZoneName: string | null;
  anchorPosition: Vector3;
}

export interface ZoneFieldEvent {
  venueId: string;
  zones: ZoneFieldEntry[];
  clusters: BehaviorCluster[];
  timestamp: number;
}

export type InsightType = 'lost_sales' | 'underperforming_zone' | 'staff_misallocation' | 'layout_friction';
export type InsightSeverity = 'high' | 'medium' | 'low';

export interface ProfitRadarInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  confidence: number;
  title: string;
  summary: string;
  why: string;
  suggestedFix: string;
  impact: { min: number; max: number; currency: string };
  dataBasis: Record<string, any>;
  timestamp: number;
}

export interface ProfitRadarInsightsEvent {
  venueId: string;
  insights: ProfitRadarInsight[];
  timestamp: number;
}
