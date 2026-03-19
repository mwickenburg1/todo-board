import { useEffect, useState, useCallback } from 'react'

interface MeetingInfo {
  title: string
  time: string
  minsUntil: number
  minsLeft: number
  meetLink: string | null
  htmlLink: string | null
}

export function CalendarBanner() {
  const [current, setCurrent] = useState<MeetingInfo | null>(null)
  const [next, setNext] = useState<MeetingInfo | null>(null)

  const fetchNext = useCallback(() => {
    fetch('/api/calendar/next')
      .then(r => r.json())
      .then(d => {
        setCurrent(d.current || null)
        setNext(d.next || null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchNext()
    const interval = setInterval(fetchNext, 30_000)
    return () => clearInterval(interval)
  }, [fetchNext])

  // In a meeting right now
  if (current) {
    return (
      <div className="flex items-center justify-between px-4 py-2 rounded-lg mb-4 text-[12px] bg-blue-500/8 border border-blue-500/15 text-blue-400/80 transition-colors duration-300">
        <div className="flex items-center gap-2">
          <span className="text-[10px]">●</span>
          <span className="font-medium">In: {current.title}</span>
          <span className="opacity-60">{current.minsLeft}m left</span>
        </div>
        <div className="flex items-center gap-3">
          {next && (
            <span className="opacity-50">then: {next.title} at {next.time}</span>
          )}
          {current.meetLink && (
            <a href={current.meetLink} target="_blank" rel="noopener noreferrer"
              className="text-blue-400/60 hover:text-blue-400 transition-colors">
              join
            </a>
          )}
        </div>
      </div>
    )
  }

  // No upcoming meeting or >45 min away
  if (!next || next.minsUntil > 45) return null

  const urgent = next.minsUntil <= 5
  const soon = next.minsUntil <= 15

  return (
    <div className={`
      flex items-center justify-between px-4 py-2 rounded-lg mb-4 text-[12px]
      transition-colors duration-300
      ${urgent
        ? 'bg-red-500/10 border border-red-500/20 text-red-400'
        : soon
        ? 'bg-amber-500/8 border border-amber-500/15 text-amber-400/80'
        : 'bg-white/[0.02] border border-white/[0.04] text-gray-500'
      }
    `}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] ${urgent ? 'animate-pulse' : ''}`}>
          {urgent ? '●' : '○'}
        </span>
        <span className="font-medium">{next.title}</span>
        <span className="opacity-60">at {next.time}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`font-mono tabular-nums ${urgent ? 'font-bold' : ''}`}>
          {next.minsUntil}m
        </span>
        {next.meetLink && (
          <a href={next.meetLink} target="_blank" rel="noopener noreferrer"
            className="text-blue-400/60 hover:text-blue-400 transition-colors">
            join
          </a>
        )}
      </div>
    </div>
  )
}
