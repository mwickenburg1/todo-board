import { useEffect, useState, useCallback, DragEvent } from 'react'

interface Todo {
  id: number | null
  text: string
  priority: number
  context: string
  status: 'pending' | 'in_progress' | 'done'
  parent_id: number | null
  children?: Todo[]
  childCount?: number
  focus_slot?: string
  is_empty_slot?: boolean
}

interface TodoData {
  lists: {
    now?: Todo[]
    today?: Todo[]
    tomorrow?: Todo[]
    backlog?: Todo[]
    monitoring?: Todo[]
    [key: string]: Todo[] | undefined
  }
}

// Helper to process a list into categorized tasks
function processList(list: Todo[]): (Todo & { category?: string; childCount?: number })[] {
  const tree = list.filter(t => !t.parent_id).map(parent => ({
    ...parent,
    children: list.filter(t => t.parent_id === parent.id)
  }))

  const tasks: (Todo & { category?: string; childCount?: number })[] = []
  tree.forEach(parent => {
    if (parent.children && parent.children.length > 0) {
      parent.children.forEach(child => {
        const childCount = list.filter(t => t.parent_id === child.id && t.status !== 'done').length
        tasks.push({ ...child, category: parent.text, childCount })
      })
    } else {
      tasks.push(parent)
    }
  })
  return tasks
}

// Helper to sort with in_progress first
function sortByStatus<T extends { status: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1
    if (b.status === 'in_progress' && a.status !== 'in_progress') return 1
    return 0
  })
}

// Helper to filter by category
function filterByCategory(tasks: (Todo & { category?: string })[], category: string) {
  return sortByStatus(tasks.filter(t =>
    t.category?.toLowerCase().includes(category.toLowerCase())
  ))
}

