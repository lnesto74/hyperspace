/**
 * Narrator2 Type Definitions
 * 
 * Types for the new ViewPack-based KPI storytelling system.
 */

// Persona IDs (from PersonaStepRegistry.json)
export type Narrator2PersonaId = 
  | 'store_manager' 
  | 'category_manager' 
  | 'retail_media_manager' 
  | 'executive';

// Step IDs (from PersonaStepRegistry.json)
export type Narrator2StepId = 
  | 'operations_pulse'
  | 'checkout_pressure'
  | 'category_engagement'
  | 'shelf_quality'
  | 'dooh_effectiveness'
  | 'attention_to_action'
  | 'business_overview'
  | 'growth_opportunities';

// Time periods
export type Narrator2Period = 'hour' | 'day' | 'week' | 'month';

// KPI status
export type KpiStatus = 'green' | 'amber' | 'red' | 'na';

// KPI format
export type KpiFormat = 'pct' | 'sec' | 'min' | 'count' | 'index' | 'score' | 'currency';

// Confidence level
export type ConfidenceLevel = 'low' | 'medium' | 'high';

// ViewPack KPI
export interface ViewPackKpi {
  id: string;
  label: string;
  value: number | null;
  unit?: string;
  format: KpiFormat;
  delta?: number | null;
  status?: KpiStatus;
  hint?: string;
}

// Time range
export interface TimeRange {
  startTs: number;
  endTs: number;
}

// ViewPack (from backend)
export interface ViewPack {
  venueId: string;
  personaId: Narrator2PersonaId;
  stepId: Narrator2StepId;
  period: Narrator2Period;
  timeRange: TimeRange;
  title: string;
  computedAt?: number;
  kpis: ViewPackKpi[];
  supporting?: Record<string, unknown>;
  evidence?: {
    sampleN?: number;
    notes?: string | null;
  };
  source?: {
    usedEndpoints: string[];
    featureFlags: Record<string, boolean>;
  };
  _meta?: {
    latencyMs: number;
    cache: { hit: boolean; layer: string };
    payloadBytes: number;
  };
}

// Recommended action
export interface Narrator2Action {
  label: string;
  uiIntent: string;
}

// Narration response
export interface Narrator2NarrationResponse {
  headline: string;
  bullets: string[];
  recommendedActions: Narrator2Action[];
  confidence: ConfidenceLevel;
  whyItMatters?: string | null;
  suggestedQuestions?: string[];
  _meta?: {
    viewPackHash: string;
    latencyMs: number;
    cache: { hit: boolean; layer: string };
    usedOpenAI: boolean;
  };
}

// Clarify response
export interface Narrator2ClarifyResponse extends Narrator2NarrationResponse {
  question: string;
}

// Persona definition
export interface Narrator2Persona {
  id: Narrator2PersonaId;
  label: string;
  goal: string;
  steps: Array<{
    id: Narrator2StepId;
    title: string;
    description: string;
  }>;
}

// Health check response
export interface Narrator2HealthResponse {
  status: 'ok' | 'error';
  service: string;
  version: string;
  timestamp: string;
  latencyMs: number;
  cache: {
    l1: { size: number; maxSize: number; hits: number; misses: number };
    l2: { available: boolean };
  };
  featureFlags: Record<string, boolean>;
  endpoints: string[];
}

// Personas list response
export interface Narrator2PersonasResponse {
  personas: Narrator2Persona[];
  validPeriods: Narrator2Period[];
}

// Narrator2 state
export interface Narrator2State {
  isOpen: boolean;
  isLoading: boolean;
  activePersona: Narrator2Persona | null;
  activeStep: Narrator2StepId | null;
  period: Narrator2Period;
  viewPack: ViewPack | null;
  narration: Narrator2NarrationResponse | null;
  error: string | null;
  personas: Narrator2Persona[];
}

// Narrator2 context value
export interface Narrator2ContextValue extends Narrator2State {
  // OpenAI mode
  useOpenAI: boolean;
  setUseOpenAI: (enabled: boolean) => void;
  // Actions
  openNarrator: () => void;
  closeNarrator: () => void;
  toggleNarrator: () => void;
  setPersona: (personaId: Narrator2PersonaId) => void;
  setStep: (stepId: Narrator2StepId) => void;
  setPeriod: (period: Narrator2Period) => void;
  fetchViewPack: () => Promise<void>;
  requestNarration: (useOpenAI?: boolean) => Promise<void>;
  askQuestion: (question: string) => Promise<void>;
  executeIntent: (intent: string) => void;
  refresh: () => Promise<void>;
}

// Persona display info (for UI)
export const NARRATOR2_PERSONA_LABELS: Record<Narrator2PersonaId, string> = {
  'store_manager': 'Store Manager',
  'category_manager': 'Category Manager',
  'retail_media_manager': 'Retail Media Manager',
  'executive': 'Executive',
};

// Step display info (for UI)
export const NARRATOR2_STEP_LABELS: Record<Narrator2StepId, string> = {
  'operations_pulse': 'Operations Pulse',
  'checkout_pressure': 'Checkout Pressure',
  'category_engagement': 'Category Engagement',
  'shelf_quality': 'Shelf Quality',
  'dooh_effectiveness': 'DOOH Effectiveness',
  'attention_to_action': 'Attention → Action',
  'business_overview': 'Business Overview',
  'growth_opportunities': 'Growth Opportunities',
};

// Default fallback
export const NARRATOR2_FALLBACK: Narrator2NarrationResponse = {
  headline: 'Select a step to begin',
  bullets: ['Choose a persona and step to explore KPI insights.'],
  recommendedActions: [],
  confidence: 'low',
};
