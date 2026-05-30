import Tooltip from './Tooltip'

interface MetricLabelProps {
  label: string
  help: string
  className?: string
}

/** Section label with an info icon that explains how the metric is calculated. */
export default function MetricLabel({ label, help, className = '' }: MetricLabelProps) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span>{label}</span>
      <Tooltip text={help} wrap>
        <span
          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full
            text-[8px] text-white/45 bg-white/[0.08] border border-white/[0.12]
            hover:text-white/70 hover:bg-white/[0.12] cursor-help transition-colors"
          aria-label={`About ${label}`}
        >
          i
        </span>
      </Tooltip>
    </div>
  )
}
