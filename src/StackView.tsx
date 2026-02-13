import { useEffect, useState, useCallback } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { TodoData, StackItem, EnvStatusRemote } from './stack/types'
import { processForStack } from './stack/data'
import { DocumentLine } from './stack/StackLine'
import { StackSection } from './stack/StackSection'
import { EnvStatusBar } from './stack/EnvStatusBar'
import { useTaskActions } from './stack/useTaskActions'

export default function StackView({ onSwitchView }: { onSwitchView: () => void }) {
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [envStatusRemote, setEnvStatusRemote] = useState<Record<string, EnvStatusRemote>>({})
  const [collapsedStacks, setCollapsedStacks] = useState<Set<string>>(new Set(['done']))
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())
  const [draggedItem, setDraggedItem] = useState<StackItem | null>(null)
  const [draggingSection, setDraggingSection] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    fetch('/api/todos')
      .then(res => res.json())
      .then(setData)
      .catch(err => setError(err.message))
    fetch('/api/env-status')
      .then(res => res.json())
      .then(setEnvStatusRemote)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Cmd+Z / Ctrl+Z undo — only when not editing an input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        const active = document.activeElement as HTMLInputElement
        if (active?.tagName === 'INPUT' && active.dataset.dirty === 'true') return
        e.preventDefault()
        fetch('/api/undo', { method: 'POST' })
          .then(res => res.json())
          .then(result => { if (result.success) fetchData() })
          .catch(() => {})
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fetchData])

  const actions = useTaskActions(fetchData)

  const handleDragStart = (e: ReactDragEvent, item: StackItem) => {
    setDraggedItem(item)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(item.id))
  }

  const handleDragEnd = () => setDraggedItem(null)

  const toggleExpand = useCallback((id: number) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleStack = useCallback((name: string) => {
    setCollapsedStacks(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }, [])

  if (error) return <div className="p-8 text-red-500 text-sm">Error: {error}</div>
  if (!data) return <div className="p-8 text-gray-400 text-sm">Loading...</div>

  const { stacks, stackNames, doneItems, envSlots } = processForStack(data)

  return (
    <div className="min-h-screen bg-white pb-16">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-8 pt-8 pb-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-gray-800">Tasks</h1>
          <button
            onClick={onSwitchView}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Board view &rarr;
          </button>
        </div>
      </div>

      {/* Stacks */}
      <div className="max-w-5xl mx-auto px-8">
        {stackNames.map((name, i) => (
          <StackSection
            key={name}
            name={name}
            actionable={stacks[name]?.actionable || []}
            waiting={stacks[name]?.waiting || []}
            collapsed={collapsedStacks.has(name)}
            onToggle={() => toggleStack(name)}
            onCapture={(text, column) => actions.capture(text, name, column)}
            onDone={actions.markDone}
            onUpdate={actions.updateTask}
            onToggleStatus={actions.toggleStatus}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            draggedItem={draggedItem}
            onDropItem={actions.dropItem}
            expandedItems={expandedItems}
            onToggleExpand={toggleExpand}
            onRename={actions.renameStack}
            onCreateStack={actions.createStack}
            onInsertItem={actions.insertItem}
            onSplitItem={actions.splitItem}
            onInsertAbove={() => {
              if (i > 0) {
                actions.insertItem(stackNames[i - 1], 'actionable', '')
              } else {
                actions.insertAboveSection(name)
              }
            }}
            onDeleteTask={actions.deleteTask}
            onDeleteStack={actions.deleteStack}
            onSectionDragStart={setDraggingSection}
            onSectionDragEnd={() => setDraggingSection(null)}
            onSectionDrop={(name, before) => { setDraggingSection(null); actions.reorderSections(name, before) }}
            draggingSection={draggingSection}
          />
        ))}

        <DocumentLine
          onCreateStack={actions.createStack}
          onCapture={(text) => actions.capture(text, stackNames[0] || 'today', 'actionable')}
        />

        {/* Done - collapsed by default */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => toggleStack('done')} className="text-gray-400 hover:text-gray-600 transition-colors">
              <span className={`text-xs inline-block transition-transform ${collapsedStacks.has('done') ? '' : 'rotate-90'}`}>&#9654;</span>
            </button>
            <h2 className="text-lg font-semibold text-gray-400">Done</h2>
          </div>
          {!collapsedStacks.has('done') && (
            <div className="pl-5 max-h-[300px] overflow-y-auto">
              {doneItems.map(item => (
                <div key={item.id} className="flex items-center gap-2 py-[2px] px-1 text-[13px] text-gray-400">
                  <span className="text-emerald-400 text-[10px]">&#10003;</span>
                  <span className="line-through truncate">{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Env Status */}
      <EnvStatusBar envSlots={envSlots} remoteStatus={envStatusRemote} />
    </div>
  )
}
