import { useState, useEffect, useRef } from 'react'

type ItemType = 'fire-drill' | 'today' | 'backlog'

export interface SlackContext {
  channel: string
  ts: string
  channelName: string
  messageCount: number
  participants: string[]
  summary: string
  threadPreview: string
}

interface ActionHint {
  type: 'reply' | 'track' | 'watch' | 'done' | 'snooze'
  draft?: string
  taskText?: string
  delegateOnly?: boolean
  checkHours?: number
}

interface NewItemFlowProps {
  onClose: () => void
  onCreate: (text: string, type?: ItemType, snoozeMins?: number, slackContext?: SlackContext, deadline?: string, delegateOnly?: boolean, checkHours?: number) => void
  isCreateTask?: boolean
  prefill?: string
  slackRef?: string | null
  actionHint?: ActionHint | null
}

const TYPE_OPTIONS: { type: ItemType; label: string; keys: string; color: string }[] = [
  { type: 'today', label: 'Priority', keys: 'T', color: 'text-blue-500 dark:text-blue-400' },
  { type: 'fire-drill', label: 'Fire drill', keys: 'F', color: 'text-red-500 dark:text-red-400' },
  { type: 'backlog', label: 'Backlog', keys: 'B', color: 'text-gray-500 dark:text-gray-400' },
]

const SNOOZE_OPTIONS = [5, 10, 15]
const NUDGE_OPTIONS = [4, 8, 12, 24, 48]

const SLACK_URL_RE = /^https:\/\/[^/]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+/

