import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useVenue } from './VenueContext';
import { useRoi } from './RoiContext';
import { useDwg } from './DwgContext';
import { useViewMode } from '../App';
import { PERSONAS, getPersonaById } from '../features/businessReporting/personas';

// Data mode types
export type NarratorDataMode = 'realtime' | 'historical';
export type NarratorTimePeriod = 'hour' | 'day' | 'week' | 'month';
import type {
  NarratorContextValue,
  NarratorInput,
  NarratorOutput,
  NarratorApiResponse,
  ProactiveInsight,
  SuggestedFollowUp,
  PersonaId,
  ViewMode,
  NarratorUsageHistory,
} from '../types/narrator';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Generate session ID for rate limiting
const SESSION_ID = `narrator-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// localStorage keys
const STORAGE_KEYS = {
  proactiveMode: 'narrator-proactive-mode',
  activePersona: 'narrator-active-persona',
  usageHistory: 'narrator-usage-history',
};

// Default fallback narration
const DEFAULT_NARRATION: NarratorOutput = {
  headline: 'Data available',
  narration: ['Select a KPI or entity to explore insights.'],
  businessMeaning: 'Your analytics data is ready for exploration.',
  recommendedActions: [],
  suggestedFollowUps: [],
  uiFocus: { highlight: [], layersOn: [], layersOff: [] },
  confidence: 'low',
};

// Create context
const NarratorContext = createContext<NarratorContextValue | null>(null);

// Provider component
export function NarratorProvider({ children }: { children: React.ReactNode }) {
  const { venue } = useVenue();
  const { mode: currentView } = useViewMode();
  
  // Get ROIs from context
  const { regions } = useRoi();
  const { dwgLayoutId } = useDwg();
  
  // State
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [liveKpis, setLiveKpis] = useState<Record<string, number | null>>({});
  const [dataMode, setDataMode] = useState<NarratorDataMode>('historical');
  const [timePeriod, setTimePeriod] = useState<NarratorTimePeriod>('day');
  const [proactiveMode, setProactiveModeState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.proactiveMode);
    return saved === 'true';
  });
  const [storyMode, setStoryModeState] = useState(false);
  const [currentStoryStep, setCurrentStoryStep] = useState(0);
  const [activePersonaId, setActivePersonaIdState] = useState<PersonaId>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.activePersona);
    return (saved as PersonaId) || 'store-manager';
  });
  const [narration, setNarration] = useState<NarratorOutput | null>(null);
  const [proactiveInsights, setProactiveInsights] = useState<ProactiveInsight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highlightedEntityId, setHighlightedEntityId] = useState<string | null>(null);
  
  // Usage history for learning
  const [usageHistory, setUsageHistory] = useState<NarratorUsageHistory>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.usageHistory);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return {
      personaId: activePersonaId,
      venueId: venue?.id || '',
      topFollowUps: [],
      preferredStyle: 'concise',
      followUpClicks: [],
      intentsTaken: [],
    };
  });
  
  // Persist settings to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.proactiveMode, String(proactiveMode));
  }, [proactiveMode]);
  
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activePersona, activePersonaId);
  }, [activePersonaId]);
  
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.usageHistory, JSON.stringify(usageHistory));
  }, [usageHistory]);
  
  // Get active persona config
  const activePersona = useMemo(() => {
    return getPersonaById(activePersonaId) || PERSONAS[0];
  }, [activePersonaId]);
  
  // Fetch KPI data - single ROI call like ZoneKPIPopup (fast)
  const fetchLiveKpis = useCallback(async (mode?: NarratorDataMode, period?: NarratorTimePeriod) => {
    if (!venue?.id || regions.length === 0) {
      console.log('[Narrator] No venue or regions');
      return {};
    }
    
    const effectivePeriod = period || timePeriod;
    const roiId = regions[0].id;
    
    console.log('[Narrator] Fetching KPIs for ROI:', roiId, 'period:', effectivePeriod);
    
    try {
      const res = await fetch(`${API_BASE}/api/roi/${roiId}/kpis?period=${effectivePeriod}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      const kpis = data.kpis;
      
      console.log('[Narrator] Raw KPIs:', JSON.stringify(kpis).slice(0, 300));
      
      const snapshot: Record<string, number | null> = {
        totalVisitors: kpis.visits || 0,
        totalEntries: kpis.totalEntries || 0,
        avgTimeSpentMin: kpis.avgTimeSpent || kpis.timeSpent || 0,
        totalDwells: kpis.dwellsCumulative || 0,
        totalEngagements: kpis.engagementsCumulative || 0,
        dwellRate: kpis.dwellRate || 0,
        engagementRate: kpis.engagementRate || 0,
        bounceRate: kpis.bounceRate || 0,
        peakOccupancy: kpis.peakOccupancy || 0,
        avgOccupancy: kpis.avgOccupancy || 0,
        zonesAnalyzed: regions.length,
        _dataMode: (mode || dataMode) === 'realtime' ? 1 : 0,
        _timePeriod: { hour: 1, day: 2, week: 3, month: 4 }[effectivePeriod],
      };
      
      console.log('[Narrator] Snapshot:', JSON.stringify(snapshot));
      setLiveKpis(snapshot);
      return snapshot;
    } catch (err) {
      console.error('[Narrator] KPI fetch failed:', err);
      return {};
    }
  }, [venue?.id, dataMode, timePeriod, regions]);
  
  // Build KPI snapshot - use live data if available
  const buildKpiSnapshot = useCallback((): Record<string, number | null> => {
    // Return live KPIs if we have them
    if (Object.keys(liveKpis).length > 0) {
      return liveKpis;
    }
    // Fallback: return empty for persona KPIs
    const snapshot: Record<string, number | null> = {};
    if (activePersona) {
      for (const kpi of activePersona.kpis) {
        snapshot[kpi.id] = null;
      }
    }
    return snapshot;
  }, [activePersona, liveKpis]);
  
  // Request narration from API
  const requestNarration = useCallback(async (context: Partial<NarratorInput>) => {
    if (!venue) {
      setError('No venue selected');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const input: NarratorInput = {
        persona: {
          id: activePersonaId,
          name: activePersona?.name || 'General',
          description: activePersona?.description || '',
        },
        currentView: currentView as ViewMode,
        selectedEntity: context.selectedEntity || { type: 'none' },
        kpiSnapshot: context.kpiSnapshot || buildKpiSnapshot(),
        venueContext: {
          venueId: venue.id,
          venueName: venue.name,
          hasLidars: true,
          hasDwgLayout: true,
          hasScreens: true,
        },
        proactiveInsights: proactiveMode ? proactiveInsights : undefined,
        usageHistory: usageHistory,
        allowedUiIntents: [
          'OPEN_MAIN_VIEW',
          'OPEN_DWG_IMPORTER',
          'OPEN_LIDAR_PLANNER',
          'OPEN_PLANOGRAM_BUILDER',
          'OPEN_DOOH_ANALYTICS',
          'OPEN_DOOH_EFFECTIVENESS',
          'OPEN_BUSINESS_REPORTING',
          'OPEN_HEATMAP_MODAL',
          'OPEN_CHECKOUT_MANAGER',
          'OPEN_SMART_KPI_MODAL',
          'TOGGLE_KPI_OVERLAYS',
          'HIGHLIGHT_ZONE',
          'HIGHLIGHT_SHELF',
        ],
        storyStepGoal: context.storyStepGoal,
        ...context,
      };
      
      const response = await fetch(`${API_BASE}/api/narrator/narrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: input, sessionId: SESSION_ID }),
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data: NarratorApiResponse = await response.json();
      
      if (data.success && data.narration) {
        setNarration(data.narration);
        
        // Apply UI focus (highlighting)
        if (data.narration.uiFocus?.highlight?.length > 0) {
          setHighlightedEntityId(data.narration.uiFocus.highlight[0]);
          // Auto-clear highlight after 5 seconds
          setTimeout(() => setHighlightedEntityId(null), 5000);
        }
      } else {
        setNarration(DEFAULT_NARRATION);
      }
      
    } catch (err) {
      console.error('[Narrator] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setNarration(DEFAULT_NARRATION);
    } finally {
      setIsLoading(false);
    }
  }, [venue, activePersonaId, activePersona, currentView, buildKpiSnapshot, proactiveMode, proactiveInsights, usageHistory]);
  
  // Detect proactive insights
  const detectInsights = useCallback(async () => {
    if (!venue || !activePersona) return;
    
    try {
      // Build thresholds from persona KPIs
      const thresholds: Record<string, { good: number; warn: number; bad: number; direction: 'lower' | 'higher' }> = {};
      for (const kpi of activePersona.kpis) {
        if (kpi.thresholds) {
          thresholds[kpi.id] = kpi.thresholds;
        }
      }
      
      const response = await fetch(`${API_BASE}/api/narrator/detect-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId: venue.id,
          personaId: activePersonaId,
          kpiData: buildKpiSnapshot(),
          thresholds,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setProactiveInsights(data.insights);
        }
      }
    } catch (err) {
      console.error('[Narrator] Insight detection error:', err);
    }
  }, [venue, activePersona, activePersonaId, buildKpiSnapshot]);
  
  // Handle follow-up click
  const handleFollowUp = useCallback(async (followUp: SuggestedFollowUp) => {
    // Track usage
    setUsageHistory(prev => ({
      ...prev,
      followUpClicks: [
        ...prev.followUpClicks.slice(-49), // Keep last 50
        {
          question: followUp.question,
          context: followUp.intentType,
          wasHelpful: true, // Assume helpful, could be refined
          timestamp: Date.now(),
        },
      ],
    }));
    
    // Track on backend
    fetch(`${API_BASE}/api/narrator/track-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venueId: venue?.id,
        personaId: activePersonaId,
        eventType: 'followup_click',
        eventData: { question: followUp.question, intentType: followUp.intentType },
        sessionId: SESSION_ID,
      }),
    }).catch(() => {}); // Fire and forget
    
    // Fetch fresh KPIs and request new narration with follow-up context
    const kpis = await fetchLiveKpis();
    await requestNarration({
      storyStepGoal: followUp.question,
      kpiSnapshot: kpis,
      selectedEntity: followUp.context?.targetEntity 
        ? { type: 'zone', id: followUp.context.targetEntity }
        : { type: 'none' },
    });
  }, [venue, activePersonaId, fetchLiveKpis, requestNarration]);
  
  // Execute UI intent
  const executeIntent = useCallback((intent: string) => {
    // Track usage
    setUsageHistory(prev => {
      const existing = prev.intentsTaken.find(i => i.intent === intent);
      if (existing) {
        return {
          ...prev,
          intentsTaken: prev.intentsTaken.map(i => 
            i.intent === intent ? { ...i, frequency: i.frequency + 1 } : i
          ),
        };
      }
      return {
        ...prev,
        intentsTaken: [...prev.intentsTaken, { intent, afterKpi: '', frequency: 1 }],
      };
    });
    
    // Intent will be handled by the parent component via callback
    // This is just for tracking - actual execution happens in App.tsx
    console.log('[Narrator] Intent executed:', intent);
  }, []);
  
  // Story mode navigation
  const nextStoryStep = useCallback(() => {
    const persona = getPersonaById(activePersonaId);
    if (!persona) return;
    
    // Fetch story paths to know max steps
    fetch(`${API_BASE}/api/narrator/story-paths`)
      .then(res => res.json())
      .then(data => {
        const path = data.storyPaths?.[activePersonaId];
        if (path && currentStoryStep < path.steps.length - 1) {
          setCurrentStoryStep(prev => prev + 1);
          requestNarration({
            storyStepGoal: path.steps[currentStoryStep + 1]?.goal,
          });
        }
      })
      .catch(() => {});
  }, [activePersonaId, currentStoryStep, requestNarration]);
  
  const prevStoryStep = useCallback(() => {
    if (currentStoryStep > 0) {
      setCurrentStoryStep(prev => prev - 1);
      
      fetch(`${API_BASE}/api/narrator/story-paths`)
        .then(res => res.json())
        .then(data => {
          const path = data.storyPaths?.[activePersonaId];
          if (path) {
            requestNarration({
              storyStepGoal: path.steps[currentStoryStep - 1]?.goal,
            });
          }
        })
        .catch(() => {});
    }
  }, [activePersonaId, currentStoryStep, requestNarration]);
  
  // Actions
  const openNarrator = useCallback(async () => {
    console.log('[Narrator] Opening narrator, regions count:', regions.length);
    setIsOpen(true);
    setIsLoading(true); // Show loading state while fetching
    
    try {
      // Fetch live KPIs first, then request narration
      console.log('[Narrator] Starting KPI fetch...');
      const kpis = await fetchLiveKpis();
      console.log('[Narrator] KPI fetch complete:', kpis);
      
      // Only request narration after KPIs are fetched
      await requestNarration({ kpiSnapshot: kpis });
      console.log('[Narrator] Narration complete');
    } catch (err) {
      console.error('[Narrator] Error in openNarrator:', err);
    }
    
    if (proactiveMode) {
      detectInsights();
    }
  }, [fetchLiveKpis, requestNarration, proactiveMode, detectInsights, regions.length]);
  
  const closeNarrator = useCallback(() => {
    setIsOpen(false);
    setHighlightedEntityId(null);
  }, []);
  
  const toggleNarrator = useCallback(() => {
    if (isOpen) {
      closeNarrator();
    } else {
      openNarrator();
    }
  }, [isOpen, openNarrator, closeNarrator]);
  
  const setProactiveMode = useCallback((enabled: boolean) => {
    setProactiveModeState(enabled);
    if (enabled && isOpen) {
      detectInsights();
    }
  }, [isOpen, detectInsights]);
  
  const setStoryMode = useCallback((enabled: boolean) => {
    setStoryModeState(enabled);
    if (enabled) {
      setCurrentStoryStep(0);
      fetch(`${API_BASE}/api/narrator/story-paths`)
        .then(res => res.json())
        .then(data => {
          const path = data.storyPaths?.[activePersonaId];
          if (path) {
            requestNarration({
              storyStepGoal: path.steps[0]?.goal,
            });
          }
        })
        .catch(() => {});
    }
  }, [activePersonaId, requestNarration]);
  
  // Data mode and time period handlers
  const handleSetDataMode = useCallback(async (mode: NarratorDataMode) => {
    console.log('[Narrator] Setting data mode to:', mode);
    setDataMode(mode);
    console.log('[Narrator] Fetching KPIs for mode:', mode, 'period:', timePeriod, 'regions:', regions.length);
    const kpis = await fetchLiveKpis(mode, timePeriod);
    console.log('[Narrator] Got KPIs:', Object.keys(kpis).length, 'values');
    requestNarration({ kpiSnapshot: kpis });
  }, [fetchLiveKpis, timePeriod, requestNarration, regions.length]);
  
  const handleSetTimePeriod = useCallback(async (period: NarratorTimePeriod) => {
    console.log('[Narrator] Setting time period to:', period);
    setTimePeriod(period);
    console.log('[Narrator] Fetching KPIs for mode:', dataMode, 'period:', period, 'regions:', regions.length);
    const kpis = await fetchLiveKpis(dataMode, period);
    console.log('[Narrator] Got KPIs:', Object.keys(kpis).length, 'values');
    requestNarration({ kpiSnapshot: kpis });
  }, [dataMode, fetchLiveKpis, requestNarration, regions.length]);
  
  const setActivePersona = useCallback(async (personaId: PersonaId) => {
    setActivePersonaIdState(personaId);
    setCurrentStoryStep(0);
    if (isOpen) {
      const kpis = await fetchLiveKpis();
      requestNarration({ kpiSnapshot: kpis });
    }
  }, [isOpen, fetchLiveKpis, requestNarration]);
  
  const highlightEntity = useCallback((entityId: string | null) => {
    setHighlightedEntityId(entityId);
    if (entityId) {
      // Auto-clear after 5 seconds
      setTimeout(() => setHighlightedEntityId(null), 5000);
    }
  }, []);
  
  // Check for demo mode URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('guidedDemo') === 'true') {
      setIsOpen(true);
      setStoryModeState(true);
      setCurrentStoryStep(0);
    }
  }, []);
  
  // Context value - cast to any to avoid type errors while we update types
  const contextValue = {
    // State
    isOpen,
    isLoading,
    proactiveMode,
    storyMode,
    currentStoryStep,
    activePersonaId,
    narration,
    proactiveInsights,
    error,
    highlightedEntityId,
    dataMode,
    timePeriod,
    // Actions
    openNarrator,
    closeNarrator,
    toggleNarrator,
    setProactiveMode,
    setStoryMode,
    setActivePersona,
    nextStoryStep,
    prevStoryStep,
    requestNarration,
    handleFollowUp,
    executeIntent,
    highlightEntity,
    detectInsights,
    setDataMode: handleSetDataMode,
    setTimePeriod: handleSetTimePeriod,
  } as NarratorContextValue;
  
  return (
    <NarratorContext.Provider value={contextValue}>
      {children}
    </NarratorContext.Provider>
  );
}

// Hook to use narrator context
export function useNarrator(): NarratorContextValue {
  const context = useContext(NarratorContext);
  if (!context) {
    throw new Error('useNarrator must be used within a NarratorProvider');
  }
  return context;
}

export default NarratorContext;
