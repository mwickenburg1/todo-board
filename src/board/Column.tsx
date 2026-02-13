import { useState, useEffect, useRef } from 'react'
import type { DragEvent } from 'react'
import type { Todo } from './types'
import { DragHandle } from './types'

export function Column({ title, count, color, tasks, rawList, onDone, targetList, category, onDrop, onAdd, onUpdateTask, editingTaskId, setEditingTaskId, expandedTasks, toggleExpanded, draggedTask, onDragStart, onDragEnd, onPromote, onDemote }: {
  title: string; count: number; color: string; tasks: (Todo & { category?: string; childCount?: number })[]; rawList?: Todo[]
  onDone: (id: number) => void; targetList: string; category?: string
  onDrop: (id: number, targetList: string, options?: { category?: string; insertBefore?: number; asSubtaskOf?: number }) => void
  onAdd: (text: string, list: string, priority: number, parent_id?: number) => void
  onUpdateTask: (id: number, updates: { text?: string }) => void; editingTaskId: number | null; setEditingTaskId: (id: number | null) => void
  expandedTasks: Set<number>; toggleExpanded: (id: number) => void; draggedTask: Todo | null
  onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void; onPromote?: (id: number) => void; onDemote?: (id: number) => void
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [newTaskText, setNewTaskText] = useState('')
  const [subtaskDropTarget, setSubtaskDropTarget] = useState<number | null>(null)
  const [newSubtaskText, setNewSubtaskText] = useState<{ [key: number]: string }>({})

  const categoryParentId = category && rawList ? rawList.find(t => !t.parent_id && t.text?.toLowerCase().includes(category.toLowerCase()))?.id : undefined
  const getSubtasks = (taskId: number) => rawList ? rawList.filter(t => t.parent_id === taskId && t.status !== 'done') : []

  const handleDragOver = (e: DragEvent, index: number) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropIndex(index) }
  const handleDragLeave = (e: DragEvent) => { const rt = e.relatedTarget as HTMLElement; if (!rt || !e.currentTarget.contains(rt)) setDropIndex(null) }
  const handleDrop = (e: DragEvent, insertBeforeId?: number) => { e.preventDefault(); e.stopPropagation(); setDropIndex(null); const id = parseInt(e.dataTransfer.getData('text/plain')); if (id) onDrop(id, targetList, { category, insertBefore: insertBeforeId }) }

  const DropZone = ({ index, insertBeforeId }: { index: number; insertBeforeId?: number }) => {
    const isActive = dropIndex === index && draggedTask
    return (
      <div className="h-6 relative -my-2" onDragOver={(e) => handleDragOver(e, index)} onDragEnter={(e) => { e.preventDefault(); setDropIndex(index) }} onDragLeave={(e) => { e.stopPropagation() }} onDrop={(e) => handleDrop(e, insertBeforeId)}>
        <div className={`absolute inset-x-1 top-1/2 -translate-y-1/2 h-8 bg-blue-100 border-2 border-dashed border-blue-400 rounded flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onDragOver={(e) => handleDragOver(e, index)} onDrop={(e) => handleDrop(e, insertBeforeId)}>
          <span className="text-xs text-blue-500">Drop here</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#f7f6f3] rounded-lg min-w-[550px] max-w-[550px] transition-all flex flex-col" onDragLeave={handleDragLeave}>
      <div className="p-3 border-b border-[#e9e9e7] flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }}></span>
        <span className="font-semibold text-sm" style={{ color: color === '#9b9a97' ? '#6b6b6b' : color.replace('ff', 'aa') }}>{title}</span>
        <span className="bg-[#e9e9e7] text-[#6b6b6b] text-xs px-2 py-0.5 rounded-full ml-auto">{count}</span>
      </div>
      <div className="p-2 max-h-[500px] overflow-y-auto min-h-[60px] flex-1">
        <DropZone index={0} insertBeforeId={tasks[0]?.id ?? undefined} />
        {tasks.map((task, idx) => {
          const subtasks = task.id ? getSubtasks(task.id) : []
          const isExpanded = task.id ? expandedTasks.has(task.id) : false
          const hasSubtasks = subtasks.length > 0 || (task.childCount || 0) > 0
          return (
            <div key={task.id}>
              <TaskCard task={task} onDone={onDone} onUpdateTask={onUpdateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} onDragStart={onDragStart} onDragEnd={onDragEnd}
                hasSubtasks={hasSubtasks} isExpanded={isExpanded} onToggleExpand={() => task.id && toggleExpanded(task.id)}
                isSubtaskDropTarget={subtaskDropTarget === task.id} onSubtaskDragOver={() => task.id && setSubtaskDropTarget(task.id)} onSubtaskDragLeave={() => setSubtaskDropTarget(null)}
                onSubtaskDrop={(droppedId) => { setSubtaskDropTarget(null); if (task.id) onDrop(droppedId, targetList, { asSubtaskOf: task.id }) }}
                onPromote={onPromote ? () => task.id && onPromote(task.id) : undefined} onDemote={onDemote ? () => task.id && onDemote(task.id) : undefined} />
              {isExpanded && (
                <div className="ml-6 border-l-2 border-gray-200 pl-2 mb-2">
                  {subtasks.map(sub => (
                    <div key={sub.id} className="py-1">
                      <SubtaskItem task={sub} onDone={onDone} onUpdateTask={onUpdateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} onDragStart={onDragStart} onDragEnd={onDragEnd} />
                    </div>
                  ))}
                  <form onSubmit={(e) => { e.preventDefault(); const text = newSubtaskText[task.id!] || ''; if (text.trim() && task.id) { onAdd(text.trim(), targetList, 2, task.id); setNewSubtaskText(prev => ({ ...prev, [task.id!]: '' })) } }} className="mt-1">
                    <input type="text" value={newSubtaskText[task.id!] || ''} onChange={(e) => setNewSubtaskText(prev => ({ ...prev, [task.id!]: e.target.value }))} placeholder="+ Add subtask..." className="w-full px-2 py-1 text-xs bg-white/80 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400" />
                  </form>
                </div>
              )}
              <DropZone index={idx + 1} insertBeforeId={tasks[idx + 1]?.id ?? undefined} />
            </div>
          )
        })}
        {tasks.length === 0 && (
          <div className="text-center text-sm text-[#9b9a97] py-8 border-2 border-dashed border-gray-200 rounded" onDragOver={(e) => handleDragOver(e, 0)} onDrop={(e) => handleDrop(e, undefined)}>Drop task here</div>
        )}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (newTaskText.trim()) { onAdd(newTaskText.trim(), targetList, 1, categoryParentId ?? undefined); setNewTaskText('') } }} className="p-2 pt-0">
        <input type="text" value={newTaskText} onChange={(e) => setNewTaskText(e.target.value)} placeholder="+ Add task..." className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400" />
      </form>
    </div>
  )
}

function TaskCard({ task, onDone, onUpdateTask, editingTaskId, setEditingTaskId, onDragStart, onDragEnd, hasSubtasks, isExpanded, onToggleExpand, isSubtaskDropTarget, onSubtaskDragOver, onSubtaskDragLeave, onSubtaskDrop, onPromote, onDemote }: {
  task: Todo & { category?: string; childCount?: number }; onDone: (id: number, recursive?: boolean) => void
  onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void; editingTaskId: number | null; setEditingTaskId: (id: number | null) => void
  onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void
  hasSubtasks: boolean; isExpanded: boolean; onToggleExpand: () => void
  isSubtaskDropTarget: boolean; onSubtaskDragOver: () => void; onSubtaskDragLeave: () => void; onSubtaskDrop: (droppedId: number) => void
  onPromote?: (id: number) => void; onDemote?: (id: number) => void
}) {
  const [hover, setHover] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isEditing = editingTaskId === task.id
  const isInProgress = task.status === 'in_progress'

  const handleStartEdit = () => { if (task.id) { setEditText(task.text); setEditingTaskId(task.id) } }
  const handleSaveEdit = () => { if (task.id && editText.trim() && editText !== task.text) onUpdateTask(task.id, { text: editText.trim() }); setEditingTaskId(null) }
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSaveEdit(); else if (e.key === 'Escape') { setEditText(task.text); setEditingTaskId(null) } }
  const handleDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); onSubtaskDragOver() }
  const handleDrop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); const id = parseInt(e.dataTransfer.getData('text/plain')); if (id && id !== task.id) onSubtaskDrop(id) }

  useEffect(() => { if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() } }, [isEditing])

  return (
    <div className={`bg-white rounded px-2 py-2 mb-1 shadow-sm hover:bg-[#fafafa] transition-colors flex items-center gap-2 min-h-[36px] group ${isInProgress ? 'border-l-2 border-[#ffc83d]' : ''} ${isSubtaskDropTarget ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onDragOver={handleDragOver} onDragLeave={onSubtaskDragLeave} onDrop={handleDrop}>
      <div className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" draggable={!!task.id} onDragStart={(e) => task.id && onDragStart(e, task)} onDragEnd={onDragEnd}><DragHandle className="w-3 h-3" /></div>
      {hasSubtasks && (
        <button onClick={(e) => { e.stopPropagation(); onToggleExpand() }} className="w-5 h-5 shrink-0 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors" title={isExpanded ? 'Collapse' : 'Expand'}>
          <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
        </button>
      )}
      <span className="text-[9px] text-[#b0b0b0] shrink-0">#{task.id}</span>
      {isInProgress && <span className="text-[10px] px-1 py-0.5 rounded bg-[#fef3c7] text-[#d97706] shrink-0" title="In Progress">●</span>}
      {isEditing ? (
        <input ref={inputRef} type="text" value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={handleKeyDown} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} className="flex-1 text-sm bg-white border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
      ) : (
        <span className="text-sm text-[#37352f] truncate cursor-text hover:bg-black/5 rounded px-1 -mx-1 flex-1" onClick={handleStartEdit}>{task.text}</span>
      )}
      {hasSubtasks && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 shrink-0">{task.childCount || '+'} sub</span>}
      <div className="shrink-0 flex items-center gap-1">
        {hover && task.id && !isEditing && onPromote && <button onClick={(e) => { e.stopPropagation(); onPromote(task.id!) }} className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Move up"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg></button>}
        {hover && task.id && !isEditing && onDemote && <button onClick={(e) => { e.stopPropagation(); onDemote(task.id!) }} className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors" title="Move down"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></button>}
        {hover && task.id && !isEditing && <button onClick={(e) => { e.stopPropagation(); onUpdateTask(task.id!, { status: isInProgress ? 'pending' : 'in_progress' }) }} className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${isInProgress ? 'bg-amber-400 text-white hover:bg-amber-500' : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-gray-300'}`} title={isInProgress ? 'Remove in-progress' : 'Mark as in-progress'}><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg></button>}
        {hover && task.id && !isEditing ? <button onClick={(e) => { e.stopPropagation(); onDone(task.id!, hasSubtasks) }} className="w-5 h-5 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors" title={hasSubtasks ? "Mark as done (with subtasks)" : "Mark as done"} /> : null}
      </div>
    </div>
  )
}

function SubtaskItem({ task, onDone, onUpdateTask, editingTaskId, setEditingTaskId, onDragStart, onDragEnd, isTopmost = false }: {
  task: Todo; onDone: (id: number, recursive?: boolean) => void; onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void
  editingTaskId: number | null; setEditingTaskId: (id: number | null) => void; onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void; isTopmost?: boolean
}) {
  const [hover, setHover] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isEditing = editingTaskId === task.id

  const handleStartEdit = () => { if (task.id) { setEditText(task.text); setEditingTaskId(task.id) } }
  const handleSaveEdit = () => { if (task.id && editText.trim() && editText !== task.text) onUpdateTask(task.id, { text: editText.trim() }); setEditingTaskId(null) }
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSaveEdit(); else if (e.key === 'Escape') { setEditText(task.text); setEditingTaskId(null) } }

  useEffect(() => { if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() } }, [isEditing])

  return (
    <div className={`rounded-md px-2 py-2 flex items-center gap-2 min-h-[40px] group ${isTopmost || task.status === 'in_progress' ? 'bg-white shadow-sm border border-amber-200' : 'bg-white/40 border border-transparent'}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" draggable={!!task.id} onDragStart={(e) => task.id && onDragStart(e, task)} onDragEnd={onDragEnd}><DragHandle className="w-3 h-3" /></div>
      <span className={`w-3 h-3 rounded-full shrink-0 ${isTopmost || task.status === 'in_progress' ? 'bg-amber-400 ring-2 ring-amber-400/20' : 'bg-gray-200'}`}></span>
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input ref={inputRef} type="text" value={editText} onChange={(e) => setEditText(e.target.value)} onBlur={handleSaveEdit} onKeyDown={handleKeyDown} className="w-full text-sm bg-white border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        ) : (
          <span className={`text-sm cursor-text hover:bg-black/5 rounded px-1 -mx-1 ${isTopmost || task.status === 'in_progress' ? 'font-bold text-[#1a1a1a]' : 'font-normal text-[#6b7280]'}`} onClick={handleStartEdit}>{task.text}</span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-3">
        {hover && task.id && !isEditing ? <button onClick={() => onUpdateTask(task.id!, { status: task.status === 'in_progress' ? 'pending' : 'in_progress' })} className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${task.status === 'in_progress' ? 'bg-amber-400 text-white hover:bg-amber-500' : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-gray-300'}`} title={task.status === 'in_progress' ? 'Remove in-progress' : 'Mark as in-progress'}><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg></button> : null}
        {hover && task.id && !isEditing ? <button onClick={() => onDone(task.id!)} className="w-5 h-5 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors" title="Mark as done" /> : null}
      </div>
    </div>
  )
}

export function InProgressSection({ tasks, onDone, onUpdateTask, onDragStart, onDragEnd, draggedTask, onReorder }: {
  tasks: Todo[]; onDone: (id: number) => void; onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void
  onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void; draggedTask: Todo | null; onReorder: (draggedId: number, targetIndex: number) => void
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const handleDragOver = (e: DragEvent, index: number) => { e.preventDefault(); e.stopPropagation(); if (draggedTask?.status === 'in_progress') { e.dataTransfer.dropEffect = 'move'; setDropIndex(index) } }
  const handleDrop = (e: DragEvent, index: number) => { e.preventDefault(); e.stopPropagation(); setDropIndex(null); const id = parseInt(e.dataTransfer.getData('text/plain')); if (id && draggedTask?.status === 'in_progress') onReorder(id, index) }

  const renderDropZone = (index: number) => {
    const isActive = dropIndex === index && draggedTask?.status === 'in_progress'
    return (
      <div key={`drop-${index}`} className="h-4 relative -my-1" onDragOver={(e) => handleDragOver(e, index)} onDragEnter={(e) => { e.preventDefault(); if (draggedTask?.status === 'in_progress') setDropIndex(index) }} onDragLeave={(e) => { e.stopPropagation() }} onDrop={(e) => handleDrop(e, index)}>
        <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-6 bg-amber-100 border-2 border-dashed border-amber-400 rounded flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}><span className="text-xs text-amber-600">Drop here</span></div>
      </div>
    )
  }

  return (
    <>
      <h2 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>In Progress<span className="text-amber-500/70 font-normal ml-1">({tasks.length})</span>
      </h2>
      <div className="flex flex-col mb-12 max-w-[600px] pb-8 relative" onDragLeave={(e) => { const rt = e.relatedTarget as HTMLElement; if (!rt || !e.currentTarget.contains(rt)) setDropIndex(null) }}>
        {renderDropZone(0)}
        {tasks.map((task, idx) => (
          <div key={task.id}>
            <InProgressCard task={task} index={idx} totalCount={tasks.length} onDone={onDone} onUpdateTask={onUpdateTask} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            {renderDropZone(idx + 1)}
          </div>
        ))}
        {tasks.length > 4 && <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />}
      </div>
    </>
  )
}

function InProgressCard({ task, index, totalCount, onDone, onUpdateTask, onDragStart, onDragEnd }: {
  task: Todo; index: number; totalCount: number; onDone: (id: number) => void
  onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void; onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void
}) {
  const [hover, setHover] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isTopItem = index < 4
  const emphasis = isTopItem ? 1 - (index * 0.12) : 0.4

  const handleStartEdit = () => { if (task.id) { setEditText(task.text); setIsEditing(true) } }
  const handleSaveEdit = () => { if (task.id && editText.trim() && editText !== task.text) onUpdateTask(task.id, { text: editText.trim() }); setIsEditing(false) }
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSaveEdit(); else if (e.key === 'Escape') { setEditText(task.text); setIsEditing(false) } }

  useEffect(() => { if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() } }, [isEditing])

  return (
    <div className={`rounded-lg shadow-md hover:shadow-lg transition-all group ${isTopItem ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-400' : 'bg-gradient-to-br from-amber-50/60 to-orange-50/60 border border-amber-200'}`}
      style={{ padding: isTopItem ? '14px 16px' : '10px 14px', opacity: emphasis + 0.3 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="flex items-center gap-3">
        <div className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" draggable={!!task.id} onDragStart={(e) => task.id && onDragStart(e, task)} onDragEnd={onDragEnd}><DragHandle className={`${isTopItem ? 'w-5 h-5' : 'w-4 h-4'} text-amber-400`} /></div>
        <div className="shrink-0">
          {isTopItem ? (
            <span className="relative flex h-4 w-4"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500"></span></span>
          ) : (
            <span className="inline-flex rounded-full h-3 w-3 bg-amber-300"></span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input ref={inputRef} type="text" value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={handleKeyDown} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
              className={`w-full font-semibold bg-white border border-amber-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400 ${isTopItem ? 'text-lg' : 'text-base'}`} placeholder="Press Enter to save, Escape to cancel" />
          ) : (
            <div className={`font-semibold cursor-text hover:bg-amber-100/50 rounded px-1 -mx-1 truncate ${isTopItem ? 'text-lg text-gray-900' : 'text-base text-gray-700'}`} onClick={handleStartEdit}>{task.text}</div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {hover && task.id && !isEditing && (
            <>
              <button onClick={handleStartEdit} className={`rounded flex items-center justify-center text-gray-400 hover:text-amber-600 hover:bg-amber-100 transition-colors ${isTopItem ? 'w-7 h-7' : 'w-6 h-6'}`} title="Rename"><svg className={isTopItem ? 'w-4 h-4' : 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
              <button onClick={() => onUpdateTask(task.id!, { status: 'pending' })} className={`rounded flex items-center justify-center bg-amber-200 text-amber-700 hover:bg-amber-300 transition-colors ${isTopItem ? 'w-7 h-7' : 'w-6 h-6'}`} title="Remove in-progress status"><svg className={isTopItem ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
              <button onClick={() => onDone(task.id!)} className={`rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors ${isTopItem ? 'w-7 h-7' : 'w-6 h-6'}`} title="Mark as done" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function DoneItem({ task, onDragStart, onDragEnd }: { task: Todo; onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void }) {
  return (
    <div className="bg-white rounded px-3 py-2 flex items-center gap-2 shadow-sm hover:bg-gray-50 transition-colors group">
      <div className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" draggable={!!task.id} onDragStart={(e) => task.id && onDragStart(e, task)} onDragEnd={onDragEnd}><DragHandle className="w-3 h-3" /></div>
      <span className="w-4 h-4 rounded-full bg-emerald-400 shrink-0 flex items-center justify-center text-white text-[10px]">✓</span>
      <span className="text-[10px] text-[#9b9a97]">#{task.id}</span>
      <span className="text-sm text-[#6b6b6b] line-through truncate">{task.text}</span>
    </div>
  )
}
