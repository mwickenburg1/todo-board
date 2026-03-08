import { useState, useEffect, useRef, useCallback } from 'react'
import { ENV_COLORS, ESCALATION_COLORS, StyledTaskText, REMOTE_ENVS, showToast, openFleetEnv } from './focusShared'

interface ClaudeLink {
  label: string
  ref: string
  idx: number
}

interface FleetTask {
  id: number; text: string; list: string; status: string; escalation: number;
  hasClaudeLink: boolean; claudeLinks: ClaudeLink[];
}

export interface FleetEnv {
  env: string
  tasks: FleetTask[]
}

function EditableFleetItem({ task, env, onSave, onUnlink, onDone, onEscalate, onDragStart, onDragEnd, onDragOver, onDrop, isDragOver, isLocked, onToggleLock }: {
  task: FleetTask; env: string;
  onSave: (id: number, text: string) => void;
  onUnlink: (id: number, linkIdx: number) => void;
  onDone: (id: number) => void;
  onEscalate: (id: number, level: number) => void;
  onDragStart: (e: React.DragEvent, task: FleetTask) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, taskId: number) => void;
  onDrop: (e: React.DragEvent, beforeId: number) => void;
  isDragOver: boolean;
  isLocked: boolean;
  onToggleLock: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const [showPopover, setShowPopover] = useState(false)
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
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
      ref={rowRef}
      className={`flex items-center gap-2 py-2 px-2 -mx-2 rounded-lg transition-all group/row ${
        editing ? 'bg-gray-100 dark:bg-white/[0.08]' : ''
      } ${isLocked ? 'opacity-30' : ''}`}
      style={isDragOver ? { boxShadow: '0 -2px 0 0 #60a5fa' } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={(e) => onDragOver(e, task.id)}
      onDrop={(e) => onDrop(e, task.id)}
    >
      {/* Drag handle */}
      <span
        className="w-4 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-30 transition-opacity select-none text-gray-400 inline-flex items-center justify-center"
        draggable
        onDragStart={(e) => {
          if (rowRef.current) e.dataTransfer.setDragImage(rowRef.current, 20, rowRef.current.offsetHeight / 2)
          onDragStart(e, task)
        }}
        onDragEnd={onDragEnd}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
          <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
          <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
        </svg>
      </span>
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
          <span
            className="w-[18px] h-[18px] rounded-[4px] border-[1.5px] border-gray-300 dark:border-gray-600 shrink-0 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onDone(task.id) }}
            title="Mark done"
          />
          <StyledTaskText text={task.text} />
        </span>
      )}
      {/* Escalation buttons */}
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
      {/* Lock toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleLock(task.id) }}
        className={`p-1.5 rounded-md transition-all cursor-pointer shrink-0 ${
          isLocked
            ? 'text-gray-400 dark:text-gray-500 opacity-100'
            : hovered
              ? 'text-gray-300/40 dark:text-gray-600/40 hover:text-gray-400 dark:hover:text-gray-500'
              : 'opacity-0 pointer-events-none'
        }`}
        title={isLocked ? 'Unlock' : 'Lock (reviewed)'}
      >
        {isLocked ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M7 11V7a5 5 0 0110 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      {/* Claude Code link button */}
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

function FleetAddRow({ env, onAdd }: { env: string; onAdd: (text: string, env: string) => void }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()
  }, [])

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed) onAdd(trimmed, env)
    setText('')
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 -mx-1">
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => { if (!text.trim()) setText('') }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { setText('') }
        }}
        placeholder="New item..."
        className="flex-1 text-[21px] bg-transparent outline-none text-gray-300 dark:text-gray-500 placeholder-gray-300/60 dark:placeholder-gray-600/60 min-w-0"
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
    <div className="flex items-center gap-2 py-2 px-2 -mx-2">
      <span className="flex-1 flex items-center gap-2 px-3 py-1.5 -mx-1">
        <span className="w-[18px] h-[18px] rounded-[4px] border-[1.5px] border-gray-200 dark:border-gray-700 shrink-0" />
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            if (e.key === 'Escape') { setText('') }
          }}
          placeholder="—"
          className="flex-1 text-[21px] bg-transparent outline-none text-gray-600 dark:text-gray-300 placeholder-gray-300 dark:placeholder-gray-700 min-w-0"
        />
      </span>
    </div>
  )
}

