/**
 * ReplayInsightContext
 * 
 * State management for the Replay Insight system.
 * Manages episode fetching, panel state, insight mode, and story playlists.
 * Does NOT modify any existing context or component.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useVenue } from './VenueContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Types ───

export interface EpisodeKpiCard {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  direction: 'up' | 'down' | 'flat';
  baseline: number | null;
  change: number | null;
}

export interface ReplayWindow {
  start: number;
  end: number;
  zones: string[];
}

export interface HighlightZone {
  id: string;
  name: string;
  color: string;
  vertices: Array<{ x: number; z: number }>;
}

export interface NarrationPack {
  episode_id: string;
  episode_type: string;
  category: string;
  color: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  business_summary: string;
  time_label: string;
  kpis: EpisodeKpiCard[];
  replay_window: ReplayWindow;
  highlight_zones: HighlightZone[];
  representative_tracks: string[];
  recommended_actions: string[];
  confidence: number;
  score: number;
  scope: string;
  features: Record<string, unknown>;
  track_positions?: Record<string, Array<{ timestamp: number; x: number; z: number; vx: number; vz: number }>>;
}

export interface TimelineMarker {
  id: string;
  episode_type: string;
  start_ts: number;
  end_ts: number;
  scope: string;
  title: string;
  confidence: number;
  score: number;
}

export interface StoryRecipe {
  id: string;
  name: string;
  persona: string;
  description: string;
  steps: Array<{ type: string; filter: string; limit: number; label: string }>;
}

export interface PlaylistItem {
  step_label: string;
  episode: unknown;
  narration_pack: NarrationPack;
}

interface ReplayInsightContextValue {
  // State
  isLoading: boolean;
  episodes: NarrationPack[];
  selectedEpisode: NarrationPack | null;
  timelineMarkers: TimelineMarker[];
  isPanelOpen: boolean;
  isInsightMode: boolean;
  recipes: StoryRecipe[];
  activePlaylist: PlaylistItem[];
  activePlaylistIndex: number;
  isStoryGridOpen: boolean;

  // Actions
  fetchEpisodes: (options?: { period?: string; type?: string }) => Promise<void>;
  fetchTimelineMarkers: (startTs: number, endTs: number) => Promise<void>;
  selectEpisode: (episodeId: string) => Promise<void>;
  explainKpi: (kpiId: string) => Promise<void>;
  openPanel: () => void;
  closePanel: () => void;
  enterInsightMode: () => void;
  exitInsightMode: () => void;
  openStoryGrid: () => void;
  closeStoryGrid: () => void;
  fetchRecipes: () => Promise<void>;
  executeRecipe: (recipeId: string, options?: Record<string, unknown>) => Promise<void>;
  playlistNext: () => void;
  playlistPrev: () => void;
  clearPlaylist: () => void;
}

const ReplayInsightContext = createContext<ReplayInsightContextValue | null>(null);

export function ReplayInsightProvider({ children }: { children: React.ReactNode }) {
  const { venue } = useVenue();

  const [isLoading, setIsLoading] = useState(false);
  const [episodes, setEpisodes] = useState<NarrationPack[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<NarrationPack | null>(null);
  const [timelineMarkers, setTimelineMarkers] = useState<TimelineMarker[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isInsightMode, setIsInsightMode] = useState(false);
  const [recipes, setRecipes] = useState<StoryRecipe[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistItem[]>([]);
  const [activePlaylistIndex, setActivePlaylistIndex] = useState(0);
  const [isStoryGridOpen, setIsStoryGridOpen] = useState(false);

  // ─── Fetch episodes ───
  const fetchEpisodes = useCallback(async (options: { period?: string; type?: string } = {}) => {
    if (!venue?.id) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ venueId: venue.id });
      if (options.period) params.set('period', options.period);
      if (options.type) params.set('type', options.type);

      const res = await fetch(`${API_BASE}/api/replay-insights?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data.episodes || []);
      }
    } catch (err) {
      console.error('[ReplayInsight] Failed to fetch episodes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [venue?.id]);

  // ─── Fetch timeline markers ───
  const fetchTimelineMarkers = useCallback(async (startTs: number, endTs: number) => {
    if (!venue?.id) return;
    try {
      const params = new URLSearchParams({
        venueId: venue.id,
        start: String(startTs),
        end: String(endTs),
      });
      const res = await fetch(`${API_BASE}/api/replay-insights/markers?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTimelineMarkers(data.markers || []);
      }
    } catch (err) {
      console.error('[ReplayInsight] Failed to fetch markers:', err);
    }
  }, [venue?.id]);

  // ─── Select episode (fetch full replay data) ───
  const selectEpisode = useCallback(async (episodeId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/replay-insights/${episodeId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedEpisode(data);
        setIsPanelOpen(true);
      }
    } catch (err) {
      console.error('[ReplayInsight] Failed to fetch episode:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ─── Explain KPI (reverse index) ───
  const explainKpi = useCallback(async (kpiId: string) => {
    if (!venue?.id) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ venueId: venue.id, kpiId });
      const res = await fetch(`${API_BASE}/api/replay-insights/explain?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEpisodes(data.episodes || []);
        if (data.episodes?.length > 0) {
          setSelectedEpisode(data.episodes[0]);
          setIsPanelOpen(true);
        }
      }
    } catch (err) {
      console.error('[ReplayInsight] Failed to explain KPI:', err);
    } finally {
      setIsLoading(false);
    }
  }, [venue?.id]);

  // ─── Panel controls ───
  const openPanel = useCallback(() => setIsPanelOpen(true), []);
  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
    setIsInsightMode(false);
  }, []);

  // ─── Insight Mode ───
  const enterInsightMode = useCallback(() => setIsInsightMode(true), []);
  const exitInsightMode = useCallback(() => setIsInsightMode(false), []);

  // ─── Story Grid ───
  const openStoryGrid = useCallback(() => {
    setIsStoryGridOpen(true);
    if (venue?.id && episodes.length === 0) {
      fetchEpisodes();
    }
  }, [venue?.id, episodes.length, fetchEpisodes]);

  const closeStoryGrid = useCallback(() => setIsStoryGridOpen(false), []);

  // ─── Recipes ───
  const fetchRecipes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/replay-insights/recipes`);
      if (res.ok) {
        const data = await res.json();
        setRecipes(data.recipes || []);
      }
    } catch (err) {
      console.error('[ReplayInsight] Failed to fetch recipes:', err);
    }
  }, []);

  const executeRecipe = useCallback(async (recipeId: string, options: Record<string, unknown> = {}) => {
    if (!venue?.id) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ venueId: venue.id });
      if (options.period) params.set('period', options.period as string);

      const res = await fetch(`${API_BASE}/api/replay-insights/recipes/${recipeId}?${params}`);
      if (res.ok) {
        const data = await res.json();
        setActivePlaylist(data.playlist || []);
        setActivePlaylistIndex(0);
        setIsStoryGridOpen(false);

        // Auto-select first episode
        if (data.playlist?.length > 0) {
          setSelectedEpisode(data.playlist[0].narration_pack);
          setIsPanelOpen(true);
        }
      }
    } catch (err) {
      console.error('[ReplayInsight] Failed to execute recipe:', err);
    } finally {
      setIsLoading(false);
    }
  }, [venue?.id]);

  // ─── Playlist navigation ───
  const playlistNext = useCallback(() => {
    if (activePlaylistIndex < activePlaylist.length - 1) {
      const nextIdx = activePlaylistIndex + 1;
      setActivePlaylistIndex(nextIdx);
      setSelectedEpisode(activePlaylist[nextIdx].narration_pack);
    }
  }, [activePlaylist, activePlaylistIndex]);

  const playlistPrev = useCallback(() => {
    if (activePlaylistIndex > 0) {
      const prevIdx = activePlaylistIndex - 1;
      setActivePlaylistIndex(prevIdx);
      setSelectedEpisode(activePlaylist[prevIdx].narration_pack);
    }
  }, [activePlaylist, activePlaylistIndex]);

  const clearPlaylist = useCallback(() => {
    setActivePlaylist([]);
    setActivePlaylistIndex(0);
  }, []);

  const contextValue: ReplayInsightContextValue = {
    isLoading,
    episodes,
    selectedEpisode,
    timelineMarkers,
    isPanelOpen,
    isInsightMode,
    recipes,
    activePlaylist,
    activePlaylistIndex,
    isStoryGridOpen,
    fetchEpisodes,
    fetchTimelineMarkers,
    selectEpisode,
    explainKpi,
    openPanel,
    closePanel,
    enterInsightMode,
    exitInsightMode,
    openStoryGrid,
    closeStoryGrid,
    fetchRecipes,
    executeRecipe,
    playlistNext,
    playlistPrev,
    clearPlaylist,
  };

  return (
    <ReplayInsightContext.Provider value={contextValue}>
      {children}
    </ReplayInsightContext.Provider>
  );
}

export function useReplayInsight(): ReplayInsightContextValue {
  const context = useContext(ReplayInsightContext);
  if (!context) {
    throw new Error('useReplayInsight must be used within a ReplayInsightProvider');
  }
  return context;
}

export default ReplayInsightContext;
