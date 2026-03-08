import { useEffect, useState, useCallback, useRef } from 'react'
import { FocusSearch } from './FocusSearch'
import { RescheduleInput } from './RescheduleInput'
import { evaluateAlerts, alertStyle } from './focusAlerts'

interface ClaudeLink {
  label: string
  ref: string
  idx: number
}

interface FleetTask {
  id: number; text: string; list: string; status: string; escalation: number;
  hasClaudeLink: boolean; claudeLinks: ClaudeLink[];
}

interface FleetEnv {
  env: string
  tasks: FleetTask[]
}

interface FocusResponse {
  empty: boolean
  depth: number
  top?: {
    id: number
    kind: string
    label: string
    sublabel?: string
    actionVerb: string
    rescheduledUntilMs?: number
    rescheduledReason?: string
    emphasizedHotkeys?: string[]
    fleet?: FleetEnv[]
  }
}

type HotkeyEmphasis = 'primary' | 'secondary' | 'default'

function HotkeyHint({ keys, label, emphasis = 'default' }: { keys: string; label: string; emphasis?: HotkeyEmphasis }) {
  const kbdClass = emphasis === 'primary'
    ? 'px-2.5 py-1 rounded-md font-mono text-[12px] font-medium bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-400/20 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'
    : emphasis === 'secondary'
    ? 'px-2.5 py-1 rounded-md font-mono text-[12px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-200/60 dark:border-amber-400/15 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'
    : 'px-2.5 py-1 rounded-md font-mono text-[12px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'

  const labelClass = emphasis === 'primary'
    ? 'text-emerald-500 dark:text-emerald-400'
    : emphasis === 'secondary'
    ? 'text-amber-400 dark:text-amber-400/70'
    : 'text-gray-300 dark:text-gray-600'

  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] tracking-wide`}>
      <kbd className={kbdClass}>{keys}</kbd>
      <span className={labelClass}>{label}</span>
    </span>
  )
}

const ENV_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  env1: { bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-200/60 dark:border-red-400/20', text: 'text-red-600 dark:text-red-400' },
  env2: { bg: 'bg-orange-50 dark:bg-orange-500/10', border: 'border-orange-200/60 dark:border-orange-400/20', text: 'text-orange-600 dark:text-orange-400' },
  env3: { bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200/60 dark:border-amber-400/20', text: 'text-amber-600 dark:text-amber-400' },
  env4: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200/60 dark:border-emerald-400/20', text: 'text-emerald-600 dark:text-emerald-400' },
  env5: { bg: 'bg-teal-50 dark:bg-teal-500/10', border: 'border-teal-200/60 dark:border-teal-400/20', text: 'text-teal-600 dark:text-teal-400' },
  env6: { bg: 'bg-blue-50 dark:bg-blue-500/10', border: 'border-blue-200/60 dark:border-blue-400/20', text: 'text-blue-600 dark:text-blue-400' },
  env7: { bg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'border-indigo-200/60 dark:border-indigo-400/20', text: 'text-indigo-600 dark:text-indigo-400' },
  env8: { bg: 'bg-purple-50 dark:bg-purple-500/10', border: 'border-purple-200/60 dark:border-purple-400/20', text: 'text-purple-600 dark:text-purple-400' },
}

function StyledTaskText({ text }: { text: string }) {
  const parts = text.split(/(\([^)]*\)|\[[^\]]*\])/)
  return (
    <>
      {parts.map((part, i) =>
        /^[\(\[]/.test(part)
          ? <span key={i} className="font-medium text-gray-600 dark:text-gray-300">{part}</span>
          : <span key={i} className="font-normal text-gray-400 dark:text-gray-500">{part}</span>
      )}
    </>
  )
}

const REMOTE_ENVS: Record<string, { space: number }> = {
  env5: { space: 5 }, env6: { space: 6 }, env7: { space: 7 }, env8: { space: 8 },
}

function showToast(message: string, duration = 10000) {
  const el = document.createElement('div')
  el.textContent = message
  Object.assign(el.style, {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    background: '#1e1e2e', color: '#cdd6f4', padding: '10px 20px',
    borderRadius: '8px', fontSize: '13px', fontWeight: '500',
    zIndex: '9999', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'opacity 0.3s', opacity: '1',
  })
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, duration)
}

function openFleetEnv(env: string, copyPrompt?: string) {
  const remote = REMOTE_ENVS[env]
  if (remote) {
    if (copyPrompt) {
      navigator.clipboard.writeText(copyPrompt).catch(() => {})
      showToast(`⌃${remote.space} to switch · /link copied`)
    } else {
      showToast(`⌃${remote.space} to switch`)
    }
    return
  }
  const path = `/home/ubuntu/${env}.code-workspace`
  const host = import.meta.env.VITE_SSH_HOST || 'dev-vm'
  const uri = `cursor://vscode-remote/ssh-remote+${host}${path}`
  window.location.href = uri
  if (copyPrompt) {
    navigator.clipboard.writeText(copyPrompt).catch(() => {})
  }
}

