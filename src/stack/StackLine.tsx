import { useState, useEffect, useRef } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { StackItem } from './types'
import { consumeArrowNav, consumePendingFocus, navigateFrom, setArrowNav } from './navigation'

const envColors: Record<string, string> = {
  env1: 'text-purple-500', env2: 'text-blue-500', env3: 'text-green-500',
  env4: 'text-pink-500', env5: 'text-orange-500', env6: 'text-cyan-500',
  env7: 'text-indigo-500', env8: 'text-lime-600', sync: 'text-amber-500',
}

const tagColors: Record<string, string> = {
  daily: 'text-red-500 bg-red-50',
  eod: 'text-red-500 bg-red-50',
  weekly: 'text-blue-500 bg-blue-50',
  eow: 'text-blue-500 bg-blue-50',
  biweekly: 'text-blue-400 bg-blue-50',
  monthly: 'text-purple-500 bg-purple-50',
  eom: 'text-purple-500 bg-purple-50',
  quarterly: 'text-teal-500 bg-teal-50',
  yearly: 'text-green-600 bg-green-50',
  annual: 'text-green-600 bg-green-50',
}

const tagPattern = new RegExp(`\\b(${Object.keys(tagColors).join('|')})\\b`, 'gi')

function highlightTags(text: string) {
  const parts = text.split(tagPattern)
  if (parts.length === 1) return text
  return parts.map((part, i) => {
    const color = tagColors[part.toLowerCase()]
    if (color) {
      return <span key={i} className={`${color} rounded px-1 py-px text-[11px] font-medium`}>{part}</span>
    }
    return part
  })
}

// Place cursor at approximate click position by measuring text widths
export function placeCaretFromClick(input: HTMLInputElement, clientX: number) {
  const style = getComputedStyle(input)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const x = clientX - input.getBoundingClientRect().left - parseFloat(style.paddingLeft || '0')
  const text = input.value
  for (let i = 0; i <= text.length; i++) {
    if (ctx.measureText(text.slice(0, i)).width >= x) {
      input.setSelectionRange(i, i)
      return
    }
  }
  input.setSelectionRange(text.length, text.length)
}

// Re-export navigation utilities used by other components
export { navigateFrom, setArrowNav, setPendingFocus } from './navigation'

