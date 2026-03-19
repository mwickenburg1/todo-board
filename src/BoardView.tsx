import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { DragEvent } from 'react'
import type { Todo, TodoData } from './board/types'
import { processList, sortByStatus, filterByCategory } from './board/types'
import { FocusSlot } from './board/FocusSlot'
import { Column, InProgressSection, DoneItem } from './board/Column'

export default function BoardView({ onSwitchView }: { onSwitchView: () => void }) {
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draggedTask, setDraggedTask] = useState<Todo | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['queue', 'tomorrow', 'backlog', 'done']))

  const lastJsonRef = useRef('')

  const fetchData = useCallback(() => {
    fetch('/api/todos')
      .then(res => res.text())
      .then(text => {
        if (text !== lastJsonRef.current) {
          lastJsonRef.current = text
          setData(JSON.parse(text))
        }
      })
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
      if (res.ok) fetchData()
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
      if (res.ok) fetchData()
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
      if (res.ok) fetchData()
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
      if (res.ok) fetchData()
    } catch (err) {
      console.error('Failed to update task:', err)
    }
  }, [fetchData])

  const toggleExpanded = useCallback((taskId: number) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId)
      return next
    })
  }, [])

  const promoteTask = useCallback(async (id: number, toList: string, category?: string) => {
    await moveTask(id, toList, { category })
  }, [moveTask])

  const demoteTask = useCallback(async (id: number, toList: string, category?: string) => {
    await moveTask(id, toList, { category })
  }, [moveTask])

  const reorderInProgress = useCallback(async (draggedId: number, targetIndex: number, currentItems: Todo[]) => {
    const currentIndex = currentItems.findIndex(t => t.id === draggedId)
    if (currentIndex === -1) return
    let adjustedIndex = targetIndex
    if (currentIndex < targetIndex) adjustedIndex = targetIndex - 1
    if (currentIndex === adjustedIndex) return

    const newOrder = [...currentItems]
    const [moved] = newOrder.splice(currentIndex, 1)
    newOrder.splice(adjustedIndex, 0, moved)

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

  const handleDragEnd = () => setDraggedTask(null)

  if (error) return <div className="p-8 text-red-500">Error: {error}</div>
  if (!data) return <div className="p-8">Loading...</div>

  const now = data.lists.now || []
  const today = data.lists.queue || []
  const tomorrow = data.lists.tomorrow || []
  const backlog = data.lists.backlog || []
  const monitoring = data.lists.monitoring || []
  const doneList = data.lists.done || []

  const todayTasks = processList(today)
  const tomorrowTasks = processList(tomorrow)
  const backlogTasks = processList(backlog)
  const monitoringTasks = sortByStatus(monitoring)

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

  const toggleSection = (name: string) => setCollapsedSections(prev => {
    const next = new Set(prev)
    if (next.has(name)) next.delete(name); else next.add(name)
    return next
  })

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0b] p-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-[#9b9a97] mb-2">Task Board</h1>
          <p className="text-sm text-[#9b9a97]">{todayActiveCount + tomorrowActiveCount} active tasks</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          <button className="px-3 py-1.5 text-xs font-medium bg-white text-gray-800 rounded-md shadow-sm">Board</button>
          <button onClick={onSwitchView} className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-md transition-colors">Stack</button>
        </div>
      </div>

      {allInProgress.length > 0 && (
        <InProgressSection tasks={allInProgress} onDone={markDone} onUpdateTask={updateTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} draggedTask={draggedTask} onReorder={(draggedId, targetIndex) => reorderInProgress(draggedId, targetIndex, allInProgress)} />
      )}

      <h2 className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-4">Active Focus</h2>
      <div className="flex gap-4 mb-10 overflow-x-auto pb-2">
        {[...now].sort((a, b) => {
          const order: Record<string, number> = { env1: 0, env2: 1, env3: 2, env4: 3, env5: 4, env6: 5, env7: 6, env8: 7, env9: 8, env10: 9, sync: 10 }
          return (order[(a.focus_slot || '').toLowerCase()] ?? 99) - (order[(b.focus_slot || '').toLowerCase()] ?? 99)
        }).map((task, idx) => {
          const isEmpty = task.is_empty_slot || !task.id
          const subtasks = isEmpty ? [] : today.filter(t => t.parent_id === task.id && t.status !== 'done')
          const accents = [
            { border: '#c4b5fd', bg: '#faf5ff', label: '#a78bfa' },
            { border: '#93c5fd', bg: '#eff6ff', label: '#60a5fa' },
            { border: '#6ee7b7', bg: '#ecfdf5', label: '#34d399' },
            { border: '#f9a8d4', bg: '#fdf2f8', label: '#f472b6' },
            { border: '#fdba74', bg: '#fff7ed', label: '#fb923c' },
            { border: '#67e8f9', bg: '#ecfeff', label: '#22d3ee' },
            { border: '#a5b4fc', bg: '#eef2ff', label: '#818cf8' },
            { border: '#86efac', bg: '#f0fdf4', label: '#4ade80' },
            { border: '#fcd34d', bg: '#fffbeb', label: '#fbbf24' },
          ]
          return (
            <FocusSlot key={task.focus_slot || idx} task={task} isEmpty={isEmpty} subtasks={subtasks} accent={accents[idx % accents.length]} idx={idx} onDone={markDone}
              onDropAsSubtask={(id, insertBeforeId) => moveTask(id, 'queue', { asSubtaskOf: task.id!, insertBefore: insertBeforeId })}
              onDropReplace={(id) => moveTask(id, 'now', { focusSlot: task.focus_slot, replaceFocus: true })}
              onAddSubtask={(text) => addTask(text, 'queue', 1, task.id!)}
              onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
          )
        })}
      </div>

      <SectionHeader title="Today" color="bg-emerald-500" count={todayActiveCount} collapsed={collapsedSections.has('queue')} onToggle={() => toggleSection('queue')} />
      {!collapsedSections.has('queue') && (
        <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
          <Column title="Long-running" count={todayLongRunning.length} color="#6b21a8" tasks={todayLongRunning} rawList={today} onDone={markDone} targetList="queue" category="long-running" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDemote={(id) => demoteTask(id, 'tomorrow', 'long-running')} />
          <Column title="Sync" count={todaySync.length} color="#c2410c" tasks={todaySync} rawList={today} onDone={markDone} targetList="queue" category="sync" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDemote={(id) => demoteTask(id, 'tomorrow', 'sync')} />
          <Column title="Monitoring" count={monitoringTasks.length} color="#529cca" tasks={monitoringTasks} onDone={markDone} targetList="monitoring" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDemote={(id) => demoteTask(id, 'tomorrow', 'monitoring')} />
        </div>
      )}
      {collapsedSections.has('queue') && <div className="mb-8" />}

      <SectionHeader title="Tomorrow" color="bg-blue-400" count={tomorrowActiveCount} collapsed={collapsedSections.has('tomorrow')} onToggle={() => toggleSection('tomorrow')} />
      {!collapsedSections.has('tomorrow') && (
        <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
          <Column title="Long-running" count={tomorrowLongRunning.length} color="#6b21a8" tasks={tomorrowLongRunning} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="long-running" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'queue', 'long-running')} onDemote={(id) => demoteTask(id, 'backlog', 'long-running')} />
          <Column title="Sync" count={tomorrowSync.length} color="#c2410c" tasks={tomorrowSync} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="sync" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'queue', 'sync')} onDemote={(id) => demoteTask(id, 'backlog', 'sync')} />
          <Column title="Monitoring" count={tomorrowMonitoring.length} color="#529cca" tasks={tomorrowMonitoring} rawList={tomorrow} onDone={markDone} targetList="tomorrow" category="monitoring" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'monitoring')} onDemote={(id) => demoteTask(id, 'backlog', 'monitoring')} />
        </div>
      )}
      {collapsedSections.has('tomorrow') && <div className="mb-8" />}

      <SectionHeader title="Backlog" color="bg-gray-400" count={backlogActiveCount} collapsed={collapsedSections.has('backlog')} onToggle={() => toggleSection('backlog')} />
      {!collapsedSections.has('backlog') && (
        <div className="flex gap-4 overflow-x-auto pb-4 mb-8">
          <Column title="Long-running" count={backlogLongRunning.length} color="#6b21a8" tasks={backlogLongRunning} rawList={backlog} onDone={markDone} targetList="backlog" category="long-running" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'tomorrow', 'long-running')} />
          <Column title="Sync" count={backlogSync.length} color="#c2410c" tasks={backlogSync} rawList={backlog} onDone={markDone} targetList="backlog" category="sync" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'tomorrow', 'sync')} />
          <Column title="Monitoring" count={backlogMonitoring.length} color="#529cca" tasks={backlogMonitoring} rawList={backlog} onDone={markDone} targetList="backlog" category="monitoring" onDrop={moveTask} onAdd={addTask} onUpdateTask={updateTask} editingTaskId={editingTaskId} setEditingTaskId={setEditingTaskId} expandedTasks={expandedTasks} toggleExpanded={toggleExpanded} draggedTask={draggedTask} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onPromote={(id) => promoteTask(id, 'tomorrow', 'monitoring')} />
        </div>
      )}
      {collapsedSections.has('backlog') && <div className="mb-8" />}

      {allDone.length > 0 && (
        <>
          <SectionHeader title="Done" color="bg-emerald-400" count={allDone.length} collapsed={collapsedSections.has('done')} onToggle={() => toggleSection('done')} />
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

function SectionHeader({ title, color, count, collapsed, onToggle }: { title: string; color: string; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <h2
      className="text-xs font-semibold text-[#37352f] uppercase tracking-wide mb-3 flex items-center gap-2 select-none hover:text-[#5a5a5a] transition-colors cursor-pointer [&>*]:pointer-events-none"
      onClick={onToggle}
    >
      <svg className={`w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      <span className={`w-2 h-2 rounded-full ${color}`}></span>
      {title}
      <span className="text-[#9b9a97] font-normal ml-1">({count})</span>
    </h2>
  )
}
