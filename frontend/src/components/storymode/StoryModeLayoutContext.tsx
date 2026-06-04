import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const NARRATIVE_COLLAPSED_KEY = 'hyperspace-story-narrative-collapsed'

function getNarrativeCollapsedPref(): boolean {
  try { return localStorage.getItem(NARRATIVE_COLLAPSED_KEY) === 'true' } catch { return false }
}

function setNarrativeCollapsedPref(collapsed: boolean) {
  try { localStorage.setItem(NARRATIVE_COLLAPSED_KEY, collapsed ? 'true' : 'false') } catch { /* ignore */ }
}

export interface StoryModeChromeSnapshot {
  active: boolean
  introPlaying: boolean
  beatIndex: number
  beatTotal: number
  replayLive: boolean
  playing: boolean
}

export interface StoryModeChromeHandlers {
  goto: (index: number) => void
  next: () => void
  prev: () => void
  exit: () => void
  togglePlaying: () => void
}

interface StoryModeLayoutContextValue {
  snapshot: StoryModeChromeSnapshot
  narrativeCollapsed: boolean
  publishSnapshot: (patch: Partial<StoryModeChromeSnapshot>) => void
  toggleNarrativeCollapsed: () => void
  registerHandlers: (handlers: StoryModeChromeHandlers | null) => void
  handlers: StoryModeChromeHandlers | null
}

const defaultSnapshot: StoryModeChromeSnapshot = {
  active: false,
  introPlaying: false,
  beatIndex: 0,
  beatTotal: 0,
  replayLive: false,
  playing: false,
}

const StoryModeLayoutContext = createContext<StoryModeLayoutContextValue | null>(null)

export function StoryModeLayoutProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<StoryModeChromeSnapshot>(defaultSnapshot)
  const [narrativeCollapsed, setNarrativeCollapsed] = useState(getNarrativeCollapsedPref)
  const handlersRef = useRef<StoryModeChromeHandlers | null>(null)
  const [handlers, setHandlers] = useState<StoryModeChromeHandlers | null>(null)

  const publishSnapshot = useCallback((patch: Partial<StoryModeChromeSnapshot>) => {
    setSnapshot((prev) => ({ ...prev, ...patch }))
  }, [])

  const toggleNarrativeCollapsed = useCallback(() => {
    setNarrativeCollapsed((prev) => {
      const next = !prev
      setNarrativeCollapsedPref(next)
      return next
    })
  }, [])

  const registerHandlers = useCallback((next: StoryModeChromeHandlers | null) => {
    handlersRef.current = next
    setHandlers(next)
  }, [])

  useEffect(() => {
    if (!snapshot.active) return
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
    return () => window.clearTimeout(t)
  }, [snapshot.active, narrativeCollapsed, snapshot.introPlaying])

  const value = useMemo(
    () => ({
      snapshot,
      narrativeCollapsed,
      publishSnapshot,
      toggleNarrativeCollapsed,
      registerHandlers,
      handlers,
    }),
    [snapshot, narrativeCollapsed, publishSnapshot, toggleNarrativeCollapsed, registerHandlers, handlers],
  )

  return (
    <StoryModeLayoutContext.Provider value={value}>
      {children}
    </StoryModeLayoutContext.Provider>
  )
}

export function useStoryModeLayout() {
  const ctx = useContext(StoryModeLayoutContext)
  if (!ctx) throw new Error('useStoryModeLayout must be used within StoryModeLayoutProvider')
  return ctx
}

/** Safe for App shell when provider may not wrap legacy paths. */
export function useStoryModeLayoutOptional() {
  return useContext(StoryModeLayoutContext)
}
