import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  text: string
  children: ReactNode
  className?: string
  /** Allow multi-line explanatory copy instead of a single nowrap line. */
  wrap?: boolean
}

export default function Tooltip({ text, children, className = '', wrap = false }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0, above: true })
  const ref = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setVisible(true)
    }, 400)
  }, [])

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }, [])

  useEffect(() => {
    if (!visible || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const above = rect.top > 50
    const y = above ? rect.top - 6 : rect.bottom + 6
    setCoords({ x: cx, y, above })
  }, [visible])

  // Clamp tooltip to viewport on next frame after it renders
  useEffect(() => {
    if (!visible || !tipRef.current) return
    const el = tipRef.current
    const r = el.getBoundingClientRect()
    if (r.left < 4) el.style.transform = `translateX(${4 - r.left}px)`
    else if (r.right > window.innerWidth - 4) el.style.transform = `translateX(${window.innerWidth - 4 - r.right}px)`
    else el.style.transform = ''
  }, [visible, coords])

  return (
    <div
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && createPortal(
        <div
          ref={tipRef}
          className="fixed pointer-events-none"
          style={{
            zIndex: 99999,
            left: coords.x,
            top: coords.above ? coords.y : coords.y,
            transform: 'translateX(-50%)',
          }}
        >
          <div
            className={`px-2.5 py-1.5 rounded text-[9px] leading-snug font-mono
              bg-[#222230] border border-white/20 text-white/90 shadow-xl shadow-black/60
              ${wrap ? 'max-w-[240px] whitespace-normal' : 'whitespace-nowrap'}
              ${coords.above ? 'mb-1' : 'mt-1'}`}
            style={coords.above ? { transform: 'translateY(-100%)' } : {}}
          >
            {text}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