const ESCALATION_COLORS = [
  '', // 0 = none
  'text-amber-500 dark:text-amber-400',   // !
  'text-red-500 dark:text-red-400',        // !!
  'text-fuchsia-500 dark:text-fuchsia-400', // !!!
]

function EditableFleetItem({ task, env, onSave, onUnlink, onDone, onEscalate }: {
  task: FleetTask; env: string;
  onSave: (id: number, text: string) => void;
  onUnlink: (id: number, linkIdx: number) => void;
  onDone: (id: number) => void;
  onEscalate: (id: number, level: number) => void;
}) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const [showPopover, setShowPopover] = useState(false)
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const save = () => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== task.text) onSave(task.id, trimmed)
    else setEditText(task.text)
    setEditing(false)
  }

  const handleCodeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (task.hasClaudeLink) {
      setShowPopover(prev => !prev)
    } else {
      const cmd = `/link ${task.text}`
      navigator.clipboard.writeText(cmd).catch(() => {})
      showToast(`/link copied — paste into Claude Code (${env})`)
    }
  }

  const handlePopoverEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }
  const handlePopoverLeave = () => {
    hideTimer.current = setTimeout(() => setShowPopover(false), 200)
  }

  return (
    <div
      className={`flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg transition-colors ${
        editing ? 'bg-gray-100 dark:bg-white/[0.08]' : ''
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editing ? (
        <>
          <span className="w-[18px] h-[18px] rounded-[4px] border-[1.5px] border-gray-300 dark:border-gray-600 shrink-0" />
          <input
            ref={inputRef}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onBlur={save}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); save() }
              if (e.key === 'Escape') { setEditText(task.text); setEditing(false) }
            }}
            className="flex-1 text-[21px] bg-transparent outline-none text-gray-600 dark:text-gray-300 min-w-0"
          />
        </>
      ) : (
        <span
          className="flex-1 flex items-center gap-2 text-[21px] truncate cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.04] rounded-md px-3 py-1.5 -mx-1 transition-colors"
          onClick={() => { setEditText(task.text); setEditing(true) }}
        >
          {/* Checkbox — click to mark done */}
          <span
            className="w-[18px] h-[18px] rounded-[4px] border-[1.5px] border-gray-300 dark:border-gray-600 shrink-0 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onDone(task.id) }}
            title="Mark done"
          />
          <StyledTaskText text={task.text} />
        </span>
      )}
      {/* Escalation buttons — inline, show on hover or when active */}
      <span className="flex items-center gap-0.5 shrink-0">
        {[1, 2, 3].map(level => {
          const active = task.escalation === level
          const visible = active || hovered
          return (
            <button
              key={level}
              onClick={(e) => { e.stopPropagation(); onEscalate(task.id, active ? 0 : level) }}
              className={`px-1.5 py-0.5 rounded text-[19px] font-bold cursor-pointer transition-all ${
                active
                  ? `${ESCALATION_COLORS[level]}`
                  : visible
                    ? 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400'
                    : 'opacity-0 pointer-events-none'
              }`}
              title={`Escalation ${level}`}
            >
              {'!'.repeat(level)}
            </button>
          )
        })}
      </span>
      {/* Claude Code link button — separate hover zone */}
      <span className="relative shrink-0" onMouseLeave={handlePopoverLeave}>
        <button
          onClick={handleCodeClick}
          onMouseEnter={handlePopoverEnter}
          className={`p-2.5 rounded-md transition-colors cursor-pointer ${
            task.hasClaudeLink
              ? 'text-amber-400/40 dark:text-amber-500/30 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
              : 'text-gray-300/25 dark:text-gray-700/40 hover:text-gray-400 dark:hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
          }`}
          title={task.hasClaudeLink ? 'View linked sessions' : 'Copy /link command'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M16.358 4.666l-4.324 14.669-2.063-.608 4.324-14.67 2.063.609zM19.4 7.2l4.2 4.8-4.2 4.8-1.5-1.312L21.55 12l-3.65-3.488L19.4 7.2zM4.6 7.2l-4.2 4.8 4.2 4.8 1.5-1.312L2.45 12l3.65-3.488L4.6 7.2z" fill="currentColor"/>
          </svg>
        </button>
        {showPopover && task.claudeLinks.length > 0 && (
          <div
            className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1.5 min-w-[280px] max-w-[400px]"
            onMouseEnter={handlePopoverEnter}
            onMouseLeave={handlePopoverLeave}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-1.5 text-[12px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">
              Linked sessions
            </div>
            {task.claudeLinks.map((link) => (
              <div
                key={link.idx}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 group/link cursor-pointer"
                onClick={() => { openFleetEnv(env); setShowPopover(false) }}
              >
                <span className="shrink-0 text-amber-500 dark:text-amber-400 opacity-70">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M16.358 4.666l-4.324 14.669-2.063-.608 4.324-14.67 2.063.609zM19.4 7.2l4.2 4.8-4.2 4.8-1.5-1.312L21.55 12l-3.65-3.488L19.4 7.2zM4.6 7.2l-4.2 4.8 4.2 4.8 1.5-1.312L2.45 12l3.65-3.488L4.6 7.2z" fill="currentColor"/>
                  </svg>
                </span>
                <span className="flex-1 text-[15px] text-gray-600 dark:text-gray-300 truncate">
                  {link.label || link.ref}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onUnlink(task.id, link.idx); setShowPopover(false) }}
                  className="text-[13px] text-gray-300 hover:text-red-400 opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0"
                  title="Unlink"
                >
                  &#x2715;
                </button>
              </div>
            ))}
          </div>
        )}
      </span>
    </div>
  )
}

function FleetAddInput({ env, onAdd }: { env: string; onAdd: (text: string, env: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed) onAdd(trimmed, env)
    setText('')
    setAdding(false)
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex items-center gap-2 px-3 py-2 -mx-1 text-[21px] text-gray-200/60 dark:text-gray-700/50 hover:text-gray-400 dark:hover:text-gray-500 transition-colors cursor-pointer rounded-md hover:bg-gray-50 dark:hover:bg-white/[0.04]"
      >
        <span className="text-[24px] leading-none">+</span>
        <span>add item</span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 -mx-1">
      <span className="w-[18px] h-[18px] rounded-[4px] border-[1.5px] border-gray-300 dark:border-gray-600 shrink-0" />
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={submit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { setText(''); setAdding(false) }
        }}
        placeholder="New item..."
        className="flex-1 text-[21px] bg-transparent outline-none text-gray-600 dark:text-gray-300 placeholder-gray-300 dark:placeholder-gray-600 min-w-0"
      />
    </div>
  )
}

function FleetEmptyInput({ env, onAdd }: { env: string; onAdd: (text: string, env: string) => void }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed) { onAdd(trimmed, env); setText('') }
  }

  return (
    <div className="px-3 py-2.5">
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { setText('') }
        }}
        placeholder="—"
        className="w-full text-[21px] bg-transparent outline-none text-gray-600 dark:text-gray-300 placeholder-gray-300 dark:placeholder-gray-700 min-w-0"
      />
    </div>
  )
}

function FleetEnvCell({ n, tasks, onSave, onUnlink, onDone, onEscalate, onAdd }: {
  n: number; tasks: FleetTask[];
  onSave: (id: number, text: string) => void;
  onUnlink: (id: number, linkIdx: number) => void;
  onDone: (id: number) => void;
  onEscalate: (id: number, level: number) => void;
  onAdd: (text: string, env: string) => void;
}) {
  const env = `env${n}`
  const colors = ENV_COLORS[env] || ENV_COLORS.env7
  return (
    <div className={`flex gap-3 items-start min-w-0 rounded-lg px-2 py-2 ${
      tasks.length === 0 ? 'bg-gray-50 dark:bg-white/[0.03]' : ''
    }`}>
      <span className={`
        inline-flex items-center gap-1 px-2.5 py-1 rounded-lg shrink-0 mt-[11px]
        ${colors.bg} border ${colors.border}
        text-[15px] font-medium font-mono ${colors.text}
      `}>
        <span className="text-[16px]">⌃</span>
        {n}
      </span>
      <div className="flex-1 min-w-0">
        {tasks.length === 0 ? (
          <FleetEmptyInput env={env} onAdd={onAdd} />
        ) : (
          <>
            {tasks.map(t => (
              <EditableFleetItem key={t.id} task={t} env={env} onSave={onSave} onUnlink={onUnlink} onDone={onDone} onEscalate={onEscalate} />
            ))}
            {tasks.length < 3 && (
              <FleetAddInput env={env} onAdd={onAdd} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FleetView({ fleet, onSave, onUnlink, onDone, onEscalate, onAdd }: {
  fleet: FleetEnv[];
  onSave: (id: number, text: string) => void;
  onUnlink: (id: number, linkIdx: number) => void;
  onDone: (id: number) => void;
  onEscalate: (id: number, level: number) => void;
  onAdd: (text: string, env: string) => void;
}) {
  const fleetMap = new Map(fleet.map(f => [f.env, f.tasks]))
  return (
    <div className="space-y-2 mt-4">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
        <FleetEnvCell key={n} n={n} tasks={fleetMap.get(`env${n}`) || []} onSave={onSave} onUnlink={onUnlink} onDone={onDone} onEscalate={onEscalate} onAdd={onAdd} />
      ))}
    </div>
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

export function FocusQueue() {
  const [data, setData] = useState<FocusResponse | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [lastItemId, setLastItemId] = useState<number | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const lastJsonRef = useRef('')

  const fetchQueue = useCallback(() => {
    fetch('/api/focus')
      .then(res => res.text())
      .then(text => {
        if (text !== lastJsonRef.current) {
          lastJsonRef.current = text
          setData(JSON.parse(text))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchQueue()
    const interval = setInterval(fetchQueue, 500)
    return () => clearInterval(interval)
  }, [fetchQueue])

  const topId = data?.top?.id ?? null

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

  // Cmd+K (search) and Cmd+J (reschedule) listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setRescheduleOpen(false)
        setSearchOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setSearchOpen(false)
        setRescheduleOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handlePromote = useCallback((id: number) => {
    fetch('/api/focus/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => {
      lastJsonRef.current = '' // Force refresh
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleCreate = useCallback((text: string) => {
    fetch('/api/focus/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(() => {
      lastJsonRef.current = '' // Force refresh
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleUpdateTask = useCallback((id: number, text: string) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleUnlink = useCallback((id: number, linkIdx: number) => {
    fetch(`/api/todos/${id}/links/${linkIdx}`, { method: 'DELETE' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleDone = useCallback((id: number) => {
    fetch(`/api/todos/${id}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleEscalate = useCallback((id: number, level: number) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalation: level }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleAddFleetItem = useCallback((text: string, env: string) => {
    fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, list: 'daily-goals', env }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleReschedule = useCallback(async (text: string, confirm?: boolean) => {
    const res = await fetch('/api/focus/reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, confirm }),
    })
    const result = await res.json()
    if (!result.success) throw new Error(result.reason)
    if (result.action === 'rescheduled') {
      lastJsonRef.current = '' // Force refresh
      setRescheduleOpen(false)
      fetchQueue()
    }
    return result
  }, [fetchQueue])

  const overlayOpen = searchOpen || rescheduleOpen

  if (!data || data.empty) {
    return (
      <div className="relative min-h-[1450px]">
        <DeepWork />
        {searchOpen && (
          <FocusSearch
            onClose={() => setSearchOpen(false)}
            onPromote={handlePromote}
            onCreate={handleCreate}
          />
        )}
        {rescheduleOpen && (
          <RescheduleInput
            onSubmit={handleReschedule}
            onClose={() => setRescheduleOpen(false)}
          />
        )}
      </div>
    )
  }

  const { top } = data
  const isTask = top!.kind === 'task'

  return (
    <div className="relative min-h-[1450px]">
      <div className={`
        relative px-8 pt-8 pb-6 rounded-2xl ${top!.kind === 'fleet' ? 'min-h-[700px]' : 'min-h-[280px]'}
        bg-white dark:bg-[#1c1c1e]
        border border-gray-100/80 dark:border-white/[0.06]
        shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_2px_8px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.04)]
        dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_2px_8px_rgba(0,0,0,0.2),0_12px_40px_rgba(0,0,0,0.3)]
        transition-all duration-300 ease-out
        ${transitioning ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}
        ${overlayOpen ? 'opacity-0 pointer-events-none' : ''}
      `}>
        {/* Action verb */}
        <div className="mb-4">
          <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-400 dark:text-gray-500">
            {top!.actionVerb}
          </span>
        </div>

        {/* Main text + env pill + alerts */}
        {(() => {
          const envMatch = top!.sublabel?.match(/env(\d+)/)
          const alerts = evaluateAlerts(top!)
          return (
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] leading-[1.35] font-medium text-gray-800 dark:text-gray-100">
                {top!.label}
              </h1>
              {alerts.map((alert, i) => {
                const s = alertStyle(alert.severity)
                return (
                  <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg ${s.bg} border ${s.border} text-[12px] font-medium ${s.text}`}>
                    {alert.text}
                  </span>
                )
              })}
              {envMatch && (() => {
                const colors = ENV_COLORS[`env${envMatch[1]}`] || ENV_COLORS.env7
                return (
                  <span className={`
                    inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg
                    ${colors.bg} border ${colors.border}
                    text-[15px] font-medium ${colors.text}
                  `}>
                    <span className="font-mono text-[16px]">⌃</span>
                    <span className="font-mono">{envMatch[1]}</span>
                  </span>
                )
              })()}
            </div>
          )
        })()}

        {/* Sublabel (non-env) */}
        {top!.sublabel && !top!.sublabel.match(/env\d+/) && (
          <p className="mt-2 text-[13px] font-normal text-gray-400 dark:text-gray-500">
            {top!.sublabel}
          </p>
        )}

        {/* Fleet view */}
        {top!.kind === 'fleet' && top!.fleet && (
          <FleetView fleet={top!.fleet} onSave={handleUpdateTask} onUnlink={handleUnlink} onDone={handleDone} onEscalate={handleEscalate} onAdd={handleAddFleetItem} />
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

        {/* Hotkey hints — sorted by emphasis (primary first, then secondary, then default) */}
        {(() => {
          const em = top!.emphasizedHotkeys || []
          const emphasisOf = (label: string): HotkeyEmphasis =>
            em[0] === label ? 'primary' : em[1] === label ? 'secondary' : 'default'
          const allHotkeys: { keys: string; label: string }[] = [
            { keys: '⌘⇧D', label: 'done' },
            { keys: '⌘⇧E', label: 'snooze' },
            { keys: '⌘K', label: 'override' },
            { keys: '⌘J', label: 'reschedule' },
          ]
          const rank = { primary: 0, secondary: 1, default: 2 }
          const sorted = [...allHotkeys].sort((a, b) =>
            rank[emphasisOf(a.label)] - rank[emphasisOf(b.label)]
          )
          return (
            <div className="mt-8 flex items-center gap-5">
              {sorted.map(h => (
                <HotkeyHint key={h.label} keys={h.keys} label={h.label} emphasis={emphasisOf(h.label)} />
              ))}
            </div>
          )
        })()}
      </div>

      {/* Cmd+K search overlay — replaces the card in-place */}
      {searchOpen && (
        <FocusSearch
          onClose={() => setSearchOpen(false)}
          onPromote={handlePromote}
          onCreate={handleCreate}
        />
      )}

      {/* Cmd+J reschedule overlay */}
      {rescheduleOpen && (
        <RescheduleInput
          onSubmit={handleReschedule}
          onClose={() => setRescheduleOpen(false)}
        />
      )}
    </div>
  )
}
