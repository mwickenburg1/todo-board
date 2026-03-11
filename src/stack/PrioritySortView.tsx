import { useState, useCallback } from 'react'
import { ENV_COLORS, StyledTaskText, envNum, smartDeadlineLabel } from './focusShared'

interface PriorityTask {
  id: number
  text: string
  env: string | null
  escalation: number
  isFireDrill: boolean
  deadline: string | null
  status?: string
}

function PrioritySortRow({ task, idx, isDragOver, isDragging, isLocked, onDragOver, onDrop, onDragStart, onDragEnd, onToggleLock, onDone }: {
  task: PriorityTask
  idx: number
  isDragOver: boolean
  isDragging: boolean
  isLocked: boolean
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onToggleLock: () => void
  onDone: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const envColors = task.env ? (ENV_COLORS[task.env] || ENV_COLORS.env7) : null
  const isWaiting = task.status === 'in_progress'

  return (
    <div
      className={`flex items-center gap-3 py-2.5 px-3 -mx-3 transition-all group/row ${
        isDragging ? 'opacity-30' : ''
      } ${isLocked ? 'opacity-30' : ''} ${isWaiting ? 'opacity-45' : ''}`}
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
      <span className="flex-1 text-[19px] truncate">
        <StyledTaskText text={task.text} />
      </span>

      {/* Deadline indicator */}
      {task.deadline && task.deadline !== 'none' && (() => {
        const { label, color } = smartDeadlineLabel(task.deadline)
        return <span className={`text-[14px] font-medium shrink-0 ${color}`}>{label}</span>
      })()}

      {/* Waiting indicator */}
      {isWaiting && (
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
    </div>
  )
}

export function PrioritySortView({ tasks, onReorder, onDone }: {
  tasks: PriorityTask[]
  onReorder: (id: number, beforeId?: number) => void
  onDone: (id: number) => void
}) {
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [lockedIds, setLockedIds] = useState<Set<number>>(new Set())

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
          onDragOver={(e) => handleDragOver(e, task.id)}
          onDrop={(e) => handleDrop(e, task.id)}
          onDragStart={(e) => handleDragStart(e, task)}
          onDragEnd={handleDragEnd}
          onToggleLock={() => toggleLock(task.id)}
          onDone={() => onDone(task.id)}
        />
      ))}
    </div>
  )
}
