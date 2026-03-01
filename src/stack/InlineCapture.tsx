import { useState, useEffect, useRef } from 'react'
import { parseInput } from '../shared/helpers'
import { consumePendingSectionFocus, navigateFrom } from './navigation'

// Inline capture — supports both plain text (add task) and > syntax (create section)
export function InlineCapture({ onCapture, onCreateStack, onInsertBelow, navCol, navSection }: {
  onCapture: (text: string) => void
  onCreateStack?: (name: string) => void
  onInsertBelow?: () => void
  navCol?: 'actionable' | 'waiting'
  navSection?: string
}) {
  const [text, setText] = useState('')
  const isToggle = text.startsWith('>')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus when this section was just created
  useEffect(() => {
    if (navSection && navCol === 'actionable' && consumePendingSectionFocus(navSection)) {
      inputRef.current?.focus()
    }
  })

  const handleSubmit = () => {
    const parsed = parseInput(text)
    if (!parsed.value) return

    if (parsed.type === 'section' && onCreateStack) {
      onCreateStack(parsed.value)
    } else {
      onCapture(parsed.type === 'section' ? parsed.value : parsed.value)
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
        ref={inputRef}
        type="text"
        value={text}
        data-dirty={text ? 'true' : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (text.trim()) handleSubmit()
            else if (onInsertBelow) onInsertBelow()
          }
          if (e.key === 'Escape') setText('')
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (wrapperRef.current) navigateFrom(wrapperRef.current, 'up')
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (wrapperRef.current) navigateFrom(wrapperRef.current, 'down')
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            if (wrapperRef.current) navigateFrom(wrapperRef.current, 'left')
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            if (wrapperRef.current) navigateFrom(wrapperRef.current, 'right')
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
    const parsed = parseInput(text)
    if (!parsed.value) { setActive(false); return }

    if (parsed.type === 'section' && onCreateStack) {
      onCreateStack(parsed.value)
    } else {
      onCapture(parsed.type === 'section' ? parsed.value : parsed.value)
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
    const parsed = parseInput(text)
    if (!parsed.value) return

    if (parsed.type === 'section') {
      onCreateStack(parsed.value)
    } else {
      onCapture(parsed.value)
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
