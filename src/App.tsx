import { useEffect, useState, useCallback, useRef } from 'react'
import type { DragEvent } from 'react'
import StackView from './StackView'

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
  stored_category?: string
  in_progress_order?: number
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

// Drag handle icon component
function DragHandle({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 text-gray-400 ${className}`} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  )
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

// Helper to filter by category (checks both derived category from parent and stored_category)
function filterByCategory(tasks: (Todo & { category?: string })[], category: string) {
  return sortByStatus(tasks.filter(t =>
    t.category?.toLowerCase().includes(category.toLowerCase()) ||
    t.stored_category?.toLowerCase().includes(category.toLowerCase())
  ))
}

function App() {
  const [view, setView] = useState<'board' | 'stack'>(() => {
    return (localStorage.getItem('todo-view') as 'board' | 'stack') || 'stack'
  })
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draggedTask, setDraggedTask] = useState<Todo | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['today', 'tomorrow', 'backlog', 'done']))

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

  const markDone = useCallback(async (id: number, recursive: boolean = false) => {
    try {
      const res = await fetch(`/api/todos/${id}/done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recursive })
      })
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

  const updateTask = useCallback(async (id: number, updates: { text?: string; context?: string; status?: string }) => {
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (res.ok) {
        fetchData()
      }
    } catch (err) {
      console.error('Failed to update task:', err)
    }
  }, [fetchData])

  const toggleExpanded = useCallback((taskId: number) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }, [])

  // Promote/demote handlers - move between today/tomorrow/backlog preserving category
  const promoteTask = useCallback(async (id: number, toList: string, category?: string) => {
    await moveTask(id, toList, { category })
  }, [moveTask])

  const demoteTask = useCallback(async (id: number, toList: string, category?: string) => {
    await moveTask(id, toList, { category })
  }, [moveTask])

  // Reorder in-progress items (must be before early returns)
  const reorderInProgress = useCallback(async (draggedId: number, targetIndex: number, currentItems: Todo[]) => {
    const currentIndex = currentItems.findIndex(t => t.id === draggedId)
    if (currentIndex === -1) return

    // Adjust target index: when moving forward, subtract 1 because the item will be removed first
    let adjustedIndex = targetIndex
    if (currentIndex < targetIndex) {
      adjustedIndex = targetIndex - 1
    }

    if (currentIndex === adjustedIndex) return

    // Calculate new order values
    const newOrder = [...currentItems]
    const [moved] = newOrder.splice(currentIndex, 1)
    newOrder.splice(adjustedIndex, 0, moved)

    // Update order values for all items
    for (let i = 0; i < newOrder.length; i++) {
      const task = newOrder[i]
      if (task.id && task.in_progress_order !== i) {
        await fetch(`/api/todos/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ in_progress_order: i })
        })
      }
    }
    fetchData()
  }, [fetchData])

  const handleDragStart = (e: DragEvent, task: Todo) => {
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(task.id))
  }

  const handleDragEnd = () => {
    setDraggedTask(null)
  }

  if (view === 'stack') {
    return <StackView onSwitchView={() => { setView('board'); localStorage.setItem('todo-view', 'board') }} />
  }

  if (error) return <div className="p-8 text-red-500">Error: {error}</div>
  if (!data) return <div className="p-8">Loading...</div>

  const now = data.lists.now || []
  const today = data.lists.today || []
  const tomorrow = data.lists.tomorrow || []
  const backlog = data.lists.backlog || []
  const monitoring = data.lists.monitoring || []
  const doneList = data.lists.done || []

  const todayTasks = processList(today)
  const tomorrowTasks = processList(tomorrow)
  const backlogTasks = processList(backlog)
  const monitoringTasks = sortByStatus(monitoring)

  // Collect all in_progress items from all lists, sorted by in_progress_order
  const allInProgress = [
    ...today.filter(t => t.status === 'in_progress'),
    ...tomorrow.filter(t => t.status === 'in_progress'),
    ...backlog.filter(t => t.status === 'in_progress'),
    ...monitoring.filter(t => t.status === 'in_progress'),
  ].sort((a, b) => (a.in_progress_order ?? 999) - (b.in_progress_order ?? 999))

  const todayLongRunning = filterByCategory(todayTasks, 'long-running')
  const todaySync = filterByCategory(todayTasks, 'sync')

  const tomorrowLongRunning = filterByCategory(tomorrowTasks, 'long-running')
  const tomorrowSync = filterByCategory(tomorrowTasks, 'sync')
  const tomorrowMonitoring = filterByCategory(tomorrowTasks, 'monitoring')

  const backlogLongRunning = filterByCategory(backlogTasks, 'long-running')
  const backlogSync = filterByCategory(backlogTasks, 'sync')
  const backlogMonitoring = filterByCategory(backlogTasks, 'monitoring')

  const allDone = doneList
  const todayActiveCount = todayTasks.length + monitoringTasks.length
  const tomorrowActiveCount = tomorrowTasks.length
  const backlogActiveCount = backlogTasks.length

  return (
    <div className="min-h-screen bg-white p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-[#9b9a97] mb-2">Task Board</h1>
          <p className="text-sm text-[#9b9a97]">{todayActiveCount + tomorrowActiveCount} active tasks</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button className="px-3 py-1.5 text-xs font-medium bg-white text-gray-800 rounded-md shadow-sm">
            Board
          </button>
          <button
            onClick={() => { setView('stack'); localStorage.setItem('todo-view', 'stack') }}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-md transition-colors"
          >
            Stack
          </button>
        </div>
      </div>

      {/* In Progress - items actively being worked on */}
      {allInProgress.length > 0 && (
        <InProgressSection
          tasks={allInProgress}
          onDone={markDone}
          onUpdateTask={updateTask}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          draggedTask={draggedTask}
          onReorder={(draggedId, targetIndex) => reorderInProgress(draggedId, targetIndex, allInProgress)}
        />
      )}

      {/* Active Focus */}
      <h2 className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-4">Active Focus</h2>
      <div className="flex gap-4 mb-10 overflow-x-auto pb-2">
        {[...now].sort((a, b) => {
          const order: Record<string, number> = { env1: 0, env2: 1, env3: 2, env4: 3, env5: 4, env6: 5, env7: 6, env8: 7, sync: 8 }
          const posA = order[(a.focus_slot || '').toLowerCase()] ?? 99
          const posB = order[(b.focus_slot || '').toLowerCase()] ?? 99
          return posA - posB
        }).map((task, idx) => {
          const isEmpty = task.is_empty_slot || !task.id
          const subtasks = isEmpty ? [] : today.filter(t => t.parent_id === task.id && t.status !== 'done')

          const accents = [
            { border: '#c4b5fd', bg: '#faf5ff', label: '#a78bfa' },  // purple - env1
            { border: '#93c5fd', bg: '#eff6ff', label: '#60a5fa' },  // blue - env2
            { border: '#6ee7b7', bg: '#ecfdf5', label: '#34d399' },  // green - env3
            { border: '#f9a8d4', bg: '#fdf2f8', label: '#f472b6' },  // pink - env4
            { border: '#fdba74', bg: '#fff7ed', label: '#fb923c' },  // orange - env5
            { border: '#67e8f9', bg: '#ecfeff', label: '#22d3ee' },  // cyan - env6
            { border: '#a5b4fc', bg: '#eef2ff', label: '#818cf8' },  // indigo - env7
            { border: '#86efac', bg: '#f0fdf4', label: '#4ade80' },  // lime-green - env8
            { border: '#fcd34d', bg: '#fffbeb', label: '#fbbf24' },  // amber - sync
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
              onDropAsSubtask={(id, insertBeforeId) => moveTask(id, 'today', { asSubtaskOf: task.id!, insertBefore: insertBeforeId })}
              onDropReplace={(id) => moveTask(id, 'now', { focusSlot: task.focus_slot, replaceFocus: true })}
              onAddSubtask={(text) => addTask(text, 'today', 1, task.id!)}
              onUpdateTask={updateTask}
              editingTaskId={editingTaskId}
              setEditingTaskId={setEditingTaskId}
              draggedTask={draggedTask}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          )
        })}
      </div>

      {/* Today Board */}
      <h2
        className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2 select-none hover:text-[#5a5a5a] transition-colors cursor-pointer [&>*]:pointer-events-none"
        onClick={() => setCollapsedSections(prev => {
          const next = new Set(prev)
          if (next.has('today')) next.delete('today')
          else next.add('today')
          return next
        })}
      >
        <svg className={`w-3 h-3 transition-transform ${collapsedSections.has('today') ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
        Today
        <span className="text-[#9b9a97] font-normal ml-1">({todayActiveCount})</span>
      </h2>
      {!collapsedSections.has('today') && (
        <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
          <Column title="Long-running" count={todayLongRunning.length} color="#6b21a8" tasks={todayLongRunning} rawList={today} onDone={markDone} targetList="today" category="long-running" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDemote={(id) => demoteTask(id, 'tomorrow', 'long-running')} />
          <Column title="Sync" count={todaySync.length} color="#c2410c" tasks={todaySync} rawList={today} onDone={markDone} targetList="today" category="sync" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDemote={(id) => demoteTask(id, 'tomorrow', 'sync')} />
          <Column title="Monitoring" count={monitoringTasks.length} color="#529cca" tasks={monitoringTasks} onDone={markDone} targetList="monitoring" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDemote={(id) => demoteTask(id, 'tomorrow', 'monitoring')} />
        </div>
      )}
      {collapsedSections.has('today') && <div className="mb-8" />}

      {/* Tomorrow Board */}
      <h2
        className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2 select-none hover:text-[#5a5a5a] transition-colors cursor-pointer [&>*]:pointer-events-none"
        onClick={() => setCollapsedSections(prev => {
          const next = new Set(prev)
          if (next.has('tomorrow')) next.delete('tomorrow')
          else next.add('tomorrow')
          return next
        })}
      >
        <svg className={`w-3 h-3 transition-transform ${collapsedSections.has('tomorrow') ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className="w-2 h-2 rounded-full bg-blue-400"></span>
        Tomorrow
        <span className="text-[#9b9a97] font-normal ml-1">({tomorrowActiveCount})</span>
      </h2>
      {!collapsedSections.has('tomorrow') && (
        <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
          <Column title="Long-running" count={tomorrowLongRunning.length} color="#6b21a8" tasks={tomorrowLongRunning} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="long-running" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'today', 'long-running')} onDemote={(id) => demoteTask(id, 'backlog', 'long-running')} />
          <Column title="Sync" count={tomorrowSync.length} color="#c2410c" tasks={tomorrowSync} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="sync" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'today', 'sync')} onDemote={(id) => demoteTask(id, 'backlog', 'sync')} />
          <Column title="Monitoring" count={tomorrowMonitoring.length} color="#529cca" tasks={tomorrowMonitoring} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="monitoring" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'monitoring')} onDemote={(id) => demoteTask(id, 'backlog', 'monitoring')} />
        </div>
      )}
      {collapsedSections.has('tomorrow') && <div className="mb-8" />}

      {/* Backlog Board */}
      <h2
        className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2 select-none hover:text-[#5a5a5a] transition-colors cursor-pointer [&>*]:pointer-events-none"
        onClick={() => setCollapsedSections(prev => {
          const next = new Set(prev)
          if (next.has('backlog')) next.delete('backlog')
          else next.add('backlog')
          return next
        })}
      >
        <svg className={`w-3 h-3 transition-transform ${collapsedSections.has('backlog') ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className="w-2 h-2 rounded-full bg-gray-400"></span>
        Backlog
        <span className="text-[#9b9a97] font-normal ml-1">({backlogActiveCount})</span>
      </h2>
      {!collapsedSections.has('backlog') && (
        <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
          <Column title="Long-running" count={backlogLongRunning.length} color="#6b21a8" tasks={backlogLongRunning} rawList={backlog} onDone={markDone} targetList="backlog" category="long-running" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'tomorrow', 'long-running')} />
          <Column title="Sync" count={backlogSync.length} color="#c2410c" tasks={backlogSync} rawList={backlog} onDone={markDone} targetList="backlog" category="sync" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'tomorrow', 'sync')} />
          <Column title="Monitoring" count={backlogMonitoring.length} color="#529cca" tasks={backlogMonitoring} rawList={backlog} onDone={markDone} targetList="backlog" category="monitoring" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'tomorrow', 'monitoring')} />
        </div>
      )}
      {collapsedSections.has('backlog') && <div className="mb-8" />}

      {/* Done Section */}
      {allDone.length > 0 && (
        <>
          <h2
            className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2 select-none hover:text-[#5a5a5a] transition-colors cursor-pointer [&>*]:pointer-events-none"
            onClick={() => setCollapsedSections(prev => {
              const next = new Set(prev)
              if (next.has('done')) next.delete('done')
              else next.add('done')
              return next
            })}
          >
            <svg className={`w-3 h-3 transition-transform ${collapsedSections.has('done') ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Done
            <span className="text-[#9b9a97] font-normal ml-1">({allDone.length})</span>
          </h2>
          {!collapsedSections.has('done') && (
            <div className="bg-[#f7f6f3] rounded-lg p-3 max-w-[600px] max-h-[400px] overflow-y-auto">
              <div className="space-y-1">
                {allDone.map(task => (
                  <DoneItem key={task.id} task={task} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Focus slot component with separate drop zones for header (replace) and subtask area (add subtask)
function FocusSlot({ task, isEmpty, subtasks, accent, idx, onDone, onDropAsSubtask, onDropReplace, onAddSubtask, onUpdateTask, editingTaskId, setEditingTaskId, draggedTask, onDragStart, onDragEnd }: {
  task: Todo
  isEmpty: boolean
  subtasks: Todo[]
  accent: { border: string; bg: string; label: string }
  idx: number
  onDone: (id: number) => void
  onDropAsSubtask: (id: number, insertBeforeId?: number) => void
  onDropReplace: (id: number) => void
  onAddSubtask: (text: string) => void
  onUpdateTask: (id: number, updates: { text?: string }) => void
  editingTaskId: number | null
  setEditingTaskId: (id: number | null) => void
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
  const handleSubtaskDrop = (e: DragEvent, dropIndex?: number) => {
    e.preventDefault()
    e.stopPropagation()
    const currentDropIndex = dropIndex ?? subtaskDropIndex
    setSubtaskDropIndex(null)
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id) {
      // Determine which subtask to insert before based on drop index
      const insertBeforeId = currentDropIndex !== null && currentDropIndex < subtasks.length
        ? subtasks[currentDropIndex]?.id ?? undefined
        : undefined
      onDropAsSubtask(id, insertBeforeId)
    }
  }

  const anyDragOver = headerDragOver || subtaskDropIndex !== null

  // Subtask drop zone component - larger hit area for reliable drops
  const SubtaskDropZone = ({ index }: { index: number }) => {
    const isActive = subtaskDropIndex === index && draggedTask
    return (
      <div
        className="h-6 relative -my-2"
        onDragOver={(e) => handleSubtaskDragOver(e, index)}
        onDragEnter={(e) => { e.preventDefault(); setSubtaskDropIndex(index) }}
        onDragLeave={(e) => { e.stopPropagation() }}
        onDrop={(e) => handleSubtaskDrop(e, index)}
      >
        <div
          className={`absolute inset-x-1 top-1/2 -translate-y-1/2 h-8 bg-blue-100 border-2 border-dashed border-blue-400 rounded flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onDragOver={(e) => handleSubtaskDragOver(e, index)}
          onDrop={(e) => handleSubtaskDrop(e, index)}
        >
          <span className="text-xs text-blue-500">Drop here</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex-1 min-w-[500px] rounded-lg border-l-4 shadow-sm transition-all ${anyDragOver ? 'ring-2 ring-offset-2' : ''}`}
      style={{
        borderLeftColor: accent.border,
        background: accent.bg,
        '--tw-ring-color': accent.border
      } as React.CSSProperties}
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
            <FocusTaskItem task={task} onDone={onDone} onUpdateTask={onUpdateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} onDragStart={onDragStart} onDragEnd={onDragEnd} />
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
                    <SubtaskItem task={sub} onDone={onDone} onUpdateTask={onUpdateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} onDragStart={onDragStart} onDragEnd={onDragEnd} isTopmost={subIdx === 0} />
                    <SubtaskDropZone index={subIdx + 1} />
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={`text-center py-6 border-2 border-dashed rounded transition-colors ${subtaskDropIndex === 0 ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
                onDragOver={(e) => handleSubtaskDragOver(e, 0)}
                onDrop={(e) => handleSubtaskDrop(e, 0)}
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

// Focus task item with hover checkbox, drag handle, and inline editing
function FocusTaskItem({ task, onDone, onUpdateTask, editingTaskId, setEditingTaskId, onDragStart, onDragEnd }: {
  task: Todo
  onDone: (id: number, recursive?: boolean) => void
  onUpdateTask: (id: number, updates: { text?: string }) => void
  editingTaskId: number | null
  setEditingTaskId: (id: number | null) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  const [hover, setHover] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isEditing = editingTaskId === task.id

  const handleStartEdit = () => {
    if (task.id) {
      setEditText(task.text)
      setEditingTaskId(task.id)
    }
  }

  const handleSaveEdit = () => {
    if (task.id && editText.trim() && editText !== task.text) {
      onUpdateTask(task.id, { text: editText.trim() })
    }
    setEditingTaskId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditText(task.text)
      setEditingTaskId(null)
    }
  }

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  return (
    <div
      className="text-base font-medium mb-1 text-[#6b7280] flex items-center gap-2 group min-h-[32px]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Drag handle */}
      <div
        className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        draggable={!!task.id}
        onDragStart={(e) => task.id && onDragStart(e, task)}
        onDragEnd={onDragEnd}
      >
        <DragHandle />
      </div>
      {/* Text - clickable to edit */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex-1 text-base font-medium bg-white border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      ) : (
        <span
          className="cursor-text hover:bg-black/5 rounded px-1 -mx-1 flex-1"
          onClick={handleStartEdit}
        >
          #{task.id} {task.text}
        </span>
      )}
      {/* Checkbox on the right */}
      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
        {hover && task.id && !isEditing ? (
          <button
            onClick={() => onDone(task.id!, true)}
            className="w-6 h-6 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors"
            title="Mark as done (with subtasks)"
          />
        ) : null}
      </div>
    </div>
  )
}

// Subtask item with hover checkbox, drag handle, and inline editing
function SubtaskItem({ task, onDone, onUpdateTask, editingTaskId, setEditingTaskId, onDragStart, onDragEnd, isTopmost = false }: {
  task: Todo
  onDone: (id: number, recursive?: boolean) => void
  onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void
  editingTaskId: number | null
  setEditingTaskId: (id: number | null) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
  isTopmost?: boolean
}) {
  const [hover, setHover] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isEditing = editingTaskId === task.id

  const handleStartEdit = () => {
    if (task.id) {
      setEditText(task.text)
      setEditingTaskId(task.id)
    }
  }

  const handleSaveEdit = () => {
    if (task.id && editText.trim() && editText !== task.text) {
      onUpdateTask(task.id, { text: editText.trim() })
    }
    setEditingTaskId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditText(task.text)
      setEditingTaskId(null)
    }
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  return (
    <div
      className={`rounded-md px-2 py-2 flex items-center gap-2 min-h-[40px] group ${
        isTopmost || task.status === 'in_progress'
          ? 'bg-white shadow-sm border border-amber-200'
          : 'bg-white/40 border border-transparent'
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Drag handle */}
      <div
        className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        draggable={!!task.id}
        onDragStart={(e) => task.id && onDragStart(e, task)}
        onDragEnd={onDragEnd}
      >
        <DragHandle className="w-3 h-3" />
      </div>
      {/* Status indicator */}
      <span className={`w-3 h-3 rounded-full shrink-0 ${
        isTopmost || task.status === 'in_progress'
          ? 'bg-amber-400 ring-2 ring-amber-400/20'
          : 'bg-gray-200'
      }`}></span>
      {/* Text - clickable to edit */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSaveEdit}
            onKeyDown={handleKeyDown}
            className="w-full text-sm bg-white border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        ) : (
          <span
            className={`text-sm cursor-text hover:bg-black/5 rounded px-1 -mx-1 ${
              isTopmost || task.status === 'in_progress'
                ? 'font-bold text-[#1a1a1a]'
                : 'font-normal text-[#6b7280]'
            }`}
            onClick={handleStartEdit}
          >
            {task.text}
          </span>
        )}
      </div>
      {/* Action buttons on the right */}
      <div className="shrink-0 flex items-center gap-3">
        {/* In-progress toggle */}
        {hover && task.id && !isEditing ? (
          <button
            onClick={() => onUpdateTask(task.id!, { status: task.status === 'in_progress' ? 'pending' : 'in_progress' })}
            className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
              task.status === 'in_progress'
                ? 'bg-amber-400 text-white hover:bg-amber-500'
                : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-gray-300'
            }`}
            title={task.status === 'in_progress' ? 'Remove in-progress' : 'Mark as in-progress'}
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </button>
        ) : null}
        {/* Checkbox */}
        {hover && task.id && !isEditing ? (
          <button
            onClick={() => onDone(task.id!)}
            className="w-5 h-5 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors"
            title="Mark as done"
          />
        ) : null}
      </div>
    </div>
  )
}

function Column({ title, count, color, tasks, rawList, onDone, targetList, category, onDrop, onAdd, onUpdateTask, editingTaskId, setEditingTaskId, expandedTasks, toggleExpanded, draggedTask, onDragStart, onDragEnd, onPromote, onDemote }: {
  title: string
  count: number
  color: string
  tasks: (Todo & { category?: string; childCount?: number })[]
  rawList?: Todo[]
  onDone: (id: number) => void
  targetList: string
  category?: string
  onDrop: (id: number, targetList: string, options?: { category?: string; insertBefore?: number; asSubtaskOf?: number }) => void
  onAdd: (text: string, list: string, priority: number, parent_id?: number) => void
  onUpdateTask: (id: number, updates: { text?: string }) => void
  editingTaskId: number | null
  setEditingTaskId: (id: number | null) => void
  expandedTasks: Set<number>
  toggleExpanded: (id: number) => void
  draggedTask: Todo | null
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
  onPromote?: (id: number) => void
  onDemote?: (id: number) => void
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [newTaskText, setNewTaskText] = useState('')
  const [subtaskDropTarget, setSubtaskDropTarget] = useState<number | null>(null)
  const [newSubtaskText, setNewSubtaskText] = useState<{ [key: number]: string }>({})

  // Find category parent if this is a category column
  const categoryParentId = category && rawList
    ? rawList.find(t => !t.parent_id && t.text?.toLowerCase().includes(category.toLowerCase()))?.id
    : undefined

  // Get subtasks for a task
  const getSubtasks = (taskId: number) => {
    if (!rawList) return []
    return rawList.filter(t => t.parent_id === taskId && t.status !== 'done')
  }

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
      className="bg-[#f7f6f3] rounded-lg min-w-[550px] max-w-[550px] transition-all flex flex-col"
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
        {tasks.map((task, idx) => {
          const subtasks = task.id ? getSubtasks(task.id) : []
          const isExpanded = task.id ? expandedTasks.has(task.id) : false
          const hasSubtasks = subtasks.length > 0 || (task.childCount || 0) > 0
          const isSubtaskDropTarget = subtaskDropTarget === task.id

          return (
            <div key={task.id}>
              <TaskCard
                task={task}
                onDone={onDone}
                onUpdateTask={onUpdateTask}
                editingTaskId={editingTaskId}
                setEditingTaskId={setEditingTaskId}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                hasSubtasks={hasSubtasks}
                isExpanded={isExpanded}
                onToggleExpand={() => task.id && toggleExpanded(task.id)}
                isSubtaskDropTarget={isSubtaskDropTarget}
                onSubtaskDragOver={() => task.id && setSubtaskDropTarget(task.id)}
                onSubtaskDragLeave={() => setSubtaskDropTarget(null)}
                onSubtaskDrop={(droppedId) => {
                  setSubtaskDropTarget(null)
                  if (task.id) {
                    onDrop(droppedId, targetList, { asSubtaskOf: task.id })
                  }
                }}
                onPromote={onPromote ? () => task.id && onPromote(task.id) : undefined}
                onDemote={onDemote ? () => task.id && onDemote(task.id) : undefined}
              />
              {/* Expanded subtasks */}
              {isExpanded && (
                <div className="ml-6 border-l-2 border-gray-200 pl-2 mb-2">
                  {subtasks.map(sub => (
                    <div key={sub.id} className="py-1">
                      <SubtaskItem
                        task={sub}
                        onDone={onDone}
                        onUpdateTask={onUpdateTask}
                        editingTaskId={editingTaskId}
                        setEditingTaskId={setEditingTaskId}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                      />
                    </div>
                  ))}
                  {/* Add subtask input when expanded */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const text = newSubtaskText[task.id!] || ''
                      if (text.trim() && task.id) {
                        onAdd(text.trim(), targetList, 2, task.id)
                        setNewSubtaskText(prev => ({ ...prev, [task.id!]: '' }))
                      }
                    }}
                    className="mt-1"
                  >
                    <input
                      type="text"
                      value={newSubtaskText[task.id!] || ''}
                      onChange={(e) => setNewSubtaskText(prev => ({ ...prev, [task.id!]: e.target.value }))}
                      placeholder="+ Add subtask..."
                      className="w-full px-2 py-1 text-xs bg-white/80 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400"
                    />
                  </form>
                </div>
              )}
              {/* Drop zone after each item */}
              <DropZone index={idx + 1} insertBeforeId={tasks[idx + 1]?.id ?? undefined} />
            </div>
          )
        })}
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

function TaskCard({ task, onDone, onUpdateTask, editingTaskId, setEditingTaskId, onDragStart, onDragEnd, hasSubtasks, isExpanded, onToggleExpand, isSubtaskDropTarget, onSubtaskDragOver, onSubtaskDragLeave, onSubtaskDrop, onPromote, onDemote }: {
  task: Todo & { category?: string; childCount?: number }
  onDone: (id: number, recursive?: boolean) => void
  onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void
  editingTaskId: number | null
  setEditingTaskId: (id: number | null) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
  hasSubtasks: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  isSubtaskDropTarget: boolean
  onSubtaskDragOver: () => void
  onSubtaskDragLeave: () => void
  onSubtaskDrop: (droppedId: number) => void
  onPromote?: (id: number) => void
  onDemote?: (id: number) => void
}) {
  const [hover, setHover] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isEditing = editingTaskId === task.id
  const isInProgress = task.status === 'in_progress'

  const handleStartEdit = () => {
    if (task.id) {
      setEditText(task.text)
      setEditingTaskId(task.id)
    }
  }

  const handleSaveEdit = () => {
    if (task.id && editText.trim() && editText !== task.text) {
      onUpdateTask(task.id, { text: editText.trim() })
    }
    setEditingTaskId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditText(task.text)
      setEditingTaskId(null)
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSubtaskDragOver()
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id && id !== task.id) {
      onSubtaskDrop(id)
    }
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  return (
    <div
      className={`bg-white rounded px-2 py-2 mb-1 shadow-sm hover:bg-[#fafafa] transition-colors flex items-center gap-2 min-h-[36px] group ${
        isInProgress ? 'border-l-2 border-[#ffc83d]' : ''
      } ${isSubtaskDropTarget ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={handleDragOver}
      onDragLeave={onSubtaskDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag handle */}
      <div
        className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        draggable={!!task.id}
        onDragStart={(e) => task.id && onDragStart(e, task)}
        onDragEnd={onDragEnd}
      >
        <DragHandle className="w-3 h-3" />
      </div>
      {/* Expand/collapse button for items with subtasks */}
      {hasSubtasks && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          className="w-5 h-5 shrink-0 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </button>
      )}
      {/* Task ID */}
      <span className="text-[9px] text-[#b0b0b0] shrink-0">#{task.id}</span>
      {isInProgress && <span className="text-[10px] px-1 py-0.5 rounded bg-[#fef3c7] text-[#d97706] shrink-0" title="In Progress">●</span>}
      {/* Text - clickable to edit */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex-1 text-sm bg-white border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      ) : (
        <span
          className="text-sm text-[#37352f] truncate cursor-text hover:bg-black/5 rounded px-1 -mx-1 flex-1"
          onClick={handleStartEdit}
        >
          {task.text}
        </span>
      )}
      {hasSubtasks && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 shrink-0">
          {task.childCount || '+'} sub
        </span>
      )}
      {/* Action buttons on the right - visible on hover */}
      <div className="shrink-0 flex items-center gap-1">
        {/* Promote button (up arrow) */}
        {hover && task.id && !isEditing && onPromote && (
          <button
            onClick={(e) => { e.stopPropagation(); onPromote(task.id!); }}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title="Move up"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        )}
        {/* Demote button (down arrow) */}
        {hover && task.id && !isEditing && onDemote && (
          <button
            onClick={(e) => { e.stopPropagation(); onDemote(task.id!); }}
            className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
            title="Move down"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
        {/* In-progress toggle */}
        {hover && task.id && !isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); onUpdateTask(task.id!, { status: isInProgress ? 'pending' : 'in_progress' }); }}
            className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
              isInProgress
                ? 'bg-amber-400 text-white hover:bg-amber-500'
                : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50 border border-gray-300'
            }`}
            title={isInProgress ? 'Remove in-progress' : 'Mark as in-progress'}
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        {/* Checkbox */}
        {hover && task.id && !isEditing ? (
          <button
            onClick={(e) => { e.stopPropagation(); onDone(task.id!, hasSubtasks); }}
            className="w-5 h-5 rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors"
            title={hasSubtasks ? "Mark as done (with subtasks)" : "Mark as done"}
          />
        ) : null}
      </div>
    </div>
  )
}

// In Progress section with drag-drop reordering
function InProgressSection({ tasks, onDone, onUpdateTask, onDragStart, onDragEnd, draggedTask, onReorder }: {
  tasks: Todo[]
  onDone: (id: number) => void
  onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
  draggedTask: Todo | null
  onReorder: (draggedId: number, targetIndex: number) => void
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (draggedTask?.status === 'in_progress') {
      e.dataTransfer.dropEffect = 'move'
      setDropIndex(index)
    }
  }

  const handleDrop = (e: DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDropIndex(null)
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id && draggedTask?.status === 'in_progress') {
      onReorder(id, index)
    }
  }

  const renderDropZone = (index: number) => {
    const isActive = dropIndex === index && draggedTask?.status === 'in_progress'
    return (
      <div
        key={`drop-${index}`}
        className="h-4 relative -my-1"
        onDragOver={(e) => handleDragOver(e, index)}
        onDragEnter={(e) => { e.preventDefault(); if (draggedTask?.status === 'in_progress') setDropIndex(index) }}
        onDragLeave={(e) => { e.stopPropagation() }}
        onDrop={(e) => handleDrop(e, index)}
      >
        <div
          className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-6 bg-amber-100 border-2 border-dashed border-amber-400 rounded flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <span className="text-xs text-amber-600">Drop here</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <h2 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
        In Progress
        <span className="text-amber-500/70 font-normal ml-1">({tasks.length})</span>
      </h2>
      <div
        className="flex flex-col mb-12 max-w-[600px] pb-8 relative"
        onDragLeave={(e) => {
          const relatedTarget = e.relatedTarget as HTMLElement
          if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
            setDropIndex(null)
          }
        }}
      >
        {renderDropZone(0)}
        {tasks.map((task, idx) => (
          <div key={task.id}>
            <InProgressCard
              task={task}
              index={idx}
              totalCount={tasks.length}
              onDone={onDone}
              onUpdateTask={onUpdateTask}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
            {renderDropZone(idx + 1)}
          </div>
        ))}
        {/* Gradient fade at bottom to de-emphasize items beyond top 4 */}
        {tasks.length > 4 && (
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />
        )}
      </div>
    </>
  )
}

// In Progress card - prominent display for actively worked items
// Uses local editing state to avoid conflicts with same task in other sections
function InProgressCard({ task, index, totalCount, onDone, onUpdateTask, onDragStart, onDragEnd }: {
  task: Todo
  index: number
  totalCount: number
  onDone: (id: number) => void
  onUpdateTask: (id: number, updates: { text?: string; status?: string }) => void
  onDragStart: (e: DragEvent, task: Todo) => void
  onDragEnd: () => void
}) {
  const [hover, setHover] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)

  // Top 4 items get special emphasis
  const isTopItem = index < 4
  const emphasis = isTopItem ? 1 - (index * 0.12) : 0.4 // 1.0, 0.88, 0.76, 0.64, then 0.4 for rest

  const handleStartEdit = () => {
    if (task.id) {
      setEditText(task.text)
      setIsEditing(true)
    }
  }

  const handleSaveEdit = () => {
    if (task.id && editText.trim() && editText !== task.text) {
      onUpdateTask(task.id, { text: editText.trim() })
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditText(task.text)
      setIsEditing(false)
    }
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  return (
    <div
      className={`rounded-lg shadow-md hover:shadow-lg transition-all group ${
        isTopItem
          ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-400'
          : 'bg-gradient-to-br from-amber-50/60 to-orange-50/60 border border-amber-200'
      }`}
      style={{
        padding: isTopItem ? '14px 16px' : '10px 14px',
        opacity: emphasis + 0.3
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        <div
          className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
          draggable={!!task.id}
          onDragStart={(e) => task.id && onDragStart(e, task)}
          onDragEnd={onDragEnd}
        >
          <DragHandle className={`${isTopItem ? 'w-5 h-5' : 'w-4 h-4'} text-amber-400`} />
        </div>
        {/* Pulsing status indicator - only for top 4 */}
        <div className="shrink-0">
          {isTopItem ? (
            <span className="relative flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500"></span>
            </span>
          ) : (
            <span className="inline-flex rounded-full h-3 w-3 bg-amber-300"></span>
          )}
        </div>
        {/* Content - single line, bigger font for top items */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className={`w-full font-semibold bg-white border border-amber-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                isTopItem ? 'text-lg' : 'text-base'
              }`}
              placeholder="Press Enter to save, Escape to cancel"
            />
          ) : (
            <div
              className={`font-semibold cursor-text hover:bg-amber-100/50 rounded px-1 -mx-1 truncate ${
                isTopItem ? 'text-lg text-gray-900' : 'text-base text-gray-700'
              }`}
              onClick={handleStartEdit}
            >
              {task.text}
            </div>
          )}
        </div>
        {/* Actions */}
        <div className="shrink-0 flex items-center gap-2">
          {hover && task.id && !isEditing && (
            <>
              {/* Edit button */}
              <button
                onClick={handleStartEdit}
                className={`rounded flex items-center justify-center text-gray-400 hover:text-amber-600 hover:bg-amber-100 transition-colors ${
                  isTopItem ? 'w-7 h-7' : 'w-6 h-6'
                }`}
                title="Rename"
              >
                <svg className={isTopItem ? 'w-4 h-4' : 'w-3.5 h-3.5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              {/* Remove in-progress status */}
              <button
                onClick={() => onUpdateTask(task.id!, { status: 'pending' })}
                className={`rounded flex items-center justify-center bg-amber-200 text-amber-700 hover:bg-amber-300 transition-colors ${
                  isTopItem ? 'w-7 h-7' : 'w-6 h-6'
                }`}
                title="Remove in-progress status"
              >
                <svg className={isTopItem ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              {/* Mark done */}
              <button
                onClick={() => onDone(task.id!)}
                className={`rounded border-2 border-emerald-500 hover:bg-emerald-500 transition-colors ${
                  isTopItem ? 'w-7 h-7' : 'w-6 h-6'
                }`}
                title="Mark as done"
              />
            </>
          )}
        </div>
      </div>
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
      className="bg-white rounded px-3 py-2 flex items-center gap-2 shadow-sm hover:bg-gray-50 transition-colors group"
    >
      {/* Drag handle */}
      <div
        className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        draggable={!!task.id}
        onDragStart={(e) => task.id && onDragStart(e, task)}
        onDragEnd={onDragEnd}
      >
        <DragHandle className="w-3 h-3" />
      </div>
      <span className="w-4 h-4 rounded-full bg-emerald-400 shrink-0 flex items-center justify-center text-white text-[10px]">✓</span>
      <span className="text-[10px] text-[#9b9a97]">#{task.id}</span>
      <span className="text-sm text-[#6b6b6b] line-through truncate">{task.text}</span>
    </div>
  )
}


export default App
