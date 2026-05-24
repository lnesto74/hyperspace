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