function App() {
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draggedTask, setDraggedTask] = useState<Todo | null>(null)

  const fetchData = useCallback(() => {
    fetch('/api/todos')
      .then(res => res.json())
      .then(setData)
      .catch(err => setError(err.message))
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const markDone = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/todos/${id}/done`, { method: 'POST' })
      if (res.ok) {
        fetchData()
      }
    } catch (err) {
      console.error('Failed to mark done:', err)
    }
  }, [fetchData])

  const moveTask = useCallback(async (id: number, targetList: string, options?: { focusSlot?: string; asSubtaskOf?: number; replaceFocus?: boolean; category?: string; insertBefore?: number }) => {
    try {
      const res = await fetch(`/api/todos/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetList, ...options })
      })
      if (res.ok) {
        fetchData()
      }
    } catch (err) {
      console.error('Failed to move task:', err)
    }
  }, [fetchData])

  const addTask = useCallback(async (text: string, list: string, priority: number = 2, parent_id?: number) => {
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, list, priority, parent_id })
      })
      if (res.ok) {
        fetchData()
      }
    } catch (err) {
      console.error('Failed to add task:', err)
    }
  }, [fetchData])

  const handleDragStart = (e: DragEvent, task: Todo) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(task.id))
  }

  const handleDragEnd = () => {
    setDraggedTask(null)
  }

  if (error) return <div className="p-8 text-red-500">Error: {error}</div>
  if (!data) return <div className="p-8">Loading...</div>

  const now = data.lists.now || []
  const today = data.lists.today || []
  const tomorrow = data.lists.tomorrow || []
  const monitoring = data.lists.monitoring || []
  const doneList = data.lists.done || []

  const todayTasks = processList(today)
  const tomorrowTasks = processList(tomorrow)
  const monitoringTasks = sortByStatus(monitoring)

  const todayLongRunning = filterByCategory(todayTasks, 'long-running')
  const todaySync = filterByCategory(todayTasks, 'sync')

  const tomorrowLongRunning = filterByCategory(tomorrowTasks, 'long-running')
  const tomorrowSync = filterByCategory(tomorrowTasks, 'sync')
  const tomorrowMonitoring = filterByCategory(tomorrowTasks, 'monitoring')

  const allDone = doneList
  const todayActiveCount = todayTasks.length + monitoringTasks.length
  const tomorrowActiveCount = tomorrowTasks.length

  return (
    <div className="min-h-screen bg-white p-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#37352f] mb-2">Task Board</h1>
        <p className="text-sm text-[#9b9a97]">{todayActiveCount + tomorrowActiveCount} active tasks</p>
      </div>

      {/* Active Focus */}
      <h2 className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-4">Active Focus</h2>
      <div className="flex gap-4 mb-10">
        {[...now].sort((a, b) => {
          const slotA = a.focus_slot || ''
          const slotB = b.focus_slot || ''
          const aIsEnv = slotA.toLowerCase().startsWith('env')
          const bIsEnv = slotB.toLowerCase().startsWith('env')
          if (aIsEnv && !bIsEnv) return -1
          if (!aIsEnv && bIsEnv) return 1
          return slotA.localeCompare(slotB)
        }).map((task, idx) => {
          const isEmpty = task.is_empty_slot || !task.id
          const subtasks = isEmpty ? [] : today.filter(t => t.parent_id === task.id && t.status !== 'done')

          const accents = [
            { border: '#6b21a8', bg: '#faf5ff', label: '#6b21a8' },
            { border: '#2563eb', bg: '#eff6ff', label: '#2563eb' },
            { border: '#059669', bg: '#ecfdf5', label: '#059669' },
            { border: '#d97706', bg: '#fffbeb', label: '#d97706' },
          ]
          const accent = accents[idx % accents.length]

          return (
            <FocusSlot
              key={task.focus_slot || idx}
              task={task}
              isEmpty={isEmpty}
              subtasks={subtasks}
              accent={accent}
              idx={idx}
              onDone={markDone}
              onDropAsSubtask={(id) => moveTask(id, 'today', { asSubtaskOf: task.id! })}
              onDropReplace={(id) => moveTask(id, 'now', { focusSlot: task.focus_slot, replaceFocus: true })}
              onAddSubtask={(text) => addTask(text, 'today', 1, task.id!)}
              draggedTask={draggedTask}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          )
        })}
      </div>

      {/* Today Board */}
      <h2 className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
        Today
        <span className="text-[#9b9a97] font-normal ml-1">({todayActiveCount})</span>
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
        <Column title="Long-running" count={todayLongRunning.length} color="#6b21a8" tasks={todayLongRunning} rawList={today} onDone={markDone} targetList="today" category="long-running" onDrop={moveTask} onAdd={addTask} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        <Column title="Sync" count={todaySync.length} color="#c2410c" tasks={todaySync} rawList={today} onDone={markDone} targetList="today" category="sync" onDrop={moveTask} onAdd={addTask} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        <Column title="Monitoring" count={monitoringTasks.length} color="#529cca" tasks={monitoringTasks} onDone={markDone} targetList="monitoring" onDrop={moveTask} onAdd={addTask} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
      </div>

      {/* Tomorrow Board */}
      <h2 className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-400"></span>
        Tomorrow
        <span className="text-[#9b9a97] font-normal ml-1">({tomorrowActiveCount})</span>
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
        <Column title="Long-running" count={tomorrowLongRunning.length} color="#6b21a8" tasks={tomorrowLongRunning} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="long-running" onDrop={moveTask} onAdd={addTask} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        <Column title="Sync" count={tomorrowSync.length} color="#c2410c" tasks={tomorrowSync} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="sync" onDrop={moveTask} onAdd={addTask} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        <Column title="Monitoring" count={tomorrowMonitoring.length} color="#529cca" tasks={tomorrowMonitoring} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="monitoring" onDrop={moveTask} onAdd={addTask} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
      </div>

      {/* Done Section */}
      {allDone.length > 0 && (
        <>
          <h2 className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Done
            <span className="text-[#9b9a97] font-normal ml-1">({allDone.length})</span>
          </h2>
          <div className="bg-[#f7f6f3] rounded-lg p-3 max-w-[600px] max-h-[400px] overflow-y-auto">
            <div className="space-y-1">
              {allDone.map(task => (
                <DoneItem key={task.id} task={task} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Focus slot component with separate drop zones for header (replace) and subtask area (add subtask)
function FocusSlot({ task, isEmpty, subtasks, accent, idx, onDone, onDropAsSubtask, onDropReplace, onAddSubtask, draggedTask, onDragStart, onDragEnd }: {
  task: Todo
  isEmpty: boolean
  subtasks: Todo[]
  accent: { border: string; bg: string; label: string }
  idx: number
  onDone: (id: number) => void
  onDropAsSubtask: (id: number) => void
  onDropReplace: (id: number) => void
  onAddSubtask: (text: string) => void
  draggedTask: Todo | null
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  const [headerDragOver, setHeaderDragOver] = useState(false)
  const [subtaskDropIndex, setSubtaskDropIndex] = useState<number | null>(null)
  const [newSubtaskText, setNewSubtaskText] = useState('')

  // Header drop zone handlers (replace focus task)
  const handleHeaderDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setHeaderDragOver(true)
  }
  const handleHeaderDragLeave = (e: DragEvent) => {
    e.stopPropagation()
    setHeaderDragOver(false)
  }
  const handleHeaderDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setHeaderDragOver(false)
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id) onDropReplace(id)
  }

  // Subtask drop zone handlers
  const handleSubtaskDragOver = (e: DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setSubtaskDropIndex(index)
  }
  const handleSubtaskDragLeave = (e: DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setSubtaskDropIndex(null)
    }
  }
  const handleSubtaskDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSubtaskDropIndex(null)
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id) onDropAsSubtask(id)
  }

  const anyDragOver = headerDragOver || subtaskDropIndex !== null

  // Subtask drop zone component - larger hit area for reliable drops
  const SubtaskDropZone = ({ index }: { index: number }) => {
    const isActive = subtaskDropIndex === index && draggedTask
    return (
      <div
        className={`h-3 relative transition-all ${isActive ? 'h-8' : ''}`}
        onDragOver={(e) => handleSubtaskDragOver(e, index)}
        onDragEnter={(e) => { e.preventDefault(); setSubtaskDropIndex(index) }}
        onDrop={handleSubtaskDrop}
      >
        {isActive && (
          <div className="absolute inset-x-0 inset-y-0 bg-blue-100 border-2 border-dashed border-blue-400 rounded flex items-center justify-center">
            <span className="text-xs text-blue-500">Drop here</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`flex-1 rounded-lg border-l-4 shadow-sm transition-all ${anyDragOver ? 'ring-2 ring-offset-2' : ''}`}
      style={{
        borderLeftColor: accent.border,
        background: accent.bg,
        ringColor: accent.border
      }}
    >
      {/* Header area - drop here to REPLACE the focus task */}
      <div
        className={`px-3 pt-3 pb-2 rounded-t-lg transition-colors ${headerDragOver ? 'bg-amber-100' : ''} ${isEmpty ? 'min-h-[180px] flex flex-col' : ''}`}
        onDragOver={handleHeaderDragOver}
        onDragLeave={handleHeaderDragLeave}
        onDrop={handleHeaderDrop}
      >
        <div className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: accent.label }}>
          {task.focus_slot || `Focus ${idx + 1}`}
        </div>
        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#9b9a97] italic border-2 border-dashed border-gray-200 rounded-lg my-2 min-h-[120px]">
            {headerDragOver ? 'Drop to assign focus' : 'Drop task here'}
          </div>
        ) : (
          <>
            <FocusTaskItem task={task} onDone={onDone} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            {task.context && (
              <div className="text-xs text-[#6b7280]">{task.context}</div>
            )}
            {headerDragOver && (
              <div className="text-xs text-amber-600 font-medium mt-1">Drop to replace focus task</div>
            )}
          </>
        )}
      </div>

      {/* Subtask area - with drop zones between items */}
      {!isEmpty && (
        <div className="border-t border-black/10 rounded-b-lg flex flex-col">
          <div
            className="px-2 pt-2 min-h-[80px] max-h-[350px] overflow-y-auto flex-1"
            onDragLeave={handleSubtaskDragLeave}
          >
            {subtasks.length > 0 ? (
              <div>
                <SubtaskDropZone index={0} />
                {subtasks.map((sub, subIdx) => (
                  <div key={sub.id}>
                    <SubtaskItem task={sub} onDone={onDone} onDragStart={onDragStart} onDragEnd={onDragEnd} />
                    <SubtaskDropZone index={subIdx + 1} />
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={`text-center py-6 border-2 border-dashed rounded transition-colors ${subtaskDropIndex === 0 ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
                onDragOver={(e) => handleSubtaskDragOver(e, 0)}
                onDrop={handleSubtaskDrop}
              >
                <span className="text-xs text-[#9b9a97] italic">Drop subtask here</span>
              </div>
            )}
          </div>
          {/* Add subtask input */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newSubtaskText.trim()) {
                onAddSubtask(newSubtaskText.trim())
                setNewSubtaskText('')
              }
            }}
            className="px-2 pb-2"
          >
            <input
              type="text"
              value={newSubtaskText}
              onChange={(e) => setNewSubtaskText(e.target.value)}
              placeholder="+ Add subtask..."
              className="w-full px-2 py-1 text-sm bg-white/80 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400"
            />
          </form>
        </div>
      )}
    </div>
  )
}

// Focus task item with hover checkbox and drag
function FocusTaskItem({ task, onDone, onDragStart, onDragEnd }: {
  task: Todo
  onDone: (id: number) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      className="text-lg font-bold mb-1 text-[#1a1a1a] flex items-center gap-2 group cursor-grab active:cursor-grabbing min-h-[32px]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={!!task.id}
      onDragStart={(e) => task.id && onDragStart(e, task)}
      onDragEnd={onDragEnd}
    >
      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
        {hover && task.id ? (
          <button
            onClick={() => onDone(task.id!)}
            className="w-6 h-6 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors"
            title="Mark as done"
          />
        ) : null}
      </div>
      <span>#{task.id} {task.text}</span>
    </div>
  )
}

// Subtask item with hover checkbox and drag
function SubtaskItem({ task, onDone, onDragStart, onDragEnd }: {
  task: Todo
  onDone: (id: number) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      className={`rounded-md px-2 py-2 flex items-center gap-2 cursor-grab active:cursor-grabbing min-h-[40px] ${
        task.status === 'in_progress'
          ? 'bg-white shadow-sm border border-amber-200'
          : 'bg-white/60 border border-transparent'
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={!!task.id}
      onDragStart={(e) => task.id && onDragStart(e, task)}
      onDragEnd={onDragEnd}
    >
      <div className="w-5 h-5 shrink-0 flex items-center justify-center">
        {hover && task.id ? (
          <button
            onClick={() => onDone(task.id!)}
            className="w-5 h-5 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors"
            title="Mark as done"
          />
        ) : (
          <span className={`w-5 h-5 rounded-full ${
            task.status === 'in_progress'
              ? 'bg-amber-400 ring-4 ring-amber-400/20'
              : 'bg-gray-300'
          }`}></span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${
          task.status === 'in_progress'
            ? 'font-bold text-[#1a1a1a]'
            : 'font-medium text-[#374151]'
        }`}>
          {task.text}
        </span>
      </div>
    </div>
  )
}

function Column({ title, count, color, tasks, rawList, onDone, targetList, category, onDrop, onAdd, draggedTask, onDragStart, onDragEnd }: {
  title: string
  count: number
  color: string
  tasks: (Todo & { category?: string; childCount?: number })[]
  rawList?: Todo[]
  onDone: (id: number) => void
  targetList: string
  category?: string
  onDrop: (id: number, targetList: string, options?: { category?: string; insertBefore?: number }) => void
  onAdd: (text: string, list: string, priority: number, parent_id?: number) => void
  draggedTask: Todo | null
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [newTaskText, setNewTaskText] = useState('')

  // Find category parent if this is a category column
  const categoryParentId = category && rawList
    ? rawList.find(t => !t.parent_id && t.text?.toLowerCase().includes(category.toLowerCase()))?.id
    : undefined

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(index)
  }

  const handleDragLeave = (e: DragEvent) => {
    // Only clear if leaving the column entirely
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDropIndex(null)
    }
  }

  const handleDrop = (e: DragEvent, insertBeforeId?: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDropIndex(null)
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id) {
      onDrop(id, targetList, { category, insertBefore: insertBeforeId })
    }
  }

  // Drop zone component - larger hit area for reliable drops
  const DropZone = ({ index, insertBeforeId }: { index: number; insertBeforeId?: number }) => {
    const isActive = dropIndex === index && draggedTask
    return (
      <div
        className="h-6 relative -my-2"
        onDragOver={(e) => handleDragOver(e, index)}
        onDragEnter={(e) => { e.preventDefault(); setDropIndex(index) }}
        onDragLeave={(e) => { e.stopPropagation() }}
        onDrop={(e) => handleDrop(e, insertBeforeId)}
      >
        <div
          className={`absolute inset-x-1 top-1/2 -translate-y-1/2 h-8 bg-blue-100 border-2 border-dashed border-blue-400 rounded flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, insertBeforeId)}
        >
          <span className="text-xs text-blue-500">Drop here</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="bg-[#f7f6f3] rounded-lg min-w-[420px] max-w-[420px] transition-all flex flex-col"
      onDragLeave={handleDragLeave}
    >
      <div className="p-3 border-b border-[#e9e9e7] flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }}></span>
        <span className="font-semibold text-sm" style={{ color: color === '#9b9a97' ? '#6b6b6b' : color.replace('ff', 'aa') }}>
          {title}
        </span>
        <span className="bg-[#e9e9e7] text-[#6b6b6b] text-xs px-2 py-0.5 rounded-full ml-auto">
          {count}
        </span>
      </div>
      <div className="p-2 max-h-[500px] overflow-y-auto min-h-[60px] flex-1">
        {/* Drop zone at start */}
        <DropZone index={0} insertBeforeId={tasks[0]?.id ?? undefined} />
        {tasks.map((task, idx) => (
          <div key={task.id}>
            <TaskCard task={task} onDone={onDone} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            {/* Drop zone after each item */}
            <DropZone index={idx + 1} insertBeforeId={tasks[idx + 1]?.id ?? undefined} />
          </div>
        ))}
        {tasks.length === 0 && (
          <div
            className="text-center text-sm text-[#9b9a97] py-8 border-2 border-dashed border-gray-200 rounded"
            onDragOver={(e) => handleDragOver(e, 0)}
            onDrop={(e) => handleDrop(e, undefined)}
          >
            Drop task here
          </div>
        )}
      </div>
      {/* Add task input - fixed at bottom */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (newTaskText.trim()) {
            onAdd(newTaskText.trim(), targetList, 1, categoryParentId ?? undefined)
            setNewTaskText('')
          }
        }}
        className="p-2 pt-0"
      >
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          placeholder="+ Add task..."
          className="w-full px-2 py-1.5 text-sm bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400"
        />
      </form>
    </div>
  )
}

function TaskCard({ task, onDone, onDragStart, onDragEnd }: {
  task: Todo & { category?: string; childCount?: number }
  onDone: (id: number) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  const [hover, setHover] = useState(false)
  const isInProgress = task.status === 'in_progress'
  const hasSubtasks = (task.childCount || 0) > 0

  return (
    <div
      className={`bg-white rounded px-2 py-2 mb-1 shadow-sm hover:bg-[#fafafa] cursor-grab active:cursor-grabbing transition-colors flex items-center gap-2 min-h-[36px] ${
        isInProgress ? 'border-l-2 border-[#ffc83d]' : ''
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={!!task.id}
      onDragStart={(e) => task.id && onDragStart(e, task)}
      onDragEnd={onDragEnd}
    >
      <div className="w-5 h-5 shrink-0 flex items-center justify-center">
        {hover && task.id ? (
          <button
            onClick={(e) => { e.stopPropagation(); onDone(task.id!); }}
            className="w-5 h-5 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors"
            title="Mark as done"
          />
        ) : (
          <span className="text-[9px] text-[#b0b0b0]">#{task.id}</span>
        )}
      </div>
      {isInProgress && <span className="text-[10px] px-1 py-0.5 rounded bg-[#fef3c7] text-[#d97706] shrink-0" title="In Progress">●</span>}
      <span className="text-sm text-[#37352f] truncate">{task.text}</span>
      {hasSubtasks && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 shrink-0 ml-auto">
          {task.childCount} sub
        </span>
      )}
    </div>
  )
}

// Done item - draggable back to other lists
function DoneItem({ task, onDragStart, onDragEnd }: {
  task: Todo
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  return (
    <div
      className="bg-white rounded px-3 py-2 flex items-center gap-2 shadow-sm cursor-grab active:cursor-grabbing hover:bg-gray-50 transition-colors"
      draggable={!!task.id}
      onDragStart={(e) => task.id && onDragStart(e, task)}
      onDragEnd={onDragEnd}
    >
      <span className="w-4 h-4 rounded-full bg-emerald-400 shrink-0 flex items-center justify-center text-white text-[10px]">✓</span>
      <span className="text-[10px] text-[#9b9a97]">#{task.id}</span>
      <span className="text-sm text-[#6b6b6b] line-through truncate">{task.text}</span>
    </div>
  )
}


export default App
