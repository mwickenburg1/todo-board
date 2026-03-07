import { useState, useEffect, useRef, memo } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { StackItem } from './types'
import { consumeArrowNav, consumePendingFocus, navigateFrom, setArrowNav, setPendingFocus } from './navigation'
import { LinkBadges, EventBadge } from './LinkBadges'
import { LinkPopover } from './LinkPopover'

const ENV_SLOTS = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8'] as const
const ENV_SLOT_COLORS: Record<string, string> = {
  env1: 'bg-blue-400',
  env2: 'bg-emerald-400',
  env3: 'bg-amber-400',
  env4: 'bg-purple-400',
  env5: 'bg-rose-400',
  env6: 'bg-cyan-400',
  env7: 'bg-orange-400',
  env8: 'bg-indigo-400',
}

const REMOTE_ENVS: Record<string, { host: string; space: number }> = {
  env5: { host: 'dev-vm2', space: 5 },
  env6: { host: 'dev-vm2', space: 6 },
  env7: { host: 'dev-vm2', space: 7 },
  env8: { host: 'dev-vm2', space: 8 },
}

function showToast(message: string, duration = 10000) {
  const el = document.createElement('div')
  el.textContent = message
  Object.assign(el.style, {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    background: '#1e1e2e', color: '#cdd6f4', padding: '10px 20px',
    borderRadius: '8px', fontSize: '13px', fontWeight: '500',
    zIndex: '9999', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'opacity 0.3s', opacity: '1',
  })
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, duration)
}

function openEnv(env: string, copyPrompt?: string) {
  const remote = REMOTE_ENVS[env]
  if (remote) {
    if (copyPrompt) {
      navigator.clipboard.writeText(copyPrompt).catch(() => {})
      showToast(`⌃${remote.space} to switch · command copied`)
    } else {
      showToast(`⌃${remote.space} to switch`)
    }
    return
  }
  const path = `/home/ubuntu/${env}.code-workspace`
  const host = import.meta.env.VITE_SSH_HOST || 'dev-vm'
  const uri = `cursor://vscode-remote/ssh-remote+${host}${path}`
  window.location.href = uri
  if (copyPrompt) {
    navigator.clipboard.writeText(copyPrompt).catch(() => {})
  }
}


function EnvSlots({ envs, onOpenEnv }: { envs: Set<string>, onOpenEnv?: (env: string) => void }) {
  if (envs.size === 0) return null
  return (
    <span className="inline-flex gap-px items-center shrink-0" title={[...envs].join(', ')}>
      {ENV_SLOTS.map(slot => {
        const active = envs.has(slot)
        return (
          <span
            key={slot}
            className={`w-[6px] h-[6px] rounded-[1px] ${
              active ? `${ENV_SLOT_COLORS[slot]} cursor-pointer` : 'bg-gray-200'
            }`}
            onClick={active && onOpenEnv ? (e) => { e.stopPropagation(); onOpenEnv(slot) } : undefined}
          />
        )
      })}
    </span>
  )
}

function EnvPicker({ onPick, onClose }: { onPick: (env: string) => void, onClose: () => void }) {
  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px]"
      onClick={e => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100">
        Launch in...
      </div>
      {ENV_SLOTS.map(env => (
        <button
          key={env}
          onClick={() => { onPick(env); onClose() }}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
          <span className={`w-2 h-2 rounded-sm ${ENV_SLOT_COLORS[env]}`} />
          {env}
        </button>
      ))}
    </div>
  )
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

