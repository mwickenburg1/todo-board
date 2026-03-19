import React, { useEffect, useState, useCallback, useRef } from 'react'
import { FleetView } from './FleetView'
import { PrioritySortView } from './PrioritySortView'
import { NewItemFlow, type SlackContext } from './NewItemFlow'
import { RescheduleInput } from './RescheduleInput'
import { SlackThreadPreview } from './SlackThreadPreview'
import { evaluateAlerts, alertStyle } from './focusAlerts'
import { ENV_COLORS, openFleetEnv, envLabel } from './focusShared'
import { PRView, type PR } from './PRView'
import { DeadlineView, type DeadlineItem } from './DeadlineView'
import { FocusSearch } from './FocusSearch'
import { TopBar } from './TopBar'
import { useFocusActions } from './useFocusActions'
import type { FocusResponse, TriageAction, PinnedTaskData } from './focusTypes'
import { EnrichOverlay, SlackIcon } from './EnrichOverlay'
import { ActivityView } from './ActivityView'
import { EnergyBar } from './EnergyBar'
import { PrepView } from './PrepView'

function EditableTitle({ label, isSlack, onSave }: { label: string; isSlack: boolean; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(label) }, [label])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const colorClass = isSlack ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100'

  const commit = () => {
    setEditing(false)
    const trimmed = value.trim()
    if (trimmed && trimmed !== label) onSave(trimmed)
    else setValue(label)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setValue(label); setEditing(false) }
          e.stopPropagation()
        }}
        onKeyUp={e => e.stopPropagation()}
        onKeyPress={e => e.stopPropagation()}
        className={`text-[24px] leading-[1.35] font-medium ${colorClass} bg-transparent border-b-2 border-blue-400 outline-none w-full`}
      />
    )
  }

  return (
    <h1
      onClick={() => setEditing(true)}
      className={`text-[24px] leading-[1.35] font-medium ${colorClass} cursor-text hover:border-b hover:border-gray-300 dark:hover:border-gray-600`}
    >
      {label}
    </h1>
  )
}

