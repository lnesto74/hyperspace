export interface BenchmarkRunSummary {
  id: string
  capture_id: string
  source_file: string | null
  venue_id: string | null
  perception_version: string | null
  scope: string | null
  generated_at: string | null
  run_status?: string
  has_scorecard: boolean
  has_report: boolean
  messages: number | null
  unique_perception_ids: number | null
  fragmentation_factor: number | null
  grocery_balanced_lt_mean: number | null
  grocery_balanced_tp_per_1k: number | null
  mtimeMs: number
}

export interface PerceptionLayer {
  messages?: number
  unique_perception_ids?: number
  time_span_h?: number
  mean_lifetime_s?: number
  mean_displacement_m?: number
  fragmentation_factor?: number
  teleports_per_1k?: number
  pct_ids_under_2s?: number
  shopper_grade_ge_30m?: number
  estimated_real_shoppers?: number
}

export interface ReconcilerConfigMetrics {
  stable_tracks?: number
  fragmentation_x?: number
  mean_lifetime_s?: number
  mean_displacement_m?: number
  teleports_per_1k?: number
  ghost_pct?: number
  shopper_grade_ge_30m?: number
}

export interface StructuralLayer {
  walkable_area_m2?: number
  significant_blindspot_m2?: number
  fragmentation_cause_pct?: {
    occlusion?: number
    blindspot?: number
    new_person?: number
  }
}

export interface BenchmarkScorecard {
  schema_version?: number
  capture_id?: string
  source_file?: string
  venue_id?: string
  perception_version?: string | null
  reconciler_at_capture?: string | null
  scope?: string
  generated_at?: string
  layers?: {
    perception?: PerceptionLayer | null
    reconciler?: Record<string, ReconcilerConfigMetrics> | null
    structural?: StructuralLayer | null
  }
  notes?: string | null
}

export interface BenchmarkArtifact {
  name: string
  size: number
  is_image: boolean
  is_json: boolean
}

export interface BenchmarkRunDetail {
  id: string
  meta: Record<string, unknown> | null
  scorecard: BenchmarkScorecard | null
  report_md: string | null
  artifacts: BenchmarkArtifact[]
  summary: BenchmarkRunSummary
}

export interface BenchmarkRunsResponse {
  runs: BenchmarkRunSummary[]
  runsDir: string
}

export interface CoveragePoint {
  x: number
  z: number
}

export interface CoverageSpatial {
  available: boolean
  reason?: string
  bbox?: { x0: number; x1: number; z0: number; z1: number }
  time_ms?: { min: number; max: number }
  counts?: {
    births: number
    deaths: number
    ghosts: number
    links: number
    blindspots: number
    timeline_buckets: number
  }
  births?: Array<CoveragePoint & { t: number; id: string }>
  deaths?: Array<CoveragePoint & { t: number; id: string; lifetime_s: number }>
  ghosts?: Array<CoveragePoint & { id: string }>
  links?: Array<{
    x0: number; z0: number; x1: number; z1: number; category: string
  }>
  blindspots?: Array<CoveragePoint & { area_m2: number }>
  timeline?: Array<{ t0: number; t1: number; points: CoveragePoint[] }>
}

export interface ProblemZone {
  rank: number
  cell_id: string
  x0: number
  x1: number
  z0: number
  z1: number
  cx: number
  cz: number
  severity: number
  death_count: number
  birth_count: number
  ghost_count: number
  shelf_occlusion_pct: number
  blindspot_gap_pct: number
  shelf_occlusion_n?: number
  blindspot_gap_n?: number
}

export interface ProblemZonesData {
  available: boolean
  reason?: string
  cell_m?: number
  frame?: string
  bbox?: MapBbox
  total_cells_scored?: number
  zones?: ProblemZone[]
}

export interface MapBbox {
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface FloorplanObject {
  id: string
  type: string
  name: string
  x: number
  z: number
  w: number
  d: number
  rotation_y: number
  color: string
}

export interface ReconciledSpatial {
  available: boolean
  reason?: string
  config?: string
  frame?: string
  bbox?: MapBbox
  time_ms?: { min: number; max: number }
  counts?: {
    stable_tracks: number
    perception_ids: number
    fragmentation_factor: number
    mean_lifetime_s: number
    mean_displacement_m: number
    births: number
    deaths: number
    timeline_buckets: number
  }
  births?: Array<CoveragePoint & { t: number; id: string; lifetime_s: number }>
  deaths?: Array<CoveragePoint & { t: number; id: string; lifetime_s: number; total_path_m?: number }>
  timeline?: Array<{ t0: number; t1: number; points: CoveragePoint[] }>
}

export type TrackViewMode =
  | 'raw'
  | 'GROCERY_BALANCED'
  | 'GROCERY_AGGRESSIVE'
  | 'GROCERY_CONSERVATIVE'
  | 'overlay_GROCERY_BALANCED'
  | 'overlay_GROCERY_AGGRESSIVE'
  | 'overlay_GROCERY_CONSERVATIVE'

export interface FloorplanContext {
  available: boolean
  reason?: string
  venue_id?: string
  venue_name?: string
  venue_width?: number
  venue_depth?: number
  perceptionTransform?: import('../../types/perceptionTransform').PerceptionTransform | null
  scaleCorrection?: number
  dwg_layout_version_id?: string | null
  objects?: FloorplanObject[]
  floorplan_image_url?: string | null
  floorplan_import_id?: string | null
  floorplan_transform?: import('./benchmarkMapUtils').FloorplanTransform | null
  bbox_venue?: MapBbox
  has_transform?: boolean
}
