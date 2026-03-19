import { useEffect, useState, useCallback } from 'react'

const BLOCKS = [
  { label: '6–7', value: 18, startHour: 6 },
  { label: '7–8', value: 20, startHour: 7 },
  { label: '8–9', value: 22, startHour: 8 },
  { label: '9–11', value: 18, startHour: 9 },
  { label: '11–12', value: 10, startHour: 11 },
  { label: '12–1:30', value: 7, startHour: 12 },
  { label: '1:30–3', value: 5, startHour: 13.5 },
]

const TOTAL = BLOCKS.reduce((s, b) => s + b.value, 0)

const CHECKS = [
  { label: '6:00 am', headline: '3 sharp · 6 solid', sub: 'highest output hour ahead', msg: 'Full tank. Go.', idx: 0 },
  { label: '7:00 am', headline: '2 sharp · 6 solid', sub: 'peak output window', msg: 'This is your most valuable hour.', idx: 1 },
  { label: '8:00 am', headline: '1 sharp · 6 solid', sub: 'biggest block of the day', msg: 'Most output per hour happens now.', idx: 2 },
  { label: '9:00 am', headline: '6 solid left', sub: 'sharp hours spent', msg: '60% of your real output is behind you.', idx: 3, color: 'text-amber-500' },
  { label: '11:00 am', headline: '4 solid left', sub: 'diminishing fast', msg: 'Each hour worth half of a morning hour.', idx: 4, color: 'text-amber-500' },
  { label: '12:00 pm', headline: '3 left', sub: 'scraps', msg: 'This 90 min block = one morning hour.', idx: 5, color: 'text-red-400' },
  { label: '1:30 pm', headline: '90 min', sub: 'almost nothing', msg: 'This whole block = 25 min at 8am.', idx: 6, color: 'text-gray-500' },
  { label: '3:00 pm', headline: 'done', sub: '', msg: 'Walk away.', idx: 7, color: 'text-emerald-500' },
]

const BLOCK_RANGES = [
  { start: 6, end: 7 },
  { start: 7, end: 8 },
  { start: 8, end: 9 },
  { start: 9, end: 11 },
  { start: 11, end: 12 },
  { start: 12, end: 13.5 },
  { start: 13.5, end: 15 },
]

// Rating scale → baseline percentage
const RATING_TO_BASELINE: Record<number, { pct: number; label: string }> = {
  5: { pct: 100, label: 'Locked in' },
  4: { pct: 85, label: 'Online' },
  3: { pct: 65, label: 'Lukewarm' },
  2: { pct: 45, label: 'Underwater' },
  1: { pct: 25, label: 'Offline' },
}

function getCurrentState(): { idx: number; progress: number } {
  const now = new Date()
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const h = est.getHours() + est.getMinutes() / 60

  if (h >= 15) return { idx: 7, progress: 1 }

  for (let i = BLOCK_RANGES.length - 1; i >= 0; i--) {
    if (h >= BLOCK_RANGES[i].start) {
      const range = BLOCK_RANGES[i]
      const progress = Math.min(1, (h - range.start) / (range.end - range.start))
      return { idx: i, progress }
    }
  }
  return { idx: 0, progress: 0 }
}

