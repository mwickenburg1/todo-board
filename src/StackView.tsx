import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { Todo, TodoData, StackItem } from './stack/types'
import { processForStack, PINNED_LISTS, PINNED_LABELS } from './stack/data'
import { DocumentLine } from './stack/InlineCapture'
import { StackSection } from './stack/StackSection'
import { useTaskActions } from './stack/useTaskActions'
import { useOptimisticActions } from './stack/useOptimisticActions'
import { PulseBanner } from './stack/PulseBanner'
import { RootGap } from './stack/RootGap'
import { FocusQueue } from './stack/FocusQueue'
import { EveningOverlay } from './stack/EveningOverlay'
import { MorningOverlay } from './stack/MorningOverlay'

export default function StackView() {
  const [data, setData] = useState<TodoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsedStacks, setCollapsedStacks] = useState<Set<string>>(new Set(['done']))
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())
  const [draggedItem, setDraggedItem] = useState<StackItem | null>(null)
  const [draggingSection, setDraggingSection] = useState<string | null>(null)
  const [activeRootGap, setActiveRootGap] = useState<number | null>(null)
  const [gapSpacers, setGapSpacers] = useState<Record<number, number>>({})
  const [focusedSection, setFocusedSection] = useState<string | null>(null)
  const [dark, setDark] = useState(() => localStorage.getItem('dark-mode') === 'true')
  const [disconnected, setDisconnected] = useState(false)
  const [morningDismissed, setMorningDismissed] = useState(true) // default true to avoid flash

  const lastJsonRef = useRef('')

  const fetchData = useCallback(() => {
    const active = document.activeElement as HTMLInputElement
    if (active?.tagName === 'INPUT' && active.dataset.dirty === 'true') return

    fetch('/api/todos')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text() })
      .then(text => {
        if (!text || !text.startsWith('{')) return // ignore empty/invalid responses during server restart
        if (text !== lastJsonRef.current) {
          lastJsonRef.current = text
          setData(JSON.parse(text))
        }
      })
      .catch(() => {}) // silently retry on next interval
  }, [])

  const checkOverlays = useCallback(() => {
    fetch('/api/disconnected')
      .then(res => res.json())
      .then(({ disconnected: d }) => setDisconnected(d))
      .catch(() => {})
    fetch('/api/morning-status')
      .then(res => res.json())
      .then(({ dismissed }) => setMorningDismissed(dismissed))
      .catch(() => {})
  }, [])

  const dismissMorning = useCallback(() => {
    setMorningDismissed(true)
    fetch('/api/morning-dismiss', { method: 'POST' }).catch(() => {})
  }, [])

  // Poll overlays faster when morning overlay is showing (Hammerspoon triggers server-side dismiss)
  const morningActive = !disconnected && !morningDismissed
  useEffect(() => {
    fetchData()
    checkOverlays()
    const interval = setInterval(fetchData, 5000)
    const dcInterval = setInterval(checkOverlays, morningActive ? 1_000 : 60_000)
    return () => { clearInterval(interval); clearInterval(dcInterval) }
  }, [fetchData, checkOverlays, morningActive])

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

  const toggleEscalation = useCallback((id: number, currentLevel: number, targetLevel: number) => {
    const newLevel = currentLevel === targetLevel ? 0 : targetLevel
    setData(prev => {
      if (!prev) return prev
      const newLists = { ...prev.lists }
      // Clear others at this level
      if (newLevel > 0) {
        for (const [listName, items] of Object.entries(newLists)) {
          if (!items) continue
          newLists[listName] = items.map(t =>
            t.escalation === newLevel && t.id !== id ? { ...t, escalation: 0 } : t
          )
        }
      }
      // Set this item
      for (const [listName, items] of Object.entries(newLists)) {
        if (!items) continue
        const idx = items.findIndex(t => t.id === id)
        if (idx !== -1) {
          const newItems = [...items]
          newItems[idx] = { ...newItems[idx], escalation: newLevel }
          newLists[listName] = newItems
          break
        }
      }
      return { ...prev, lists: newLists }
    })
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalation: newLevel }),
    }).then(() => fetchData()).catch(() => {})
  }, [fetchData, setData])

  const processed = useMemo(() => data ? processForStack(data, data.snoozeMap) : null, [data])

  // FocusQueue fetches its own data from /api/focus — no client-side computation needed

  // Sync dark class on mount (must be before early returns)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [])

  if (error) return <div className="p-8 text-red-500 text-sm">Error: {error}</div>
  if (!data || !processed) return <div className="p-8 text-gray-400 text-sm">Loading...</div>

  const { stacks, stackNames, doneItems } = processed
  const pulseItems = (data.lists.pulse || []).filter(t => t.id && t.status !== 'done')

  const dismissPulse = async (id: number) => {
    setData(prev => {
      if (!prev) return prev
      return { ...prev, lists: { ...prev.lists, pulse: (prev.lists.pulse || []).filter(t => t.id !== id) } }
    })
    try { await fetch(`/api/todos/${id}`, { method: 'DELETE' }) } catch {}
  }

  const toggleDark = () => {
    setDark(d => {
      const next = !d
      localStorage.setItem('dark-mode', String(next))
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-white pb-16">
      <MorningOverlay active={!disconnected && !morningDismissed} onDismiss={dismissMorning} />
      <EveningOverlay active={disconnected} />
      <div className="max-w-6xl mx-auto px-8 pt-8">
        {/* Focus Queue — display-only, fetches its own data from /api/focus */}
        <FocusQueue />

        <PulseBanner items={pulseItems} onDismiss={dismissPulse} snoozeMap={data.snoozeMap} />

        {/* Pinned "Today" section */}
        {PINNED_LISTS.filter(name => stacks[name]).map(name => (
          <StackSection
            key={name}
            name={name}
            label={data.section_labels?.[name] || PINNED_LABELS[name] || name}
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
            onEscalate={toggleEscalation}
          />
        ))}

        {/* 100px gap after Today */}
        <div style={{ height: 100 }} />

        {stackNames.map((name, i) => (
          <div
            key={name}
            className={`transition-opacity duration-200 ${
              focusedSection === name ? 'opacity-100' : 'opacity-30'
            }`}
            onFocusCapture={() => setFocusedSection(name)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusedSection(null)
            }}
          >
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
              subdued
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
              onEscalate={toggleEscalation}
            />
          </div>
        ))}

        <RootGap
          active={activeRootGap === stackNames.length}
          onActivate={() => setActiveRootGap(stackNames.length)}
          onDeactivate={() => setActiveRootGap(null)}
          onCreateStack={(sectionName) => optimistic.createStack(sectionName)}
          onCapture={(text) => optimistic.capture(text, stackNames[stackNames.length - 1] || 'queue', 'actionable')}
          spacers={gapSpacers[stackNames.length] || 0}
          onSetSpacers={(n) => setGapSpacers(prev => ({ ...prev, [stackNames.length]: n }))}
        />

        <DocumentLine
          onCreateStack={optimistic.createStack}
          onCapture={(text) => optimistic.capture(text, stackNames[0] || 'queue', 'actionable')}
        />

        {/* Done - collapsed by default */}
        <div className="mb-8 opacity-50">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => toggleStack('done')} className="text-gray-400 hover:text-gray-600 transition-colors">
              <span className={`text-xs inline-block transition-transform ${collapsedStacks.has('done') ? '' : 'rotate-90'}`}>&#9654;</span>
            </button>
            <h2 className="text-sm font-medium text-gray-400">Done</h2>
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

    </div>
  )
}
