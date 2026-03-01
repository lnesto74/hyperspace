/**
 * LaunchPad — Commissioning Automation Layer
 * 
 * Type definitions for the guided commissioning flow.
 * This module orchestrates existing Hyperspace features without
 * modifying any core business logic, schemas, or API contracts.
 */

// ─── Step Identifiers ───────────────────────────────────────────

export type LaunchPadStepId =
  | 'select_dwg'
  | 'map_fixtures'
  | 'define_rois'
  | 'place_lidars'
  | 'commission_edge'    // merged: scan tailscale + select edge + scan LiDARs
  | 'pair_devices'
  | 'validate_stream'
  | 'go_live'

export type StepStatus =
  | 'locked'       // preconditions not met
  | 'ready'        // can start
  | 'running'      // in progress
  | 'waiting'      // waiting for user action in deep-linked view
  | 'done'         // validated successfully
  | 'warning'      // done with warnings
  | 'error'        // failed, needs retry or manual fix
  | 'skipped'      // user chose to skip (optional steps only)

// ─── Fixture Classification ─────────────────────────────────────

export type FixtureType =
  | 'shelf'
  | 'fridge'
  | 'wall'
  | 'checkout'
  | 'entrance'
  | 'pillar'
  | 'digital_display'
  | 'radio'
  | 'custom'

export interface ClassificationSuggestion {
  groupId: string
  blockName: string | null
  layerName: string
  count: number
  sizeW: number
  sizeD: number
  suggestedType: FixtureType
  confidence: number          // 0-1
  reason: string              // human-readable explanation
  accepted: boolean           // user confirmed
}

// ─── Step Data Models ───────────────────────────────────────────

export interface SelectDwgData {
  importId: string | null
  layoutVersionId: string | null
  filename: string | null
  fixtureCount: number
  groupCount: number
}

export interface MapFixturesData {
  totalGroups: number
  mappedGroups: number
  classifications: ClassificationSuggestion[]
  allAccepted: boolean
}

export interface DefineRoisData {
  roiCount: number
  roiNames: string[]
}

export interface PlaceLidarsData {
  modelId: string | null
  modelName: string | null
  sensorCount: number
  coveragePct: number
  kCoveragePct: number
  coverageTarget: number
  meetsCoverage: boolean
}

export interface CommissionEdgeData {
  edgeId: string | null
  edgeHostname: string | null
  edgeTailscaleIp: string | null
  edgeOnline: boolean
  scannedLidarCount: number
  neededLidarCount: number
  missingLidars: boolean       // true if scanned < needed → prompt to commission
}

export interface PairDevicesData {
  totalPlacements: number
  pairedCount: number
  unpaired: string[]           // placement IDs still unpaired
  allPaired: boolean
}

export interface ValidateStreamData {
  mqttConnected: boolean
  lidarStatuses: Array<{
    lidarId: string
    ip: string
    connected: boolean
    publishRate?: number       // tracks/sec
  }>
  overallHealthy: boolean
}

export interface GoLiveData {
  trackingSubscribed: boolean
  activeTrackCount: number
  isLive: boolean
}

// Union of all step data
export type StepData =
  | SelectDwgData
  | MapFixturesData
  | DefineRoisData
  | PlaceLidarsData
  | CommissionEdgeData
  | PairDevicesData
  | ValidateStreamData
  | GoLiveData

// ─── Step Definition ────────────────────────────────────────────

export interface LaunchPadStep {
  id: LaunchPadStepId
  index: number
  label: string
  description: string
  icon: string                  // Lucide icon name
  status: StepStatus
  data: StepData | null
  startedAt: string | null      // ISO timestamp
  completedAt: string | null
  error: string | null
  warnings: string[]
}

// ─── Session Model ──────────────────────────────────────────────

export interface LaunchPadSession {
  id: string
  venueId: string | null
  venueName: string | null
  createdAt: string
  updatedAt: string
  currentStepId: LaunchPadStepId
  steps: LaunchPadStep[]
  log: LaunchPadLogEntry[]
  isComplete: boolean
}

export interface LaunchPadLogEntry {
  timestamp: string
  stepId: LaunchPadStepId
  action: 'start' | 'complete' | 'error' | 'skip' | 'retry' | 'user_action'
  message: string
  data?: Record<string, unknown>
}

// ─── UI State ───────────────────────────────────────────────────

export interface LaunchPadUIState {
  isOpen: boolean
  expandedStepId: LaunchPadStepId | null
  isMinimized: boolean
}

// ─── Step Definition Template (for state machine) ───────────────

export interface StepDefinition {
  id: LaunchPadStepId
  label: string
  description: string
  icon: string
  /** Check if this step can be activated */
  canStart: (session: LaunchPadSession) => boolean
  /** Check if step is already satisfied (skip if so) */
  isAlreadyDone: (session: LaunchPadSession) => boolean
  /** Get the ViewMode to deep-link into */
  deepLinkViewMode: string | null
}

// ─── Autopilot Types ─────────────────────────────────────────────

export type AutopilotState = 'idle' | 'running' | 'waiting_input' | 'paused' | 'complete'

export interface AutopilotContext {
  state: AutopilotState
  activeStepId: LaunchPadStepId | null
  /** What kind of input the autopilot is waiting for */
  waitingFor: 'dwg_upload' | 'classification_review' | 'roi_drawing' | 'edge_connect' | 'manual' | null
  /** Message to show in the Stage */
  stageMessage: string | null
  /** Whether the 3D flythrough should be playing */
  show3DFlythrough: boolean
}

// ─── Feature Flags ──────────────────────────────────────────────

export const FEATURE_LAUNCHPAD = 'VITE_FEATURE_LAUNCHPAD'
export const FEATURE_LAUNCHPAD_AI = 'VITE_FEATURE_LAUNCHPAD_AI'

export function isLaunchPadEnabled(): boolean {
  try {
    return import.meta.env[FEATURE_LAUNCHPAD] === 'true'
  } catch {
    return false
  }
}

export function isLaunchPadAIEnabled(): boolean {
  try {
    return import.meta.env[FEATURE_LAUNCHPAD_AI] === 'true'
  } catch {
    return false
  }
}
