import { useEffect, useState, useCallback, useRef } from 'react'
import { FleetView } from './FleetView'
import { PrioritySortView } from './PrioritySortView'
import { NewItemFlow, type SlackContext } from './NewItemFlow'
import { RescheduleInput } from './RescheduleInput'
import { SlackThreadPreview } from './SlackThreadPreview'
import { evaluateAlerts, alertStyle } from './focusAlerts'
import { ENV_COLORS, openFleetEnv } from './focusShared'

interface FleetEnv {
  env: string
  tasks: { id: number; text: string; list: string; status: string; escalation: number; hasClaudeLink: boolean; claudeLinks: { label: string; ref: string; idx: number }[] }[]
}

interface FocusResponse {
  empty: boolean
  depth: number
  snoozeMinutes?: number
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
    from?: string | null
    isFireDrill?: boolean
    slackThread?: { who: string; text: string }[] | null
    slackRef?: string | null
    slackContext?: { label: string; ref: string }[] | null
    env?: string | null
    claudeLinks?: { label: string; ref: string; idx: number }[] | null
    priorityTasks?: { id: number; text: string; env: string | null; escalation: number; isFireDrill: boolean }[]
  }
}

type HotkeyEmphasis = 'primary' | 'secondary' | 'default'

function HotkeyHint({ keys, label, emphasis = 'default' }: { keys: string; label: string; emphasis?: HotkeyEmphasis }) {
  const kbdClass = emphasis === 'primary'
    ? 'px-2.5 py-1 rounded-md font-mono text-[14px] font-medium bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-400/20 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'
    : emphasis === 'secondary'
    ? 'px-2.5 py-1 rounded-md font-mono text-[14px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-200/60 dark:border-amber-400/15 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'
    : 'px-2.5 py-1 rounded-md font-mono text-[14px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'

  const labelClass = emphasis === 'primary'
    ? 'text-emerald-500 dark:text-emerald-400'
    : emphasis === 'secondary'
    ? 'text-amber-400 dark:text-amber-400/70'
    : 'text-gray-300 dark:text-gray-600'

  return (
    <span className={`inline-flex items-center gap-1.5 text-[15px] tracking-wide`}>
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

const ALL_ENVS = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8']

function EnvControls({ taskId, env, label, isLinked, onSetEnv }: {
  taskId: number
  env: string | null
  label: string
  isLinked: boolean
  onSetEnv: (id: number, env: string | null) => void
}) {
  const [showPicker, setShowPicker] = useState(false)

  return (
    <span className="relative ml-auto inline-flex items-center gap-3">
      {env ? (
        <>
          <button
            onClick={() => openFleetEnv(env, isLinked ? undefined : `/link ${label}`)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[14px] font-medium cursor-pointer transition-colors ${
              isLinked
                ? 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)] hover:text-gray-600 dark:hover:text-gray-300'
                : 'bg-transparent text-gray-300 dark:text-gray-600 border border-dashed border-gray-300/80 dark:border-gray-600/60 hover:text-gray-500 dark:hover:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
            title={isLinked ? 'Open environment' : 'Not linked — click to open env & copy /link'}
          >
            <span>&#x2303;</span>
            <span>{env.replace('env', '')}</span>
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
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="text-[13px] text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-pointer transition-colors"
        >
          assign env
        </button>
      )}
      {showPicker && (
        <div className="absolute right-0 bottom-full mb-2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2.5 flex items-center gap-2">
          {ALL_ENVS.map(e => {
            const c = ENV_COLORS[e] || ENV_COLORS.env7
            const isActive = e === env
            return (
              <button
                key={e}
                onClick={() => { onSetEnv(taskId, e); setShowPicker(false); openFleetEnv(e, `/link ${label}`) }}
                className={`px-2.5 py-1 rounded-lg text-[13px] font-mono font-medium border cursor-pointer transition-colors ${
                  isActive
                    ? `${c.bg} ${c.border} ${c.text} ring-2 ring-offset-1 dark:ring-offset-gray-900`
                    : `bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border-gray-200/60 dark:border-white/[0.08]`
                }`}
              >
                {e.replace('env', '')}
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
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const lastJsonRef = useRef('')
  const dataRef = useRef<FocusResponse | null>(null)

  const fetchQueue = useCallback(() => {
    fetch('/api/focus')
      .then(res => res.text())
      .then(text => {
        if (text !== lastJsonRef.current) {
          lastJsonRef.current = text
          const parsed = JSON.parse(text)
          dataRef.current = parsed
          setData(parsed)
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

  // Cmd+N (new item), Cmd+J (reschedule), Cmd+Shift+C (create task from Slack)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n') {
        e.preventDefault()
        setRescheduleOpen(false)
        setNewItemFireDrill(false)
        setNewItemPrefill('')
        setNewItemOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setNewItemOpen(false)
        setRescheduleOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        const currentTop = dataRef.current?.top
        if (currentTop?.kind !== 'slack') return
        setRescheduleOpen(false)
        setNewItemOpen(false)
        const prefill = currentTop.label || ''
        setNewItemFireDrill(true)
        setNewItemPrefill(prefill)
        setTimeout(() => setNewItemOpen(true), 10)
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
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleCreate = useCallback((text: string, type?: 'fire-drill' | 'today' | 'backlog', snoozeMins?: number, pastedSlack?: SlackContext) => {
    const currentTop = dataRef.current?.top
    const isSlack = currentTop?.kind === 'slack'
    const slackRef = isSlack ? currentTop.slackRef : null
    const slackLabel = isSlack ? currentTop.label : null
    const originalId = currentTop?.id

    // Step 1: Dismiss the slack pulse item first (so it doesn't reappear)
    const dismissPromise = isSlack && originalId
      ? fetch('/api/focus/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      : Promise.resolve(null)

    dismissPromise.then(() =>
      // Step 2: Create the new task via promote
      fetch('/api/focus/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, itemType: type, snoozeMins: type === 'fire-drill' ? snoozeMins : undefined }),
      }).then(res => res.json())
    ).then(result => {
      if (!result) return
      const promises: Promise<unknown>[] = []
      // Attach slack thread link — from focus queue item or from pasted URL
      const linkRef = slackRef || (pastedSlack ? `${pastedSlack.channel}/${pastedSlack.ts}` : null)
      const linkLabel = slackLabel || (pastedSlack ? `#${pastedSlack.channelName}` : null)
      if (result.created && result.promoted && linkRef) {
        promises.push(fetch(`/api/todos/${result.promoted}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'slack_thread', ref: linkRef, label: linkLabel || '' }),
        }))
      }
      return Promise.all(promises)
    }).then(() => {
      lastJsonRef.current = ''
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

  const handleSetEnv = useCallback((id: number, env: string | null) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: env || '' }),
    }).then(() => {
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

  const handleReorder = useCallback((id: number, beforeId?: number) => {
    fetch(`/api/todos/${id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeId }),
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
      lastJsonRef.current = ''
      setRescheduleOpen(false)
      fetchQueue()
    }
    return result
  }, [fetchQueue])

  const overlayOpen = newItemOpen || rescheduleOpen

  if (!data || data.empty) {
    return (
      <div className="relative min-h-[1450px]">
        <DeepWork />
        {overlayOpen && (
          <div className="absolute inset-0 z-40 bg-black/50 dark:bg-black/60 rounded-2xl" />
        )}
        {newItemOpen && (
          <NewItemFlow
            onClose={() => { setNewItemOpen(false); setNewItemFireDrill(false); setNewItemPrefill('') }}
            onCreate={handleCreate}
            isCreateTask={newItemFireDrill}
            prefill={newItemPrefill}
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
  const isFireDrill = top!.isFireDrill

  return (
    <div className="relative min-h-[1450px]">
      {/* New item button — top right */}
      <button
        onClick={() => { setNewItemFireDrill(false); setNewItemPrefill(''); setNewItemOpen(true) }}
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
      >
        <span className="font-mono opacity-60">⌘N</span>
        <span>new item</span>
      </button>
      <div className={`
        relative px-8 pt-8 pb-8 rounded-2xl ${top!.kind === 'fleet' || top!.kind === 'priority-sort' ? 'min-h-[700px]' : ''}
        bg-white dark:bg-[#1c1c1e]
        ${isFireDrill ? 'border-2 border-red-300/60 dark:border-red-500/30' : 'border border-gray-100/80 dark:border-white/[0.06]'}
        shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_2px_8px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.04)]
        dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_2px_8px_rgba(0,0,0,0.2),0_12px_40px_rgba(0,0,0,0.3)]
        transition-all duration-300 ease-out
        ${transitioning ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}
        ${overlayOpen ? 'opacity-0 pointer-events-none' : ''}
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
                <h1 className="text-[24px] leading-[1.35] font-medium text-gray-800 dark:text-gray-100">
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
                      <span className="font-mono">{envKey.replace('env', '')}</span>
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

        {/* Slack thread — mini conversation snapshot */}
        {top!.kind === 'slack' && top!.slackThread && top!.slackThread.length > 0 && (
          <div className="mt-4 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06] px-4 py-3 space-y-2.5">
            {top!.slackThread.map((msg, i) => (
              <div key={i} className="flex gap-2.5 items-start">
                <span className={`text-[13px] font-semibold shrink-0 mt-px ${
                  msg.who === 'me'
                    ? 'text-blue-500 dark:text-blue-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}>
                  {msg.who === 'me' ? 'You' : msg.who}
                </span>
                <span className="text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed">
                  {msg.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Fleet view */}
        {top!.kind === 'fleet' && top!.fleet && (
          <FleetView fleet={top!.fleet} onSave={handleUpdateTask} onUnlink={handleUnlink} onDone={handleDone} onEscalate={handleEscalate} onAdd={handleAddFleetItem} onReorder={handleReorder} />
        )}

        {/* Priority sort view */}
        {top!.kind === 'priority-sort' && top!.priorityTasks && (
          <PrioritySortView tasks={top!.priorityTasks} onReorder={handleReorder} onDone={handleDone} />
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
            {top!.slackContext.map((ctx, i) => (
              <SlackThreadPreview key={i} ref_={ctx.ref} label={ctx.label} />
            ))}
          </div>
        )}

        {/* Hotkey hints + env controls */}
        {(() => {
          const em = top!.emphasizedHotkeys || (top!.kind === 'task' ? ['done'] : [])
          const emphasisOf = (label: string): HotkeyEmphasis =>
            em[0] === label ? 'primary' : em[1] === label ? 'secondary' : 'default'
          const snoozeMins = data?.snoozeMinutes || 30
          const allHotkeys: { keys: string; label: string }[] = [
            { keys: '\u2318\u21e7D', label: 'done' },
            { keys: '\u2318\u21e7E', label: `snooze ${snoozeMins}m` },
            { keys: '\u2318J', label: 'reschedule' },
          ]
          // Add create task hotkey for slack cards
          if (top!.kind === 'slack') {
            allHotkeys.push({ keys: '\u2318\u21e7C', label: 'create task' })
          }
          const rank = { primary: 0, secondary: 1, default: 2 }
          const sorted = [...allHotkeys].sort((a, b) =>
            rank[emphasisOf(a.label)] - rank[emphasisOf(b.label)]
          )
          const taskEnv = top!.kind === 'task' ? (top!.env || null) : null
          const hasEnvControls = top!.kind === 'task'
          return (
            <>
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
                    onSetEnv={handleSetEnv}
                  />
                )}
              </div>
            </>
          )
        })()}
      </div>

      {/* Overlay backdrop */}
      {overlayOpen && (
        <div className="absolute inset-0 z-40 bg-black/50 dark:bg-black/60 rounded-2xl" />
      )}

      {/* Cmd+N new item overlay */}
      {newItemOpen && (
        <NewItemFlow
          onClose={() => { setNewItemOpen(false); setNewItemFireDrill(false); setNewItemPrefill('') }}
          onCreate={handleCreate}
          isCreateTask={newItemFireDrill}
          prefill={newItemPrefill}
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

