// Venue types
export interface Venue {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  tileSize: number;
  createdAt: string;
  updatedAt: string;
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
}

export type ObjectType = 'shelf' | 'wall' | 'checkout' | 'entrance' | 'pillar' | 'custom';

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
  deviceId: string;
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

export interface RegionOfInterest {
  id: string;
  venueId: string;
  name: string;
  vertices: Vector2[];
  color: string;
  opacity: number;
  createdAt: string;
  updatedAt: string;
}
