interface Bar {
  key: string
  label: string
  value: number
}

export default function PulseFingerprintBars({ bars }: { bars: Bar[] }) {
  return (
    <div className="flex items-end gap-1 h-8">
      {bars.map(b => (
        <div key={b.key} className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
          <div className="w-full h-6 bg-gray-900/80 rounded-sm overflow-hidden flex items-end">
            <div
              className="w-full bg-cyan-500/70 transition-all duration-700"
              style={{ height: `${Math.max(8, b.value * 100)}%` }}
            />
          </div>
          <span className="text-[7px] uppercase tracking-wider text-gray-600 truncate w-full text-center">
            {b.label}
          </span>
        </div>
      ))}
    </div>
  )
}
