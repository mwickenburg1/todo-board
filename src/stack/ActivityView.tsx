import React, { useState, useMemo } from 'react'

interface ActivityEntry {
  ts: string
  type: string
  detail: string | null
  session_id: string | null
  env: string | null
  task_id: number | null
}

const TYPE_COLORS: Record<string, string> = {
  focus_action: 'text-amber-400',
  space_switch: 'text-sky-400',
  claude_prompt: 'text-violet-400',
  claude_response: 'text-emerald-400',
  next_blocked: 'text-rose-400',
  auto_assign: 'text-orange-400',
}

const FILTER_TYPES = ['', 'focus_action', 'space_switch', 'claude_prompt', 'claude_response', 'next_blocked', 'auto_assign']
const PAGE_SIZE = 50

interface ActivityViewProps {
  entries: ActivityEntry[]
}

export function ActivityView({ entries: allEntries }: ActivityViewProps) {
  const [filter, setFilter] = useState('')
  const [groupBySession, setGroupBySession] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    if (!filter) return allEntries
    return allEntries.filter(e => e.type === filter)
  }, [allEntries, filter])

  const entries = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const hasMore = filtered.length > visibleCount

  const sessionGroups = useMemo(() => {
    if (!groupBySession) return null
    return entries.reduce<Record<string, ActivityEntry[]>>((acc, e) => {
      const key = e.session_id || '__no_session'
      if (!acc[key]) acc[key] = []
      acc[key].push(e)
      return acc
    }, {})
  }, [entries, groupBySession])

  // Reset visible count when filter changes
  const setFilterAndReset = (f: string) => {
    setFilter(f)
    setVisibleCount(PAGE_SIZE)
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1 flex-wrap items-center">
          {FILTER_TYPES.map(f => (
            <button
              key={f}
              onClick={() => setFilterAndReset(f)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                filter === f
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-gray-500 hover:text-gray-300 dark:hover:text-gray-400'
              }`}
            >
              {f || 'all'}
            </button>
          ))}
          <span className="text-[10px] text-gray-600 ml-2">{filtered.length} total</span>
        </div>
        <button
          onClick={() => setGroupBySession(g => !g)}
          className={`text-[10px] px-2 py-0.5 rounded ${
            groupBySession ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          by session
        </button>
      </div>

      <div className="max-h-[600px] overflow-y-auto font-mono">
        {sessionGroups ? (
          Object.entries(sessionGroups).map(([sid, items]) => (
            <div key={sid} className="mb-3">
              <div className="text-[10px] text-gray-600 dark:text-gray-500 mb-1 font-semibold">
                {sid === '__no_session' ? 'No session' : `Session ${sid.slice(0, 8)}...`}
                <span className="ml-2 font-normal opacity-60">{items.length} events</span>
              </div>
              {items.map((entry, i) => <EntryRow key={i} entry={entry} />)}
            </div>
          ))
        ) : (
          entries.map((entry, i) => <EntryRow key={i} entry={entry} />)
        )}
        {entries.length === 0 && (
          <div className="text-[11px] text-gray-600 py-4 text-center">No activity recorded yet</div>
        )}
        {hasMore && (
          <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            className="w-full py-2 text-[11px] text-gray-500 hover:text-gray-400 transition-colors"
          >
            Show more ({filtered.length - visibleCount} remaining)
          </button>
        )}
      </div>
    </div>
  )
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
  const time = new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div className="flex gap-2 py-[2px] text-[11px] text-gray-500 dark:text-gray-500 hover:text-gray-400 dark:hover:text-gray-400">
      <span className="text-gray-600 dark:text-gray-600 shrink-0">{time}</span>
      <span className={`shrink-0 w-[100px] ${TYPE_COLORS[entry.type] || 'text-gray-400'}`}>
        {entry.type}
      </span>
      {entry.env && <span className="text-gray-600 dark:text-gray-600 shrink-0">[{entry.env}]</span>}
      <span className="truncate">{entry.detail || ''}</span>
    </div>
  )
}