export function EnergyBar() {
  const [state, setState] = useState(getCurrentState)
  const [rating, setRating] = useState<number | null>(null)
  const [baseline, setBaseline] = useState(100)

  useEffect(() => {
    const interval = setInterval(() => setState(getCurrentState()), 60_000)
    return () => clearInterval(interval)
  }, [])

  // Fetch today's baseline
  useEffect(() => {
    fetch('/api/activity/baseline')
      .then(r => r.json())
      .then(d => {
        if (d.baseline) setBaseline(d.baseline)
      })
      .catch(() => {})
  }, [])

  const handleRating = useCallback((r: number) => {
    setRating(r)
    const b = RATING_TO_BASELINE[r].pct
    setBaseline(b)
    fetch('/api/activity/baseline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseline: b }),
    }).catch(() => {})
  }, [])

  const { idx: checkIdx, progress } = state
  const c = CHECKS[checkIdx]
  const isDone = checkIdx >= BLOCKS.length

  const spentValue = BLOCKS.slice(0, checkIdx).reduce((s, b) => s + b.value, 0)
    + (checkIdx < BLOCKS.length ? BLOCKS[checkIdx].value * progress : 0)
  const spentPct = Math.round((spentValue / TOTAL) * 100)
  const leftOnTable = 100 - baseline
  const effectiveRemaining = Math.max(0, Math.round((100 - spentPct) * baseline / 100))

  // The bar total is always 100% width. Blocks take baseline%, unreachable takes the rest.
  // Each block's width is its value% of TOTAL, scaled by baseline/100.
  const scaledBlockWidth = (value: number) => (value / TOTAL) * baseline

  return (
    <div className="w-full py-6">
      {/* Header */}
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-[32px] font-medium text-gray-200">{spentPct}% spent</span>
        <div className="text-right">
          <span className="text-[16px] text-gray-500 font-light">{c.headline}</span>
          {baseline < 100 && (
            <div className="text-[13px] text-gray-600">
              {baseline}% capacity · {RATING_TO_BASELINE[rating || 5]?.label || ''}
            </div>
          )}
        </div>
      </div>
      <div className="text-[15px] text-gray-500 mb-4">{c.sub}</div>

      {/* Rating selector */}
      <div className="flex gap-2 mb-4">
        {[5, 4, 3, 2, 1].map(r => {
          const info = RATING_TO_BASELINE[r]
          const active = rating === r
          return (
            <button
              key={r}
              onClick={() => handleRating(r)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                active
                  ? r >= 4 ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/30'
                    : r === 3 ? 'bg-amber-600/30 text-amber-400 border border-amber-500/30'
                    : 'bg-red-600/30 text-red-400 border border-red-500/30'
                  : 'bg-white/[0.03] text-gray-600 border border-white/[0.06] hover:text-gray-400'
              }`}
            >
              {r} · {info.label}
            </button>
          )
        })}
      </div>

      {/* Blocks — each scaled by baseline, plus unreachable zone */}
      <div className="flex gap-0 h-[80px] mb-1 items-end">
        {BLOCKS.map((b, i) => {
          const widthPct = scaledBlockWidth(b.value)
          const isPast = i < c.idx
          const isCurrent = i === c.idx

          let bg = ''
          let opacity = ''

          if (isDone) {
            bg = 'bg-gray-700'; opacity = 'opacity-[0.15]'
          } else if (isPast) {
            bg = 'bg-gray-700'; opacity = 'opacity-[0.15]'
          } else if (isCurrent) {
            bg = i < 3 ? 'bg-violet-600' : 'bg-emerald-600'
          } else {
            bg = i < 3 ? 'bg-violet-600' : 'bg-emerald-600'
            opacity = 'opacity-50'
          }

          const isFirst = i === 0
          const isLast = i === BLOCKS.length - 1 && leftOnTable === 0

          return (
            <div
              key={i}
              className={`${bg} ${opacity} h-full flex items-center justify-center transition-all duration-300 relative overflow-hidden
                ${isFirst ? 'rounded-l-lg' : ''} ${isLast ? 'rounded-r-lg' : ''}
              `}
              style={{
                width: `${widthPct}%`,
                marginRight: i < BLOCKS.length - 1 ? '3px' : leftOnTable > 0 ? '3px' : '0',
                ...(isCurrent && !isDone ? {
                  outline: '2px solid rgba(255,255,255,0.7)',
                  outlineOffset: '-2px',
                } : {}),
              }}
            >
              {isCurrent && progress > 0 && (
                <>
                  <div className="absolute inset-0" style={{
                    background: 'rgba(0,0,0,0.7)',
                    width: `${progress * 100}%`,
                  }} />
                  <div className="absolute top-0 bottom-0" style={{
                    left: `${progress * 100}%`,
                    width: '2px',
                    background: 'rgba(239,68,68,0.9)',
                    boxShadow: '0 0 8px rgba(239,68,68,0.5)',
                  }} />
                </>
              )}
              {widthPct > 5 && (
                <span className={`text-[13px] font-semibold relative z-10 ${isPast || isDone ? 'text-gray-700 opacity-40' : 'text-white opacity-80'}`}>
                  {Math.round(b.value)}%
                </span>
              )}
            </div>
          )
        })}
        {/* Unreachable zone */}
        {leftOnTable > 0 && (
          <div
            className="h-full rounded-r-lg flex items-center justify-center"
            style={{
              width: `${leftOnTable}%`,
              background: 'repeating-linear-gradient(-45deg, rgba(100,40,40,0.06), rgba(100,40,40,0.06) 2px, rgba(60,20,20,0.03) 2px, rgba(60,20,20,0.03) 6px)',
              border: '1px dashed rgba(239,68,68,0.12)',
            }}
          >
            {leftOnTable > 6 && (
              <span className="text-[11px] text-red-400/25 font-medium">-{leftOnTable}%</span>
            )}
          </div>
        )}
      </div>

      {/* Labels — scaled to match */}
      <div className="flex gap-0 mb-6">
        {BLOCKS.map((b, i) => (
          <div
            key={i}
            className="text-[11px] text-gray-600 text-center overflow-hidden"
            style={{
              width: `${scaledBlockWidth(b.value)}%`,
              marginRight: i < BLOCKS.length - 1 ? '3px' : '0',
            }}
          >
            {scaledBlockWidth(b.value) > 4 ? b.label : ''}
          </div>
        ))}
      </div>

      {/* Message */}
      <div className={`text-[18px] leading-relaxed ${c.color || 'text-gray-300'} ${c.color ? 'font-semibold' : 'font-medium'}`}>
        {c.msg}
      </div>
      {baseline < 100 && !isDone && (
        <div className="mt-2 text-[14px] text-gray-500">
          Effective remaining: <span className="text-gray-300 font-medium">{effectiveRemaining}%</span> of a full day
          <span className="text-red-400/40 ml-2">· {leftOnTable}% unreachable</span>
        </div>
      )}
    </div>
  )
}
