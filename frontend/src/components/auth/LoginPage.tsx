import { useState, useEffect, useRef, useCallback } from 'react'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../config/api'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, AlertTriangle, Users, MapPin, Clock, Zap, Shield } from 'lucide-react'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

interface InsightCard {
  id: string
  title: string
  summary: string
  venue_name: string
  severity: 'high' | 'medium' | 'low'
  color: string
  kpis: Array<{ label: string; value: string; direction: 'up' | 'down' | 'flat' }>
  episode_type: string
  time_label: string
}

const EPISODE_ICONS: Record<string, typeof Zap> = {
  QUEUE_BUILDUP_SPIKE: Users,
  LANE_UNDERSUPPLY: AlertTriangle,
  LANE_OVERSUPPLY: AlertTriangle,
  ABANDONMENT_WAVE: Users,
  HIGH_PASSBY_LOW_BROWSE: MapPin,
  BROWSE_NO_CONVERT_PROXY: TrendingDown,
  BOTTLENECK_CORRIDOR: Users,
  STORE_VISIT_TIME_SHIFT: Clock,
  EXPOSURE_TO_ACTION_WIN: TrendingUp,
  EXPOSURE_NO_FOLLOWTHROUGH: TrendingDown,
  ATTENTION_QUALITY_DROP: TrendingDown,
}

// Fallback insight cards when no data available
const FALLBACK_CARDS: InsightCard[] = [
  {
    id: 'f1', title: 'Real-time People Tracking', summary: 'LiDAR-powered anonymous tracking with centimeter precision. No cameras, no privacy concerns.', venue_name: 'Hyperspace', severity: 'low', color: '#3b82f6',
    kpis: [{ label: 'Accuracy', value: '±3cm', direction: 'flat' }, { label: 'Privacy', value: '100%', direction: 'up' }], episode_type: '', time_label: 'Always On',
  },
  {
    id: 'f2', title: 'Shelf Engagement Analytics', summary: 'Measure browse rates, dwell times, and conversion at every shelf and category.', venue_name: 'Hyperspace', severity: 'low', color: '#8b5cf6',
    kpis: [{ label: 'Browse Rate', value: '22%', direction: 'down' }, { label: 'Dwell Time', value: '4.2s', direction: 'up' }], episode_type: '', time_label: 'Category Performance',
  },
  {
    id: 'f3', title: 'DOOH Attribution', summary: 'PEBLE™ measures digital signage effectiveness by linking ad exposure to shopper behavior changes.', venue_name: 'Hyperspace', severity: 'low', color: '#f59e0b',
    kpis: [{ label: 'Lift', value: '+18%', direction: 'up' }, { label: 'Exposure', value: '2.3K', direction: 'flat' }], episode_type: '', time_label: 'PEBLE™ Attribution',
  },
  {
    id: 'f4', title: 'Queue Management', summary: 'Detect queue buildups in real-time, optimize lane allocation, reduce abandonment.', venue_name: 'Hyperspace', severity: 'medium', color: '#ef4444',
    kpis: [{ label: 'Wait Time', value: '3.2m', direction: 'down' }, { label: 'Throughput', value: '↑12%', direction: 'up' }], episode_type: '', time_label: 'Operations',
  },
  {
    id: 'f5', title: 'AI-Powered Insights', summary: 'Automated behavior episode detection with actionable business recommendations.', venue_name: 'Hyperspace', severity: 'low', color: '#10b981',
    kpis: [{ label: 'Episodes', value: '20+', direction: 'flat' }, { label: 'Accuracy', value: '94%', direction: 'up' }], episode_type: '', time_label: 'Replay Insights',
  },
]

function Particle({ delay, duration, x, size, opacity }: { delay: number; duration: number; x: number; size: number; opacity: number }) {
  return (
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: `${x}%`,
        bottom: '-5%',
        width: size,
        height: size,
        background: `radial-gradient(circle, rgba(59,130,246,${opacity}) 0%, transparent 70%)`,
        animation: `login-float ${duration}s ${delay}s ease-out infinite`,
      }}
    />
  )
}

