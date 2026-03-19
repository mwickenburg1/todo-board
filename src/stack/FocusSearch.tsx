import { useState, useEffect, useRef } from 'react'

interface SearchResult {
  id: number
  text: string
  list: string
  priority?: number
  env?: string | null
}

interface FocusSearchProps {
  onClose: () => void
  onPin: (id: number) => void
}

export function FocusSearch({ onClose, onPin }: FocusSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Debounced search via task-search endpoint (same as NewItemFlow uses)
  useEffect(() => {
    const q = query.trim()
    if (!q || q.length < 2) { setResults([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/focus/task-search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(data => { setResults(data); setSelectedIdx(0) })
        .catch(() => setResults([]))
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSelect = (item: SearchResult) => {
    onPin(item.id)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(prev => Math.min(prev + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(prev => Math.max(prev - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length > 0 && selectedIdx < results.length) handleSelect(results[selectedIdx])
    }
  }

  return (
    <div
      ref={backdropRef}
      className="absolute inset-0 z-50 flex items-start justify-center"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="w-full bg-white dark:bg-[#1c1c1e] rounded-2xl border border-gray-200/80 dark:border-white/[0.08] shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_4px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_4px_16px_rgba(0,0,0,0.4)] overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4">
          <span className="text-gray-300 dark:text-gray-600 text-sm shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7" cy="7" r="4.5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks..."
            className="flex-1 bg-transparent text-[15px] text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-600"
            autoFocus
          />
          <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">
            esc
          </kbd>
        </div>

        {results.length > 0 && (
          <div className="border-t border-gray-100 dark:border-white/[0.06] py-1">
            {results.map((item, i) => (
              <button
                key={item.id}
                className={`w-full text-left px-6 py-2 flex items-center gap-3 text-sm transition-colors ${
                  i === selectedIdx
                    ? 'bg-blue-50 dark:bg-blue-500/10'
                    : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                }`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider w-16 shrink-0 truncate text-right">
                  {item.list}
                </span>
                <span className="text-gray-700 dark:text-gray-200 truncate">
                  {item.text}
                </span>
                {item.env && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono">{item.env}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {query.trim().length >= 2 && results.length === 0 && (
          <div className="border-t border-gray-100 dark:border-white/[0.06] px-6 py-3 text-sm text-gray-400 dark:text-gray-500">
            No matching tasks found
          </div>
        )}
      </div>
    </div>
  )
}
