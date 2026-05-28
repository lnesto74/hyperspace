import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { OpsAlert } from './types';

interface OperationsAlertsPanelProps {
  alerts: OpsAlert[];
}

const SEVERITY_STYLE = {
  info: { icon: Info, border: 'border-gray-700/60', bg: 'bg-gray-900/40', title: 'text-gray-300', iconColor: 'text-gray-500' },
  warn: { icon: AlertTriangle, border: 'border-gray-700/60', bg: 'bg-gray-900/40', title: 'text-white', iconColor: 'text-gray-400' },
  bad: { icon: XCircle, border: 'border-red-500/25', bg: 'bg-red-500/5', title: 'text-red-400', iconColor: 'text-red-400' },
};

export default function OperationsAlertsPanel({ alerts }: OperationsAlertsPanelProps) {
  return (
    <div className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-white">Ops Alerts</h3>
        <span className="text-[10px] text-gray-500">{alerts.length} active</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {alerts.length === 0 && (
          <p className="text-[10px] text-green-400/90 text-center py-6">All clear — no threshold breaches</p>
        )}
        {alerts.map(alert => {
          const style = SEVERITY_STYLE[alert.severity];
          const Icon = style.icon;
          return (
            <div
              key={alert.id}
              className={`rounded-md border px-2 py-1.5 ${style.border} ${style.bg}`}
            >
              <div className="flex items-start gap-1.5">
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${style.iconColor}`} />
                <div className="min-w-0">
                  <div className={`text-[11px] font-medium ${style.title}`}>{alert.title}</div>
                  <div className="text-[10px] text-gray-400 leading-snug mt-0.5">{alert.message}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
