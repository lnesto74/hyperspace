interface QueuedPerson {
  id: string
  waitTimeSec: number
}

interface QueueCirclesProps {
  count: number
  queuedPeople?: QueuedPerson[]
  warningMin?: number
  criticalMin?: number
}

export function QueueCircles({ 
  count, 
  queuedPeople = [], 
  warningMin = 2, 
  criticalMin = 5 
}: QueueCirclesProps) {
  if (count === 0) return <span className="text-gray-500 text-xs">--</span>
  
  const getWaitColor = (waitTimeSec: number) => {
    const waitMin = waitTimeSec / 60
    if (waitMin >= criticalMin) return 'bg-red-500'
    if (waitMin >= warningMin) return 'bg-amber-500'
    return 'bg-green-500'
  }
  
  // Generate circles based on count and wait times
  const circles: { color: string; isEllipsis?: boolean }[] = []
  const maxVisible = 6
  
  if (count <= maxVisible) {
    // Show all circles
    for (let i = 0; i < count; i++) {
      const waitTime = queuedPeople[i]?.waitTimeSec || 0
      circles.push({ color: getWaitColor(waitTime) })
    }
  } else {
    // Show first 2, ellipsis, last 3
    for (let i = 0; i < 2; i++) {
      const waitTime = queuedPeople[i]?.waitTimeSec || 0
      circles.push({ color: getWaitColor(waitTime) })
    }
    circles.push({ color: '', isEllipsis: true })
    for (let i = count - 3; i < count; i++) {
      const waitTime = queuedPeople[i]?.waitTimeSec || 0
      circles.push({ color: getWaitColor(waitTime) })
    }
  }
  
  return (
    <div className="flex items-center gap-0.5">
      {circles.map((c, i) => 
        c.isEllipsis ? (
          <span key={i} className="text-gray-500 text-xs px-0.5">...</span>
        ) : (
          <div key={i} className={`w-2.5 h-2.5 rounded-full ${c.color}`} />
        )
      )}
      {count > maxVisible && (
        <span className="text-xs text-gray-400 ml-1">({count})</span>
      )}
    </div>
  )
}

export type { QueuedPerson }
export default QueueCircles
