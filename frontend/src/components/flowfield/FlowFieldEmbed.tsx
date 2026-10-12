import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';

export type FlowFieldHandle = {
  setControlsCollapsed: (on: boolean) => void
  toggleStory: () => void
}

/**
 * Embeds the Windy-style people-flow prototype (Three.js + left control bar)
 * into dashboards. Kept as an iframe so the visualisation options stay identical
 * to the standalone prototype. Expansion keeps the same iframe mounted, preserving the current investigation.
 */
const FlowFieldEmbed = forwardRef<FlowFieldHandle, {
  className?: string;
  title?: string;
  /** Show the Full screen control (default true). */
  showExpand?: boolean;
  venueId?: string;
  /** Start with the in-iframe control rail folded (workspace stage). */
  startCollapsed?: boolean;
  onStoryChange?: (on: boolean) => void;
  onOpenLive?: (point: { x: number; z: number }) => void;
}>(function FlowFieldEmbed({
  className = '',
  title = 'People-flow field',
  showExpand = true,
  venueId,
  startCollapsed = false,
  onStoryChange,
  onOpenLive,
}, ref) {
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const post = (data: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(data, window.location.origin);
  };

  useImperativeHandle(ref, () => ({
    setControlsCollapsed: (on) => post({ type: 'ff-controls-collapsed', on }),
    toggleStory: () => post({ type: 'ff-story-toggle' }),
  }), []);

  // Stable src — Date.now() on every mount restarted the iframe (and the
  // splash) whenever the dashboard re-rendered the tile.
  const embedSrc = useMemo(() => {
    const q = new URLSearchParams({ embed: '1', v: 'ux-v3-12' });
    if (venueId) q.set('venue', venueId);
    if (onOpenLive) q.set('liveLink', '1');
    if (startCollapsed) q.set('collapsed', '1');
    return `/flowfield/index.html?${q}`;
  }, [venueId, startCollapsed, !!onOpenLive]);


  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'ff-open-live' && e.source === iframeRef.current?.contentWindow
          && Number.isFinite(e.data.x) && Number.isFinite(e.data.z)) {
        onOpenLive?.({ x: e.data.x, z: e.data.z });
      }
      if (e.data?.type === 'ff-story-chrome') onStoryChange?.(!!e.data.on);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onStoryChange, onOpenLive]);

  return (
    <>
      <div
        className={fullscreen ? 'fixed inset-0 z-[200] bg-black' : `relative h-full w-full ${className}`}
        role={fullscreen ? 'dialog' : undefined}
        aria-modal={fullscreen ? true : undefined}
        aria-label={fullscreen ? `${title} — full screen` : undefined}
      >
        <iframe
          ref={iframeRef}
          title={title}
          src={embedSrc}
          className="absolute inset-0 block w-full h-full border-0 bg-black"
          allow="fullscreen"
          loading="eager"
        />
        {showExpand && (
          <button
            type="button"
            onClick={() => setFullscreen((value) => !value)}
            className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-gray-900/85 border border-gray-600 text-gray-300 hover:text-white hover:border-cyan-500/50 transition-colors shadow-lg shadow-black/40"
            title={fullscreen ? "Close full screen" : "Open full people-flow field"}
          >
            {fullscreen ? <X className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            {fullscreen ? 'Close' : 'Full screen'}
          </button>
        )}
      </div>


    </>
  );
});

export default FlowFieldEmbed;