function Scratchpad({ taskId, initialNotes, onSave }: { taskId: number; initialNotes: string; onSave: (id: number, notes: string) => void }) {
  const [value, setValue] = useState(initialNotes)
  const [expanded, setExpanded] = useState(false)
  const [needsCollapse, setNeedsCollapse] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(initialNotes)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusedRef = useRef(false)

  // Reset when task changes — but skip if user is actively typing
  useEffect(() => {
    if (!focusedRef.current) {
      setValue(initialNotes)
      lastSavedRef.current = initialNotes
      setExpanded(false)
    }
  }, [taskId, initialNotes])

  // Auto-resize textarea + check if collapsible
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = '100px'
      const natural = Math.max(100, el.scrollHeight)
      el.style.height = natural + 'px'
      setNeedsCollapse(natural > 200)
    }
  }, [value])

  const debouncedSave = useCallback((text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (text !== lastSavedRef.current) {
        lastSavedRef.current = text
        onSave(taskId, text)
      }
    }, 600)
  }, [taskId, onSave])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    setValue(newVal)
    debouncedSave(newVal)
  }

  const isCollapsed = needsCollapse && !expanded && !focusedRef.current

  return (
    <div className="mt-4 relative">
      <div
        className="transition-all duration-200"
        style={{
          maxHeight: isCollapsed ? '200px' : 'none',
          overflow: isCollapsed ? 'hidden' : 'visible',
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onFocus={() => { focusedRef.current = true; setExpanded(true) }}
          onBlur={() => { focusedRef.current = false }}
          onKeyDown={e => e.stopPropagation()}
          onKeyUp={e => e.stopPropagation()}
          onKeyPress={e => e.stopPropagation()}
          placeholder="Notes..."
          className="w-full bg-gray-50/50 dark:bg-white/[0.02] text-[18px] leading-relaxed text-gray-600 dark:text-gray-400 placeholder-gray-300 dark:placeholder-gray-600 border-none rounded-xl px-5 py-4 outline-none resize-none overflow-hidden"
          style={{ minHeight: '100px' }}
          data-dirty="true"
        />
      </div>
      {isCollapsed && (
        <div
          className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white dark:from-[#1c1c1e] to-transparent rounded-b-xl flex items-end justify-center pb-2 cursor-pointer"
          onClick={() => setExpanded(true)}
        >
          <span className="text-[11px] text-gray-400 hover:text-gray-300 transition-colors">show more</span>
        </div>
      )}
      {needsCollapse && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 text-[11px] text-gray-500 hover:text-gray-400 transition-colors"
        >
          collapse
        </button>
      )}
    </div>
  )
}

function EnvHealthBar({ status }: { status: string }) {
  const segments = status.split(' | ').map(s => {
    const colonIdx = s.lastIndexOf(':')
    if (colonIdx === -1) return null
    return { name: s.slice(0, colonIdx).trim(), icon: s.slice(colonIdx + 1).trim() }
  }).filter(Boolean) as { name: string; icon: string }[]

  if (segments.length === 0) return null

  const iconColor = (icon: string) => {
    if (icon === '✅') return 'text-emerald-500/60'
    if (icon === '❌') return 'text-red-400/70'
    if (icon === '⚠️') return 'text-amber-400/70'
    return 'text-gray-600'
  }

  const hasIssue = segments.some(s => s.icon !== '✅')

  return (
    <div>
      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${hasIssue ? 'text-amber-500/60' : 'text-gray-600'}`}>env health</div>
      <div className="flex flex-col gap-[2px] text-[12px]">
        {segments.map((s, i) => (
          <div key={i} className={`flex items-center gap-2 ${s.icon !== '✅' ? 'opacity-100' : 'opacity-50'}`}>
            <span className={`w-4 text-center ${iconColor(s.icon)}`}>{s.icon}</span>
            <span className={iconColor(s.icon)}>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineStatusBar({ status, next }: { status: string; next: string | null }) {
  const segments = status.split(' | ').map(s => {
    const [name, icon] = s.split(':')
    return { name: name?.trim(), icon: icon?.trim() }
  }).filter(s => s.name && s.icon)

  if (segments.length === 0) return null

  const iconColor = (icon: string) => {
    if (icon === '✅') return 'text-emerald-500/60'
    if (icon === '❌') return 'text-red-400/70'
    if (icon === '⬜') return 'text-gray-600'
    if (icon === '👉') return 'text-blue-400/60'
    return 'text-gray-600'
  }

  return (
    <div className="flex flex-col gap-[2px] text-[12px]">
      {segments.map((s, i) => {
        const isNext = next && s.name === next
        return (
          <div key={i} className={`flex items-center gap-2 ${isNext ? 'opacity-100' : s.icon === '✅' ? 'opacity-40' : 'opacity-70'}`}>
            <span className={`w-4 text-center ${iconColor(s.icon)}`}>{s.icon}</span>
            <span className={`${iconColor(s.icon)} ${isNext ? 'font-medium' : ''}`}>{s.name}</span>
            {isNext && <span className="text-[10px] text-blue-400/50 ml-1">← next</span>}
          </div>
        )
      })}
    </div>
  )
}


interface ConvoMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

interface MemoryEvent {
  id: number
  content: string
}

interface MemoryEvents {
  recalled: MemoryEvent[]
  saved: MemoryEvent[]
}

function MemoryBadge({ type, memories }: { type: 'recalled' | 'saved'; memories: MemoryEvent[] }) {
  const [showTooltip, setShowTooltip] = useState(false)
  if (memories.length === 0) return null
  const isRecall = type === 'recalled'
  const label = isRecall ? 'Recalled from memory' : 'Saved to memory'
  return (
    <span
      className="relative inline-flex cursor-default"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span className={`text-[14px] ${isRecall ? 'text-violet-400' : 'text-emerald-400'}`} title={label}>
        {isRecall ? '🧠' : '☁️'}
      </span>
      {showTooltip && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 w-max max-w-[280px] px-3 py-2 rounded-lg bg-gray-900 dark:bg-gray-800 text-white text-[12px] leading-snug shadow-lg">
          <p className="font-medium opacity-70 mb-1">{label}</p>
          {memories.map(m => (
            <p key={m.id} className="opacity-90">{m.content}</p>
          ))}
        </div>
      )}
    </span>
  )
}

/** Lightweight markdown renderer for chat messages — handles bold, italic, code, code blocks, lists */
function renderMarkdown(text: string) {
  // Split code blocks first
  const blocks = text.split(/(```[\s\S]*?```)/g)
  return blocks.map((block, bi) => {
    if (block.startsWith('```') && block.endsWith('```')) {
      const inner = block.slice(3, -3).replace(/^\w*\n/, '') // strip language hint line
      return <pre key={bi} className="my-2 px-3 py-2 rounded-md bg-black/10 dark:bg-black/30 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap">{inner}</pre>
    }
    // Split into lines for list detection
    const lines = block.split('\n')
    const elements: React.ReactNode[] = []
    let listItems: React.ReactNode[] = []
    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(<ul key={`ul-${elements.length}`} className="my-1 ml-4 list-disc space-y-0.5">{listItems}</ul>)
        listItems = []
      }
    }
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      const listMatch = line.match(/^[\s]*[-*]\s+(.+)/)
      if (listMatch) {
        listItems.push(<li key={li}>{renderInline(listMatch[1])}</li>)
      } else {
        flushList()
        if (line.trim() === '' && li > 0 && li < lines.length - 1) {
          elements.push(<br key={`br-${li}`} />)
        } else if (line.trim()) {
          if (elements.length > 0) elements.push(<br key={`br-${li}`} />)
          elements.push(<span key={`l-${li}`}>{renderInline(line)}</span>)
        }
      }
    }
    flushList()
    return <span key={bi}>{elements}</span>
  })
}

function renderInline(text: string): React.ReactNode {
  // Split on inline patterns: `code`, **bold**, *italic*
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-black/30 text-[13px] font-mono">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

function TaskConversation({ taskId, hasMessages }: { taskId: number; hasMessages: boolean }) {
  const [expanded, setExpanded] = useState(hasMessages)
  const [messages, setMessages] = useState<ConvoMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [memoryEvents, setMemoryEvents] = useState<MemoryEvents | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize chat input
  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.style.height = '0'
      el.style.height = Math.min(el.scrollHeight, 150) + 'px'
    }
  }, [input])

  // Load conversation when expanded
  useEffect(() => {
    if (expanded && !loaded) {
      fetch(`/api/todos/${taskId}/conversation`)
        .then(r => r.json())
        .then(data => { setMessages(data.messages || []); setLoaded(true) })
        .catch(() => setLoaded(true))
    }
  }, [expanded, taskId, loaded])

  // Reset when task changes
  useEffect(() => {
    setMessages([])
    setLoaded(false)
    setExpanded(hasMessages)
    setMemoryEvents(null)
  }, [taskId])

  // Auto-scroll on new messages (scroll container, not the page)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, memoryEvents])

  // Auto-focus input when expanded
  useEffect(() => {
    if (expanded && loaded) inputRef.current?.focus()
  }, [expanded, loaded])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setLoading(true)
    setMemoryEvents(null)
    // Optimistic user message
    setMessages(prev => [...prev, { role: 'user', content: text, ts: Date.now() }])
    try {
      const res = await fetch(`/api/todos/${taskId}/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      setMessages(data.messages || [])
      if (data.memory_events) setMemoryEvents(data.memory_events)
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to get response.', ts: Date.now() }])
    }
    setLoading(false)
  }

  const clearConvo = async () => {
    await fetch(`/api/todos/${taskId}/conversation`, { method: 'DELETE' })
    setMessages([])
    setMemoryEvents(null)
  }

  const hasMemoryActivity = memoryEvents && (memoryEvents.recalled.length > 0 || memoryEvents.saved.length > 0)

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[13px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>&#x25B6;</span>
        <span>Chat{messages.length > 0 ? ` (${messages.length})` : ''}</span>
        {messages.length > 0 && (
          <button
            onClick={e => { e.stopPropagation(); clearConvo() }}
            className="ml-2 text-[11px] text-gray-300 dark:text-gray-600 hover:text-red-400"
          >clear</button>
        )}
      </button>

      {expanded && (
        <div className="mt-2 rounded-xl bg-gray-50/50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04] overflow-hidden">
          {/* Messages */}
          {messages.length > 0 && (
            <div ref={scrollContainerRef} className="max-h-[500px] overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((m, i) => {
                const isLastAssistant = m.role === 'assistant' && i === messages.length - 1
                return (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-[16px] leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-blue-500/10 dark:bg-blue-500/15 text-gray-700 dark:text-gray-200'
                        : 'bg-white dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-white/[0.06]'
                    }`}>
                      <div className="whitespace-pre-wrap">{m.role === 'assistant' ? renderMarkdown(m.content) : m.content}</div>
                      {isLastAssistant && hasMemoryActivity && (
                        <div className="flex gap-1.5 mt-1.5 -mb-0.5">
                          {memoryEvents!.recalled.length > 0 && (
                            <MemoryBadge type="recalled" memories={memoryEvents!.recalled} />
                          )}
                          {memoryEvents!.saved.length > 0 && (
                            <MemoryBadge type="saved" memories={memoryEvents!.saved} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-white/[0.04] border border-gray-100 dark:border-white/[0.06] rounded-lg px-4 py-2.5 text-[16px] text-gray-400">
                    <span className="animate-pulse">thinking...</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-white/[0.04]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
              }}
              onKeyUp={e => e.stopPropagation()}
              placeholder="Think out loud..."
              disabled={loading}
              rows={1}
              className="flex-1 bg-transparent text-[16px] text-gray-700 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 outline-none resize-none overflow-hidden"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="text-[13px] font-medium text-blue-500 dark:text-blue-400 hover:text-blue-600 disabled:text-gray-300 dark:disabled:text-gray-600 transition-colors px-2 py-1 flex items-center gap-1"
            >
              <kbd className="text-[11px] opacity-60">⌘↵</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* PRView and DeadlineView extracted to ./PRView.tsx and ./DeadlineView.tsx */

type HotkeyEmphasis = 'primary' | 'secondary' | 'default'

function HotkeyHint({ keys, label, emphasis = 'default' }: { keys: string; label: string; emphasis?: HotkeyEmphasis }) {
  const kbdClass = emphasis === 'primary'
    ? 'px-3 py-1.5 rounded-md font-mono text-[15px] font-medium bg-emerald-500/20 dark:bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 border border-emerald-400/30 dark:border-emerald-400/25 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'
    : emphasis === 'secondary'
    ? 'px-3 py-1.5 rounded-md font-mono text-[14px] font-medium bg-amber-50/60 dark:bg-amber-500/[0.06] text-amber-400/80 dark:text-amber-400/50 border border-amber-200/40 dark:border-amber-400/10'
    : 'px-3 py-1.5 rounded-md font-mono text-[14px] font-medium bg-gray-100 dark:bg-white/[0.04] text-gray-400 dark:text-gray-600 border border-gray-200/60 dark:border-white/[0.05]'

  const labelClass = emphasis === 'primary'
    ? 'text-emerald-500 dark:text-emerald-400 font-medium'
    : emphasis === 'secondary'
    ? 'text-amber-400/60 dark:text-amber-400/40'
    : 'text-gray-400/70 dark:text-gray-600'

  return (
    <span className={`inline-flex items-center gap-2 text-[16px] tracking-wide`}>
      <kbd className={kbdClass}>{keys}</kbd>
      <span className={labelClass}>{label}</span>
    </span>
  )
}

function DeepWork() {
  return (
    <div className="py-16 flex flex-col items-center">
      <p className="text-[15px] font-light tracking-wide text-gray-300 dark:text-gray-600">
        Nothing needs you right now.
      </p>
    </div>
  )
}

const ALL_ENVS = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8', 'env9', 'env10']

function buildLinkPrompt(label: string, notes?: string) {
  if (notes) return `/link ${label}\n\nContext:\n${notes}`
  return `/link ${label}`
}

function EnvControls({ taskId, env, label, isLinked, visitedAt, notes, onSetEnv, onRefresh }: {
  taskId: number
  env: string | null
  label: string
  isLinked: boolean
  visitedAt: string | null
  notes?: string
  onSetEnv: (id: number, env: string | null) => void
  onRefresh: () => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const visited = !!visitedAt

  const handleAutoAssign = useCallback(() => {
    setAssigning(true)
    fetch('/api/auto-assign')
      .then(r => r.json())
      .then(data => {
        if (data.env) {
          openFleetEnv(`env${data.env}`, buildLinkPrompt(label, notes))
          onRefresh()
        }
      })
      .catch(() => {})
      .finally(() => setAssigning(false))
  }, [label, notes, onRefresh])

  const handleGoTo = useCallback(() => {
    // Set visitedAt server-side via auto-assign (which handles already-assigned case)
    fetch('/api/auto-assign')
      .then(r => r.json())
      .then(data => {
        if (data.env) {
          openFleetEnv(`env${data.env}`, isLinked ? undefined : buildLinkPrompt(label, notes))
          onRefresh()
        }
      })
      .catch(() => {})
  }, [label, notes, isLinked, onRefresh])

  return (
    <span className="relative ml-auto inline-flex items-center gap-3">
      {env ? (
        <>
          <button
            onClick={handleGoTo}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[14px] font-medium cursor-pointer transition-all ${
              !visited
                ? 'bg-emerald-500/15 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-400/40 dark:border-emerald-400/30 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)] animate-pulse'
                : isLinked
                  ? 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)] hover:text-gray-600 dark:hover:text-gray-300'
                  : 'bg-transparent text-gray-300 dark:text-gray-600 border border-dashed border-gray-300/80 dark:border-gray-600/60 hover:text-gray-500 dark:hover:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
            title={!visited ? '⌘⇧. — Go to env (not visited yet)' : isLinked ? 'Open environment' : 'Not linked — click to open env & copy /link'}
          >
            <span>{!visited ? '\u279C' : '\u2303'}</span>
            <span>{envLabel(env)}</span>
            {!visited && <span className="text-[11px] font-sans opacity-60">⌘⇧.</span>}
          </button>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-[13px] text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-pointer transition-colors"
          >
            change
          </button>
          <button
            onClick={() => onSetEnv(taskId, null)}
            className="text-[13px] text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 cursor-pointer transition-colors"
          >
            unlink
          </button>
        </>
      ) : (
        <>
          <button
            onClick={handleAutoAssign}
            disabled={assigning}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] font-medium cursor-pointer transition-all ${
              assigning
                ? 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 border border-gray-200/80 dark:border-white/[0.08]'
                : 'bg-emerald-500/15 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-400/40 dark:border-emerald-400/30 hover:bg-emerald-500/25 animate-pulse'
            }`}
            title="⌘⇧. — Auto-assign to least-busy env & go"
          >
            {assigning ? 'assigning...' : '⌘⇧. auto-assign'}
          </button>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-[13px] text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-pointer transition-colors"
          >
            pick env
          </button>
        </>
      )}
      {showPicker && (
        <div className="absolute right-0 bottom-full mb-2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2.5 flex items-center gap-2">
          {ALL_ENVS.map(e => {
            const c = ENV_COLORS[e] || ENV_COLORS.env7
            const isActive = e === env
            return (
              <button
                key={e}
                onClick={() => { onSetEnv(taskId, e); setShowPicker(false); openFleetEnv(e, buildLinkPrompt(label, notes)) }}
                className={`px-2.5 py-1 rounded-lg text-[13px] font-mono font-medium border cursor-pointer transition-colors ${
                  isActive
                    ? `${c.bg} ${c.border} ${c.text} ring-2 ring-offset-1 dark:ring-offset-gray-900`
                    : `bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border-gray-200/60 dark:border-white/[0.08]`
                }`}
              >
                {envLabel(e)}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

export function FocusQueue() {
  const [data, setData] = useState<FocusResponse | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [lastItemId, setLastItemId] = useState<number | null>(null)
  const [newItemOpen, setNewItemOpen] = useState(false)
  const [newItemFireDrill, setNewItemFireDrill] = useState(false)
  const [newItemPrefill, setNewItemPrefill] = useState('')
  const [newItemSlackRef, setNewItemSlackRef] = useState<string | null>(null)
  const [newItemActionHint, setNewItemActionHint] = useState<TriageAction | null>(null)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [retriaging, setRetriaging] = useState(false)
  const [viewLoading, setViewLoading] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [enrichOpen, setEnrichOpen] = useState(false)
  const [pinnedTaskId, setPinnedTaskId] = useState<number | null>(null)
  const [pinnedTask, setPinnedTask] = useState<PinnedTaskData | null>(null)
  const lastJsonRef = useRef('')
  const dataRef = useRef<FocusResponse | null>(null)
  const pinnedRefetchRef = useRef(0)

  const fetchQueue = useCallback(() => {
    fetch('/api/focus')
      .then(res => res.text())
      .then(text => {
        // Strip notes from comparison so typing doesn't cause jitter
        const strip = (s: string) => s.replace(/"notes":"[^"]*"/, '"notes":""')
        if (strip(text) !== strip(lastJsonRef.current)) {
          lastJsonRef.current = text
          const parsed = JSON.parse(text)
          dataRef.current = parsed
          setData(parsed)
        } else {
          lastJsonRef.current = text
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchQueue()
    const interval = setInterval(fetchQueue, 500)
    return () => clearInterval(interval)
  }, [fetchQueue])

  const {
    triggerFleet, triggerPriority, triggerPRs, triggerDeadlines, triggerActivity, triggerEnergy,
    handleRetriage: _handleRetriage, handleCreate: _handleCreate, handleUpdateTask,
    handleUnlink, handleSetEnv: _handleSetEnv, handleSaveNotes: _handleSaveNotes, handleDone,
    handleEscalate, handleAddFleetItem, handleReorder, handleReschedule: _handleReschedule,
  } = useFocusActions(fetchQueue, lastJsonRef, dataRef)

  // Wrap handleRetriage to manage local retriaging state
  const handleRetriage = useCallback((id: number) => {
    setRetriaging(true)
    fetch('/api/focus/retriage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {}).finally(() => setRetriaging(false))
  }, [fetchQueue])

  // Wrap triggerPRs to manage viewLoading state
  const triggerPRsWithLoading = useCallback(() => {
    setViewLoading('Loading PRs...')
    triggerPRs()
  }, [triggerPRs])

  // Wrap handleCreate to clear newItem state
  const handleCreate = useCallback((text: string, type?: 'fire-drill' | 'today' | 'backlog', snoozeMins?: number, pastedSlack?: SlackContext, deadline?: string, delegateOnly?: boolean, checkHours?: number, existingTaskId?: number) => {
    const currentTop = dataRef.current?.top
    const isSlack = currentTop?.kind === 'slack'
    _handleCreate(
      text, type, snoozeMins, pastedSlack, deadline, delegateOnly, checkHours, existingTaskId,
      isSlack ? currentTop!.slackRef : undefined,
      isSlack ? currentTop!.label : undefined,
      currentTop?.id,
    )
    if (delegateOnly !== undefined && (isSlack ? currentTop!.slackRef : null)) {
      setNewItemSlackRef(null)
      setNewItemActionHint(null)
    }
  }, [_handleCreate])

  // Wrap handleSetEnv to refetch pinned task
  const handleSetEnv = useCallback((id: number, env: string | null) => {
    _handleSetEnv(id, env)
    if (pinnedTaskId === id) {
      pinnedRefetchRef.current++
    }
  }, [_handleSetEnv, pinnedTaskId])

  // Wrap handleSaveNotes to refetch pinned task
  const handleSaveNotes = useCallback((id: number, notes: string) => {
    _handleSaveNotes(id, notes)
    // No refetch needed for notes — the local state is authoritative during editing
  }, [_handleSaveNotes])

  // Wrap handleReschedule to manage rescheduleOpen
  const handleReschedule = useCallback(async (text: string, confirm?: boolean) => {
    const result = await _handleReschedule(text, confirm)
    if (result.action === 'rescheduled') {
      setRescheduleOpen(false)
    }
    return result
  }, [_handleReschedule])

  // Fetch pinned task data
  useEffect(() => {
    if (!pinnedTaskId) { setPinnedTask(null); return }
    fetch(`/api/focus/task/${pinnedTaskId}`)
      .then(r => r.json())
      .then(setPinnedTask)
      .catch(() => setPinnedTask(null))
  }, [pinnedTaskId, pinnedRefetchRef.current]) // eslint-disable-line react-hooks/exhaustive-deps

  const topId = data?.top?.id ?? null
  const topKind = data?.top?.kind

  // Clear loading overlay when view data arrives
  useEffect(() => {
    if (viewLoading && topKind === 'prs') setViewLoading(null)
  }, [topKind, viewLoading])

  useEffect(() => {
    if (lastItemId !== null && topId !== lastItemId) {
      setTransitioning(true)
      const timer = setTimeout(() => {
        setTransitioning(false)
        setLastItemId(topId)
      }, 150)
      return () => clearTimeout(timer)
    }
    setLastItemId(topId)
  }, [topId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+N (new item), Cmd+J (reschedule), Cmd+Shift+C (track/create from Slack)
  // Escape — dismiss pinned card (when no other overlay is open)
  useEffect(() => {
    if (!pinnedTaskId) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !searchOpen && !newItemOpen && !rescheduleOpen) {
        e.preventDefault()
        setPinnedTaskId(null)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [pinnedTaskId, searchOpen, newItemOpen, rescheduleOpen])

  // Cmd+Shift+F (fleet), Cmd+P (priorities), Cmd+Shift+G (PRs), Cmd+Shift+' (deadlines)
  // Cmd+K (search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n') {
        e.preventDefault()
        setRescheduleOpen(false)
        setNewItemFireDrill(false)
        setNewItemPrefill('')
        setNewItemSlackRef(null)
        setNewItemActionHint(null)
        setNewItemOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setNewItemOpen(false)
        setRescheduleOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        triggerFleet()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ';') {
        e.preventDefault()
        triggerPriority()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        triggerPRsWithLoading()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "'") {
        e.preventDefault()
        triggerDeadlines()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        triggerActivity()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        triggerEnergy()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        const currentTop = dataRef.current?.top
        if (currentTop?.kind !== 'slack') return
        setRescheduleOpen(false)
        setNewItemOpen(false)
        // Use LLM-ranked actions to pre-configure the create flow
        const trackAction = currentTop.actions?.find(a => a.type === 'track' || a.type === 'watch')
        const prefill = trackAction?.taskText || currentTop.label || ''
        setNewItemFireDrill(true)
        setNewItemPrefill(prefill)
        // Auto-attach slackWatch when creating task from a Slack card
        setNewItemSlackRef(currentTop.slackRef || null)
        // If action has delegateOnly pre-set, pass it through via a data attribute
        if (trackAction) {
          setNewItemActionHint(trackAction)
        } else {
          setNewItemActionHint(null)
        }
        setTimeout(() => setNewItemOpen(true), 10)
      }
      // Cmd+Shift+Y — re-triage current slack item (fresh Slack fetch + LLM)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        const currentTop = dataRef.current?.top
        if (currentTop?.kind === 'slack' && currentTop.id) {
          handleRetriage(currentTop.id)
        }
      }
      // Cmd+Shift+. — auto-assign env (or go-to if already assigned)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '.' || e.key === '>')) {
        e.preventDefault()
        const currentTop = dataRef.current?.top
        if (currentTop?.kind === 'task') {
          const linkPrompt = buildLinkPrompt(currentTop.label, currentTop.notes)
          if (currentTop.env) {
            openFleetEnv(currentTop.env, currentTop.claudeLinks?.length ? undefined : linkPrompt)
          } else {
            fetch('/api/auto-assign')
              .then(r => r.json())
              .then(d => {
                if (d.env) {
                  openFleetEnv(`env${d.env}`, linkPrompt)
                  lastJsonRef.current = ''
                  fetchQueue()
                }
              }).catch(() => {})
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [triggerFleet, triggerPriority, triggerPRsWithLoading, triggerDeadlines, handleRetriage])

  const overlayOpen = newItemOpen || rescheduleOpen || searchOpen || enrichOpen

  if (!data || data.empty) {
    return (
      <div className="relative min-h-[1450px]">
        <TopBar
          onFleet={triggerFleet}
          onPriority={triggerPriority}
          onPRs={triggerPRsWithLoading}
          onDeadlines={triggerDeadlines}
          onActivity={triggerActivity}
          onEnergy={triggerEnergy}
          onNewItem={() => { setNewItemFireDrill(false); setNewItemPrefill(''); setNewItemOpen(true) }}
        />

        <DeepWork />
        {overlayOpen && (
          <div className="absolute inset-0 z-40 bg-black/50 dark:bg-black/60 rounded-2xl" />
        )}
        {searchOpen && (
          <FocusSearch
            onClose={() => setSearchOpen(false)}
            onPin={(id) => { setPinnedTaskId(id); setSearchOpen(false) }}
          />
        )}
        {newItemOpen && (
          <NewItemFlow
            onClose={() => { setNewItemOpen(false); setNewItemFireDrill(false); setNewItemPrefill(''); setNewItemSlackRef(null); setNewItemActionHint(null) }}
            onCreate={handleCreate}
            isCreateTask={newItemFireDrill}
            prefill={newItemPrefill}
            slackRef={newItemSlackRef}
            actionHint={newItemActionHint}
          />
        )}
        {rescheduleOpen && (
          <RescheduleInput
            onSubmit={handleReschedule}
            onClose={() => setRescheduleOpen(false)}
          />
        )}

        {/* Pinned task floating overlay */}
        {pinnedTask && (
          <div className="fixed inset-0 z-50 bg-black/50 dark:bg-black/60 flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) setPinnedTaskId(null) }}>
            <div className="w-full max-w-[600px] max-h-[85vh] overflow-y-auto px-8 pt-8 pb-8 rounded-2xl bg-white dark:bg-[#1c1c1e] shadow-[0_8px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-medium tracking-[0.12em] uppercase text-gray-400 dark:text-gray-500">
                  {pinnedTask.list} — pinned
                </span>
                <button onClick={() => setPinnedTaskId(null)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.08] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer transition-colors text-sm">✕</button>
              </div>
              <EditableTitle label={pinnedTask.text} isSlack={false} onSave={(t) => handleUpdateTask(pinnedTask.id, t)} />
              {pinnedTask.env && <EnvControls taskId={pinnedTask.id} env={pinnedTask.env} label={pinnedTask.text} isLinked={pinnedTask.claudeLinks.length > 0} visitedAt={null} notes={pinnedTask.notes || ''} onSetEnv={handleSetEnv} onRefresh={() => { lastJsonRef.current = ''; fetchQueue() }} />}
              <Scratchpad key={`pin-${pinnedTask.id}`} taskId={pinnedTask.id} initialNotes={pinnedTask.notes} onSave={handleSaveNotes} />
              <TaskConversation key={`pin-convo-${pinnedTask.id}`} taskId={pinnedTask.id} hasMessages={pinnedTask.hasConversation} />
              {pinnedTask.slackContext && pinnedTask.slackContext.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  {pinnedTask.slackContext.map((ctx) => (
                    <SlackThreadPreview key={`pin-ctx-${ctx.ref}`} ref_={ctx.ref} label={ctx.label} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const { top } = data
  const isFireDrill = top!.isFireDrill

  return (
    <div className="relative min-h-[1450px]">
      {/* Top-right buttons: fleet, priorities, new item */}
      <TopBar
        onFleet={triggerFleet}
        onPriority={triggerPriority}
        onPRs={triggerPRsWithLoading}
        onDeadlines={triggerDeadlines}
        onActivity={triggerActivity}
          onEnergy={triggerEnergy}
        onNewItem={() => { setNewItemFireDrill(false); setNewItemPrefill(''); setNewItemOpen(true) }}
        faded
      />

      {/* Loading overlay for slow view transitions (e.g. PRs) */}
      {viewLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 dark:bg-black/40 rounded-2xl">
          <span className="text-[14px] font-medium text-gray-500 dark:text-gray-400 animate-pulse">{viewLoading}</span>
        </div>
      )}

      {/* Relax card — full viewport immersive overlay */}
      {top!.kind === 'relax' && (
        <div className={`
          relative rounded-2xl min-h-[1400px] overflow-hidden select-none
          transition-all duration-700 ease-out
          ${transitioning ? 'opacity-0' : 'opacity-100'}
        `}>
          {/* Animated gradient background — slow color shift */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(160deg, #06080f 0%, #080d18 25%, #0a1428 50%, #0c1830 75%, #080e1a 100%)',
            animation: 'relax-bg-shift 30s ease-in-out infinite',
          }} />

          {/* Large aurora blobs — slow, dreamy movement */}
          <div className="relax-orb" style={{
            width: '80vw', height: '80vw', top: '-20%', right: '-20%',
            background: 'radial-gradient(circle, rgba(56,189,248,0.07) 0%, rgba(59,130,246,0.03) 35%, transparent 65%)',
            animation: 'relax-drift-1 25s ease-in-out infinite',
          }} />
          <div className="relax-orb" style={{
            width: '70vw', height: '70vw', bottom: '-15%', left: '-15%',
            background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, rgba(109,40,217,0.025) 35%, transparent 65%)',
            animation: 'relax-drift-2 20s ease-in-out infinite',
          }} />
          <div className="relax-orb" style={{
            width: '50vw', height: '50vw', top: '25%', left: '20%',
            background: 'radial-gradient(circle, rgba(52,211,153,0.045) 0%, rgba(16,185,129,0.015) 35%, transparent 65%)',
            animation: 'relax-drift-3 28s ease-in-out infinite',
          }} />
          <div className="relax-orb" style={{
            width: '60vw', height: '60vw', top: '10%', left: '50%',
            background: 'radial-gradient(circle, rgba(244,114,182,0.03) 0%, rgba(219,39,119,0.01) 35%, transparent 65%)',
            animation: 'relax-drift-4 22s ease-in-out infinite',
          }} />

          {/* Star field — three parallax layers */}
          {[
            { count: 60, sizeRange: [1, 1.5], opRange: [0.15, 0.3], speedRange: [8, 14], drift: 30 },
            { count: 40, sizeRange: [1.5, 2.5], opRange: [0.2, 0.4], speedRange: [12, 20], drift: 50 },
            { count: 15, sizeRange: [2.5, 4], opRange: [0.25, 0.5], speedRange: [18, 28], drift: 80 },
          ].map((layer, li) => (
            <div key={li} className="absolute inset-0 overflow-hidden">
              {Array.from({ length: layer.count }).map((_, i) => {
                const seed = li * 1000 + i
                const x = ((seed * 37 + 13) % 97)
                const y = ((seed * 53 + 7) % 97)
                const size = layer.sizeRange[0] + ((seed * 17) % 100) / 100 * (layer.sizeRange[1] - layer.sizeRange[0])
                const op = layer.opRange[0] + ((seed * 31) % 100) / 100 * (layer.opRange[1] - layer.opRange[0])
                const speed = layer.speedRange[0] + ((seed * 43) % 100) / 100 * (layer.speedRange[1] - layer.speedRange[0])
                const twinkle = 2 + ((seed * 23) % 100) / 100 * 4
                return (
                  <div key={i} className="relax-star" style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    width: `${size}px`,
                    height: `${size}px`,
                    opacity: op,
                    animationName: 'relax-star-drift, relax-star-twinkle',
                    animationDuration: `${speed}s, ${twinkle}s`,
                    animationTimingFunction: 'linear, ease-in-out',
                    animationIterationCount: 'infinite, infinite',
                    animationDelay: `${((seed * 11) % 100) / 10}s, ${((seed * 7) % 100) / 10}s`,
                    ['--drift' as any]: `${layer.drift}px`,
                    ['--drift-x' as any]: `${((seed * 19) % 100) - 50}px`,
                  }} />
                )
              })}
            </div>
          ))}

          {/* Content — centered, breathing */}
          <div className="relative z-10 flex flex-col items-center justify-center min-h-[1400px] gap-8">
            <div style={{ animation: 'relax-breathe 8s ease-in-out infinite' }}>
              <span className="text-[96px] font-[200] tracking-[0.2em] bg-clip-text text-transparent"
                style={{
                  backgroundImage: 'linear-gradient(135deg, rgba(148,163,184,0.5) 0%, rgba(100,116,139,0.3) 30%, rgba(139,92,246,0.25) 60%, rgba(56,189,248,0.3) 100%)',
                  backgroundSize: '200% 200%',
                  WebkitBackgroundClip: 'text',
                  animation: 'relax-gradient-text 12s ease-in-out infinite',
                }}>
                breathe
              </span>
            </div>

            <p className="text-[17px] font-extralight tracking-[0.1em] text-slate-500/40 max-w-lg text-center leading-loose"
              style={{ animation: 'relax-fade-in 3s ease-out' }}>
              all priority items handled · agents working
            </p>

            <div className="absolute bottom-12 flex flex-col items-center gap-3"
              style={{ animation: 'relax-fade-in 5s ease-out' }}>
              <span className="text-[10px] tracking-[0.25em] uppercase text-slate-700/25">
                ⌘⇧D snooze 30m · drag marker to adjust waterline
              </span>
            </div>
          </div>

          <style>{`
            .relax-orb {
              position: absolute;
              border-radius: 50%;
              will-change: transform;
              filter: blur(100px);
            }
            .relax-star {
              position: absolute;
              border-radius: 50%;
              background: radial-gradient(circle, rgba(220,230,255,0.9) 0%, rgba(180,200,255,0.4) 40%, transparent 70%);
              box-shadow: 0 0 3px rgba(180,200,255,0.3);
            }
            @keyframes relax-star-drift {
              0% { transform: translate(0, 0); }
              25% { transform: translate(var(--drift-x), calc(var(--drift) * -0.5)); }
              50% { transform: translate(calc(var(--drift-x) * -0.7), calc(var(--drift) * -1)); }
              75% { transform: translate(calc(var(--drift-x) * 0.5), calc(var(--drift) * -0.3)); }
              100% { transform: translate(0, 0); }
            }
            @keyframes relax-star-twinkle {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
            @keyframes relax-bg-shift {
              0%, 100% { filter: hue-rotate(0deg) brightness(1); }
              50% { filter: hue-rotate(15deg) brightness(1.05); }
            }
            @keyframes relax-drift-1 {
              0%, 100% { transform: translate(0, 0) scale(1); }
              25% { transform: translate(-40px, 30px) scale(1.12); }
              50% { transform: translate(-20px, -20px) scale(0.95); }
              75% { transform: translate(30px, 10px) scale(1.05); }
            }
            @keyframes relax-drift-2 {
              0%, 100% { transform: translate(0, 0) scale(1); }
              30% { transform: translate(50px, -35px) scale(1.1); }
              60% { transform: translate(-30px, 25px) scale(0.9); }
            }
            @keyframes relax-drift-3 {
              0%, 100% { transform: translate(0, 0) scale(1); }
              40% { transform: translate(-35px, -40px) scale(1.08); }
              70% { transform: translate(25px, 30px) scale(0.94); }
            }
            @keyframes relax-drift-4 {
              0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
              35% { transform: translate(-45px, 20px) scale(1.06) rotate(3deg); }
              65% { transform: translate(30px, -25px) scale(0.96) rotate(-2deg); }
            }
            @keyframes relax-breathe {
              0%, 100% { opacity: 0.4; transform: scale(1) translateY(0); }
              50% { opacity: 0.75; transform: scale(1.03) translateY(-4px); }
            }
            @keyframes relax-gradient-text {
              0%, 100% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
            }
            @keyframes relax-float {
              0% { transform: translateY(0) translateX(0); opacity: 0; }
              10% { opacity: 1; }
              90% { opacity: 1; }
              100% { transform: translateY(-100px) translateX(20px); opacity: 0; }
            }
            @keyframes relax-fade-in {
              0% { opacity: 0; transform: translateY(10px); }
              100% { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}

      <div className={`
        relative px-8 pt-14 pb-8 rounded-2xl ${top!.kind === 'fleet' || top!.kind === 'priority-sort' || top!.kind === 'prs' || top!.kind === 'deadlines' ? 'min-h-[700px]' : ''}
        bg-white dark:bg-[#1c1c1e]
        ${isFireDrill ? 'border-2 border-red-300/60 dark:border-red-500/30' : 'border border-gray-100/80 dark:border-white/[0.06]'}
        shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_2px_8px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.04)]
        dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_2px_8px_rgba(0,0,0,0.2),0_12px_40px_rgba(0,0,0,0.3)]
        transition-all duration-300 ease-out
        ${transitioning ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}
        ${overlayOpen ? 'opacity-0 pointer-events-none' : ''}
        ${top!.kind === 'relax' ? 'hidden' : ''}
      `}>
        {/* Action verb */}
        <div className="mb-4">
          <span className={`text-[13px] font-semibold tracking-[0.12em] uppercase ${
            isFireDrill ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'
          }`}>
            {isFireDrill ? 'Fire drill' : top!.actionVerb}
          </span>
        </div>

        {/* Main text + env pill + alerts */}
        {(() => {
          const envKey = top!.env || null
          const envLinked = (top!.claudeLinks && top!.claudeLinks.length > 0) || false
          const alerts = evaluateAlerts(top!)
          return (
            <>
              <div className="flex items-center gap-3">
                <EditableTitle
                  label={top!.label}
                  isSlack={top!.kind === 'slack'}
                  onSave={(newText) => handleUpdateTask(top!.id, newText)}
                />
                {alerts.map((alert, i) => {
                  const s = alertStyle(alert.severity)
                  return (
                    <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg ${s.bg} border ${s.border} text-[12px] font-medium ${s.text}`}>
                      {alert.text}
                    </span>
                  )
                })}
                {envKey && (() => {
                  const colors = ENV_COLORS[envKey] || ENV_COLORS.env7
                  return (
                    <span
                      onClick={() => openFleetEnv(envKey, envLinked ? undefined : `/link ${top!.label}`)}
                      title={envLinked ? 'Open environment' : 'Not linked — click to open env & copy /link'}
                      className={envLinked
                        ? `inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg cursor-pointer hover:opacity-80 transition-opacity ${colors.bg} border ${colors.border} text-[15px] font-medium ${colors.text}`
                        : `inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg cursor-pointer hover:opacity-80 transition-opacity bg-transparent border border-dashed ${colors.border} text-[15px] font-medium ${colors.text} opacity-50 hover:opacity-70`
                      }
                    >
                      <span className="font-mono text-[16px]">&#x2303;</span>
                      <span className="font-mono">{envLabel(envKey)}</span>
                    </span>
                  )
                })()}
              </div>
              {top!.sublabel && !top!.sublabel.match(/env\d+/) && (
                <p className="mt-2 text-[19px] font-normal text-gray-400 dark:text-gray-500">
                  {top!.sublabel}
                </p>
              )}
            </>
          )
        })()}

        {/* Scratchpad — free-form notes for task items */}
        {top!.kind === 'task' && (
          <Scratchpad key={top!.id} taskId={top!.id} initialNotes={top!.notes || ''} onSave={handleSaveNotes} />
        )}

        {/* Task conversation — expandable LLM chat */}
        {top!.kind === 'task' && (
          <TaskConversation key={`convo-${top!.id}`} taskId={top!.id} hasMessages={!!top!.hasConversation} />
        )}

        {/* LLM suggestion — above Slack panel unless first action is track */}
        {top!.kind === 'slack' && (top!.suggestion || retriaging) && top!.actions?.[0]?.type !== 'track' && top!.actions?.[0]?.type !== 'watch' && (
          <div className="mt-4 flex items-start gap-3">
            <p className={`text-[21px] text-gray-700 dark:text-gray-200 leading-relaxed flex-1 ${retriaging ? 'opacity-50' : ''}`}>
              {retriaging ? 'Re-analyzing...' : top!.suggestion}
            </p>
          </div>
        )}

        {/* Slack thread preview — above hotkeys so user sees context first */}
        {top!.kind === 'slack' && top!.slackRef && (() => {
          const isEmphasized = top!.slackPanelEmphasis === 'emphasized'
          // Extract channel name from label (strip # prefix)
          const rawLabel = top!.channelLabel || top!.from || 'Slack'
          const chName = rawLabel.startsWith('#') ? rawLabel.slice(1) : undefined
          return (
            <div className={`mt-6 transition-opacity duration-300 ${isEmphasized ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
              style={isEmphasized ? { borderLeft: '3px solid rgb(59 130 246 / 0.5)', paddingLeft: '12px' } : undefined}
            >
              <SlackThreadPreview
                key={`slack-${top!.id}`}
                ref_={top!.slackRef!}
                label={rawLabel}
                context={top!.context || undefined}
                channelName={chName}
                defaultExpanded
                draftReply={top!.draftReply || null}
                keyMessageTs={top!.keyMessageTs || null}
              />
            </div>
          )
        })()}

        {/* LLM suggestion — below Slack panel when first action is track */}
        {top!.kind === 'slack' && (top!.suggestion || retriaging) && (top!.actions?.[0]?.type === 'track' || top!.actions?.[0]?.type === 'watch') && (
          <div className="mt-4 flex items-start gap-3">
            <p className={`text-[21px] text-gray-700 dark:text-gray-200 leading-relaxed flex-1 ${retriaging ? 'opacity-50' : ''}`}>
              {retriaging ? 'Re-analyzing...' : top!.suggestion}
            </p>
          </div>
        )}

        {/* Hotkey hints — below Slack context for slack cards */}
        {top!.kind === 'slack' && (() => {
          const em = top!.emphasizedHotkeys || []
          const emphasisOf = (label: string): HotkeyEmphasis =>
            em[0] === label ? 'primary' : em[1] === label ? 'secondary' : 'default'
          const snoozeMins = data?.snoozeMinutes || 30
          const allHotkeys: { keys: string; label: string }[] = [
            { keys: '\u2318\u21e7D', label: 'done' },
            { keys: '\u2318\u21e7E', label: `snooze ${snoozeMins}m` },
            { keys: '\u2318J', label: 'reschedule' },
            { keys: '\u2318\u21e7C', label: 'track' },
            { keys: '\u2318\u21e7Y', label: 'refresh' },
          ]
          const rank = { primary: 0, secondary: 1, default: 2 }
          const sorted = [...allHotkeys].sort((a, b) =>
            rank[emphasisOf(a.label)] - rank[emphasisOf(b.label)]
          )
          return (
            <div className="mt-6 flex items-center gap-5">
              {sorted.map(h => (
                <HotkeyHint key={h.label} keys={h.keys} label={h.label} emphasis={emphasisOf(h.label)} />
              ))}
            </div>
          )
        })()}

        {/* Pipeline status + env health — parallel columns */}
        {top!.kind === 'task' && (top!.pipelineStatus || top!.envHealth) && (
          <div className="mt-4 flex gap-8">
            {top!.pipelineStatus && (
              <div className="flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-1 text-gray-600">pipeline</div>
                <PipelineStatusBar status={top!.pipelineStatus} next={top!.pipelineNext || null} />
              </div>
            )}
            {top!.envHealth && (
              <div className="flex-1">
                <EnvHealthBar status={top!.envHealth} />
              </div>
            )}
          </div>
        )}

        {/* Energy check — value-weighted day blocks */}
        {top!.kind === 'energy' && (
          <div className="mt-6">
            <EnergyBar />
          </div>
        )}

        {/* Prep view — next sessions with editable notes */}
        {top!.kind === 'prep' && top!.prepItems && (
          <PrepView items={top!.prepItems} />
        )}

        {/* Fleet view */}
        {top!.kind === 'fleet' && top!.fleet && (
          <FleetView fleet={top!.fleet} onSave={handleUpdateTask} onUnlink={handleUnlink} onDone={handleDone} onEscalate={handleEscalate} onAdd={handleAddFleetItem} onReorder={handleReorder} />
        )}

        {/* PR dashboard view */}
        {top!.kind === 'prs' && top!.prs && (
          <PRView prs={top!.prs} />
        )}

        {/* Deadline view */}
        {top!.kind === 'deadlines' && top!.deadlineItems && (
          <DeadlineView items={top!.deadlineItems} onSetDeadline={(id, deadline) => {
            fetch(`/api/todos/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deadline }),
            }).then(() => { lastJsonRef.current = ''; fetchQueue() }).catch(() => {})
          }} onDone={handleDone} />
        )}

        {/* Priority sort view */}
        {top!.kind === 'priority-sort' && top!.priorityTasks && (
          <PrioritySortView tasks={top!.priorityTasks} onReorder={handleReorder} onDone={handleDone} onSetDeadline={(id, deadline) => {
            fetch(`/api/todos/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deadline }),
            }).then(() => { lastJsonRef.current = ''; fetchQueue() }).catch(() => {})
          }} onRename={handleUpdateTask} />
        )}

        {/* Relax overlay — intentionally empty, rendered as full card below */}

        {/* Activity log view */}
        {top!.kind === 'activity' && top!.activityEntries && (
          <ActivityView entries={top!.activityEntries} />
        )}

        {/* Rescheduled indicator */}
        {top!.rescheduledUntilMs && (() => {
          const d = new Date(top!.rescheduledUntilMs)
          const now = new Date()
          const ny = (dt: Date) => dt.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
          const sameDay = ny(d) === ny(now)
          const timeStr = d.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
          })
          const dateStr = d.toLocaleDateString('en-US', {
            timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })
          return (
            <p className={`mt-2 font-normal text-amber-500/70 dark:text-amber-400/50 ${sameDay ? 'text-[15px]' : 'text-[12px]'}`}>
              {sameDay ? timeStr : dateStr}
            </p>
          )
        })()}

        {/* Slack context — collapsible thread previews */}
        {top!.kind === 'task' && top!.slackContext && top!.slackContext.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {top!.slackContext.map((ctx) => (
              <SlackThreadPreview key={`ctx-${ctx.ref}`} ref_={ctx.ref} label={ctx.label} />
            ))}
          </div>
        )}

        {/* Watched thread inline preview */}
        {top!.kind === 'task' && top!.slackWatch?.surfaceReason === 'activity' && top!.slackWatch.ref && (
          <div className="mt-4">
            <SlackThreadPreview
              key={`watch-${top!.slackWatch.ref}`}
              ref_={top!.slackWatch.ref}
              label="Watched thread"
              defaultExpanded
            />
          </div>
        )}

        {/* Enrich from Slack — task cards only */}
        {top!.kind === 'task' && !top!.notes && (
          <button
            onClick={() => setEnrichOpen(true)}
            className="mt-4 flex items-center gap-2 text-[13px] text-gray-400 hover:text-purple-500 transition-colors"
            title="Search Slack for context about this task"
          >
            <SlackIcon />
            <span>Enrich from Slack</span>
          </button>
        )}

        {/* Hotkey hints + env controls — only for non-slack cards (slack hotkeys are above) */}
        {top!.kind !== 'slack' && (() => {
          const em = top!.emphasizedHotkeys || (top!.kind === 'task' ? ['done'] : [])
          const emphasisOf = (label: string): HotkeyEmphasis =>
            em[0] === label ? 'primary' : em[1] === label ? 'secondary' : 'default'
          const snoozeMins = data?.snoozeMinutes || 30
          const allHotkeys: { keys: string; label: string }[] = [
            { keys: '\u2318\u21e7D', label: 'done' },
            { keys: '\u2318\u21e7E', label: `snooze ${snoozeMins}m` },
            { keys: '\u2318J', label: 'reschedule' },
          ]
          const rank = { primary: 0, secondary: 1, default: 2 }
          const sorted = [...allHotkeys].sort((a, b) =>
            rank[emphasisOf(a.label)] - rank[emphasisOf(b.label)]
          )
          const taskEnv = top!.kind === 'task' ? (top!.env || null) : null
          const hasEnvControls = top!.kind === 'task'
          return (
            <div className="mt-8 flex items-center gap-5">
              {sorted.map(h => (
                <HotkeyHint key={h.label} keys={h.keys} label={h.label} emphasis={emphasisOf(h.label)} />
              ))}
              {hasEnvControls && (
                <EnvControls
                  taskId={top!.id}
                  env={taskEnv}
                  label={top!.label}
                  isLinked={!!(top!.claudeLinks && top!.claudeLinks.length > 0)}
                  visitedAt={top!.visitedAt || null}
                  notes={top!.notes || ''}
                  onSetEnv={handleSetEnv}
                  onRefresh={() => { lastJsonRef.current = ''; fetchQueue() }}
                />
              )}
            </div>
          )
        })()}
        {/* (Slack thread preview moved above hotkeys) */}
      </div>

      {/* Overlay backdrop */}
      {overlayOpen && (
        <div className="absolute inset-0 z-40 bg-black/50 dark:bg-black/60 rounded-2xl" />
      )}

      {/* Slack enrich overlay */}
      {enrichOpen && top && (
        <EnrichOverlay
          taskId={top.id}
          taskText={top.label}
          onClose={() => setEnrichOpen(false)}
          onApplied={() => { lastJsonRef.current = ''; fetchQueue() }}
        />
      )}

      {/* Cmd+K search overlay */}
      {searchOpen && (
        <FocusSearch
          onClose={() => setSearchOpen(false)}
          onPin={(id) => { setPinnedTaskId(id); setSearchOpen(false) }}
        />
      )}

      {/* Cmd+N new item overlay */}
      {newItemOpen && (
        <NewItemFlow
          onClose={() => { setNewItemOpen(false); setNewItemFireDrill(false); setNewItemPrefill(''); setNewItemSlackRef(null); setNewItemActionHint(null) }}
          onCreate={handleCreate}
          isCreateTask={newItemFireDrill}
          prefill={newItemPrefill}
          slackRef={newItemSlackRef}
          actionHint={newItemActionHint}
        />
      )}

      {/* Cmd+J reschedule overlay */}
      {rescheduleOpen && (
        <RescheduleInput
          onSubmit={handleReschedule}
          onClose={() => setRescheduleOpen(false)}
        />
      )}

      {/* Pinned task floating overlay */}
      {pinnedTask && (
        <div className="fixed inset-0 z-50 bg-black/50 dark:bg-black/60 flex items-center justify-center" onClick={(e) => { if (e.target === e.currentTarget) setPinnedTaskId(null) }}>
          <div className="w-full max-w-[600px] max-h-[85vh] overflow-y-auto px-8 pt-8 pb-8 rounded-2xl bg-white dark:bg-[#1c1c1e] shadow-[0_8px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-medium tracking-[0.12em] uppercase text-gray-400 dark:text-gray-500">
                {pinnedTask.list} — pinned
              </span>
              <button onClick={() => setPinnedTaskId(null)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.08] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer transition-colors text-sm">✕</button>
            </div>
            <EditableTitle label={pinnedTask.text} isSlack={false} onSave={(t) => handleUpdateTask(pinnedTask.id, t)} />
            {pinnedTask.env && <EnvControls taskId={pinnedTask.id} env={pinnedTask.env} label={pinnedTask.text} isLinked={pinnedTask.claudeLinks.length > 0} visitedAt={null} notes={pinnedTask.notes || ''} onSetEnv={handleSetEnv} onRefresh={() => { lastJsonRef.current = ''; fetchQueue() }} />}
            <Scratchpad key={`pin-${pinnedTask.id}`} taskId={pinnedTask.id} initialNotes={pinnedTask.notes} onSave={handleSaveNotes} />
            <TaskConversation key={`pin-convo-${pinnedTask.id}`} taskId={pinnedTask.id} hasMessages={pinnedTask.hasConversation} />
            {pinnedTask.slackContext && pinnedTask.slackContext.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {pinnedTask.slackContext.map((ctx) => (
                  <SlackThreadPreview key={`pin-ctx-${ctx.ref}`} ref_={ctx.ref} label={ctx.label} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
