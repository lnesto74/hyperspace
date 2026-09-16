import type { KpiLabel, KpiStatus } from './types';

export function MeasureChip({
  label,
  status,
  method,
  statusReason,
}: {
  label?: KpiLabel | null;
  status?: KpiStatus | null;
  method?: string | null;
  statusReason?: string | null;
}) {
  if (status === 'unreliable') {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium bg-gray-700/80 text-gray-400"
        title={statusReason || method || 'Controllo del giorno fallito'}
      >
        non affidabile
      </span>
    );
  }
  if (label === 'MEASURED') {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium bg-emerald-500/15 text-emerald-300"
        title={method || 'Il sensore lo ha visto'}
      >
        Misurato
      </span>
    );
  }
  if (label === 'ESTIMATED') {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium bg-sky-500/15 text-sky-300"
        title={method || 'Calcolato (formula in tooltip)'}
      >
        Stimato
      </span>
    );
  }
  return null;
}
