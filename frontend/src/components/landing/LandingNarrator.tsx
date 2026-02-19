/**
 * LandingNarrator
 * 
 * Async AI headline with typewriter effect.
 * Calls Narrator v2 to generate a 1-sentence executive summary.
 * Falls back to top episode title if API is slow or fails.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useVenue } from '../../context/VenueContext';
import type { NarrationPack } from '../../context/ReplayInsightContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface LandingNarratorProps {
  episodes: NarrationPack[];
}

export default function LandingNarrator({ episodes }: LandingNarratorProps) {
  const { venue } = useVenue();
  const [headline, setHeadline] = useState<string>('');
  const [displayText, setDisplayText] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [showCursor, setShowCursor] = useState(true);
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Build fallback headline from episodes
  const buildFallback = useCallback(() => {
    if (episodes.length === 0) return 'Analyzing venue activity...';

    const highSev = episodes.filter(e => e.severity === 'high');
    if (highSev.length > 0) {
      return highSev[0].title;
    }
    
    // Summarize episode types
    const types = new Set(episodes.map(e => e.category));
    const typeList = Array.from(types).slice(0, 3).join(', ');
    return `${episodes.length} moments detected across ${typeList}`;
  }, [episodes]);

  // Fetch AI headline
  useEffect(() => {
    if (!venue?.id || episodes.length === 0) {
      setHeadline(buildFallback());
      return;
    }

    // Set fallback immediately, then try AI
    const fallback = buildFallback();
    setHeadline(fallback);

    // Build a compact summary for the AI
    const summaryParts = episodes.slice(0, 5).map(ep => 
      `${ep.category}: "${ep.title}" (${ep.severity} severity)`
    );
    const prompt = `You are briefing a retail executive. Given these ${episodes.length} detected behavior episodes at venue "${venue.name}":\n${summaryParts.join('\n')}\n\nWrite ONE sentence (max 20 words) summarizing the most important takeaway. Neutral tone, no "we", no questions. Business impact focus.`;

    abortRef.current = new AbortController();

    const fetchHeadline = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/narrator2/clarify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venueId: venue.id,
            question: prompt,
            context: { source: 'landing-experience' },
          }),
          signal: abortRef.current?.signal,
        });

        if (res.ok) {
          const data = await res.json();
          const aiText = data.answer || data.response || data.text;
          if (aiText && typeof aiText === 'string' && aiText.length > 10) {
            // Clean up: remove quotes, truncate if too long
            const cleaned = aiText.replace(/^["']|["']$/g, '').trim();
            if (cleaned.length <= 120) {
              setHeadline(cleaned);
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.log('[LandingNarrator] AI headline failed, using fallback');
        }
      }
    };

    // Give the AI 4 seconds max
    const timeout = setTimeout(() => {
      abortRef.current?.abort();
    }, 4000);

    fetchHeadline();

    return () => {
      clearTimeout(timeout);
      abortRef.current?.abort();
    };
  }, [venue?.id, episodes, buildFallback]);

  // Typewriter effect
  useEffect(() => {
    if (!headline) return;

    // Reset
    setDisplayText('');
    setIsTyping(true);
    setShowCursor(true);

    let charIndex = 0;
    const speed = Math.max(20, Math.min(50, 1500 / headline.length)); // adaptive speed

    const type = () => {
      if (charIndex < headline.length) {
        setDisplayText(headline.slice(0, charIndex + 1));
        charIndex++;
        typingRef.current = setTimeout(type, speed);
      } else {
        setIsTyping(false);
        // Hide cursor after 2s
        typingRef.current = setTimeout(() => setShowCursor(false), 2000);
      }
    };

    // Small delay before starting
    typingRef.current = setTimeout(type, 300);

    return () => {
      if (typingRef.current) clearTimeout(typingRef.current);
    };
  }, [headline]);

  return (
    <div className="relative">
      {/* Main headline text */}
      <p className="text-lg text-gray-300 leading-relaxed font-light tracking-wide">
        <span
          className="bg-clip-text"
          style={{
            backgroundImage: 'linear-gradient(90deg, #e2e8f0, #94a3b8)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {displayText}
        </span>
        {/* Blinking cursor */}
        {showCursor && (
          <span
            className="inline-block w-0.5 h-5 ml-0.5 align-middle"
            style={{
              backgroundColor: isTyping ? '#3b82f6' : '#64748b',
              animation: isTyping ? 'none' : 'landing-glow-pulse 1s ease-in-out infinite',
            }}
          />
        )}
      </p>

      {/* Subtle underline glow */}
      {!isTyping && displayText.length > 0 && (
        <div
          className="mt-3 mx-auto h-px max-w-xs"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent)',
            opacity: 0,
            animation: 'landing-card-in 1s ease forwards',
          }}
        />
      )}
    </div>
  );
}
