import { useState, useEffect, useCallback } from 'react'

interface CarouselItem {
  src: string
  alt: string
  isLogo?: boolean
}

const ITEMS: CarouselItem[] = [
  { src: '/hyperspace-logo.png', alt: 'Hyperspace', isLogo: true },
  { src: '/assets/geo-singapore.svg', alt: 'Singapore' },
  { src: '/assets/geo-italy.svg', alt: 'Italy' },
  { src: '/assets/geo-puglia.svg', alt: 'Puglia' },
  { src: '/assets/geo-sicily.svg', alt: 'Sicily' },
]

const HOLD_MS = 3500
const STROBE_MS = 300

type Phase = 'enter' | 'hold' | 'exit'

export default function LogoCarousel() {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('enter')

  const advance = useCallback(() => {
    setPhase('exit')
    setTimeout(() => {
      setIndex(prev => (prev + 1) % ITEMS.length)
      setPhase('enter')
      setTimeout(() => setPhase('hold'), STROBE_MS)
    }, STROBE_MS)
  }, [])

  useEffect(() => {
    setTimeout(() => setPhase('hold'), STROBE_MS)
  }, [])

  useEffect(() => {
    if (phase !== 'hold') return
    const t = setTimeout(advance, HOLD_MS)
    return () => clearTimeout(t)
  }, [phase, advance])

  const item = ITEMS[index]

  const anim =
    phase === 'enter' ? `strobe-in ${STROBE_MS}ms linear forwards` :
    phase === 'exit'  ? `strobe-out ${STROBE_MS}ms linear forwards` :
    'logo-idle 4s ease-in-out infinite'

  return (
    <div className="w-14 h-14 relative flex items-center justify-center overflow-hidden">
      <img
        key={`${index}-${phase}`}
        src={item.src}
        alt={item.alt}
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          filter: item.isLogo
            ? 'brightness(0) invert(1)'
            : 'drop-shadow(0 0 8px rgba(255,255,255,0.12))',
          padding: item.isLogo ? 0 : 6,
          animation: anim,
        }}
        onError={(e) => { (e.target as HTMLImageElement).src = '/hyperspace.svg' }}
      />

      <style>{`
        @keyframes strobe-in {
          0%   { opacity: 0;    transform: scale(0.88) translateX(-3px); }
          12%  { opacity: 1;    transform: scale(1.06) translateX(2px); }
          22%  { opacity: 0;    transform: scale(0.94) translateX(-2px); }
          36%  { opacity: 1;    transform: scale(1.03) translateX(1px); }
          48%  { opacity: 0.1;  transform: scale(0.97) translateX(-1px); }
          62%  { opacity: 1;    transform: scale(1.01); }
          78%  { opacity: 0.65; transform: scale(1); }
          100% { opacity: 1;    transform: scale(1); }
        }
        @keyframes strobe-out {
          0%   { opacity: 1;    transform: scale(1); }
          14%  { opacity: 0;    transform: scale(1.05) translateX(2px); }
          28%  { opacity: 0.7;  transform: scale(0.95) translateX(-2px); }
          42%  { opacity: 0;    transform: scale(1.03) translateX(1px); }
          58%  { opacity: 0.4;  transform: scale(0.93); }
          75%  { opacity: 0;    transform: scale(0.88); }
          100% { opacity: 0;    transform: scale(0.85); }
        }
        @keyframes logo-idle {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 1; transform: scale(1.03); }
        }
      `}</style>
    </div>
  )
}
