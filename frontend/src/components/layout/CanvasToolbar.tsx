import { useState, useRef, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Accent = 'purple' | 'blue' | 'emerald' | 'amber' | 'orange' | 'indigo' | 'green' | 'gray'

const ACCENT_HOVER: Record<Accent, string> = {
  purple: 'hover:bg-purple-600 hover:border-purple-500 hover:text-white',
  blue: 'hover:bg-blue-600 hover:border-blue-500 hover:text-white',
  emerald: 'hover:bg-emerald-600 hover:border-emerald-500 hover:text-white',
  amber: 'hover:bg-amber-600 hover:border-amber-500 hover:text-white',
  orange: 'hover:bg-orange-600 hover:border-orange-500 hover:text-white',
  indigo: 'hover:bg-indigo-600 hover:border-indigo-500 hover:text-white',
  green: 'hover:bg-green-600 hover:border-green-500 hover:text-white',
  gray: 'hover:bg-gray-700',
}

const ACCENT_ACTIVE: Record<Accent, string> = {
  purple: 'bg-purple-600 text-white border-purple-500',
  blue: 'bg-blue-600 text-white border-blue-500',
  emerald: 'bg-emerald-600 text-white border-emerald-500',
  amber: 'bg-amber-600 text-white border-amber-500',
  orange: 'bg-orange-600 text-white border-orange-500',
  indigo: 'bg-indigo-600 text-white border-indigo-500',
  green: 'bg-green-600 text-white border-green-500',
  gray: 'bg-gray-700 text-white border-gray-500',
}

export interface CanvasToolbarAction {
  id: string
  icon: LucideIcon
  title: string
  onClick: () => void
  active?: boolean
  accent?: Accent
}

interface CanvasToolbarButtonProps {
  icon: LucideIcon
  title: string
  onClick: () => void
  active?: boolean
  accent?: Accent
  className?: string
  children?: ReactNode
}

export function CanvasToolbarButton({
  icon: Icon,
  title,
  onClick,
  active = false,
  accent = 'gray',
  className = '',
  children,
}: CanvasToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all border ${
        active
          ? ACCENT_ACTIVE[accent]
          : `bg-gray-800 text-gray-300 border-gray-600 ${ACCENT_HOVER[accent]}`
      } ${className}`}
      title={title}
    >
      <Icon className="w-4 h-4" />
      {children}
    </button>
  )
}

interface CanvasToolbarFlyoutProps {
  icon: LucideIcon
  title: string
  accent?: Accent
  active?: boolean
  onPrimaryClick: () => void
  items: CanvasToolbarAction[]
}

export function CanvasToolbarFlyout({
  icon: Icon,
  title,
  accent = 'gray',
  active = false,
  onPrimaryClick,
  items,
}: CanvasToolbarFlyoutProps) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }

  const handleLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  const hasFlyout = items.length > 0

  return (
    <div
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {open && hasFlyout && (
        <div className="absolute bottom-full right-0 pb-2 flex flex-col items-end gap-2 z-40">
          {items.map((item) => {
            const ItemIcon = item.icon
            const itemAccent = item.accent ?? accent
            return (
              <button
                key={item.id}
                onClick={() => {
                  item.onClick()
                  setOpen(false)
                }}
                className={`flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all border ${
                  item.active
                    ? ACCENT_ACTIVE[itemAccent]
                    : `bg-gray-800 text-gray-300 border-gray-600 ${ACCENT_HOVER[itemAccent]}`
                }`}
                title={item.title}
              >
                <ItemIcon className="w-4 h-4" />
              </button>
            )
          })}
        </div>
      )}

      <button
        onClick={onPrimaryClick}
        className={`relative flex items-center justify-center w-10 h-10 rounded-lg shadow-lg transition-all border ${
          active
            ? ACCENT_ACTIVE[accent]
            : `bg-gray-800 text-gray-300 border-gray-600 ${ACCENT_HOVER[accent]}`
        }`}
        title={title}
      >
        <Icon className="w-4 h-4" />
        {hasFlyout && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-gray-500/80 border border-gray-700" />
        )}
      </button>
    </div>
  )
}

export function CanvasToolbarDivider() {
  return <div className="w-px h-8 bg-gray-600/70 mx-0.5 shrink-0" />
}
