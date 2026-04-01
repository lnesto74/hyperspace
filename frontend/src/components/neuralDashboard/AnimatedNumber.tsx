/**
 * AnimatedNumber — Smoothly tweens between numeric values using requestAnimationFrame.
 * Gives a "counting up/down" effect that makes dashboard updates feel live.
 */

import { useEffect, useRef, useState } from 'react'

interface AnimatedNumberProps {
  value: number
  duration?: number // ms, default 600
  decimals?: number // decimal places, default 0
  suffix?: string
  prefix?: string
  className?: string
}

export default function AnimatedNumber({
  value,
  duration = 600,
  decimals = 0,
  suffix = '',
  prefix = '',
  className = '',
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef({ value: value, time: 0 })
  const targetRef = useRef(value)
  const currentRef = useRef(value)

  useEffect(() => {
    if (value === targetRef.current) return
    
    // Start a new animation from current displayed value to new target
    startRef.current = { value: currentRef.current, time: performance.now() }
    targetRef.current = value

    const animate = (now: number) => {
      const elapsed = now - startRef.current.time
      const t = Math.min(elapsed / duration, 1)
      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - t, 3)
      
      const from = startRef.current.value
      const to = targetRef.current
      const current = from + (to - from) * eased
      
      currentRef.current = current
      setDisplay(current)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        currentRef.current = to
        setDisplay(to)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  const formatted = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toString()

  return (
    <span className={className}>
      {prefix}{formatted}{suffix}
    </span>
  )
}
