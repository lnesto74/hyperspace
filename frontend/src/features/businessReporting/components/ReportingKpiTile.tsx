import { useState, useRef } from 'react';
import { HelpCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { KpiTileDefinition, KpiFormat, KpiThresholds } from '../personas';

interface ReportingKpiTileProps {
  definition: KpiTileDefinition;
  value: number | null | undefined;
  previousValue?: number | null;
}

function formatValue(value: number | null | undefined, format: KpiFormat): string {
  if (value === null || value === undefined) return '—';
  
  switch (format) {
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'seconds':
      return `${Math.round(value)}s`;
    case 'minutes':
      return `${value.toFixed(1)}m`;
    case 'int':
      return Math.round(value).toLocaleString();
    case 'float':
      return value.toFixed(2);
    case 'score':
      return value.toFixed(1);
    case 'currency':
      return `$${value.toFixed(2)}`;
    default:
      return String(value);
  }
}

function getThresholdState(
  value: number | null | undefined,
  thresholds?: KpiThresholds
): 'good' | 'warn' | 'bad' | 'neutral' {
  if (value === null || value === undefined || !thresholds) return 'neutral';
  
  const { good, warn, bad, direction } = thresholds;
  
  if (direction === 'lower') {
    if (value <= good) return 'good';
    if (value <= warn) return 'warn';
    return 'bad';
  } else {
    if (value >= good) return 'good';
    if (value >= warn) return 'warn';
    return 'bad';
  }
}

function getStateColor(state: 'good' | 'warn' | 'bad' | 'neutral'): string {
  switch (state) {
    case 'good': return 'text-green-400';
    case 'warn': return 'text-amber-400';
    case 'bad': return 'text-red-400';
    default: return 'text-white';
  }
}

function getStateBgColor(state: 'good' | 'warn' | 'bad' | 'neutral'): string {
  switch (state) {
    case 'good': return 'bg-green-500/10 border-green-500/30';
    case 'warn': return 'bg-amber-500/10 border-amber-500/30';
    case 'bad': return 'bg-red-500/10 border-red-500/30';
    default: return 'bg-gray-800 border-gray-700';
  }
}

export default function ReportingKpiTile({ definition, value, previousValue }: ReportingKpiTileProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  
  const state = getThresholdState(value, definition.thresholds);
  const formattedValue = formatValue(value, definition.format);
  
  // Calculate trend if previous value exists
  let trendDirection: 'up' | 'down' | 'flat' | null = null;
  let trendPercent: number | null = null;
  
  if (previousValue !== undefined && previousValue !== null && value !== null && value !== undefined) {
    const diff = value - previousValue;
    if (Math.abs(diff) > 0.01) {
      trendDirection = diff > 0 ? 'up' : 'down';
      trendPercent = previousValue !== 0 ? Math.round((diff / previousValue) * 100) : 0;
    } else {
      trendDirection = 'flat';
    }
  }
  
  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
    setShowTooltip(true);
  };
  
  return (
    <div className={`rounded-xl border p-5 transition-all hover:shadow-lg ${getStateBgColor(state)}`}>
      {/* Header: Title + Help Icon */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-400">{definition.title}</h3>
        <div className="relative">
          <button
            ref={buttonRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip); }}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          {showTooltip && (
            <div 
              className="fixed w-72 p-3 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl text-xs text-gray-300 leading-relaxed pointer-events-none"
              style={{
                zIndex: 99999,
                top: tooltipPos.top,
                left: tooltipPos.left,
                transform: 'translate(-50%, -100%)',
              }}
            >
              <div className="font-semibold text-white mb-1">How it's computed</div>
              <div>{definition.tooltip}</div>
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-600" />
            </div>
          )}
        </div>
      </div>
      
      {/* Value */}
      <div className="flex items-baseline gap-2 mb-3">
        <span className={`text-3xl font-bold ${getStateColor(state)}`}>
          {formattedValue}
        </span>
        {definition.unit && value !== null && value !== undefined && 
         !['percent', 'seconds', 'minutes', 'currency'].includes(definition.format) && (
          <span className="text-sm text-gray-500">{definition.unit}</span>
        )}
        
        {/* Trend Indicator */}
        {trendDirection && trendDirection !== 'flat' && (
          <span className={`flex items-center text-xs ${
            trendDirection === 'up' 
              ? definition.thresholds?.direction === 'higher' ? 'text-green-400' : 'text-red-400'
              : definition.thresholds?.direction === 'higher' ? 'text-red-400' : 'text-green-400'
          }`}>
            {trendDirection === 'up' ? (
              <TrendingUp className="w-3 h-3 mr-0.5" />
            ) : (
              <TrendingDown className="w-3 h-3 mr-0.5" />
            )}
            {trendPercent !== null && `${Math.abs(trendPercent)}%`}
          </span>
        )}
        {trendDirection === 'flat' && (
          <span className="flex items-center text-xs text-gray-500">
            <Minus className="w-3 h-3" />
          </span>
        )}
      </div>
      
      {/* Meaning */}
      <p className="text-xs text-gray-400 mb-2 leading-relaxed">
        {definition.meaning}
      </p>
      
      {/* Action */}
      <p className="text-xs text-blue-400 leading-relaxed">
        💡 {definition.action}
      </p>
    </div>
  );
}
