import { useState, useCallback } from 'react'
import type { Todo } from './types'

interface PulseBannerProps {
  items: Todo[]
  onDismiss: (id: number) => void
  excludeIds?: Set<number>
}

// Returns 0-3 urgency level based on age since creation
//   0 = fresh (<30 min)   — calm gray (within one cycle)
//   1 = stale (30-60 min) — amber (missed one cycle)
//   2 = overdue (1-2h)    — orange (missed two cycles)
//   3 = urgent (2h+)      — red (ignored for too long)
function urgency(created: string | null): number {
  if (!created) return 0
  const mins = (Date.now() - new Date(created).getTime()) / 60_000
  if (mins < 30) return 0
  if (mins < 60) return 1
  if (mins < 120) return 2
  return 3
}

const URGENCY_STYLES = [
  // 0: calm
  { text: 'text-gray-500 dark:text-gray-400', dot: 'border-amber-300/80 dark:border-amber-500/60', bg: '' },
  // 1: stale
  { text: 'text-amber-700 dark:text-amber-300', dot: 'border-amber-500 dark:border-amber-400', bg: 'bg-amber-50/40 dark:bg-amber-900/20' },
  // 2: overdue
  { text: 'text-orange-700 dark:text-orange-300 font-medium', dot: 'border-orange-500 bg-orange-100 dark:border-orange-400 dark:bg-orange-900/30', bg: 'bg-orange-50/40 dark:bg-orange-900/20' },
  // 3: urgent
  { text: 'text-red-700 dark:text-red-300 font-medium', dot: 'border-red-500 bg-red-200 dark:border-red-400 dark:bg-red-900/30', bg: 'bg-red-50/50 dark:bg-red-900/20' },
]

