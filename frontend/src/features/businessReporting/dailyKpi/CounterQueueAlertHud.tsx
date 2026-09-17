import { useEffect, useState } from 'react';
import { API_BASE } from '../../../config/api';

type Alert = { type?: string; counter?: string; lane?: string; people?: number; minutes?: number };

export default function CounterQueueAlertHud({ venueId }: { venueId?: string | null }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/reporting/alerts?venueId=${encodeURIComponent(venueId)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      } catch { /* keep last */ }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 10_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [venueId]);

  if (!alerts.length) return null;
  return (
    <div className="absolute top-14 right-3 z-20 flex flex-col gap-1 pointer-events-none" data-testid="counter-queue-alert-hud">
      {alerts.map((a) => (
        <div
          key={`${a.type}-${a.counter || a.lane}`}
          className="px-2.5 py-1 rounded-md bg-amber-950/90 border border-amber-500/60 text-[11px] text-amber-100 shadow"
        >
          {a.type === 'queue_wait'
            ? `Coda ${a.lane}: ${a.people} persone da ${a.minutes} min`
            : `Coda al banco ${a.counter}: ${a.people} persone da ${a.minutes} min`}
        </div>
      ))}
    </div>
  );
}
