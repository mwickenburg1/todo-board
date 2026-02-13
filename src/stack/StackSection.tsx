import { useState, useEffect, useRef } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { StackItem } from './types'
import { StackLine, InlineCapture, InsertGap, placeCaretFromClick } from './StackLine'
import { navigateFrom, consumeArrowNav } from './navigation'

export function StackSection({ name, actionable, waiting, collapsed, onToggle, onCapture, onDone, onUpdate, onToggleStatus, onDragStart, onDragEnd, draggedItem, onDropItem, expandedItems, onToggleExpand, onRename, onCreateStack, onInsertItem, onSplitItem, onInsertAbove, onDeleteTask, onDeleteStack, onSectionDragStart, onSectionDragEnd, onSectionDrop, draggingSection, onAddLink, onRemoveLink }: {
  name: string
  actionable: StackItem[]
  waiting: StackItem[]
  collapsed: boolean
  onToggle: () => void
  onCapture: (text: string, column: 'actionable' | 'waiting') => void
  onDone: (id: number, recursive?: boolean) => void
  onUpdate: (id: number, updates: { text?: string }) => void
  onToggleStatus: (id: number, currentStatus: string) => void
  onDragStart: (e: ReactDragEvent, item: StackItem) => void
  onDragEnd: () => void
  draggedItem: StackItem | null
  onDropItem: (itemId: number, targetStack: string, targetColumn: 'actionable' | 'waiting', beforeId?: number) => void
  expandedItems: Set<number>
  onToggleExpand: (id: number) => void
  onRename?: (oldName: string, newName: string) => void
  onCreateStack?: (name: string) => void
  onInsertItem?: (stack: string, column: 'actionable' | 'waiting', text: string, beforeId?: number) => void
  onSplitItem?: (id: number, before: string, after: string, stack: string, column: 'actionable' | 'waiting') => void
  onInsertAbove?: () => void
  onDeleteTask?: (id: number) => void
  onDeleteStack?: (name: string) => void
  onSectionDragStart?: (name: string) => void
  onSectionDragEnd?: () => void
  onSectionDrop?: (name: string, beforeName?: string) => void
  draggingSection?: string | null
  onAddLink?: (id: number, link: { type: string, ref: string, label?: string }) => void
  onRemoveLink?: (id: number, idx: number) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameText, setNameText] = useState(name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const headerRef = useRef<HTMLDivElement>(null)
  const clickXRef = useRef<number | null>(null)

  useEffect(() => {
    if (editingName && !confirmingDelete && nameRef.current) {
      nameRef.current.focus()
      if (consumeArrowNav()) {
        const len = nameRef.current.value.length
        nameRef.current.setSelectionRange(len, len)
      } else if (clickXRef.current !== null) {
        placeCaretFromClick(nameRef.current, clickXRef.current)
        clickXRef.current = null
      } else {
        const len = nameRef.current.value.length
        nameRef.current.setSelectionRange(len, len)
      }
    }
  }, [editingName, confirmingDelete])

  const RESERVED_NAMES = ['now', 'monitoring', 'done']

  const saveName = () => {
    const normalized = nameText.trim().toLowerCase().replace(/\s+/g, '-')
    if (normalized && normalized !== name && !RESERVED_NAMES.includes(normalized) && onRename) {
      onRename(name, normalized)
    }
    setEditingName(false)
  }

  const [dropIndicator, setDropIndicator] = useState<{ column: string; beforeId?: number } | null>(null)

  const handleColumnDrop = (column: 'actionable' | 'waiting') => (e: ReactDragEvent) => {
    e.preventDefault()
    const id = parseInt(e.dataTransfer.getData('text/plain'))
    if (id) onDropItem(id, name, column, dropIndicator?.beforeId)
    setDropIndicator(null)
  }

  const handleDragOver = (e: ReactDragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleItemDragOver = (e: ReactDragEvent, items: StackItem[], idx: number, column: 'actionable' | 'waiting') => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    if (e.clientY < midY) {
      // Top half → insert before this item
      setDropIndicator({ column, beforeId: items[idx].id || undefined })
    } else {
      // Bottom half → insert before next item (or at end)
      const nextItem = items[idx + 1]
      setDropIndicator({ column, beforeId: nextItem?.id || undefined })
    }
  }

  const renderItems = (items: StackItem[], column: 'actionable' | 'waiting') => (
    <div
      className="min-h-[40px]"
      onDragOver={handleDragOver}
      onDrop={handleColumnDrop(column)}
      onDragLeave={(e) => {
        // Clear indicator when leaving the column entirely
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndicator(null)
      }}
    >
      {items.map((item, idx) => {
        const isExpanded = item.id ? expandedItems.has(item.id) : false
        const showIndicatorBefore = draggedItem && dropIndicator?.column === column && dropIndicator?.beforeId === item.id
        return (
          <div key={item.id}>
            {/* Insert gap before each item */}
            {idx > 0 && !showIndicatorBefore && (
              <InsertGap
                onCapture={(text) => onCapture(text, column)}
                onCreateStack={onCreateStack}
              />
            )}
            {/* Drop indicator line */}
            {showIndicatorBefore && (
              <div className="h-0.5 bg-blue-400 rounded mx-1 my-0.5" />
            )}
            <div
              className="flex items-center"
              onDragOver={(e) => handleItemDragOver(e, items, idx, column)}
            >
              {item.childCount > 0 && (
                <button
                  onClick={() => item.id && onToggleExpand(item.id)}
                  className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0 -ml-4"
                >
                  <span className={`text-xs transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                </button>
              )}
              <div className="flex-1">
                <StackLine
                  item={item}
                  onDone={onDone}
                  onUpdate={onUpdate}
                  onToggleStatus={onToggleStatus}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDelete={onDeleteTask}
                  onAddLink={onAddLink}
                  onRemoveLink={onRemoveLink}
                  navCol={column}
                  navSection={name}
                  navIdx={idx}
                  onEnterSplit={(onSplitItem || onInsertItem) ? (id, before, after) => {
                    if (!before) {
                      // Cursor at start → insert empty item BEFORE this one
                      if (onInsertItem) onInsertItem(name, column, '', id)
                    } else if (onSplitItem) {
                      // Atomic split: update current text + create new after it
                      onSplitItem(id, before.trim(), after.trim(), name, column)
                    } else if (onInsertItem) {
                      onUpdate(id, { text: before.trim() })
                      const nextItem = items[idx + 1]
                      onInsertItem(name, column, after.trim(), nextItem?.id)
                    }
                  } : undefined}
                />
              </div>
            </div>
            {isExpanded && item.children.map(child => (
              <StackLine
                key={child.id}
                item={child}
                onDone={onDone}
                onUpdate={onUpdate}
                onToggleStatus={onToggleStatus}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDelete={onDeleteTask}
                onAddLink={onAddLink}
                onRemoveLink={onRemoveLink}
                isChild
              />
            ))}
          </div>
        )
      })}
      {/* Drop indicator at end */}
      {draggedItem && dropIndicator?.column === column && !dropIndicator?.beforeId && items.length > 0 && (
        <div className="h-0.5 bg-blue-400 rounded mx-1 my-0.5" />
      )}
      {/* Bottom capture — always visible */}
      <InlineCapture
        onCapture={(text) => onCapture(text, column)}
        onCreateStack={onCreateStack}
        navCol={column}
        navSection={name}
      />
    </div>
  )

  const handleSectionDragOver = (e: ReactDragEvent) => {
    if (e.dataTransfer.types.includes('application/x-section')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }

  const handleSectionDrop = (e: ReactDragEvent) => {
    e.preventDefault()
    const draggedName = e.dataTransfer.getData('application/x-section')
    if (draggedName && draggedName !== name && onSectionDrop) {
      onSectionDrop(draggedName, name)
    }
  }

  return (
    <div className="mb-10">
      {/* Section drop zone */}
      {draggingSection && draggingSection !== name && (
        <div
          className="h-1 -mt-1 mb-0 rounded bg-blue-400 opacity-0 transition-opacity"
          onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.opacity = '1' }}
          onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0' }}
          onDrop={handleSectionDrop}
        />
      )}
      {/* Section heading */}
      <div
        ref={headerRef}
        className="flex items-center gap-2 mb-3 group/header cursor-text"
        data-nav-col="header"
        data-nav-section={name}
        onDragOver={handleSectionDragOver}
        onDrop={handleSectionDrop}
        onClick={(e) => {
          // Enter edit mode when clicking anywhere on the header row (except toggle button)
          if (!editingName && !(e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('[draggable]')) {
            clickXRef.current = e.clientX
            setNameText(name)
            setEditingName(true)
          }
        }}
      >
        <button onClick={(e) => { e.stopPropagation(); onToggle() }} className="text-gray-400 hover:text-gray-600 transition-colors">
          <span className={`text-[10px] inline-block transition-transform ${collapsed ? '' : 'rotate-90'}`}>&#9654;</span>
        </button>
        {confirmingDelete ? (
          <span
            className="flex-1 text-lg font-semibold text-red-500"
            tabIndex={0}
            ref={(el) => el?.focus()}
            onKeyDown={(e) => {
              e.preventDefault()
              if (e.key === 'y' || e.key === 'Y') {
                if (headerRef.current) navigateFrom(headerRef.current, 'up')
                if (onDeleteStack) onDeleteStack(name)
                setConfirmingDelete(false)
                setEditingName(false)
              } else {
                setConfirmingDelete(false)
              }
            }}
            onBlur={() => { setConfirmingDelete(false); setEditingName(false) }}
          >
            Delete section "{name.replace(/-/g, ' ')}"? <span className="text-gray-400">y / n</span>
          </span>
        ) : editingName ? (
          <input
            ref={nameRef}
            value={nameText}
            data-dirty={nameText !== name ? 'true' : undefined}
            onChange={(e) => setNameText(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && onDeleteStack) {
                const input = nameRef.current
                if (input && input.selectionStart === 0 && input.selectionEnd === 0) {
                  e.preventDefault()
                  setConfirmingDelete(true)
                }
              }
              if (e.key === 'Enter') {
                const pos = nameRef.current?.selectionStart ?? nameText.length
                saveName()
                if (pos === 0) {
                  // Cursor at start → insert above this section
                  if (onInsertAbove) onInsertAbove()
                } else if (onInsertItem) {
                  // Cursor at end → insert at top of this section
                  const firstItem = actionable[0]
                  onInsertItem(name, 'actionable', '', firstItem?.id)
                }
              }
              if (e.key === 'Escape') { setNameText(name); setEditingName(false) }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                saveName()
                if (headerRef.current) navigateFrom(headerRef.current, 'down')
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                saveName()
                if (headerRef.current) navigateFrom(headerRef.current, 'up')
              }
            }}
            className="flex-1 text-lg font-semibold text-gray-800 bg-transparent outline-none"
          />
        ) : (
          <h2 className="flex-1 text-lg font-semibold text-gray-800 cursor-text">
            {name.replace(/-/g, ' ')}
          </h2>
        )}
        {/* Drag handle for section */}
        <span
          className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover/header:opacity-30 transition-opacity select-none text-[10px] text-gray-400 w-3 ml-1"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('application/x-section', name)
            onSectionDragStart?.(name)
          }}
          onDragEnd={() => onSectionDragEnd?.()}
        >
          &#x2807;
        </span>
      </div>

      {!collapsed && (
        <div className="flex gap-10 pl-5">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2 font-medium">
              Actionable
            </div>
            {renderItems(actionable, 'actionable')}
          </div>

          <div className="w-px bg-gray-100 self-stretch" />

          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-2 font-medium">
              Waiting
            </div>
            {renderItems(waiting, 'waiting')}
          </div>
        </div>
      )}
    </div>
  )
}
