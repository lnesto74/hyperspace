import { AlertTriangle, CheckCircle, Lightbulb, TrendingUp } from 'lucide-react';
import { KpiTileDefinition, KpiThresholds } from '../personas';

interface InsightsPanelProps {
  kpiDefinitions: KpiTileDefinition[];
  kpiValues: Record<string, number | null | undefined>;
  personaName: string;
}

interface Alert {
  type: 'warning' | 'critical' | 'success';
  kpiTitle: string;
  message: string;
}

function getAlerts(
  definitions: KpiTileDefinition[],
  values: Record<string, number | null | undefined>
): Alert[] {
  const alerts: Alert[] = [];
  
  for (const def of definitions) {
    const value = values[def.id];
    if (value === null || value === undefined || !def.thresholds) continue;
    
    const { good, warn, bad, direction } = def.thresholds;
    
    if (direction === 'lower') {
      if (value > bad) {
        alerts.push({
          type: 'critical',
          kpiTitle: def.title,
          message: `${def.title} is critical at ${value.toFixed(1)}. ${def.action}`,
        });
      } else if (value > warn) {
        alerts.push({
          type: 'warning',
          kpiTitle: def.title,
          message: `${def.title} needs attention at ${value.toFixed(1)}. ${def.action}`,
        });
      } else if (value <= good) {
        alerts.push({
          type: 'success',
          kpiTitle: def.title,
          message: `${def.title} is performing well at ${value.toFixed(1)}.`,
        });
      }
    } else {
      if (value < bad) {
        alerts.push({
          type: 'critical',
          kpiTitle: def.title,
          message: `${def.title} is critical at ${value.toFixed(1)}. ${def.action}`,
        });
      } else if (value < warn) {
        alerts.push({
          type: 'warning',
          kpiTitle: def.title,
          message: `${def.title} needs attention at ${value.toFixed(1)}. ${def.action}`,
        });
      } else if (value >= good) {
        alerts.push({
          type: 'success',
          kpiTitle: def.title,
          message: `${def.title} is performing well at ${value.toFixed(1)}.`,
        });
      }
    }
  }
  
  // Sort: critical first, then warning, then success
  alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, success: 2 };
    return order[a.type] - order[b.type];
  });
  
  return alerts;
}

function generateKeyTakeaways(
  definitions: KpiTileDefinition[],
  values: Record<string, number | null | undefined>,
  personaName: string
): string[] {
  const takeaways: string[] = [];
  
  // Count states
  let goodCount = 0;
  let warnCount = 0;
  let badCount = 0;
  
  for (const def of definitions) {
    const value = values[def.id];
    if (value === null || value === undefined || !def.thresholds) continue;
    
    const { good, warn, bad, direction } = def.thresholds;
    
    if (direction === 'lower') {
      if (value <= good) goodCount++;
      else if (value <= warn) warnCount++;
      else badCount++;
    } else {
      if (value >= good) goodCount++;
      else if (value >= warn) warnCount++;
      else badCount++;
    }
  }
  
  // Overall summary
  const total = goodCount + warnCount + badCount;
  if (total > 0) {
    if (badCount === 0 && warnCount === 0) {
      takeaways.push(`All ${total} KPIs are in healthy range. Great performance!`);
    } else if (badCount > 0) {
      takeaways.push(`${badCount} KPI${badCount > 1 ? 's' : ''} require${badCount === 1 ? 's' : ''} immediate attention.`);
    } else if (warnCount > 0) {
      takeaways.push(`${warnCount} KPI${warnCount > 1 ? 's' : ''} need${warnCount === 1 ? 's' : ''} monitoring.`);
    }
  }
  
  // Add specific insights based on persona
  if (personaName.includes('Operations')) {
    const waitTime = values['avgWaitingTimeMin'];
    const abandonRate = values['abandonRate'];
    if (waitTime && waitTime > 5) {
      takeaways.push('Queue wait times are elevated. Consider adding staff to registers.');
    }
    if (abandonRate && abandonRate > 15) {
      takeaways.push('High abandon rate detected. Shoppers may be leaving due to long waits.');
    }
  }
  
  if (personaName.includes('PEBLE') || personaName.includes('Effectiveness')) {
    const eal = values['eal'];
    const ces = values['ces'];
    if (eal && eal > 15) {
      takeaways.push('Strong ad lift detected. Consider increasing media spend.');
    }
    if (ces && ces > 60) {
      takeaways.push('Campaign effectiveness is above average. Good creative performance.');
    }
  }
  
  return takeaways.slice(0, 3); // Max 3 takeaways
}

export default function ReportingInsightsPanel({ 
  kpiDefinitions, 
  kpiValues, 
  personaName 
}: InsightsPanelProps) {
  const alerts = getAlerts(kpiDefinitions, kpiValues);
  const takeaways = generateKeyTakeaways(kpiDefinitions, kpiValues, personaName);
  
  // Show only top alerts
  const criticalAlerts = alerts.filter(a => a.type === 'critical').slice(0, 3);
  const warningAlerts = alerts.filter(a => a.type === 'warning').slice(0, 2);
  const successAlerts = alerts.filter(a => a.type === 'success').slice(0, 2);
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
      {/* Key Takeaways */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-400" />
          Key Takeaways
        </h3>
        {takeaways.length > 0 ? (
          <ul className="space-y-3">
            {takeaways.map((takeaway, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                <TrendingUp className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                {takeaway}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No insights available for current data.</p>
        )}
      </div>
      
      {/* Alerts & Recommendations */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          Alerts & Recommendations
        </h3>
        <div className="space-y-3 max-h-48 overflow-y-auto">
          {criticalAlerts.map((alert, i) => (
            <div key={`critical-${i}`} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-red-300">{alert.message}</span>
            </div>
          ))}
          {warningAlerts.map((alert, i) => (
            <div key={`warning-${i}`} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <span className="text-amber-300">{alert.message}</span>
            </div>
          ))}
          {successAlerts.map((alert, i) => (
            <div key={`success-${i}`} className="flex items-start gap-2 text-sm">
              <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span className="text-green-300">{alert.message}</span>
            </div>
          ))}
          {alerts.length === 0 && (
            <p className="text-sm text-gray-500">No alerts at this time.</p>
          )}
        </div>
      </div>
    </div>
  );
}
