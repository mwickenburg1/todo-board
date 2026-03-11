import React, { useEffect, useState, useRef } from 'react'
import { ENV_COLORS, envLabel, smartDeadlineLabel } from './focusShared'

export interface DeadlineItem {
  id: number; text: string; list: string; deadline: string | null
  status: string; env: string | null; escalation: number; created?: string
}

export function DeadlineView({ items, onSetDeadline, onDone }: { items: DeadlineItem[]; onSetDeadline: (id: number, deadline: string | null) => void; onDone: (id: number) => void }) {
  const [search, setSearch] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [dateInput, setDateInput] = useState<{ id: number; text: string } | null>(null)
  const [dateText, setDateText] = useState('')
  const [dateParsing, setDateParsing] = useState(false)
  const [datePreview, setDatePreview] = useState<{ label: string; iso: string } | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (dateInput) { setDateInput(null); setDateText(''); setDatePreview(null); setDateError(null) }
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [dateInput])

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  const withDeadline = items.filter(i => i.deadline && i.deadline !== 'none').sort((a, b) => (a.deadline || '') < (b.deadline || '') ? -1 : 1)
  const withoutDeadline = items.filter(i => !i.deadline)
  const filtered = search.trim()
    ? withoutDeadline.filter(i => i.text.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => (b.created || '') > (a.created || '') ? 1 : -1)
        .slice(0, 15)
    : []

  useEffect(() => { setSelectedIdx(0) }, [search])

  const deadlineDateStr = (d: string) => {
    if (d.includes('T')) return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    return d
  }

  const deadlineColor = (d: string) => smartDeadlineLabel(d).color
  const deadlineLabel = (d: string) => smartDeadlineLabel(d).label

  const parseDate = async (text: string) => {
    setDateParsing(true)
    setDateError(null)
    try {
      const res = await fetch('/api/focus/parse-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const result = await res.json()
      if (result.success && result.iso) {
        setDatePreview({ label: result.label, iso: result.iso })
      } else {
        setDateError('Could not parse date')
      }
    } catch {
      setDateError('Failed to parse')
    }
    setDateParsing(false)
  }

  const confirmDate = () => {
    if (!dateInput || !datePreview) return
    onSetDeadline(dateInput.id, datePreview.iso)
    setDateInput(null)
    setDateText('')
    setDatePreview(null)
    setDateError(null)
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  useEffect(() => {
    if (!datePreview) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmDate() }
      if (e.key === 'Escape') { e.preventDefault(); setDatePreview(null); setTimeout(() => dateInputRef.current?.focus(), 0) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [datePreview]) // eslint-disable-line react-hooks/exhaustive-deps

  const startDateInput = (item: DeadlineItem) => {
    setDateInput({ id: item.id, text: item.text })
    setDateText('')
    setDatePreview(null)
    setDateError(null)
    setTimeout(() => dateInputRef.current?.focus(), 50)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      startDateInput(filtered[selectedIdx])
    }
    else if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur() }
  }

  const envBadge = (env: string | null) => {
    if (!env) return null
    const c = ENV_COLORS[env]
    if (!c) return null
    return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.bg} ${c.border} ${c.text} border shrink-0`}>{envLabel(env)}</span>
  }

  const renderDeadlineItem = (item: DeadlineItem) => (
    <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-gray-200/40 dark:border-white/[0.06] group">
      <button
        className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors cursor-pointer shrink-0 flex items-center justify-center text-transparent hover:text-green-500"
        onClick={() => onDone(item.id)}
        title="Mark done"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      </button>
      {envBadge(item.env)}
      <span className="text-[15px] text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{item.text}</span>
      <span className="text-[12px] text-gray-400 dark:text-gray-600 shrink-0">{item.list}</span>
      {editingId === item.id ? (
        <input
          type="date"
          autoFocus
          defaultValue={item.deadline || today}
          className="text-[14px] bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 text-gray-700 dark:text-gray-300 outline-none"
          onBlur={(e) => { onSetDeadline(item.id, e.target.value || null); setEditingId(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSetDeadline(item.id, (e.target as HTMLInputElement).value || null); setEditingId(null) }
            if (e.key === 'Escape') setEditingId(null)
          }}
        />
      ) : (
        <span
          className={`text-[14px] font-medium cursor-pointer hover:underline shrink-0 ${deadlineColor(item.deadline!)}`}
          onClick={() => setEditingId(item.id)}
        >
          {deadlineLabel(item.deadline!)}
        </span>
      )}
      <button
        className="text-[20px] leading-none text-gray-400 dark:text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 px-1 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-500/10"
        onClick={() => onSetDeadline(item.id, null)}
        title="Remove deadline"
      >×</button>
    </div>
  )

  const renderSearchResult = (item: DeadlineItem, idx: number) => (
    <div
      key={item.id}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors cursor-pointer ${
        idx === selectedIdx
          ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200/60 dark:border-blue-500/20'
          : 'bg-white/50 dark:bg-white/[0.03] border-gray-200/40 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/[0.12]'
      }`}
      onClick={() => startDateInput(item)}
      onMouseEnter={() => setSelectedIdx(idx)}
    >
      <button
        className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors cursor-pointer shrink-0 flex items-center justify-center text-transparent hover:text-green-500"
        onClick={(e) => { e.stopPropagation(); onDone(item.id) }}
        title="Mark done"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      </button>
      {envBadge(item.env)}
      <span className="text-[15px] text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{item.text}</span>
      <span className="text-[12px] text-gray-400 dark:text-gray-600 shrink-0">{item.list}</span>
      <span className="text-[13px] text-gray-400 dark:text-gray-600 shrink-0">↵ set date</span>
    </div>
  )

  const [deadlinesCollapsed, setDeadlinesCollapsed] = useState(false)
  const [dailyGoalsCollapsed, setDailyGoalsCollapsed] = useState(false)

  return (
    <div className="mt-6">
      {/* Search / assign deadline — always at top */}
      <div className="mb-4 relative">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search tasks to assign deadline... (⌘K)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="w-full px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-gray-200/40 dark:border-white/[0.06] text-[16px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none focus:border-blue-300 dark:focus:border-blue-500/30 transition-colors relative z-50"
        />
        {(filtered.length > 0 || (search.trim() && filtered.length === 0)) && !dateInput && (
          <>
            <div className="fixed inset-0 z-40 bg-black/50 dark:bg-black/70" onClick={() => setSearch('')} />
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-[400px] overflow-y-auto bg-white dark:bg-[#1c1c1e] rounded-xl border border-gray-200/80 dark:border-white/[0.08] shadow-lg dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)] p-2">
              {filtered.length > 0 ? (
                <div className="space-y-1.5">
                  {filtered.map(renderSearchResult)}
                </div>
              ) : (
                <div className="text-[15px] text-gray-400 dark:text-gray-500 px-4 py-3">No matches</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Date input overlay */}
      {dateInput && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-blue-50/50 dark:bg-blue-500/5 border border-blue-200/60 dark:border-blue-500/20">
          <div className="text-[14px] text-gray-500 dark:text-gray-400 mb-1.5 truncate">{dateInput.text}</div>
          {!datePreview ? (
            <div className="flex items-center gap-2">
              <input
                ref={dateInputRef}
                value={dateText}
                onChange={(e) => { setDateText(e.target.value); setDateError(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && dateText.trim()) parseDate(dateText.trim())
                  if (e.key === 'Escape') { setDateInput(null); setDateText(''); setTimeout(() => searchRef.current?.focus(), 50) }
                }}
                placeholder="tomorrow, friday 2pm, midday, AM, EOD..."
                className="flex-1 bg-transparent text-[16px] text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-600"
                disabled={dateParsing}
                autoFocus
              />
              {dateParsing && <span className="text-[13px] text-gray-400 animate-pulse">parsing...</span>}
              {dateError && <span className="text-[13px] text-red-400">{dateError}</span>}
              <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[11px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">esc</kbd>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-[16px] text-gray-800 dark:text-gray-100">{datePreview.label}</span>
              <span className="text-[12px] text-gray-400 dark:text-gray-500">
                <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[11px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">↵</kbd>
                {' '}confirm
              </span>
              <kbd
                className="px-1.5 py-0.5 rounded-[5px] font-mono text-[11px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] cursor-pointer"
                onClick={() => { setDatePreview(null); setTimeout(() => dateInputRef.current?.focus(), 0) }}
              >esc</kbd>
            </div>
          )}
        </div>
      )}

      {/* Deadlines list — collapsible */}
      {withDeadline.length > 0 && (
        <div className="mb-6">
          <div
            className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 px-1 py-1.5 mb-2 flex items-center gap-2 cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            onClick={() => setDeadlinesCollapsed(c => !c)}
          >
            <span className={`text-[11px] transition-transform ${deadlinesCollapsed ? '' : 'rotate-90'}`}>▶</span>
            Deadlines
            <span className="text-[13px] font-normal text-gray-400 dark:text-gray-500">({withDeadline.length})</span>
            <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>
          {!deadlinesCollapsed && (
            <div className="space-y-1.5">
              {withDeadline.map(renderDeadlineItem)}
            </div>
          )}
        </div>
      )}

      {/* Daily-goals items without deadlines */}
      {(() => {
        const dailyGoalsNoDeadline = withoutDeadline.filter(i => i.list === 'daily-goals')
        if (dailyGoalsNoDeadline.length === 0) return null
        return (
          <div className="mt-4 opacity-40">
            <div
              className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 px-1 py-1.5 mb-2 flex items-center gap-2 cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              onClick={() => setDailyGoalsCollapsed(c => !c)}
            >
              <span className={`text-[11px] transition-transform ${dailyGoalsCollapsed ? '' : 'rotate-90'}`}>▶</span>
              Daily goals — no deadline
              <span className="text-[13px] font-normal text-gray-400 dark:text-gray-500">({dailyGoalsNoDeadline.length})</span>
              <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>
            {!dailyGoalsCollapsed && <div className="space-y-1.5">
              {dailyGoalsNoDeadline.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-gray-200/40 dark:border-white/[0.06] group">
                  <button
                    className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors cursor-pointer shrink-0 flex items-center justify-center text-transparent hover:text-green-500"
                    onClick={() => onDone(item.id)}
                    title="Mark done"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </button>
                  {envBadge(item.env)}
                  <span className="text-[15px] text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{item.text}</span>
                  <span
                    className="text-[13px] text-gray-400 dark:text-gray-600 shrink-0 cursor-pointer hover:text-blue-500 dark:hover:text-blue-400"
                    onClick={() => startDateInput(item)}
                  >+ deadline</span>
                  <span
                    className="text-[13px] text-gray-400 dark:text-gray-600 shrink-0 cursor-pointer hover:text-gray-500 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onSetDeadline(item.id, 'none')}
                    title="Mark as not needing a deadline"
                  >n/a</span>
                </div>
              ))}
            </div>}
          </div>
        )
      })()}
    </div>
  )
}