function InsightSlide({ card, isActive }: { card: InsightCard; isActive: boolean }) {
  const Icon = EPISODE_ICONS[card.episode_type] || Zap
  return (
    <div
      className={`absolute inset-0 rounded-2xl overflow-hidden transition-all duration-700 ease-out ${
        isActive ? 'opacity-100 scale-100 z-10' : 'opacity-0 scale-95 z-0 pointer-events-none'
      }`}
      style={{ border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${card.color}18 0%, rgba(30,30,40,0.95) 50%, ${card.color}10 100%)` }} />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,15,0.95) 0%, rgba(10,10,15,0.6) 40%, transparent 100%)' }} />
      <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' }} />

      <div className="relative h-full flex flex-col justify-end p-8 text-left">
        <div className="absolute top-6 left-8 right-8 flex items-center justify-between">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider backdrop-blur-md"
            style={{ color: card.color, backgroundColor: `${card.color}25`, border: `1px solid ${card.color}40` }}
          >
            <Icon className="w-3.5 h-3.5" />
            {card.venue_name}
          </div>
          <span className="text-xs text-gray-300 bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
            {card.time_label}
          </span>
        </div>

        <h3 className="text-2xl font-bold text-white mb-3 leading-tight max-w-lg drop-shadow-lg">{card.title}</h3>
        <p className="text-sm text-gray-200 mb-4 max-w-lg line-clamp-2 leading-relaxed drop-shadow-md">{card.summary}</p>

        <div className="flex flex-wrap gap-2">
          {card.kpis.map((kpi, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur-md border"
              style={{
                background: kpi.direction === 'up' ? 'rgba(34,197,94,0.2)' : kpi.direction === 'down' ? 'rgba(239,68,68,0.2)' : 'rgba(107,114,128,0.2)',
                color: kpi.direction === 'up' ? '#86efac' : kpi.direction === 'down' ? '#fca5a5' : '#d1d5db',
                borderColor: kpi.direction === 'up' ? 'rgba(34,197,94,0.25)' : kpi.direction === 'down' ? 'rgba(239,68,68,0.25)' : 'rgba(107,114,128,0.25)',
              }}
            >
              {kpi.direction === 'up' ? <TrendingUp className="w-3 h-3" /> : kpi.direction === 'down' ? <TrendingDown className="w-3 h-3" /> : null}
              <span>{kpi.label}</span>
              <span className="font-bold">{kpi.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LoginPageInner() {
  const { login } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [cards, setCards] = useState<InsightCard[]>(FALLBACK_CARDS)
  const [slideIndex, setSlideIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const particlesRef = useRef(
    Array.from({ length: 15 }, () => ({
      delay: Math.random() * 8,
      duration: 10 + Math.random() * 12,
      x: Math.random() * 100,
      size: 2 + Math.random() * 4,
      opacity: 0.04 + Math.random() * 0.12,
    }))
  )

  // Try to fetch real episodes from all venues for the carousel
  useEffect(() => {
    const fetchInsights = async () => {
      try {
        const venueRes = await fetch(`${API_BASE}/api/venues`)
        if (!venueRes.ok) return
        const venueList = await venueRes.json()
        if (!venueList || venueList.length === 0) return

        const allEpisodes: any[] = []
        for (const v of venueList.slice(0, 3)) {
          try {
            const epRes = await fetch(`${API_BASE}/api/replay-insights?venueId=${v.id}&period=day&limit=5`)
            if (epRes.ok) {
              const epData = await epRes.json()
              if (epData.episodes) {
                allEpisodes.push(...epData.episodes.map((ep: any) => ({ ...ep, venue_name: v.name })))
              }
            }
          } catch { /* skip venue */ }
        }

        if (allEpisodes.length > 0) {
          const mapped: InsightCard[] = allEpisodes.slice(0, 10).map((ep: any) => ({
            id: ep.episode_id,
            title: ep.title,
            summary: ep.business_summary,
            venue_name: ep.venue_name || 'Venue',
            severity: ep.severity,
            color: ep.color || '#3b82f6',
            kpis: (ep.kpis || []).slice(0, 3).map((k: any) => ({
              label: k.label,
              value: `${k.value}${k.unit === 'percent' ? '%' : k.unit === 'seconds' ? 's' : ''}`,
              direction: k.direction,
            })),
            episode_type: ep.episode_type,
            time_label: ep.time_label || '',
          }))
          if (mapped.length > 0) setCards(mapped)
        }
      } catch {
        // Use fallback cards
      }
    }
    fetchInsights()
  }, [])

  // Auto-advance carousel
  useEffect(() => {
    if (isPaused || cards.length <= 1) return
    autoRef.current = setInterval(() => setSlideIndex((p) => (p + 1) % cards.length), 5000)
    return () => {
      if (autoRef.current) clearInterval(autoRef.current)
    }
  }, [isPaused, cards.length])

  const goToSlide = useCallback(
    (i: number) => {
      setSlideIndex(i)
      setIsPaused(true)
      setTimeout(() => setIsPaused(false), 8000)
    },
    []
  )

  const handleGoogleSuccess = async (credentialResponse: any) => {
    setError(null)
    try {
      await login(credentialResponse.credential)
    } catch (err: any) {
      setError(err.message || 'Login failed')
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-950 overflow-hidden flex flex-col items-center justify-center">
      <style>{`
        @keyframes login-float { 0% { transform: translateY(0) scale(1); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(-110vh) scale(0.5); opacity: 0; } }
        @keyframes login-card-in { 0% { opacity: 0; transform: translateY(30px) scale(0.95); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes login-pulse-ring { 0% { transform: scale(0.8); opacity: 0; } 50% { opacity: 0.4; } 100% { transform: scale(2.5); opacity: 0; } }
        @keyframes login-hue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(-360deg); } }
        .login-gradient-text {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 100;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: #f35626;
          background-image: linear-gradient(92deg, #f35626, #feab3a);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: login-hue 10s infinite linear;
        }
      `}</style>

      {/* Background effects */}
      <div className="absolute inset-0 bg-gray-950" />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(59,130,246,0.06) 0%, transparent 60%)' }}
      />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particlesRef.current.map((p, i) => (
          <Particle key={i} {...p} />
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10 w-full max-w-5xl px-6 flex flex-col items-center gap-8">
        {/* Logo + Title */}
        <div className="text-center" style={{ opacity: 0, animation: 'login-card-in 1s 0.2s ease-out forwards' }}>
          <div className="relative inline-flex items-center justify-center mb-4">
            <div className="absolute w-32 h-32 rounded-full border border-blue-500/20" style={{ animation: 'login-pulse-ring 3s ease-out infinite' }} />
            <div className="absolute w-32 h-32 rounded-full border border-blue-500/10" style={{ animation: 'login-pulse-ring 3s 1s ease-out infinite' }} />
            <img
              src="/hyperspace-logo.png"
              alt="Hyperspace"
              className="w-24 h-24 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).src = '/hyperspace.svg' }}
            />
          </div>
          <h1 className="login-gradient-text text-2xl mb-2">Hyperspace</h1>
          <p className="text-sm text-gray-500">LiDAR-Powered Spatial Intelligence</p>
        </div>

        {/* Carousel */}
        <div
          className="w-full"
          style={{ opacity: 0, animation: 'login-card-in 0.8s 0.6s ease-out forwards' }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div className="flex items-center gap-3">
            {cards.length > 1 && (
              <button
                onClick={() => goToSlide((slideIndex - 1 + cards.length) % cards.length)}
                className="shrink-0 w-10 h-10 rounded-full bg-gray-800/60 backdrop-blur-sm border border-gray-700/30 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700/80 transition-all"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div className="relative flex-1 min-w-0 aspect-[16/7] rounded-2xl overflow-hidden">
              {cards.map((card, i) => (
                <InsightSlide key={card.id} card={card} isActive={i === slideIndex} />
              ))}
              {/* Dots */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
                {cards.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => goToSlide(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === slideIndex ? 'w-6 h-2 bg-white' : 'w-2 h-2 bg-gray-500/60 hover:bg-gray-400/60'
                    }`}
                  />
                ))}
              </div>
            </div>
            {cards.length > 1 && (
              <button
                onClick={() => goToSlide((slideIndex + 1) % cards.length)}
                className="shrink-0 w-10 h-10 rounded-full bg-gray-800/60 backdrop-blur-sm border border-gray-700/30 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700/80 transition-all"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Login section */}
        <div
          className="flex flex-col items-center gap-4"
          style={{ opacity: 0, animation: 'login-card-in 0.8s 1s ease-out forwards' }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="h-px w-16 bg-gradient-to-r from-transparent to-gray-700" />
            <span className="text-[10px] text-gray-500 uppercase tracking-widest">Sign in to continue</span>
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-gray-700" />
          </div>

          <div className="relative">
            <div className="absolute -inset-3 rounded-2xl bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 blur-lg" />
            <div className="relative bg-gray-900/80 backdrop-blur-xl border border-gray-700/50 rounded-xl p-6 flex flex-col items-center gap-4">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google login failed')}
                theme="filled_black"
                size="large"
                shape="pill"
                text="signin_with"
                width="280"
              />
              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                  <Shield className="w-3.5 h-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-600 mt-2">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <LoginPageInner />
    </GoogleOAuthProvider>
  )
}
