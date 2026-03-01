import { useState, useEffect, useRef } from 'react'
import { parseInput } from '../shared/helpers'
import { clickNav } from './navigation'

interface RootGapProps {
  active: boolean
  onActivate: () => void
  onDeactivate: () => void
  onCreateStack: (name: string) => void
  onCapture: (text: string) => void
  spacers: number
  onSetSpacers: (n: number) => void
}

export function RootGap({ active, onActivate, onDeactivate, onCreateStack, onCapture, spacers, onSetSpacers }: RootGapProps) {
  const [text, setText] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isToggle = text.startsWith('>')

  useEffect(() => {
    if (active && inputRef.current) inputRef.current.focus()
  }, [active])

  const handleSubmit = () => {
    const parsed = parseInput(text)
    if (!parsed.value) {
      onSetSpacers(spacers + 1)
      return
    }

    if (parsed.type === 'section') {
      onCreateStack(parsed.value)
    } else {
      onCapture(parsed.value)
    }
    setText('')
    onDeactivate()
  }

  const navArrow = (dir: 'up' | 'down') => {
    const el = wrapperRef.current
    if (!el) return
    const all = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-idx], [data-nav-col="header"]'))
    if (all.length === 0) return
    const rect = el.getBoundingClientRect()
    if (dir === 'up') {
      const above = all.filter(n => n.getBoundingClientRect().bottom <= rect.top + 4)
      if (above.length > 0) clickNav(above[above.length - 1])
    } else {
      const below = all.filter(n => n.getBoundingClientRect().top >= rect.bottom - 4)
      if (below.length > 0) clickNav(below[0])
    }
  }

  if (!active && spacers === 0) {
    return (
      <div
        ref={wrapperRef}
        className="h-6 cursor-text relative z-10"
        onClick={onActivate}
      />
    )
  }

  return (
    <div
      ref={wrapperRef}
      className={active ? 'mb-2' : 'cursor-text'}
      onClick={() => { if (!active) onActivate() }}
    >
      {Array.from({ length: spacers }, (_, i) => (
        <div key={i} className="h-6" />
      ))}
      {active && (
        <input
          ref={inputRef}
          type="text"
          value={text}
          data-dirty={text ? 'true' : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (!text.trim()) { setText(''); onDeactivate() } }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Backspace' && !text) {
              e.preventDefault()
              if (spacers > 0) {
                onSetSpacers(spacers - 1)
              } else {
                onDeactivate()
              }
            }
            if (e.key === 'ArrowUp') { e.preventDefault(); navArrow('up') }
            if (e.key === 'ArrowDown') { e.preventDefault(); navArrow('down') }
            if (e.key === 'Escape') { setText(''); onDeactivate() }
          }}
          placeholder="Type to add task, or > to create section..."
          className={`w-full bg-transparent border-none outline-none py-[3px] px-1 placeholder:text-gray-300 transition-all ${
            isToggle
              ? 'text-lg font-semibold text-gray-800'
              : 'text-[13px] text-gray-700'
          }`}
        />
      )}
    </div>
  )
}
