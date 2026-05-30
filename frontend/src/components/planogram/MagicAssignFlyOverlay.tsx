import { useEffect, useRef, useState } from 'react'
import { Package } from 'lucide-react'
import type { MagicAssignAssignment } from '../../context/PlanogramContext'

const FLIGHT_MS = 650
const STAGGER_MS = 55
const BASKET_X = 148
const BASKET_Y_OFFSET = 0.42

type FlyingItem = MagicAssignAssignment & {
  key: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  launched: boolean
  landed: boolean
}

interface MagicAssignFlyOverlayProps {
  assignments: MagicAssignAssignment[]
  active: boolean
  projectSlot: (shelfId: string, levelIndex: number, slotIndex: number) => { x: number; y: number } | null
  onComplete: () => void
}

function assignmentRunKey(assignments: MagicAssignAssignment[]): string {
  return assignments.map(a => `${a.shelfId}:${a.levelIndex}:${a.slotIndex}:${a.skuItemId}`).join('|')
}

export default function MagicAssignFlyOverlay({
  assignments,
  active,
  projectSlot,
  onComplete,
}: MagicAssignFlyOverlayProps) {
  const [items, setItems] = useState<FlyingItem[]>([])
  const completedRef = useRef(false)
  const projectSlotRef = useRef(projectSlot)
  const onCompleteRef = useRef(onComplete)

  projectSlotRef.current = projectSlot
  onCompleteRef.current = onComplete

  const runKey = active && assignments.length > 0 ? assignmentRunKey(assignments) : ''

  useEffect(() => {
    if (!active || assignments.length === 0) {
      setItems([])
      completedRef.current = false
      return
    }

    completedRef.current = false
    const basketY = window.innerHeight * BASKET_Y_OFFSET

    const prepared: FlyingItem[] = assignments.map((a, i) => {
      const target = projectSlotRef.current(a.shelfId, a.levelIndex, a.slotIndex)
      return {
        ...a,
        key: `${a.shelfId}-${a.levelIndex}-${a.slotIndex}-${i}`,
        fromX: BASKET_X,
        fromY: basketY,
        toX: target?.x ?? window.innerWidth * 0.55,
        toY: target?.y ?? window.innerHeight * 0.45,
        launched: false,
        landed: false,
      }
    })

    setItems(prepared)

    const launchTimers: number[] = []
    prepared.forEach((_, i) => {
      launchTimers.push(window.setTimeout(() => {
        setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, launched: true } : item)))
      }, i * STAGGER_MS))
    })

    const totalMs = prepared.length * STAGGER_MS + FLIGHT_MS + 180

    const landTimer = window.setTimeout(() => {
      setItems((prev) => prev.map((item) => ({ ...item, landed: true })))
    }, prepared.length * STAGGER_MS + FLIGHT_MS)

    const doneTimer = window.setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true
        onCompleteRef.current()
      }
    }, totalMs)

    // Safety net — never leave the UI stuck if timers were interrupted
    const safetyTimer = window.setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true
        onCompleteRef.current()
      }
    }, totalMs + 2000)

    return () => {
      launchTimers.forEach(clearTimeout)
      clearTimeout(landTimer)
      clearTimeout(doneTimer)
      clearTimeout(safetyTimer)
    }
  }, [active, runKey, assignments.length])

  if (!active || items.length === 0) return null

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none overflow-hidden">
      <div
        className="absolute w-16 h-16 rounded-full bg-amber-500/20 blur-xl animate-pulse"
        style={{ left: BASKET_X - 32, top: `calc(${BASKET_Y_OFFSET * 100}% - 32px)` }}
      />

      {items.map((item) => {
        const x = item.launched ? item.toX : item.fromX
        const y = item.launched ? item.toY : item.fromY
        const scale = item.landed ? 0.85 : item.launched ? 1 : 0.6
        const opacity = item.landed ? 0 : 1

        return (
          <div
            key={item.key}
            className="absolute flex items-center gap-1.5 px-2 py-1 rounded-lg shadow-lg border border-amber-500/40 bg-gray-900/95 backdrop-blur-sm"
            style={{
              left: x,
              top: y,
              transform: `translate(-50%, -50%) scale(${scale})`,
              opacity,
              transition: item.launched
                ? `left ${FLIGHT_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${FLIGHT_MS}ms cubic-bezier(0.22, 1, 0.36, 1), transform 200ms ease-out, opacity 180ms ease-out`
                : 'transform 200ms ease-out, opacity 200ms ease-out',
              zIndex: item.launched ? 20 : 10,
            }}
          >
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                className="w-7 h-7 rounded object-cover bg-white/10"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <Package className="w-5 h-5 text-amber-400 flex-shrink-0" />
            )}
            <span className="text-[10px] text-white max-w-[88px] truncate">{item.name}</span>
          </div>
        )
      })}
    </div>
  )
}
