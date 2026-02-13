import { useState, useEffect, useRef, memo } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { StackItem, TaskLink } from './types'
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

// Link type logos — inline SVGs for each source type
const linkLogos: Record<string, { icon: (props: { size?: number }) => JSX.Element, label: string }> = {
  slack_thread: {
    label: 'Slack',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
        <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
        <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
        <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
      </svg>
    ),
  },
  slack: {
    label: 'Slack',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
        <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
        <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
        <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
      </svg>
    ),
  },
  linear: {
    label: 'Linear',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M2.357 13.643a10.97 10.97 0 0 1-.354-2.165l10.52 10.519a10.97 10.97 0 0 1-2.166-.354L2.357 13.643zm-1.007-4.2a11.08 11.08 0 0 0-.227 1.07l12.364 12.364c.356-.06.715-.138 1.07-.227L1.35 9.443zm.837-2.263a11.027 11.027 0 0 0-.504 1.1L14.28 22.317c.383-.144.758-.308 1.1-.504L2.187 7.18zm1.205-1.96a11.09 11.09 0 0 0-.748 1.02L17.76 21.356c.357-.222.697-.474 1.02-.748L3.392 5.22zm2.042-1.726a11.015 11.015 0 0 0-.97.912l16.11 16.11c.33-.3.632-.625.912-.97L5.434 3.494zm2.513-1.558a11.123 11.123 0 0 0-1.13.724l16.023 16.023c.27-.36.51-.738.724-1.13L7.947 1.936zm2.816-1.114a10.952 10.952 0 0 0-1.293.453l14.24 14.24c.196-.42.343-.849.453-1.293L10.763.822zM24 12c0-1.37-.25-2.685-.71-3.896L7.897 22.497A10.988 10.988 0 0 0 12 24c6.627 0 12-5.373 12-12zM12 0C5.373 0 0 5.373 0 12c0 .736.067 1.457.194 2.163L14.163.194A12.1 12.1 0 0 0 12 0z" fill="#5E6AD2"/>
      </svg>
    ),
  },
  claude_code: {
    label: 'Claude',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M16.358 4.666l-4.324 14.669-2.063-.608 4.324-14.67 2.063.609zM19.4 7.2l4.2 4.8-4.2 4.8-1.5-1.312L21.55 12l-3.65-3.488L19.4 7.2zM4.6 7.2l-4.2 4.8 4.2 4.8 1.5-1.312L2.45 12l3.65-3.488L4.6 7.2z" fill="#D97706"/>
      </svg>
    ),
  },
  github: {
    label: 'GitHub',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" fill="#333"/>
      </svg>
    ),
  },
  url: {
    label: 'Link',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    ),
  },
}

function LinkBadges({ links, onRemove }: { links: TaskLink[], onRemove?: (idx: number) => void }) {
  if (!links || links.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {links.map((link, i) => {
        const info = linkLogos[link.type] || linkLogos[link.icon] || linkLogos.url
        const Icon = info.icon
        return (
          <span
            key={i}
            className="inline-flex items-center justify-center w-4 h-4 cursor-default opacity-70 hover:opacity-100 transition-opacity"
            title={`${info.label}: ${link.label}`}
            onClick={(e) => {
              if (e.shiftKey && onRemove) { e.stopPropagation(); onRemove(i) }
            }}
          >
            <Icon size={14} />
          </span>
        )
      })}
    </span>
  )
}

function LinkPopover({ onAdd, onClose }: {
  onAdd: (link: { type: string, ref: string, label?: string }) => void
  onClose: () => void
}) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) { onClose(); return }

    // Auto-detect link type from input
    let type = 'url', ref = trimmed, label = trimmed
    if (/slack/i.test(trimmed) || trimmed.match(/^[A-Z]\w+\/[\d.]+$/)) {
      type = 'slack_thread'; label = trimmed
    } else if (/^[A-Z]+-\d+$/i.test(trimmed)) {
      type = 'linear'; label = trimmed
    } else if (/claude/i.test(trimmed) || /^session[-_]/i.test(trimmed)) {
      type = 'claude_code'; label = trimmed
    } else if (/github\.com/i.test(trimmed)) {
      type = 'github'
      label = trimmed.replace(/https?:\/\/github\.com\//, '')
    } else if (/^https?:\/\//.test(trimmed)) {
      try { label = new URL(trimmed).hostname } catch { label = trimmed }
    }

    onAdd({ type, ref, label })
    setInput('')
    onClose()
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-64"
      onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') onClose()
        }}
        onBlur={() => { if (!input.trim()) onClose() }}
        placeholder="Paste link, issue key, or URL..."
        className="w-full text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-blue-300"
      />
      <div className="text-[10px] text-gray-400 mt-1 px-1">
        ATT-123 &middot; slack thread &middot; URL &middot; session-id
      </div>
    </div>
  )
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