export function NewItemFlow({ onClose, onCreate, isCreateTask = false, prefill = '', slackRef = null, actionHint = null }: NewItemFlowProps) {
  const [text, setText] = useState(prefill)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [snoozeMins, setSnoozeMins] = useState(5)
  const [delegateOnly, setDelegateOnly] = useState(actionHint?.delegateOnly ?? false)
  const [checkHours, setCheckHours] = useState(actionHint?.checkHours ?? 24)
  // If actionHint provided with a taskText, skip text input and go straight to type picker
  const [focusArea, setFocusArea] = useState<'text' | 'type' | 'mode' | 'nudge' | 'snooze' | 'deadline'>(
    actionHint?.taskText ? 'type' : 'text'
  )
  const isWatch = isCreateTask && !!slackRef
  const [slackContext, setSlackContext] = useState<SlackContext | null>(null)
  const [slackLoading, setSlackLoading] = useState(false)
  const [deadlineText, setDeadlineText] = useState('')
  const [deadlineIso, setDeadlineIso] = useState<string | null>(null)
  const [deadlinePreview, setDeadlinePreview] = useState<string | null>(null)
  const [deadlineParsing, setDeadlineParsing] = useState(false)
  const [deadlineError, setDeadlineError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const deadlineRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const selectedType = TYPE_OPTIONS[selectedIdx].type
  const showSnooze = selectedType === 'fire-drill'

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (focusArea === 'text') inputRef.current?.focus()
  }, [focusArea])

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    // If there's unparsed deadline text, parse it first
    let finalDeadline = deadlineIso
    if (!finalDeadline && deadlineText.trim()) {
      try {
        const res = await fetch('/api/focus/parse-date', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: deadlineText.trim() }),
        })
        const result = await res.json()
        if (result.success && result.iso) finalDeadline = result.iso
      } catch { /* proceed without deadline */ }
    }
    const snoose = selectedType === 'fire-drill' ? snoozeMins : undefined
    onCreate(trimmed, selectedType, snoose, slackContext || undefined, finalDeadline || undefined, isWatch ? delegateOnly : undefined, isWatch ? checkHours : undefined)
    onClose()
  }

  const parseDeadline = async () => {
    if (!deadlineText.trim() || deadlineParsing) return
    setDeadlineParsing(true)
    setDeadlineError(null)
    try {
      const res = await fetch('/api/focus/parse-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: deadlineText.trim() }),
      })
      const result = await res.json()
      if (result.success && result.iso) {
        setDeadlinePreview(result.label)
        setDeadlineIso(result.iso)
      } else {
        setDeadlineError('Could not parse')
      }
    } catch {
      setDeadlineError('Failed')
    }
    setDeadlineParsing(false)
  }

  const extractSlack = (url: string) => {
    setSlackLoading(true)
    fetch('/api/slack-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(res => res.ok ? res.json() : null)
      .then((ctx: SlackContext | null) => {
        if (ctx) {
          setSlackContext(ctx)
          setText(ctx.summary)
        }
        setSlackLoading(false)
        setFocusArea('type')
      })
      .catch(() => {
        setSlackLoading(false)
        setFocusArea('type')
      })
  }

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      const trimmed = text.trim()
      if (!trimmed) return
      // Check if it's a Slack URL — extract context first
      if (SLACK_URL_RE.test(trimmed) && !slackContext) {
        extractSlack(trimmed)
        return
      }
      setFocusArea('type')
    }
  }

  // Global keyboard handler for type picker + snooze
  useEffect(() => {
    if (focusArea === 'text') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        submit()
        return
      }

      if (focusArea === 'type') {
        // Left/Right to cycle type options
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setSelectedIdx(prev => Math.max(0, prev - 1))
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setSelectedIdx(prev => Math.min(TYPE_OPTIONS.length - 1, prev + 1))
          return
        }
        // Up goes back to text input
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusArea('text')
          return
        }
        // Down goes to mode (if watch), snooze (if fire drill), or deadline
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          if (isWatch) setFocusArea('mode')
          else if (showSnooze) setFocusArea('snooze')
          else { setFocusArea('deadline'); setTimeout(() => deadlineRef.current?.focus(), 0) }
          return
        }
        // Shortcut keys: T, F, B
        const lower = e.key.toLowerCase()
        const matchIdx = TYPE_OPTIONS.findIndex(o => o.keys.toLowerCase() === lower)
        if (matchIdx >= 0) {
          e.preventDefault()
          setSelectedIdx(matchIdx)
        }
      }

      if (focusArea === 'mode') {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusArea('type')
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusArea('nudge')
          return
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          setDelegateOnly(prev => !prev)
          return
        }
      }

      if (focusArea === 'nudge') {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusArea('mode')
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          if (showSnooze) setFocusArea('snooze')
          else { setFocusArea('deadline'); setTimeout(() => deadlineRef.current?.focus(), 0) }
          return
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setCheckHours(prev => {
            const opts = NUDGE_OPTIONS
            const idx = opts.indexOf(prev)
            return opts[Math.max(0, idx - 1)]
          })
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setCheckHours(prev => {
            const opts = NUDGE_OPTIONS
            const idx = opts.indexOf(prev)
            return opts[Math.min(opts.length - 1, idx + 1)]
          })
          return
        }
      }

      if (focusArea === 'snooze') {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          if (isWatch) setFocusArea('nudge')
          else setFocusArea('type')
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusArea('deadline')
          setTimeout(() => deadlineRef.current?.focus(), 0)
          return
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setSnoozeMins(prev => {
            const idx = SNOOZE_OPTIONS.indexOf(prev)
            return SNOOZE_OPTIONS[Math.max(0, idx - 1)]
          })
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setSnoozeMins(prev => {
            const idx = SNOOZE_OPTIONS.indexOf(prev)
            return SNOOZE_OPTIONS[Math.min(SNOOZE_OPTIONS.length - 1, idx + 1)]
          })
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusArea, selectedIdx, text, snoozeMins, showSnooze, isWatch, delegateOnly, checkHours, deadlineIso, deadlineText]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={backdropRef}
      className="absolute inset-0 z-50 flex items-start justify-center"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="w-full bg-white dark:bg-[#1c1c1e] rounded-2xl border border-gray-200/80 dark:border-white/[0.08] shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_4px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_4px_16px_rgba(0,0,0,0.4)] overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-6 py-4">
          <span className={`text-[11px] font-semibold tracking-[0.12em] uppercase shrink-0 ${
            isWatch
              ? 'text-purple-500 dark:text-purple-400'
              : isCreateTask
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-gray-400 dark:text-gray-500'
          }`}>
            {isWatch ? 'Watch thread' : isCreateTask ? 'Create task' : 'New item'}
          </span>
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="What needs doing?"
            className={`flex-1 bg-transparent text-[15px] text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-600 ${
              focusArea !== 'text' ? 'opacity-50' : ''
            }`}
            autoFocus
          />
          {slackLoading && (
            <span className="w-4 h-4 border-2 border-purple-400/40 border-t-purple-500 rounded-full animate-spin shrink-0" />
          )}
          <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">
            esc
          </kbd>
        </div>

        {/* Type picker — horizontal, Left/Right to navigate */}
        {focusArea !== 'text' && (
          <div className={`border-t border-gray-100 dark:border-white/[0.06] px-6 py-3 flex items-center gap-3 transition-colors ${
            focusArea === 'type' ? 'bg-gray-50/50 dark:bg-white/[0.02]' : ''
          }`}>
            <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">Type</span>
            {TYPE_OPTIONS.map((opt, i) => (
              <button
                key={opt.type}
                className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                  i === selectedIdx
                    ? focusArea === 'type'
                      ? `${opt.type === 'fire-drill' ? 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 border border-red-300/80 dark:border-red-400/30 ring-2 ring-red-200/50 dark:ring-red-400/20'
                        : opt.type === 'today' ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-300/80 dark:border-blue-400/30 ring-2 ring-blue-200/50 dark:ring-blue-400/20'
                        : 'bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-300 border border-gray-300/80 dark:border-white/20 ring-2 ring-gray-200/50 dark:ring-white/10'}`
                      : `${opt.type === 'fire-drill' ? 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 border border-red-200/80 dark:border-red-400/20'
                        : opt.type === 'today' ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-400/20'
                        : 'bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-300 border border-gray-200/80 dark:border-white/15'}`
                    : 'bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border border-gray-200/60 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.12]'
                }`}
                onClick={() => { setSelectedIdx(i); setFocusArea('type') }}
              >
                {opt.label}
              </button>
            ))}
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-300 dark:text-gray-600">
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2190;</kbd>
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2192;</kbd>
            </span>
          </div>
        )}

        {/* Delegate-only toggle — when watching a Slack thread */}
        {focusArea !== 'text' && isWatch && (
          <div className={`border-t border-gray-100 dark:border-white/[0.06] px-6 py-3 flex items-center gap-3 transition-colors ${
            focusArea === 'mode' ? 'bg-gray-50/50 dark:bg-white/[0.02]' : ''
          }`}>
            <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">Mode</span>
            <button
              onClick={() => { setDelegateOnly(false); setFocusArea('mode') }}
              className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                !delegateOnly
                  ? focusArea === 'mode'
                    ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-300/80 dark:border-blue-400/30 ring-2 ring-blue-200/50 dark:ring-blue-400/20'
                    : 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-300/80 dark:border-blue-400/30'
                  : 'bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border border-gray-200/60 dark:border-white/[0.08]'
              }`}
            >
              Own work
            </button>
            <button
              onClick={() => { setDelegateOnly(true); setFocusArea('mode') }}
              className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                delegateOnly
                  ? focusArea === 'mode'
                    ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-300/80 dark:border-amber-400/30 ring-2 ring-amber-200/50 dark:ring-amber-400/20'
                    : 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-300/80 dark:border-amber-400/30'
                  : 'bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border border-gray-200/60 dark:border-white/[0.08]'
              }`}
            >
              Delegate
            </button>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-300 dark:text-gray-600">
              <span>{delegateOnly ? 'hidden until reply or nudge' : 'stays in queue'}</span>
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2190;</kbd>
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2192;</kbd>
            </span>
          </div>
        )}

        {/* Nudge interval — when watching a Slack thread */}
        {focusArea !== 'text' && isWatch && (
          <div className={`border-t border-gray-100 dark:border-white/[0.06] px-6 py-3 flex items-center gap-3 transition-colors ${
            focusArea === 'nudge' ? 'bg-gray-50/50 dark:bg-white/[0.02]' : ''
          }`}>
            <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">Nudge</span>
            {NUDGE_OPTIONS.map(h => (
              <button
                key={h}
                onClick={() => { setCheckHours(h); setFocusArea('nudge') }}
                className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                  checkHours === h
                    ? focusArea === 'nudge'
                      ? 'bg-purple-100 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-300/80 dark:border-purple-400/30 ring-2 ring-purple-200/50 dark:ring-purple-400/20'
                      : 'bg-purple-100 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-200/80 dark:border-purple-400/20'
                    : 'bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border border-gray-200/60 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.12]'
                }`}
              >
                {h}h
              </button>
            ))}
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-300 dark:text-gray-600">
              <span>resurface if no reply</span>
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2190;</kbd>
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2192;</kbd>
            </span>
          </div>
        )}

        {/* Snooze picker — when fire drill selected */}
        {focusArea !== 'text' && showSnooze && (
          <div className={`border-t border-gray-100 dark:border-white/[0.06] px-6 py-3 flex items-center gap-3 transition-colors ${
            focusArea === 'snooze' ? 'bg-gray-50/50 dark:bg-white/[0.02]' : ''
          }`}>
            <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">Snooze original</span>
            {SNOOZE_OPTIONS.map(m => (
              <button
                key={m}
                onClick={() => { setSnoozeMins(m); setFocusArea('snooze') }}
                className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
                  snoozeMins === m
                    ? focusArea === 'snooze'
                      ? 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 border border-red-300/80 dark:border-red-400/30 ring-2 ring-red-200/50 dark:ring-red-400/20'
                      : 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 border border-red-200/80 dark:border-red-400/20'
                    : 'bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border border-gray-200/60 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.12]'
                }`}
              >
                {m}m
              </button>
            ))}
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-300 dark:text-gray-600">
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2190;</kbd>
              <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] bg-gray-100 dark:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]">&#x2192;</kbd>
            </span>
          </div>
        )}

        {/* Deadline input */}
        {focusArea !== 'text' && (
          <div className={`border-t border-gray-100 dark:border-white/[0.06] px-6 py-3 flex items-center gap-3 transition-colors ${
            focusArea === 'deadline' ? 'bg-gray-50/50 dark:bg-white/[0.02]' : ''
          }`}>
            <span className="text-[12px] text-gray-400 dark:text-gray-500 shrink-0">Due</span>
            {deadlinePreview ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-[13px] text-gray-700 dark:text-gray-200">{deadlinePreview}</span>
                <button
                  onClick={() => { setDeadlinePreview(null); setDeadlineIso(null); setDeadlineText(''); setTimeout(() => deadlineRef.current?.focus(), 0) }}
                  className="text-[11px] text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-pointer px-1"
                >
                  &times;
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={deadlineRef}
                  value={deadlineText}
                  onChange={e => { setDeadlineText(e.target.value); setDeadlineError(null) }}
                  onFocus={() => setFocusArea('deadline')}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); return }
                    if (e.key === 'Enter') { e.preventDefault(); parseDeadline() }
                    if (e.key === 'Escape') { e.preventDefault(); onClose() }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setFocusArea(showSnooze ? 'snooze' : isWatch ? 'nudge' : 'type') }
                  }}
                  onKeyUp={e => e.stopPropagation()}
                  placeholder="tomorrow, fri 2pm, midday, EOD..."
                  className={`flex-1 bg-transparent text-[13px] text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-600 ${
                    focusArea !== 'deadline' ? 'opacity-50' : ''
                  }`}
                />
                {deadlineParsing && <span className="text-[11px] text-gray-400 animate-pulse">...</span>}
                {deadlineError && <span className="text-[11px] text-red-400">{deadlineError}</span>}
              </>
            )}
            <span className="text-[11px] text-gray-300 dark:text-gray-600 shrink-0">optional</span>
          </div>
        )}

        {/* Slack context — when extracted */}
        {focusArea !== 'text' && slackContext && (
          <div className="border-t border-gray-100 dark:border-white/[0.06] px-6 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-purple-500 dark:text-purple-400 font-medium shrink-0">Slack</span>
              <span className="text-[12px] text-gray-500 dark:text-gray-400">
                #{slackContext.channelName}
                <span className="text-gray-300 dark:text-gray-600 mx-1">&middot;</span>
                {slackContext.messageCount} msg{slackContext.messageCount !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => setSlackContext(null)}
                className="ml-auto text-[11px] text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-pointer px-1"
              >
                &times;
              </button>
            </div>
            {slackContext.threadPreview && (
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 leading-tight line-clamp-2 italic">
                {slackContext.threadPreview}
              </p>
            )}
          </div>
        )}

        {/* Submit hint */}
        {focusArea !== 'text' && (
          <div className="border-t border-gray-100 dark:border-white/[0.06] px-6 py-2.5 flex items-center justify-end">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-300 dark:text-gray-600">
              <kbd className={`px-2 py-0.5 rounded-[5px] font-mono text-[10px] font-medium border ${
                selectedType === 'fire-drill'
                  ? 'bg-red-50 dark:bg-red-500/10 text-red-400 dark:text-red-400/60 border-red-200/60 dark:border-red-400/15'
                  : 'bg-blue-50 dark:bg-blue-500/10 text-blue-400 dark:text-blue-400/60 border-blue-200/60 dark:border-blue-400/15'
              }`}>⌘↵</kbd>
              <span>{isWatch ? 'watch' : isCreateTask ? 'create task' : 'create item'}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
