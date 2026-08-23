import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';

export type FlowFieldHandle = {
  setControlsCollapsed: (on: boolean) => void
  toggleStory: () => void
}

/**
 * Embeds the Windy-style people-flow prototype (Three.js + left control bar)
 * into dashboards. Kept as an iframe so the visualisation options stay identical
 * to the standalone prototype. Expand opens the full page (non-embed) overlay.
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
}>(function FlowFieldEmbed({
  className = '',
  title = 'People-flow field',
  showExpand = true,
  venueId,
  startCollapsed = false,
  onStoryChange,
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
    const q = new URLSearchParams({ embed: '1', v: 'holistic-67' });
    if (venueId) q.set('venue', venueId);
    if (startCollapsed) q.set('collapsed', '1');
    return `/flowfield/index.html?${q}`;
  }, [venueId, startCollapsed]);
  const fullSrc = useMemo(() => {
    const q = new URLSearchParams({ v: 'holistic-67' });
    if (venueId) q.set('venue', venueId);
    return `/flowfield/index.html?${q}`;
  }, [venueId]);

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
      if (e.data?.type === 'ff-story-chrome') onStoryChange?.(!!e.data.on);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onStoryChange]);

  return (
    <>
      <div className={`relative h-full w-full ${className}`}>
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
            onClick={() => setFullscreen(true)}
            className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-gray-900/85 border border-gray-600 text-gray-300 hover:text-white hover:border-cyan-500/50 transition-colors shadow-lg shadow-black/40"
            title="Open full people-flow field"
          >
            <Maximize2 className="w-3 h-3" />
            Full screen
          </button>
        )}
      </div>

      {fullscreen && createPortal(
        <div
          className="fixed inset-0 z-[200] bg-black flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="People-flow field full screen"
        >
          <div className="h-11 flex items-center justify-between gap-3 px-3 border-b border-gray-800 bg-gray-950 shrink-0">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">{title}</div>
              <div className="text-[10px] text-gray-500">
                Full controls · Esc or Close to return
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-gray-600 text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
          <iframe
            title={`${title} — full screen`}
            src={fullSrc}
            className="flex-1 w-full min-h-0 border-0 bg-black"
            allow="fullscreen"
          />
        </div>,
        document.body,
      )}
    </>
  );
});

export default FlowFieldEmbed;