export function StackLine({ item, onDone, onUpdate, onToggleStatus, onDragStart, onDragEnd, isChild, onEnterSplit, onDelete, navCol, navSection, navIdx }: {
  item: StackItem
  onDone: (id: number, recursive?: boolean) => void
  onUpdate: (id: number, updates: { text?: string }) => void
  onToggleStatus: (id: number, currentStatus: string) => void
  onDragStart: (e: ReactDragEvent, item: StackItem) => void
  onDragEnd: () => void
  isChild?: boolean
  onEnterSplit?: (id: number, textBefore: string, textAfter: string) => void
  onDelete?: (id: number) => void
  navCol?: 'actionable' | 'waiting'
  navSection?: string
  navIdx?: number
}) {
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(item.text)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const clickXRef = useRef<number | null>(null)

  useEffect(() => {
    if (editing && !confirmingDelete && inputRef.current) {
      inputRef.current.focus()
      if (consumeArrowNav()) {
        const len = inputRef.current.value.length
        inputRef.current.setSelectionRange(len, len)
      } else if (clickXRef.current !== null) {
        placeCaretFromClick(inputRef.current, clickXRef.current)
        clickXRef.current = null
      } else {
        const len = inputRef.current.value.length
        inputRef.current.setSelectionRange(len, len)
      }
    }
  }, [editing, confirmingDelete])

  useEffect(() => {
    if (!editing) setEditText(item.text)
  }, [item.text])

  // Auto-focus newly created items
  useEffect(() => {
    if (!editing && item.id && consumePendingFocus(item.id)) {
      setArrowNav(true)
      setEditText(item.text)
      setEditing(true)
    }
  })

  const save = () => {
    if (item.id && editText.trim() && editText !== item.text) {
      onUpdate(item.id, { text: editText.trim() })
    }
    setEditing(false)
  }

  return (
    <div
      ref={rowRef}
      data-item-id={item.id || undefined}
      data-nav-col={navCol}
      data-nav-section={navSection}
      data-nav-idx={navIdx !== undefined ? navIdx : undefined}
      className={`group flex items-center gap-2 py-1.5 px-1.5 transition-colors ${hover ? 'bg-gray-50' : ''} ${isChild ? 'ml-5' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Drag handle */}
      <span
        className="shrink-0 cursor-grab active:cursor-grabbing opacity-15 group-hover:opacity-50 transition-opacity select-none text-xs text-gray-400 w-5 inline-flex items-center justify-center self-stretch"
        draggable={!!item.id}
        onDragStart={(e) => {
          if (!item.id) return
          if (rowRef.current) {
            e.dataTransfer.setDragImage(rowRef.current, 20, rowRef.current.offsetHeight / 2)
          }
          onDragStart(e, item)
        }}
        onDragEnd={onDragEnd}
      >
        &#x2807;
      </span>

      {/* Checkbox - always visible */}
      <button
        onClick={() => item.id && onDone(item.id, item.childCount > 0)}
        className={`w-3.5 h-3.5 shrink-0 rounded-sm border transition-colors ${
          item.status === 'in_progress'
            ? 'border-amber-400 hover:bg-amber-50'
            : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50'
        }`}
      />

      {/* Text */}
      {confirmingDelete ? (
        <span
          className="flex-1 text-sm text-red-500 outline-none py-0"
          tabIndex={0}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            e.preventDefault()
            if (e.key === 'y' || e.key === 'Y') {
              if (rowRef.current) navigateFrom(rowRef.current, 'up')
              if (item.id && onDelete) onDelete(item.id)
              setConfirmingDelete(false)
              setEditing(false)
            } else {
              setConfirmingDelete(false)
            }
          }}
          onBlur={() => { setConfirmingDelete(false); setEditing(false) }}
        >
          Delete "{item.text}"? <span className="text-gray-400">y / n</span>
        </span>
      ) : editing ? (
        <input
          ref={inputRef}
          value={editText}
          data-dirty={editText !== item.text ? 'true' : undefined}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && onDelete && item.id) {
              const input = inputRef.current
              if (input && input.selectionStart === 0 && input.selectionEnd === 0) {
                e.preventDefault()
                setConfirmingDelete(true)
              }
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const input = inputRef.current
              if (input && onEnterSplit && item.id) {
                const pos = input.selectionStart ?? editText.length
                const before = editText.slice(0, pos)
                const after = editText.slice(pos)
                if (before.trim()) setEditText(before.trim())
                onEnterSplit(item.id, before, after)
                setEditing(false)
                return
              }
              save()
            }
            if (e.key === 'Escape') { setEditText(item.text); setEditing(false) }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              save()
              if (rowRef.current) navigateFrom(rowRef.current, 'up')
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              save()
              if (rowRef.current) navigateFrom(rowRef.current, 'down')
            }
            if (e.key === 'ArrowLeft' && navCol) {
              const input = inputRef.current
              if (input && input.selectionStart === 0 && input.selectionEnd === 0) {
                e.preventDefault()
                save()
                if (rowRef.current) navigateFrom(rowRef.current, 'left')
              }
            }
            if (e.key === 'ArrowRight' && navCol) {
              const input = inputRef.current
              if (input && input.selectionStart === editText.length && input.selectionEnd === editText.length) {
                e.preventDefault()
                save()
                if (rowRef.current) navigateFrom(rowRef.current, 'right')
              }
            }
          }}
          className="flex-1 text-sm bg-transparent outline-none py-0"
        />
      ) : (
        <span
          className="flex-1 text-sm text-gray-700 cursor-text truncate leading-normal min-h-[1.25rem]"
          onClick={(e) => { if (item.id) { clickXRef.current = e.clientX; setEditText(item.text); setEditing(true) } }}
        >
          {editText ? highlightTags(editText) : '\u00A0'}
        </span>
      )}

      {/* Annotations */}
      {item.childCount > 0 && (
        <span className="text-[10px] text-gray-400">{item.childCount}</span>
      )}
      {item.linkedEnv && (
        <span className={`text-[10px] font-medium ${envColors[item.linkedEnv] || 'text-gray-400'}`}>
          {item.linkedEnv}
        </span>
      )}
      {item.waitingReason === 'in_progress' && !item.linkedEnv && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
      )}

      {/* Toggle status on hover */}
      {hover && item.id && !editing && (
        <button
          onClick={() => onToggleStatus(item.id!, item.status)}
          className="text-[10px] text-gray-400 hover:text-amber-500 transition-colors shrink-0"
          title={item.status === 'in_progress' ? 'Unblock' : 'Block'}
        >
          {item.status === 'in_progress' ? '\u2192' : '\u23F8'}
        </button>
      )}
    </div>
  )
}

// Inline capture — supports both plain text (add task) and > syntax (create section)
export function InlineCapture({ onCapture, onCreateStack, navCol, navSection }: {
  onCapture: (text: string) => void
  onCreateStack?: (name: string) => void
  navCol?: 'actionable' | 'waiting'
  navSection?: string
}) {
  const [text, setText] = useState('')
  const isToggle = text.startsWith('>')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) return

    if (trimmed.startsWith('>') && onCreateStack) {
      const name = trimmed.slice(1).trim()
      if (name) onCreateStack(name)
    } else {
      onCapture(trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed)
    }
    setText('')
  }

  return (
    <div
      ref={wrapperRef}
      data-nav-col={navCol}
      data-nav-section={navSection}
      data-nav-idx="capture"
    >
      <input
        type="text"
        value={text}
        data-dirty={text ? 'true' : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) handleSubmit()
          if (e.key === 'Escape') setText('')
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (wrapperRef.current) navigateFrom(wrapperRef.current, 'up')
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (wrapperRef.current) navigateFrom(wrapperRef.current, 'down')
          }
        }}
        placeholder="Type to add, or > for new section..."
        className={`w-full bg-transparent border-none outline-none py-[3px] px-1 placeholder:text-gray-300 transition-all ${
          isToggle
            ? 'text-lg font-semibold text-gray-800'
            : 'text-[13px] text-gray-700'
        }`}
      />
    </div>
  )
}

// Clickable gap between items — click to reveal insert input
export function InsertGap({ onCapture, onCreateStack }: {
  onCapture: (text: string) => void
  onCreateStack?: (name: string) => void
}) {
  const [active, setActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const isToggle = text.startsWith('>')

  useEffect(() => {
    if (active && inputRef.current) inputRef.current.focus()
  }, [active])

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) { setActive(false); return }

    if (trimmed.startsWith('>') && onCreateStack) {
      const name = trimmed.slice(1).trim()
      if (name) onCreateStack(name)
    } else {
      onCapture(trimmed)
    }
    setText('')
    setActive(false)
  }

  if (!active) {
    return (
      <div
        className="h-1 cursor-text"
        onClick={() => setActive(true)}
      />
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      data-dirty={text ? 'true' : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (!text.trim()) setActive(false) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleSubmit()
        if (e.key === 'Escape') { setText(''); setActive(false) }
      }}
      placeholder="Type to insert, or > for new section..."
      className={`w-full bg-transparent border-none outline-none py-[3px] px-1 placeholder:text-gray-300 transition-all ${
        isToggle
          ? 'text-lg font-semibold text-gray-800'
          : 'text-[13px] text-gray-700'
      }`}
    />
  )
}

// Document-level line — always visible at the bottom of the page
export function DocumentLine({ onCreateStack, onCapture }: {
  onCreateStack: (name: string) => void
  onCapture: (text: string) => void
}) {
  const [text, setText] = useState('')
  const isToggle = text.startsWith('>')

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed) return

    if (trimmed.startsWith('>')) {
      const name = trimmed.slice(1).trim()
      if (name) onCreateStack(name)
    } else {
      onCapture(trimmed)
    }
    setText('')
  }

  return (
    <div className="mb-6 flex items-center gap-2">
      {isToggle && (
        <span className="text-gray-300 text-xs shrink-0">&#9654;</span>
      )}
      <input
        type="text"
        value={text}
        data-dirty={text ? 'true' : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') setText('')
        }}
        placeholder="Type to add task, or > to create section..."
        className={`w-full bg-transparent border-none outline-none py-[3px] px-1 placeholder:text-gray-300 transition-all ${
          isToggle
            ? 'text-lg font-semibold text-gray-800'
            : 'text-[13px] text-gray-700'
        }`}
      />
    </div>
  )
}
