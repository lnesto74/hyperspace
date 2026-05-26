import { useCallback, useEffect, useRef, useState } from 'react'

interface Position {
  x: number
  y: number
}

interface UseDraggablePanelOptions {
  storageKey?: string
  defaultX?: number
  defaultY?: number
}

function loadPosition(storageKey: string | undefined, defaultX: number, defaultY: number): Position {
  if (!storageKey) return { x: defaultX, y: defaultY }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { x: defaultX, y: defaultY }
    const parsed = JSON.parse(raw) as Partial<Position>
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch { /* ignore */ }
  return { x: defaultX, y: defaultY }
}

function isInteractiveDragTarget(target: EventTarget | null) {
  return !!(target as HTMLElement | null)?.closest('button, input, select, textarea, label, a')
}

export function useDraggablePanel({
  storageKey,
  defaultX = 64,
  defaultY = 16,
}: UseDraggablePanelOptions = {}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const posRef = useRef<Position>(loadPosition(storageKey, defaultX, defaultY))
  const [pos, setPos] = useState<Position>(posRef.current)
  const [dragging, setDragging] = useState(false)
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 })

  const clamp = useCallback((x: number, y: number): Position => {
    const el = panelRef.current
    if (!el) return { x, y }
    const parent = el.offsetParent as HTMLElement | null
    const maxW = parent?.clientWidth ?? window.innerWidth
    const maxH = parent?.clientHeight ?? window.innerHeight
    const w = el.offsetWidth || 0
    const h = el.offsetHeight || 0
    return {
      x: Math.max(0, Math.min(x, Math.max(0, maxW - w))),
      y: Math.max(0, Math.min(y, Math.max(0, maxH - h))),
    }
  }, [])

  const persistPosition = useCallback((next: Position) => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch { /* ignore */ }
  }, [storageKey])

  const updatePosition = useCallback((x: number, y: number) => {
    const next = clamp(x, y)
    posRef.current = next
    setPos(next)
    return next
  }, [clamp])

  const onHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (isInteractiveDragTarget(e.target)) return
    const el = panelRef.current
    if (!el) return

    e.preventDefault()
    const parent = el.offsetParent as HTMLElement | null
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 }
    dragOffsetRef.current = {
      x: e.clientX - parentRect.left - posRef.current.x,
      y: e.clientY - parentRect.top - posRef.current.y,
    }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragging) return
    const el = panelRef.current
    if (!el) return
    const parent = el.offsetParent as HTMLElement | null
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 }
    updatePosition(
      e.clientX - parentRect.left - dragOffsetRef.current.x,
      e.clientY - parentRect.top - dragOffsetRef.current.y,
    )
  }, [dragging, updatePosition])

  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragging) return
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    persistPosition(posRef.current)
  }, [dragging, persistPosition])

  useEffect(() => {
    if (!dragging) return
    const onResize = () => updatePosition(posRef.current.x, posRef.current.y)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [dragging, updatePosition])

  return {
    panelRef,
    pos,
    dragging,
    panelStyle: { left: pos.x, top: pos.y } as const,
    headerProps: {
      onPointerDown: onHeaderPointerDown,
      onPointerMove: onHeaderPointerMove,
      onPointerUp: onHeaderPointerUp,
      onPointerCancel: onHeaderPointerUp,
    },
  }
}
