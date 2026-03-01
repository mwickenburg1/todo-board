import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { Todo, TodoData, StackItem, EnvStatusRemote } from './stack/types'
import { processForStack, PINNED_LISTS } from './stack/data'
import { DocumentLine } from './stack/InlineCapture'
import { StackSection } from './stack/StackSection'
import { EnvStatusBar } from './stack/EnvStatusBar'
import { useTaskActions } from './stack/useTaskActions'
import { useOptimisticActions } from './stack/useOptimisticActions'
import { PulseBanner } from './stack/PulseBanner'
import { RootGap } from './stack/RootGap'

export default function StackView() {
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [envStatusRemote, setEnvStatusRemote] = useState<Record<string, EnvStatusRemote>>({})
  const [collapsedStacks, setCollapsedStacks] = useState<Set<string>>(new Set(['done']))
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())
  const [draggedItem, setDraggedItem] = useState<StackItem | null>(null)
  const [draggingSection, setDraggingSection] = useState<string | null>(null)
  const [activeRootGap, setActiveRootGap] = useState<number | null>(null)
  const [gapSpacers, setGapSpacers] = useState<Record<number, number>>({})

  const lastJsonRef = useRef('')
  const lastEnvJsonRef = useRef('')

  const fetchData = useCallback(() => {
    const active = document.activeElement as HTMLInputElement
    if (active?.tagName === 'INPUT' && active.dataset.dirty === 'true') return

    fetch('/api/todos')
      .then(res => res.text())
      .then(text => {
        if (text !== lastJsonRef.current) {
          lastJsonRef.current = text
          setData(JSON.parse(text))
        }
      })
      .catch(err => setError(err.message))
    fetch('/api/env-status')
      .then(res => res.text())
      .then(text => {
        if (text !== lastEnvJsonRef.current) {
          lastEnvJsonRef.current = text
          setEnvStatusRemote(JSON.parse(text))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Cmd+Z / Ctrl+Z undo
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
  const optimistic = useOptimisticActions(actions, setData)

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

  const processed = useMemo(() => data ? processForStack(data) : null, [data])

  if (error) return <div className="p-8 text-red-500 text-sm">Error: {error}</div>
  if (!data || !processed) return <div className="p-8 text-gray-400 text-sm">Loading...</div>

  const { stacks, stackNames, doneItems, envSlots } = processed
  const pulseItems = (data.lists.pulse || []).filter(t => t.id && t.status !== 'done')

  const dismissPulse = async (id: number) => {
    setData(prev => {
      if (!prev) return prev
      return { ...prev, lists: { ...prev.lists, pulse: (prev.lists.pulse || []).filter(t => t.id !== id) } }
    })
    try { await fetch(`/api/todos/${id}`, { method: 'DELETE' }) } catch {}
  }

  return (
    <div className="min-h-screen bg-white pb-16">
      <div className="max-w-6xl mx-auto px-8 pt-8">
        <PulseBanner items={pulseItems} onDismiss={dismissPulse} />

        {/* Pinned sections */}
        {PINNED_LISTS.filter(name => stacks[name]).map(name => (
          <StackSection
            key={name}
            name={name}
            label={data.section_labels?.[name] || 'Daily Goals'}
            pinned
            actionable={stacks[name]?.actionable || []}
            waiting={stacks[name]?.waiting || []}
            collapsed={collapsedStacks.has(name)}
            onToggle={() => toggleStack(name)}
            onCapture={(text, column) => optimistic.capture(text, name, column)}
            onDone={actions.markDone}
            onUpdate={actions.updateTask}
            onToggleStatus={optimistic.toggleStatus}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            draggedItem={draggedItem}
            onDropItem={actions.dropItem}
            expandedItems={expandedItems}
            onToggleExpand={toggleExpand}
            onRename={optimistic.renameStack}
            onInsertItem={optimistic.insertItem}
            onSplitItem={optimistic.splitItem}
            onDeleteTask={actions.deleteTask}
            onAddLink={actions.addLink}
            onRemoveLink={actions.removeLink}
            onMoveItem={(id, column, direction) => optimistic.moveItem(id, name, column, direction)}
          />
        ))}

        {stackNames.map((name, i) => (
          <div key={name}>
            <RootGap
              active={activeRootGap === i}
              onActivate={() => setActiveRootGap(i)}
              onDeactivate={() => setActiveRootGap(null)}
              onCreateStack={(sectionName) => optimistic.createStack(sectionName, name)}
              onCapture={(text) => optimistic.capture(text, name, 'actionable')}
              spacers={gapSpacers[i] || 0}
              onSetSpacers={(n) => setGapSpacers(prev => ({ ...prev, [i]: n }))}
            />
            <StackSection
              name={name}
              label={data.section_labels?.[name]}
              isFirstSection={i === 0}
              actionable={stacks[name]?.actionable || []}
              waiting={stacks[name]?.waiting || []}
              collapsed={collapsedStacks.has(name)}
              onToggle={() => toggleStack(name)}
              onCapture={(text, column) => optimistic.capture(text, name, column)}
              onDone={actions.markDone}
              onUpdate={actions.updateTask}
              onToggleStatus={optimistic.toggleStatus}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              draggedItem={draggedItem}
              onDropItem={actions.dropItem}
              expandedItems={expandedItems}
              onToggleExpand={toggleExpand}
              onRename={optimistic.renameStack}
              onCreateStack={(sectionName) => optimistic.createStack(sectionName, name)}
              onInsertItem={optimistic.insertItem}
              onSplitItem={optimistic.splitItem}
              onInsertAbove={() => setActiveRootGap(i)}
              onInsertBelow={() => setActiveRootGap(i + 1)}
              onDeleteTask={actions.deleteTask}
              onDeleteStack={actions.deleteStack}
              onSectionDragStart={setDraggingSection}
              onSectionDragEnd={() => setDraggingSection(null)}
              onSectionDrop={(name, before) => { setDraggingSection(null); actions.reorderSections(name, before) }}
              draggingSection={draggingSection}
              onAddLink={actions.addLink}
              onRemoveLink={actions.removeLink}
              onMoveItem={(id, column, direction) => optimistic.moveItem(id, name, column, direction)}
            />
          </div>
        ))}

        <RootGap
          active={activeRootGap === stackNames.length}
          onActivate={() => setActiveRootGap(stackNames.length)}
          onDeactivate={() => setActiveRootGap(null)}
          onCreateStack={(sectionName) => optimistic.createStack(sectionName)}
          onCapture={(text) => optimistic.capture(text, stackNames[stackNames.length - 1] || 'today', 'actionable')}
          spacers={gapSpacers[stackNames.length] || 0}
          onSetSpacers={(n) => setGapSpacers(prev => ({ ...prev, [stackNames.length]: n }))}
        />

        <DocumentLine
          onCreateStack={optimistic.createStack}
          onCapture={(text) => optimistic.capture(text, stackNames[0] || 'today', 'actionable')}
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

      <EnvStatusBar envSlots={envSlots} remoteStatus={envStatusRemote} />
    </div>
  )
}
