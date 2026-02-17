/**
 * Narrator2 Context
 * 
 * New ViewPack-based KPI storytelling system.
 * Uses /api/narrator2/* endpoints for fast, cached responses.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useVenue } from './VenueContext';
import type {
  Narrator2ContextValue,
  Narrator2PersonaId,
  Narrator2StepId,
  Narrator2Period,
  Narrator2Persona,
  ViewPack,
  Narrator2NarrationResponse,
  Narrator2PersonasResponse,
} from '../types/narrator2';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Storage keys
const STORAGE_KEYS = {
  persona: 'narrator2-persona',
  step: 'narrator2-step',
  period: 'narrator2-period',
};

// Default fallback
const DEFAULT_NARRATION: Narrator2NarrationResponse = {
  headline: 'Select a step to begin',
  bullets: ['Choose a persona and step to explore KPI insights.'],
  recommendedActions: [],
  confidence: 'low',
};

// Create context
const Narrator2Context = createContext<Narrator2ContextValue | null>(null);

// Provider component
export function Narrator2Provider({ children }: { children: React.ReactNode }) {
  const { venue } = useVenue();
  
  // State
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [personas, setPersonas] = useState<Narrator2Persona[]>([]);
  const [activePersona, setActivePersona] = useState<Narrator2Persona | null>(null);
  const [activeStep, setActiveStep] = useState<Narrator2StepId | null>(null);
  const [period, setPeriodState] = useState<Narrator2Period>(() => {
    return (localStorage.getItem(STORAGE_KEYS.period) as Narrator2Period) || 'day';
  });
  const [viewPack, setViewPack] = useState<ViewPack | null>(null);
  const [narration, setNarration] = useState<Narrator2NarrationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useOpenAI, setUseOpenAI] = useState<boolean>(() => {
    return localStorage.getItem('narrator2-useOpenAI') === 'true';
  });

  // Fetch personas on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/narrator2/personas`)
      .then(res => res.json())
      .then((data: Narrator2PersonasResponse) => {
        setPersonas(data.personas);
        
        // Restore saved persona or use first
        const savedPersonaId = localStorage.getItem(STORAGE_KEYS.persona) as Narrator2PersonaId;
        const persona = data.personas.find(p => p.id === savedPersonaId) || data.personas[0];
        if (persona) {
          setActivePersona(persona);
          
          // Restore saved step or use first
          const savedStepId = localStorage.getItem(STORAGE_KEYS.step) as Narrator2StepId;
          const step = persona.steps.find(s => s.id === savedStepId) || persona.steps[0];
          if (step) {
            setActiveStep(step.id);
          }
        }
      })
      .catch(err => {
        console.error('[Narrator2] Failed to fetch personas:', err);
      });
  }, []);

  // Persist settings
  useEffect(() => {
    if (activePersona) {
      localStorage.setItem(STORAGE_KEYS.persona, activePersona.id);
    }
  }, [activePersona]);

  useEffect(() => {
    if (activeStep) {
      localStorage.setItem(STORAGE_KEYS.step, activeStep);
    }
  }, [activeStep]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.period, period);
  }, [period]);

  // Fetch ViewPack
  const fetchViewPack = useCallback(async () => {
    if (!venue?.id || !activePersona || !activeStep) {
      console.log('[Narrator2] Missing params for fetchViewPack');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        venueId: venue.id,
        personaId: activePersona.id,
        stepId: activeStep,
        period,
      });

      const response = await fetch(`${API_BASE}/api/narrator2/viewpack?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: ViewPack = await response.json();
      setViewPack(data);
      
      console.log(`[Narrator2] ViewPack fetched in ${data._meta?.latencyMs}ms (cache: ${data._meta?.cache.layer})`);
    } catch (err) {
      console.error('[Narrator2] ViewPack fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setViewPack(null);
    } finally {
      setIsLoading(false);
    }
  }, [venue?.id, activePersona, activeStep, period]);

  // Request narration
  const requestNarration = useCallback(async (useOpenAI = false) => {
    if (!venue?.id || !activePersona || !activeStep) {
      console.log('[Narrator2] Missing params for requestNarration');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        venueId: venue.id,
        personaId: activePersona.id,
        stepId: activeStep,
        period,
      });

      const response = await fetch(`${API_BASE}/api/narrator2/narrate?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useOpenAI }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: Narrator2NarrationResponse = await response.json();
      setNarration(data);
      
      console.log(`[Narrator2] Narration generated in ${data._meta?.latencyMs}ms`);
    } catch (err) {
      console.error('[Narrator2] Narration error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate narration');
      setNarration(DEFAULT_NARRATION);
    } finally {
      setIsLoading(false);
    }
  }, [venue?.id, activePersona, activeStep, period]);

  // Ask a question (clarify endpoint)
  const askQuestion = useCallback(async (question: string) => {
    console.log('[Narrator2] askQuestion called with:', { question, venueId: venue?.id, activePersona: activePersona?.id, activeStep });
    if (!venue?.id || !activePersona || !activeStep) {
      console.log('[Narrator2] Missing params for askQuestion:', { venueId: venue?.id, personaId: activePersona?.id, stepId: activeStep });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        venueId: venue.id,
        personaId: activePersona.id,
        stepId: activeStep,
        period,
      });

      console.log('[Narrator2] Sending clarify request:', `${API_BASE}/api/narrator2/clarify?${params}`);
      const response = await fetch(`${API_BASE}/api/narrator2/clarify?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: Narrator2NarrationResponse = await response.json();
      console.log('[Narrator2] Clarify response:', data);
      setNarration(data);
      
      console.log(`[Narrator2] Question answered in ${data._meta?.latencyMs}ms`);
    } catch (err) {
      console.error('[Narrator2] Clarify error:', err);
      setError(err instanceof Error ? err.message : 'Failed to answer question');
    } finally {
      setIsLoading(false);
    }
  }, [venue?.id, activePersona, activeStep, period]);

  // Set persona
  const setPersona = useCallback((personaId: Narrator2PersonaId) => {
    const persona = personas.find(p => p.id === personaId);
    if (persona) {
      setActivePersona(persona);
      // Auto-select first step
      if (persona.steps.length > 0) {
        setActiveStep(persona.steps[0].id);
      }
    }
  }, [personas]);

  // Set step
  const setStep = useCallback((stepId: Narrator2StepId) => {
    setActiveStep(stepId);
  }, []);

  // Set period
  const setPeriod = useCallback((newPeriod: Narrator2Period) => {
    setPeriodState(newPeriod);
  }, []);

  // Set OpenAI mode
  const handleSetUseOpenAI = useCallback((enabled: boolean) => {
    setUseOpenAI(enabled);
    localStorage.setItem('narrator2-useOpenAI', enabled ? 'true' : 'false');
  }, []);

  // Execute UI intent - dispatch custom event for App to handle
  const executeIntent = useCallback((intent: string) => {
    console.log('[Narrator2] Execute intent:', intent);
    
    // Dispatch custom event that App.tsx can listen to
    const event = new CustomEvent('narrator2-intent', { 
      detail: { intent, venueId: venue?.id } 
    });
    window.dispatchEvent(event);
  }, [venue?.id]);

  // Refresh (fetch viewpack + narration)
  const refresh = useCallback(async () => {
    await fetchViewPack();
    await requestNarration(useOpenAI);
  }, [fetchViewPack, requestNarration, useOpenAI]);

  // Actions
  const openNarrator = useCallback(async () => {
    setIsOpen(true);
    if (venue?.id && activePersona && activeStep) {
      await refresh();
    }
  }, [venue?.id, activePersona, activeStep, refresh]);

  const closeNarrator = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleNarrator = useCallback(() => {
    if (isOpen) {
      closeNarrator();
    } else {
      openNarrator();
    }
  }, [isOpen, openNarrator, closeNarrator]);

  // Auto-refresh when params change
  useEffect(() => {
    if (isOpen && venue?.id && activePersona && activeStep) {
      refresh();
    }
  }, [isOpen, venue?.id, activePersona?.id, activeStep, period]);

  // Context value
  const contextValue: Narrator2ContextValue = {
    // State
    isOpen,
    isLoading,
    activePersona,
    activeStep,
    period,
    viewPack,
    narration,
    error,
    personas,
    // OpenAI mode
    useOpenAI,
    setUseOpenAI: handleSetUseOpenAI,
    // Actions
    openNarrator,
    closeNarrator,
    toggleNarrator,
    setPersona,
    setStep,
    setPeriod,
    fetchViewPack,
    requestNarration,
    askQuestion,
    executeIntent,
    refresh,
  };

  return (
    <Narrator2Context.Provider value={contextValue}>
      {children}
    </Narrator2Context.Provider>
  );
}

// Hook
export function useNarrator2(): Narrator2ContextValue {
  const context = useContext(Narrator2Context);
  if (!context) {
    throw new Error('useNarrator2 must be used within a Narrator2Provider');
  }
  return context;
}

export default Narrator2Context;
