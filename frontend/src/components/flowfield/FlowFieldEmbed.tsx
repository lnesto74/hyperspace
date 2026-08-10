import { useMemo } from 'react';

/**
 * Embeds the Windy-style people-flow prototype (Three.js + left control bar)
 * into the Esselunga executive pulse band. Kept as an iframe so the visualisation
 * options stay identical to the standalone prototype without re-porting ~600
 * lines of scene code into React.
 */
export default function FlowFieldEmbed({
  className = '',
  title = 'People-flow field',
}: {
  className?: string;
  title?: string;
}) {
  // Bust once per mount so a redeployed field_prod.json is picked up, without
  // reloading the iframe on every parent re-render.
  const src = useMemo(
    () => `/flowfield/index.html?embed=1&t=${Date.now()}`,
    [],
  );

  return (
    <iframe
      title={title}
      src={src}
      className={`block w-full h-full border-0 bg-black ${className}`}
      allow="fullscreen"
      loading="eager"
    />
  );
}
