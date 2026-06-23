import { useEffect, useState } from 'react';
import { RefreshCw, Users, Clock, Euro, TrendingUp, Lightbulb } from 'lucide-react';
import { API_BASE } from '../../config/api';
import type { EsselungaJourneyPayload, ExecutiveInsight } from '../businessReporting/esselunga/types';

interface PulseExecutivePanelProps {
  venueId: string;
  className?: string;
}

const INSIGHT_BORDER: Record<ExecutiveInsight['severity'], string> = {
  good: 'border-green-500/30',
  warn: 'border-amber-500/30',
  bad: 'border-red-500/30',
  info: 'border-blue-500/30',
};

export default function PulseExecutivePanel({ venueId, className = '' }: PulseExecutivePanelProps) {
  const [journey, setJourney] = useState<EsselungaJourneyPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchJourney = async () => {
    setLoading(true);
    try {
      const endTs = Date.now();
      const startTs = endTs - 24 * 60 * 60 * 1000;
      const params = new URLSearchParams({
        personaId: 'esselunga-executive',
        venueId,
        startTs: String(startTs),
        endTs: String(endTs),
        variant: 'live',
      });
      const res = await fetch(`${API_BASE}/api/reporting/summary?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setJourney(data.supporting?.esselungaJourney ?? null);
    } catch {
      setJourney(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchJourney();
    const iv = window.setInterval(() => void fetchJourney(), 60_000);
    return () => window.clearInterval(iv);
  }, [venueId]);

  if (loading && !journey) {
    return (
      <div className={`flex items-center justify-center py-6 ${className}`}>
        <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!journey) {
    return (
      <div className={`px-3 py-4 text-[10px] text-gray-500 ${className}`}>
        Executive KPIs unavailable — enable Business Reporting.
      </div>
    );
  }

  const { overview, insights, checkout } = journey;

  return (
    <div className={`flex flex-col min-h-0 overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-gray-800/60 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-medium text-gray-200 uppercase tracking-wide">Executive KPI</span>
        <button type="button" onClick={() => void fetchJourney()} className="text-gray-500 hover:text-white">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-2 grid grid-cols-2 gap-1.5 shrink-0">
        <div className="rounded border border-gray-800/80 bg-gray-900/40 p-2">
          <div className="flex items-center gap-1 text-[8px] text-gray-500"><Users className="w-2.5 h-2.5" /> Visitors</div>
          <div className="text-sm font-semibold text-white">{overview.totalVisitors}</div>
        </div>
        <div className="rounded border border-gray-800/80 bg-gray-900/40 p-2">
          <div className="flex items-center gap-1 text-[8px] text-gray-500"><Clock className="w-2.5 h-2.5" /> Dwell</div>
          <div className="text-sm font-semibold text-white">{overview.avgStoreDwellMin}m</div>
        </div>
        <div className="rounded border border-gray-800/80 bg-gray-900/40 p-2">
          <div className="flex items-center gap-1 text-[8px] text-gray-500"><Euro className="w-2.5 h-2.5" /> Ticket</div>
          <div className="text-sm font-semibold text-white">
            {overview.avgTicket != null ? `€${overview.avgTicket.toFixed(0)}` : '—'}
          </div>
        </div>
        <div className="rounded border border-gray-800/80 bg-gray-900/40 p-2">
          <div className="flex items-center gap-1 text-[8px] text-gray-500"><TrendingUp className="w-2.5 h-2.5" /> Wait</div>
          <div className="text-sm font-semibold text-white">{checkout.avgWaitMin}m</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1.5">
        {insights.slice(0, 3).map(ins => (
          <div key={ins.id} className={`rounded border p-2 ${INSIGHT_BORDER[ins.severity]} bg-gray-900/30`}>
            <div className="flex items-start gap-1">
              <Lightbulb className="w-2.5 h-2.5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[9px] font-medium text-gray-200 leading-tight">{ins.title}</div>
                <p className="text-[8px] text-gray-500 mt-0.5 line-clamp-2">{ins.message}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
