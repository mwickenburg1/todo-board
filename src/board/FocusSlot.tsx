import { useState, useEffect, useRef } from 'react'
import type { DragEvent } from 'react'
import type { Todo } from './types'
import { DragHandle } from './types'

export function FocusSlot({ task, isEmpty, subtasks, accent, idx, onDone, onDropAsSubtask, onDropReplace, onAddSubtask, onUpdateTask, editingTaskId, setEditingTaskId, draggedTask, onDragStart, onDragEnd }: {
  task: Todo; isEmpty: boolean; subtasks: Todo[]; accent: { border: string; bg: string; label: string }; idx: number
  onDone: (id: number) => void; onDropAsSubtask: (id: number, insertBeforeId?: number) => void; onDropReplace: (id: number) => void
  onAddSubtask: (text: string) => void; onUpdateTask: (id: number, updates: { text?: string }) => void
  editingTaskId: number | null; setEditingTaskId: (id: number | null) => void; draggedTask: Todo | null
  onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void
}) {
  const [headerDragOver, setHeaderDragOver] = useState(false)
  const [subtaskDropIndex, setSubtaskDropIndex] = useState<number | null>(null)
  const [newSubtaskText, setNewSubtaskText] = useState('')

  const handleHeaderDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setHeaderDragOver(true) }
  const handleHeaderDragLeave = (e: DragEvent) => { e.stopPropagation(); setHeaderDragOver(false) }
  const handleHeaderDrop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setHeaderDragOver(false); const id = parseInt(e.dataTransfer.getData('text/plain')); if (id) onDropReplace(id) }

  const handleSubtaskDragOver = (e: DragEvent, index: number) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setSubtaskDropIndex(index) }
  const handleSubtaskDragLeave = (e: DragEvent) => { const rt = e.relatedTarget as HTMLElement; if (!rt || !e.currentTarget.contains(rt)) setSubtaskDropIndex(null) }
  const handleSubtaskDrop = (e: DragEvent, dropIndex?: number) => {
    e.preventDefault(); e.stopPropagation()
    const di = dropIndex ?? subtaskDropIndex; setSubtaskDropIndex(null)
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id) { const insertBeforeId = di !== null && di < subtasks.length ? subtasks[di]?.id ?? undefined : undefined; onDropAsSubtask(id, insertBeforeId) }
  }

  const anyDragOver = headerDragOver || subtaskDropIndex !== null

  const SubtaskDropZone = ({ index }: { index: number }) => {
    const isActive = subtaskDropIndex === index && draggedTask
    return (
      <div className="h-6 relative -my-2" onDragOver={(e) => handleSubtaskDragOver(e, index)} onDragEnter={(e) => { e.preventDefault(); setSubtaskDropIndex(index) }} onDragLeave={(e) => { e.stopPropagation() }} onDrop={(e) => handleSubtaskDrop(e, index)}>
        <div className={`absolute inset-x-1 top-1/2 -translate-y-1/2 h-8 bg-blue-100 border-2 border-dashed border-blue-400 rounded flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onDragOver={(e) => handleSubtaskDragOver(e, index)} onDrop={(e) => handleSubtaskDrop(e, index)}>
          <span className="text-xs text-blue-500">Drop here</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex-1 min-w-[500px] rounded-lg border-l-4 shadow-sm transition-all ${anyDragOver ? 'ring-2 ring-offset-2' : ''}`} style={{ borderLeftColor: accent.border, background: accent.bg, '--tw-ring-color': accent.border } as React.CSSProperties}>
      <div className={`px-3 pt-3 pb-2 rounded-t-lg transition-colors ${headerDragOver ? 'bg-amber-100' : ''} ${isEmpty ? 'min-h-[180px] flex flex-col' : ''}`} onDragOver={handleHeaderDragOver} onDragLeave={handleHeaderDragLeave} onDrop={handleHeaderDrop}>
        <div className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: accent.label }}>{task.focus_slot || `Focus ${idx + 1}`}</div>
        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#9b9a97] italic border-2 border-dashed border-gray-200 rounded-lg my-2 min-h-[120px]">{headerDragOver ? 'Drop to assign focus' : 'Drop task here'}</div>
        ) : (
          <>
            <FocusTaskItem task={task} onDone={onDone} onUpdateTask={onUpdateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            {task.context && <div className="text-xs text-[#6b7280]">{task.context}</div>}
            {headerDragOver && <div className="text-xs text-amber-600 font-medium mt-1">Drop to replace focus task</div>}
          </>
        )}
      </div>
      {!isEmpty && (
        <div className="border-t border-black/10 rounded-b-lg flex flex-col">
          <div className="px-2 pt-2 min-h-[80px] max-h-[350px] overflow-y-auto flex-1" onDragLeave={handleSubtaskDragLeave}>
            {subtasks.length > 0 ? (
              <div>
                <SubtaskDropZone index={0} />
                {subtasks.map((sub, subIdx) => (
                  <div key={sub.id}>
                    <SubtaskItem task={sub} onDone={onDone} onUpdateTask={onUpdateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} onDragStart={onDragStart} onDragEnd={onDragEnd} isTopmost={subIdx === 0} />
                    <SubtaskDropZone index={subIdx + 1} />
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-6 border-2 border-dashed rounded transition-colors ${subtaskDropIndex === 0 ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`} onDragOver={(e) => handleSubtaskDragOver(e, 0)} onDrop={(e) => handleSubtaskDrop(e, 0)}>
                <span className="text-xs text-[#9b9a97] italic">Drop subtask here</span>
              </div>
            )}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (newSubtaskText.trim()) { onAddSubtask(newSubtaskText.trim()); setNewSubtaskText('') } }} className="px-2 pb-2">
            <input type="text" value={newSubtaskText} onChange={(e) => setNewSubtaskText(e.target.value)} placeholder="+ Add subtask..." className="w-full px-2 py-1 text-sm bg-white/80 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400" />
          </form>
        </div>
      )}
    </div>
  )
}

function FocusTaskItem({ task, onDone, onUpdateTask, editingTaskId, setEditingTaskId, onDragStart, onDragEnd }: {
  task: Todo; onDone: (id: number, recursive?: boolean) => void; onUpdateTask: (id: number, updates: { text?: string }) => void
  editingTaskId: number | null; setEditingTaskId: (id: number | null) => void; onDragStart: (e: DragEvent, task: Todo) => void; onDragEnd: () => void
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
    <div className="text-base font-medium mb-1 text-[#6b7280] flex items-center gap-2 group min-h-[32px]" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity" draggable={!!task.id} onDragStart={(e) => task.id && onDragStart(e, task)} onDragEnd={onDragEnd}><DragHandle /></div>
      {isEditing ? (
        <input ref={inputRef} type="text" value={editText} onChange={(e) => setEditText(e.target.value)} onKeyDown={handleKeyDown} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} className="flex-1 text-base font-medium bg-white border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400" />
      ) : (
        <span className="cursor-text hover:bg-black/5 rounded px-1 -mx-1 flex-1" onClick={handleStartEdit}>#{task.id} {task.text}</span>
      )}
      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
        {hover && task.id && !isEditing ? <button onClick={() => onDone(task.id!, true)} className="w-6 h-6 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors" title="Mark as done (with subtasks)" /> : null}
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