function FleetEnvCell({ n, tasks, onSave, onUnlink, onDone, onEscalate, onAdd, onReorder, lockedIds, onToggleLock }: {
  n: number; tasks: FleetTask[];
  onSave: (id: number, text: string) => void;
  onUnlink: (id: number, linkIdx: number) => void;
  onDone: (id: number) => void;
  onEscalate: (id: number, level: number) => void;
  onAdd: (text: string, env: string) => void;
  onReorder: (id: number, beforeId?: number) => void;
  lockedIds: Set<number>;
  onToggleLock: (id: number) => void;
}) {
  const [adding, setAdding] = useState(false)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [draggingEnv, setDraggingEnv] = useState(false)
  const env = `env${n}`
  const colors = ENV_COLORS[env] || ENV_COLORS.env7
  const canAdd = tasks.length < 3
  const taskIds = new Set(tasks.map(t => t.id))

  const handleDragStart = (e: React.DragEvent, task: FleetTask) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(task.id))
    setDraggingEnv(true)
  }
  const handleDragEnd = () => { setDragOverId(null); setDraggingEnv(false) }
  const handleDragOver = (e: React.DragEvent, taskId: number) => {
    if (!draggingEnv) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(taskId)
  }
  const handleDrop = (e: React.DragEvent, beforeId: number) => {
    e.preventDefault()
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'))
    if (draggedId && draggedId !== beforeId && taskIds.has(draggedId)) {
      onReorder(draggedId, beforeId)
    }
    setDragOverId(null)
    setDraggingEnv(false)
  }

  return (
    <div className={`flex gap-3 items-start min-w-0 rounded-lg px-2 py-2 ${
      tasks.length === 0 && !adding ? 'bg-gray-50 dark:bg-white/[0.03]' : ''
    }`}>
      <span
        className={`
          group/env inline-flex items-center justify-center w-[52px] py-1 rounded-lg shrink-0 mt-[11px]
          ${colors.bg} border ${colors.border}
          text-[15px] font-medium font-mono ${colors.text}
          ${canAdd ? 'cursor-pointer' : ''}
        `}
        onClick={canAdd ? () => setAdding(prev => !prev) : undefined}
        title={canAdd ? 'Add item' : undefined}
      >
        <span className={canAdd ? 'group-hover/env:hidden' : ''}>
          <span className="text-[16px]">&#x2303;</span>{n}
        </span>
        {canAdd && <span className="hidden group-hover/env:inline text-[22px] leading-none">+</span>}
      </span>
      <div className="flex-1 min-w-0">
        {tasks.length === 0 && !adding ? (
          <FleetEmptyInput env={env} onAdd={onAdd} />
        ) : (
          <>
            {tasks.map(t => (
              <EditableFleetItem key={t.id} task={t} env={env} onSave={onSave} onUnlink={onUnlink} onDone={onDone} onEscalate={onEscalate}
                onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragOver={handleDragOver} onDrop={handleDrop} isDragOver={dragOverId === t.id}
                isLocked={lockedIds.has(t.id)} onToggleLock={onToggleLock}
              />
            ))}
            {adding && (
              <FleetAddRow env={env} onAdd={(text, e) => { onAdd(text, e); setAdding(false) }} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function FleetView({ fleet, onSave, onUnlink, onDone, onEscalate, onAdd, onReorder }: {
  fleet: FleetEnv[];
  onSave: (id: number, text: string) => void;
  onUnlink: (id: number, linkIdx: number) => void;
  onDone: (id: number) => void;
  onEscalate: (id: number, level: number) => void;
  onAdd: (text: string, env: string) => void;
  onReorder: (id: number, beforeId?: number) => void;
}) {
  const [lockedIds, setLockedIds] = useState<Set<number>>(new Set())
  const toggleLock = useCallback((id: number) => {
    setLockedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const fleetMap = new Map(fleet.map(f => [f.env, f.tasks]))
  return (
    <div className="space-y-2 mt-4">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
        <FleetEnvCell key={n} n={n} tasks={fleetMap.get(`env${n}`) || []} onSave={onSave} onUnlink={onUnlink} onDone={onDone} onEscalate={onEscalate} onAdd={onAdd} onReorder={onReorder}
          lockedIds={lockedIds} onToggleLock={toggleLock}
        />
      ))}
    </div>
  )
}