export const StackLine = memo(function StackLine({ item, onDone, onUpdate, onToggleStatus, onDragStart, onDragEnd, isChild, onEnterSplit, onDelete, onAddLink, onRemoveLink, navCol, navSection, navIdx }: {
  item: StackItem
  onDone: (id: number, recursive?: boolean) => void
  onUpdate: (id: number, updates: { text?: string }) => void
  onToggleStatus: (id: number, currentStatus: string) => void
  onDragStart: (e: ReactDragEvent, item: StackItem) => void
  onDragEnd: () => void
  isChild?: boolean
  onEnterSplit?: (id: number, textBefore: string, textAfter: string) => void
  onDelete?: (id: number) => void
  onAddLink?: (id: number, link: { type: string, ref: string, label?: string }) => void
  onRemoveLink?: (id: number, idx: number) => void
  navCol?: 'actionable' | 'waiting'
  navSection?: string
  navIdx?: number
}) {
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(item.text)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showLinkPopover, setShowLinkPopover] = useState(false)
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
      className={`group relative flex items-center gap-2 py-1.5 pr-1.5 transition-colors ${hover ? 'bg-gray-50' : ''} ${isChild ? 'ml-5' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Drag handle — positioned in the left margin */}
      <span
        className="absolute -left-5 top-0 bottom-0 w-5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-40 transition-opacity select-none text-gray-400 inline-flex items-center justify-center"
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
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
          <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
          <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
        </svg>
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

      {/* Right-side annotations — fixed layout, no shift on hover */}
      <span className="inline-flex items-center gap-1 shrink-0 ml-auto">
        {item.childCount > 0 && (
          <span className="text-[10px] text-gray-400">{item.childCount}</span>
        )}
        {item.links.length > 0 && (
          <LinkBadges links={item.links} onRemove={onRemoveLink ? (idx) => onRemoveLink(item.id!, idx) : undefined} />
        )}
        {item.events.length > 0 && (
          <span className="text-[9px] text-gray-400 bg-gray-50 rounded px-1" title={`${item.events.length} event${item.events.length > 1 ? 's' : ''}`}>
            {item.events.length}
          </span>
        )}
        {item.linkedEnv && (
          <span className={`text-[10px] font-medium ${envColors[item.linkedEnv] || 'text-gray-400'}`}>
            {item.linkedEnv}
          </span>
        )}
        {item.waitingReason === 'in_progress' && !item.linkedEnv && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        )}

        {/* Hover actions — always in DOM, opacity-controlled */}
        {item.id && !editing && (
          <span className={`relative inline-flex items-center gap-1 transition-opacity ${hover ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button
              onClick={() => onToggleStatus(item.id!, item.status)}
              className="text-[10px] text-gray-400 hover:text-amber-500 transition-colors"
              title={item.status === 'in_progress' ? 'Unblock' : 'Block'}
            >
              {item.status === 'in_progress' ? '\u2192' : '\u23F8'}
            </button>
            {onAddLink && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowLinkPopover(!showLinkPopover) }}
                className="text-[10px] text-gray-400 hover:text-blue-500 transition-colors"
                title="Link to external source"
              >
                &#x1F517;
              </button>
            )}
            {showLinkPopover && onAddLink && (
              <LinkPopover
                onAdd={(link) => onAddLink(item.id!, link)}
                onClose={() => setShowLinkPopover(false)}
              />
            )}
          </span>
        )}
      </span>
    </div>
  )
})

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