function PulseItem({ item, fading, onDismiss }: { item: Todo; fading: boolean; onDismiss: () => void }) {
  const isBlock = item.context === 'time-block'
  const isNext = item.context === 'time-next'
  const isRoutine = item.context === 'routine'
  const u = (isBlock || isNext || isRoutine) ? 0 : urgency(item.created)
  const s = URGENCY_STYLES[u]

  const isSlack = item.context?.startsWith('slack-')

  if (isBlock) {
    return (
      <button
        onClick={onDismiss}
        className={`
          flex items-center gap-2 py-1 px-2 -mx-1 rounded text-[14px] font-semibold text-gray-800 dark:text-gray-100
          bg-white/60 dark:bg-white/5 border border-amber-200/50 dark:border-amber-500/30
          hover:bg-amber-100/50 dark:hover:bg-amber-900/30
          transition-all duration-250 cursor-pointer select-none text-left
          ${fading ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'}
        `}
      >
        <span className="w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-500 shrink-0" />
        {item.text}
      </button>
    )
  }

  if (isNext) {
    return (
      <button
        onClick={onDismiss}
        className={`
          flex items-center gap-2 py-0.5 px-1 rounded text-[12px] text-gray-400 dark:text-gray-500 italic
          hover:bg-amber-100/50 dark:hover:bg-amber-900/20
          transition-all duration-250 cursor-pointer select-none text-left
          ${fading ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'}
        `}
      >
        <span className="w-3 h-3 flex items-center justify-center text-[8px] text-gray-300 shrink-0">&#9654;</span>
        {item.text}
      </button>
    )
  }

  if (isRoutine) {
    return (
      <button
        onClick={onDismiss}
        className={`
          flex items-center gap-2.5 py-1 px-2 -mx-1 rounded text-[13px] text-sky-800 dark:text-sky-300
          hover:bg-sky-100/60 dark:hover:bg-sky-900/30
          transition-all duration-250 cursor-pointer select-none text-left group
          ${fading ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'}
        `}
      >
        <span className="w-3.5 h-3.5 rounded border-2 border-sky-400 dark:border-sky-500 shrink-0 group-hover:bg-sky-200 dark:group-hover:bg-sky-800 transition-colors" />
        {item.text}
      </button>
    )
  }

  if (isSlack) {
    const isClear = item.priority === 0
    return (
      <div
        className={`
          flex items-center gap-2 py-0.5 px-1 rounded text-[12px]
          ${isClear ? 'text-gray-400 dark:text-gray-500' : 'text-purple-700 dark:text-purple-300 font-medium'}
          transition-all duration-250
          ${fading ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'}
        `}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isClear ? 'bg-green-400' : 'bg-purple-500'}`} />
        {item.text}
      </div>
    )
  }

  return (
    <button
      onClick={onDismiss}
      className={`
        flex items-center gap-2 py-0.5 px-1 rounded text-[13px]
        ${s.text} ${s.bg}
        hover:bg-amber-100/50 dark:hover:bg-amber-900/20
        transition-all duration-250 cursor-pointer select-none text-left
        ${fading ? 'opacity-0 -translate-x-2' : 'opacity-100 translate-x-0'}
      `}
    >
      <span className={`w-3 h-3 rounded-full border ${s.dot} shrink-0 transition-colors duration-1000`} />
      {item.text}
    </button>
  )
}

export function PulseBanner({ items: rawItems, onDismiss, excludeIds }: PulseBannerProps) {
  const items = excludeIds?.size ? rawItems.filter(t => !t.id || !excludeIds.has(t.id)) : rawItems
  const [dismissing, setDismissing] = useState<Set<number>>(new Set())

  const handleDismiss = useCallback((id: number) => {
    setDismissing(prev => new Set(prev).add(id))
    setTimeout(() => onDismiss(id), 250)
  }, [onDismiss])

  if (items.length === 0) return null

  const blockItems = items.filter(i => i.context === 'time-block')
  const nextItems = items.filter(i => i.context === 'time-next')
  const routineItems = items.filter(i => i.context === 'routine')
  const slackHeader = items.find(i => i.context === 'slack-header')
  const slackItems = items.filter(i => i.context?.startsWith('slack-') && i.context !== 'slack-header' && i.priority > 0)
  const checkItems = items.filter(i => i.context !== 'time-block' && i.context !== 'time-next' && i.context !== 'routine' && !i.context?.startsWith('slack-'))

  const maxUrgency = Math.max(0, ...checkItems.map(i => urgency(i.created)))
  const borderColor = maxUrgency >= 3 ? 'border-red-300/60 dark:border-red-700/50' :
    maxUrgency >= 2 ? 'border-orange-200/60 dark:border-orange-700/50' : 'border-amber-200/40 dark:border-amber-700/40'

  const slackHasIssues = slackItems.some(i => i.priority > 0)
  const slackLabel = slackHeader ? `Slack — ${slackHeader.text}` : 'Slack'

  const handleAck = useCallback(() => {
    // Optimistically dismiss all slack items
    for (const item of slackItems) {
      if (item.id) onDismiss(item.id)
    }
    if (slackHeader?.id) onDismiss(slackHeader.id)
    fetch('/api/slack-digest/ack', { method: 'POST' }).catch(() => {})
  }, [slackItems, slackHeader, onDismiss])

  const handleRoutineCheck = useCallback((id: number) => {
    setDismissing(prev => new Set(prev).add(id))
    setTimeout(() => {
      fetch('/api/routine/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {})
    }, 250)
  }, [])

  return (
    <div className="mb-6 flex flex-col gap-3">
      {/* Routine checklist panel */}
      {routineItems.length > 0 && (
        <div className="px-4 py-3 rounded-lg bg-sky-50/60 dark:bg-sky-950/30 border border-sky-200/40 dark:border-sky-700/40 transition-colors duration-1000">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-sky-500/70 dark:text-sky-400/70 font-semibold">Routine</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {routineItems.map(item => (
              <PulseItem key={item.id} item={item} fading={item.id ? dismissing.has(item.id) : false}
                onDismiss={() => item.id && handleRoutineCheck(item.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Slack panel */}
      {slackItems.length > 0 && (
        <div className={`px-4 py-3 rounded-lg border transition-colors duration-1000 ${
          slackHasIssues ? 'bg-purple-50/60 dark:bg-purple-950/30 border-purple-200/60 dark:border-purple-700/40' : 'bg-gray-50/60 dark:bg-gray-800/30 border-gray-200/40 dark:border-gray-700/40'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-[10px] uppercase tracking-wider font-semibold ${
              slackHasIssues ? 'text-purple-500/70 dark:text-purple-400/70' : 'text-gray-400/70 dark:text-gray-500/70'
            }`}>{slackLabel}</span>
            <button
              onClick={handleAck}
              className="text-[9px] uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-pointer select-none px-1.5 py-0.5 rounded hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
            >
              ack
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            {slackItems.map(item => (
              <PulseItem key={item.id} item={item} fading={item.id ? dismissing.has(item.id) : false}
                onDismiss={() => item.id && handleDismiss(item.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Pulse check panel */}
      {(blockItems.length > 0 || checkItems.length > 0 || nextItems.length > 0) && (
        <div className={`px-4 py-3 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 ${borderColor} border transition-colors duration-1000`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-wider text-amber-500/70 dark:text-amber-400/70 font-semibold">Pulse check</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {blockItems.map(item => (
              <PulseItem key={item.id} item={item} fading={item.id ? dismissing.has(item.id) : false}
                onDismiss={() => item.id && handleDismiss(item.id)} />
            ))}
            {blockItems.length > 0 && checkItems.length > 0 && <div className="h-1" />}
            {checkItems.map(item => (
              <PulseItem key={item.id} item={item} fading={item.id ? dismissing.has(item.id) : false}
                onDismiss={() => item.id && handleDismiss(item.id)} />
            ))}
            {nextItems.length > 0 && <div className="h-1" />}
            {nextItems.map(item => (
              <PulseItem key={item.id} item={item} fading={item.id ? dismissing.has(item.id) : false}
                onDismiss={() => item.id && handleDismiss(item.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