export const StackLine = memo(function StackLine({ item, isBold, onDone, onUpdate, onToggleStatus, onDragStart, onDragEnd, isChild, onEnterSplit, onDelete, onAddLink, onRemoveLink, onMoveItem, onEscalate, navCol, navSection, navIdx }: {
  item: StackItem
  isBold?: boolean
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
  onMoveItem?: (id: number, direction: 'up' | 'down') => void
  onEscalate?: (id: number, currentLevel: number, targetLevel: number) => void
  navCol?: 'actionable' | 'waiting'
  navSection?: string
  navIdx?: number
}) {
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(item.text)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showLinkPopover, setShowLinkPopover] = useState(false)
  const [showEnvPicker, setShowEnvPicker] = useState(false)
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
  }, [item.text, editing])

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

      {/* Checkbox */}
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
            // Cmd+Shift+Arrow → move/reorder items
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && item.id) {
              if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && navCol) {
                e.preventDefault()
                save()
                setPendingFocus(item.id)
                onToggleStatus(item.id, item.status)
                return
              }
              if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && onMoveItem) {
                e.preventDefault()
                save()
                setPendingFocus(item.id)
                onMoveItem(item.id, e.key === 'ArrowUp' ? 'up' : 'down')
                return
              }
            }
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
          className={`flex-1 text-sm text-gray-700 cursor-text truncate leading-normal min-h-[1.25rem]${isBold ? ' font-semibold' : ''}`}
          onClick={(e) => { if (item.id) { clickXRef.current = e.clientX; setEditText(item.text); setEditing(true) } }}
        >
          {editText ? highlightTags(editText) : '\u00A0'}
        </span>
      )}

      {/* Right-side annotations */}
      <span className="inline-flex items-center gap-1 shrink-0 ml-auto">
        {item.childCount > 0 && (
          <span className="text-[10px] text-gray-400">{item.childCount}</span>
        )}
        {item.links.length > 0 && (
          <LinkBadges links={item.links} onRemove={onRemoveLink ? (idx) => onRemoveLink(item.id!, idx) : undefined} />
        )}
        <EnvSlots envs={item.envs} onOpenEnv={openEnv} />
        {item.waitingReason === 'in_progress' && item.envs.size === 0 && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        )}

        {/* Hover actions — visible on hover OR when editing */}
        {item.id && (
          <span className={`relative inline-flex items-center gap-1.5 transition-opacity ${hover || editing ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button
              onClick={() => onToggleStatus(item.id!, item.status)}
              className="text-[13px] text-gray-400 hover:text-amber-500 transition-colors leading-none"
              title={item.status === 'in_progress' ? 'Unblock' : 'Block'}
            >
              {item.status === 'in_progress' ? '\u2192' : '\u23F8'}
            </button>
            {onEscalate && (
              <>
                <button
                  onClick={() => onEscalate(item.id!, item.escalation || 0, 1)}
                  className={`text-[13px] font-bold transition-colors leading-none ${
                    item.escalation === 1 ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'
                  }`}
                  title={item.escalation === 1 ? 'De-escalate' : 'Escalate !'}
                >!</button>
                <button
                  onClick={() => onEscalate(item.id!, item.escalation || 0, 2)}
                  className={`text-[13px] font-bold transition-colors leading-none ${
                    item.escalation === 2 ? 'text-red-500' : 'text-gray-400 hover:text-red-500'
                  }`}
                  title={item.escalation === 2 ? 'De-escalate' : 'Escalate !!'}
                >!!</button>
                <button
                  onClick={() => onEscalate(item.id!, item.escalation || 0, 3)}
                  className={`text-[13px] font-bold transition-colors leading-none ${
                    item.escalation === 3 ? 'text-fuchsia-500' : 'text-gray-400 hover:text-fuchsia-500'
                  }`}
                  title={item.escalation === 3 ? 'De-escalate' : 'Escalate !!!'}
                >!!!</button>
              </>
            )}
            {onAddLink && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowLinkPopover(!showLinkPopover) }}
                className="text-[13px] text-gray-400 hover:text-blue-500 transition-colors leading-none"
                title="Link to external source"
              >
                &#x1F517;
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (item.envs.size === 1) {
                  // Single env — go directly
                  openEnv([...item.envs][0])
                } else if (item.envs.size > 1) {
                  // Multiple envs — show picker
                  setShowEnvPicker(!showEnvPicker)
                } else {
                  // No env linked — show picker to launch new
                  setShowEnvPicker(!showEnvPicker)
                }
              }}
              className={`text-[13px] transition-colors leading-none ${
                item.envs.size > 0
                  ? 'text-emerald-500 hover:text-emerald-600'
                  : 'text-gray-400 hover:text-emerald-500'
              }`}
              title={item.envs.size > 0 ? 'Go to session' : 'Launch in env...'}
            >
              {item.envs.size > 0 ? '\u279C' : '\u25B6'}
            </button>
            {showLinkPopover && onAddLink && (
              <LinkPopover
                onAdd={(link) => onAddLink(item.id!, link)}
                onClose={() => setShowLinkPopover(false)}
              />
            )}
            {showEnvPicker && (
              <EnvPicker
                onPick={(env) => {
                  if (item.envs.has(env)) {
                    openEnv(env)
                  } else {
                    // Open workspace + copy /link command to clipboard for quick paste into CC
                    openEnv(env, `/link ${item.text}`)
                  }
                }}
                onClose={() => setShowEnvPicker(false)}
              />
            )}
          </span>
        )}
      </span>
    </div>
  )
})
