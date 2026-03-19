import { useState, useCallback, useRef, useEffect } from 'react'

interface PrepItem {
  id: number
  text: string
  env: string | null
  notes: string
  priority: number
  escalation: number
  hasClaudeLink: boolean
}

interface PrepViewProps {
  items: PrepItem[]
}

const ENV_COLORS: Record<string, string> = {
  env1: 'text-blue-400', env2: 'text-purple-400', env3: 'text-emerald-400',
  env4: 'text-orange-400', env5: 'text-cyan-400', env6: 'text-pink-400',
  env7: 'text-yellow-400', env8: 'text-red-400',
}

function PrepItemRow({ item }: { item: PrepItem }) {
  const [notes, setNotes] = useState(item.notes)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>()

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.max(44, textareaRef.current.scrollHeight) + 'px'
    }
  }, [notes])

  const saveNotes = useCallback((value: string) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      setSaving(true)
      fetch(`/api/todos/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      }).then(() => setSaving(false)).catch(() => setSaving(false))
    }, 800)
  }, [item.id])

  const handleChange = (value: string) => {
    setNotes(value)
    saveNotes(value)
  }

  const envColor = item.env ? (ENV_COLORS[item.env] || 'text-gray-400') : ''

  return (
    <div className="border-b border-white/[0.04] py-4 last:border-b-0">
      <div className="flex items-start gap-4">
        {/* Env badge */}
        <div className="shrink-0 w-[48px] pt-1">
          {item.env && (
            <span className={`text-[15px] font-mono font-semibold ${envColor}`}>
              {item.env.replace('env', '')}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[17px] text-gray-200 font-medium truncate">{item.text}</span>
            {item.hasClaudeLink && (
              <span className="text-[11px] text-violet-400/60 shrink-0">linked</span>
            )}
            {saving && (
              <span className="text-[11px] text-gray-600 shrink-0">saving...</span>
            )}
          </div>

          {/* Notes — always open as textarea */}
          <textarea
            ref={textareaRef}
            value={notes}
            onChange={e => handleChange(e.target.value)}
            placeholder="Prep notes for this session..."
            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5 text-[15px] text-gray-300 placeholder-gray-700 resize-none focus:outline-none focus:border-white/[0.15] leading-relaxed"
            data-dirty="true"
          />
        </div>
      </div>
    </div>
  )
}

export function PrepView({ items }: PrepViewProps) {
  if (items.length === 0) {
    return (
      <div className="mt-6 text-center text-[15px] text-gray-600 py-8">
        No items below this marker to prep for.
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="text-[13px] text-gray-600 uppercase tracking-[0.15em] mb-4">
        Next {items.length} sessions — add context before jumping in
      </div>
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] px-5">
        {items.map(item => (
          <PrepItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
