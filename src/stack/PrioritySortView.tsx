import { useState, useCallback, useRef, useEffect } from 'react'

import { ENV_COLORS, StyledTaskText, envNum, smartDeadlineLabel } from './focusShared'

interface PriorityTask {
  id: number
  text: string
  env: string | null
  escalation: number
  isFireDrill: boolean
  deadline: string | null
  status?: string
  snoozedUntil?: number | null
}

function DeadlineEditor({ taskId, onSet, onClose }: {
  taskId: number
  onSet: (id: number, deadline: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ label: string; iso: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const parseDate = async () => {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/focus/parse-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      const result = await res.json()
      if (result.success && result.iso) {
        setPreview({ label: result.label, iso: result.iso })
      } else {
        setError('Could not parse')
      }
    } catch {
      setError('Failed')
    }
    setLoading(false)
  }

  const confirm = () => {
    if (!preview) return
    onSet(taskId, preview.iso)
    onClose()
  }

  useEffect(() => {
    if (!preview) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm() }
      if (e.key === 'Escape') { e.preventDefault(); setPreview(null); setTimeout(() => inputRef.current?.focus(), 0) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [preview]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-[#232325] rounded-lg border border-gray-200/80 dark:border-white/[0.08] shadow-lg px-3 py-2 flex items-center gap-2"
      style={{ minWidth: '280px' }}
      onClick={e => e.stopPropagation()}
    >
      {!preview ? (
        <>
          <input
            ref={inputRef}
            value={text}
            onChange={e => { setText(e.target.value); setError(null) }}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') parseDate()
              if (e.key === 'Escape') onClose()
            }}
            onKeyUp={e => e.stopPropagation()}
            placeholder="tomorrow, fri 2pm, midday..."
            className="flex-1 bg-transparent text-[14px] text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-600"
            disabled={loading}
          />
          {loading && <span className="text-[11px] text-gray-400 animate-pulse">...</span>}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </>
      ) : (
        <div className="flex-1 flex items-center gap-2">
          <span className="text-[14px] text-gray-800 dark:text-gray-100">{preview.label}</span>
          <kbd className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">↵</kbd>
          <span className="text-[11px] text-gray-400">confirm</span>
        </div>
      )}
      <button
        onClick={onClose}
        className="text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-500 text-[11px] cursor-pointer"
      >
        esc
      </button>
    </div>
  )
}

function PrioritySortRow({ task, idx, isDragOver, isDragging, isLocked, editingDeadline, onDragOver, onDrop, onDragStart, onDragEnd, onToggleLock, onDone, onEditDeadline, onSetDeadline, onRename }: {
  task: PriorityTask
  idx: number
  isDragOver: boolean
  isDragging: boolean
  isLocked: boolean
  editingDeadline: boolean
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onToggleLock: () => void
  onDone: () => void
  onEditDeadline: () => void
  onSetDeadline: (id: number, deadline: string) => void
  onRename: (id: number, text: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const editRef = useRef<HTMLInputElement>(null)
  const envColors = task.env ? (ENV_COLORS[task.env] || ENV_COLORS.env7) : null
  const isWaiting = task.status === 'in_progress'
  const isSnoozed = !!(task.snoozedUntil && task.snoozedUntil > Date.now())

  useEffect(() => { if (editing) editRef.current?.select() }, [editing])

  const saveEdit = () => {
    setEditing(false)
    const trimmed = editText.trim()
    if (trimmed && trimmed !== task.text) onRename(task.id, trimmed)
    else setEditText(task.text)
  }

  return (
    <div
      className={`flex items-center gap-3 py-2.5 px-3 -mx-3 transition-all group/row relative ${
        isDragging ? 'opacity-30' : ''
      } ${isLocked ? 'opacity-30' : ''} ${isWaiting ? 'opacity-45' : ''} ${isSnoozed ? 'opacity-40' : ''}`}
      style={isDragOver ? { boxShadow: '0 -2px 0 0 #60a5fa' } : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Position number */}
      <span className="w-6 text-right text-[14px] font-mono text-gray-300 dark:text-gray-600 shrink-0 select-none">
        {idx + 1}
      </span>

      {/* Done checkbox */}
      <span
        className="w-[18px] h-[18px] rounded-[4px] border-[1.5px] border-gray-300 dark:border-gray-600 shrink-0 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onDone() }}
        title="Mark done"
      />

      {/* Drag handle */}
      <span
        className={`w-4 shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover/row:opacity-30 transition-opacity select-none text-gray-400 inline-flex items-center justify-center ${
          isLocked ? '!opacity-0 !cursor-default' : ''
        }`}
        draggable={!isLocked}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
          <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
          <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
        </svg>
      </span>

      {/* Env tag */}
      {envColors && task.env && (
        <span className={`
          inline-flex items-center justify-center w-[42px] py-0.5 rounded-md shrink-0
          ${envColors.bg} border ${envColors.border}
          text-[12px] font-medium font-mono ${envColors.text}
        `}>
          <span className="text-[13px]">&#x2303;</span>{envNum(task.env)}
        </span>
      )}

      {/* Task text */}
      {editing ? (
        <input
          ref={editRef}
          value={editText}
          onChange={e => setEditText(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') saveEdit()
            if (e.key === 'Escape') { setEditText(task.text); setEditing(false) }
          }}
          onKeyUp={e => e.stopPropagation()}
          className="flex-1 text-[19px] bg-transparent outline-none text-gray-800 dark:text-gray-100 min-w-0 border-b border-blue-400"
        />
      ) : (
        <span
          className="flex-1 text-[19px] truncate cursor-text"
          onClick={() => { setEditText(task.text); setEditing(true) }}
        >
          <StyledTaskText text={task.text} />
        </span>
      )}

      {/* Deadline indicator / clock icon */}
      {task.deadline && task.deadline !== 'none' ? (() => {
        const { label, color } = smartDeadlineLabel(task.deadline)
        return (
          <span
            className={`text-[14px] font-medium shrink-0 cursor-pointer hover:opacity-70 transition-opacity ${color}`}
            onClick={(e) => { e.stopPropagation(); onEditDeadline() }}
            title="Edit deadline"
          >
            {label}
          </span>
        )
      })() : (
        <span
          className={`shrink-0 cursor-pointer transition-opacity ${
            hovered ? 'opacity-30 hover:opacity-60' : 'opacity-0 pointer-events-none'
          } text-gray-400 dark:text-gray-500`}
          onClick={(e) => { e.stopPropagation(); onEditDeadline() }}
          title="Set deadline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
        </span>
      )}

      {/* Snoozed indicator */}
      {isSnoozed && (
        <span className="text-[12px] font-medium text-amber-400 dark:text-amber-500 shrink-0 tracking-wide" title={`Snoozed until ${new Date(task.snoozedUntil!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}>
          zzz
        </span>
      )}

      {/* Waiting indicator */}
      {isWaiting && !isSnoozed && (
        <span className="text-[12px] font-medium text-blue-400 dark:text-blue-500 uppercase tracking-wider shrink-0">
          waiting
        </span>
      )}

      {/* Fire drill indicator */}
      {task.isFireDrill && (
        <span className="text-[12px] font-semibold text-red-500 dark:text-red-400 uppercase tracking-wider shrink-0">
          fire drill
        </span>
      )}

      {/* Lock toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleLock() }}
        className={`p-1.5 rounded-md transition-all cursor-pointer shrink-0 ${
          isLocked
            ? 'text-gray-400 dark:text-gray-500 opacity-100'
            : hovered
              ? 'text-gray-300/40 dark:text-gray-600/40 hover:text-gray-400 dark:hover:text-gray-500'
              : 'opacity-0 pointer-events-none'
        }`}
        title={isLocked ? 'Unlock' : 'Lock (set)'}
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

      {/* Inline deadline editor */}
      {editingDeadline && (
        <DeadlineEditor
          taskId={task.id}
          onSet={onSetDeadline}
          onClose={onEditDeadline}
        />
      )}
    </div>
  )
}

export function PrioritySortView({ tasks, onReorder, onDone, onSetDeadline, onRename }: {
  tasks: PriorityTask[]
  onReorder: (id: number, beforeId?: number) => void
  onDone: (id: number) => void
  onSetDeadline: (id: number, deadline: string) => void
  onRename: (id: number, text: string) => void
}) {
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [lockedIds, setLockedIds] = useState<Set<number>>(new Set())
  const [editingDeadlineId, setEditingDeadlineId] = useState<number | null>(null)

  const toggleLock = useCallback((id: number) => {
    setLockedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const handleDragStart = (e: React.DragEvent, task: PriorityTask) => {
    if (lockedIds.has(task.id)) { e.preventDefault(); return }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(task.id))
    setDraggingId(task.id)
  }

  const handleDragEnd = () => {
    setDragOverId(null)
    setDraggingId(null)
  }

  const handleDragOver = (e: React.DragEvent, taskId: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (taskId !== draggingId) setDragOverId(taskId)
  }

  const handleDrop = (e: React.DragEvent, beforeId: number) => {
    e.preventDefault()
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'))
    if (draggedId && draggedId !== beforeId) {
      onReorder(draggedId, beforeId)
    }
    setDragOverId(null)
    setDraggingId(null)
  }

  if (tasks.length === 0) {
    return (
      <div className="mt-4 py-6 text-center text-[15px] text-gray-400 dark:text-gray-500">
        No pending tasks to prioritize.
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-0.5">
      {tasks.map((task, idx) => (
        <PrioritySortRow
          key={task.id}
          task={task}
          idx={idx}
          isDragOver={dragOverId === task.id}
          isDragging={draggingId === task.id}
          isLocked={lockedIds.has(task.id)}
          editingDeadline={editingDeadlineId === task.id}
          onDragOver={(e) => handleDragOver(e, task.id)}
          onDrop={(e) => handleDrop(e, task.id)}
          onDragStart={(e) => handleDragStart(e, task)}
          onDragEnd={handleDragEnd}
          onToggleLock={() => toggleLock(task.id)}
          onDone={() => onDone(task.id)}
          onEditDeadline={() => setEditingDeadlineId(editingDeadlineId === task.id ? null : task.id)}
          onSetDeadline={onSetDeadline}
          onRename={onRename}
        />
      ))}
    </div>
  )
}
