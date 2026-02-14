/**
 * AI Narrator Types
 * Strict TypeScript schemas for narrator input/output
 */

// Personas (matching existing personas.ts)
export type PersonaId = 'store-manager' | 'merchandising' | 'retail-media' | 'executive';

// View modes (matching App.tsx ViewMode)
export type ViewMode = 'main' | 'planogram' | 'dwgImporter' | 'lidarPlanner' | 
  'edgeCommissioning' | 'doohAnalytics' | 'doohEffectiveness' | 'businessReporting';

// Entity types that can be selected/highlighted
export type EntityType = 'zone' | 'shelf' | 'screen' | 'lidar' | 'queue' | 'category' | 'none';

// UI Intent types
export const UI_INTENTS = [
  'OPEN_MAIN_VIEW',
  'OPEN_DWG_IMPORTER',
  'OPEN_LIDAR_PLANNER',
  'OPEN_PLANOGRAM_BUILDER',
  'OPEN_EDGE_COMMISSIONING',
  'OPEN_DOOH_ANALYTICS',
  'OPEN_DOOH_EFFECTIVENESS',
  'OPEN_BUSINESS_REPORTING',
  'OPEN_HEATMAP_MODAL',
  'OPEN_CHECKOUT_MANAGER',
  'OPEN_SMART_KPI_MODAL',
  'OPEN_ACTIVITY_LEDGER',
  'TOGGLE_KPI_OVERLAYS',
  'TOGGLE_COVERAGE_HEATMAP',
  'TOGGLE_LIDAR_FOV',
  'HIGHLIGHT_ZONE',
  'HIGHLIGHT_SHELF',
  'HIGHLIGHT_SCREEN',
  'HIGHLIGHT_LIDAR',
  'HIGHLIGHT_QUEUE',
  'SELECT_PERSONA',
] as const;

export type UiIntent = typeof UI_INTENTS[number];

// Follow-up intent types
export type FollowUpIntentType = 'explain_kpi' | 'compare_trend' | 'drill_down' | 'navigate';

// Confidence levels
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// Insight severity
export type InsightSeverity = 'critical' | 'warning' | 'info';

// Insight types
export type InsightType = 'anomaly' | 'trend' | 'threshold_breach' | 'opportunity' | 'comparison';

// Selected entity
export interface SelectedEntity {
  type: EntityType;
  id?: string;
  name?: string;
}

// Venue context
export interface VenueContext {
  venueId: string;
  venueName: string;
  hasLidars: boolean;
  hasDwgLayout: boolean;
  hasScreens: boolean;
}

// Proactive insight
export interface ProactiveInsight {
  type: InsightType;
  severity: InsightSeverity;
  kpiId: string;
  currentValue: number;
  benchmark: number;
  delta: number;
  headline: string;
  explanation: string;
  suggestedAction: string;
  relevantEntities: string[];
}

// Usage history for learning
export interface NarratorUsageHistory {
  personaId: string;
  venueId: string;
  topFollowUps: string[];
  preferredStyle: 'concise' | 'detailed';
  followUpClicks: {
    question: string;
    context: string;
    wasHelpful: boolean;
    timestamp: number;
  }[];
  intentsTaken: {
    intent: string;
    afterKpi: string;
    frequency: number;
  }[];
}

// Narrator input (sent to backend)
export interface NarratorInput {
  persona: {
    id: PersonaId;
    name: string;
    description: string;
  };
  currentView: ViewMode;
  selectedEntity: SelectedEntity;
  kpiSnapshot: Record<string, number | null>;
  venueContext: VenueContext;
  proactiveInsights?: ProactiveInsight[];
  usageHistory?: NarratorUsageHistory;
  allowedUiIntents: UiIntent[];
  storyStepGoal?: string;
}

// Recommended action
export interface RecommendedAction {
  label: string;
  uiIntent: string;
  reason: string;
}

// Suggested follow-up
export interface SuggestedFollowUp {
  question: string;
  intentType: FollowUpIntentType;
  context?: {
    targetKpi?: string;
    targetEntity?: string;
  };
}

// UI focus (highlighting)
export interface UiFocus {
  highlight: string[];
  layersOn: string[];
  layersOff: string[];
}

// Narrator output (from backend)
export interface NarratorOutput {
  headline: string;
  narration: string[];
  businessMeaning: string;
  recommendedActions: RecommendedAction[];
  suggestedFollowUps: SuggestedFollowUp[];
  uiFocus: UiFocus;
  confidence: ConfidenceLevel;
}

// Narrator API response
export interface NarratorApiResponse {
  success: boolean;
  narration: NarratorOutput;
  source: 'openai' | 'fallback';
  model?: string;
  error?: string;
}

// Insight detection response
export interface InsightDetectionResponse {
  success: boolean;
  insights: ProactiveInsight[];
  total: number;
}

// Story step
export interface StoryStep {
  id: number;
  title: string;
  kpis: string[];
  goal: string;
}

// Story path
export interface StoryPath {
  name: string;
  steps: StoryStep[];
}

// Story paths by persona
export interface StoryPaths {
  [personaId: string]: StoryPath;
}

// Narrator state
export interface NarratorState {
  isOpen: boolean;
  isLoading: boolean;
  proactiveMode: boolean;
  storyMode: boolean;
  currentStoryStep: number;
  activePersonaId: PersonaId;
  narration: NarratorOutput | null;
  proactiveInsights: ProactiveInsight[];
  error: string | null;
  highlightedEntityId: string | null;
}

// Narrator context value
export interface NarratorContextValue extends NarratorState {
  // Actions
  openNarrator: () => void;
  closeNarrator: () => void;
  toggleNarrator: () => void;
  setProactiveMode: (enabled: boolean) => void;
  setStoryMode: (enabled: boolean) => void;
  setActivePersona: (personaId: PersonaId) => void;
  nextStoryStep: () => void;
  prevStoryStep: () => void;
  requestNarration: (context: Partial<NarratorInput>) => Promise<void>;
  handleFollowUp: (followUp: SuggestedFollowUp) => Promise<void>;
  executeIntent: (intent: string) => void;
  highlightEntity: (entityId: string | null) => void;
  detectInsights: () => Promise<void>;
}

// Fallback response
export const FALLBACK_NARRATION: NarratorOutput = {
  headline: 'Data available',
  narration: ['Select a KPI or entity to explore insights.'],
  businessMeaning: 'Your analytics data is ready for exploration.',
  recommendedActions: [],
  suggestedFollowUps: [],
  uiFocus: { highlight: [], layersOn: [], layersOff: [] },
  confidence: 'low',
};
