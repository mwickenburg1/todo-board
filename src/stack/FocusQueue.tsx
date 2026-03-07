import { useEffect, useState, useCallback, useRef } from 'react'
import { FocusSearch } from './FocusSearch'

interface FocusResponse {
  empty: boolean
  depth: number
  top?: {
    id: number
    kind: string
    label: string
    sublabel?: string
    actionVerb: string
  }
}

function HotkeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] tracking-wide text-gray-300 dark:text-gray-600">
      <kbd className="
        px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] font-medium
        bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500
        border border-gray-200/80 dark:border-white/[0.08]
        shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]
      ">{keys}</kbd>
      <span>{label}</span>
    </span>
  )
}

function DeepWork() {
  return (
    <div className="py-16 flex flex-col items-center">
      <p className="text-[15px] font-light tracking-wide text-gray-300 dark:text-gray-600">
        Nothing needs you right now.
      </p>
    </div>
  )
}

export function FocusQueue() {
  const [data, setData] = useState<FocusResponse | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [lastItemId, setLastItemId] = useState<number | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const lastJsonRef = useRef('')

  const fetchQueue = useCallback(() => {
    fetch('/api/focus')
      .then(res => res.text())
      .then(text => {
        if (text !== lastJsonRef.current) {
          lastJsonRef.current = text
          setData(JSON.parse(text))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchQueue()
    const interval = setInterval(fetchQueue, 500)
    return () => clearInterval(interval)
  }, [fetchQueue])

  const topId = data?.top?.id ?? null

  useEffect(() => {
    if (lastItemId !== null && topId !== lastItemId) {
      setTransitioning(true)
      const timer = setTimeout(() => {
        setTransitioning(false)
        setLastItemId(topId)
      }, 150)
      return () => clearTimeout(timer)
    }
    setLastItemId(topId)
  }, [topId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handlePromote = useCallback((id: number) => {
    fetch('/api/focus/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => {
      lastJsonRef.current = '' // Force refresh
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleCreate = useCallback((text: string) => {
    fetch('/api/focus/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(() => {
      lastJsonRef.current = '' // Force refresh
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  if (!data || data.empty) {
    return (
      <div className="relative mb-8 min-h-[200px]">
        <DeepWork />
        {searchOpen && (
          <FocusSearch
            onClose={() => setSearchOpen(false)}
            onPromote={handlePromote}
            onCreate={handleCreate}
          />
        )}
      </div>
    )
  }

  const { top } = data
  const isTask = top!.kind === 'task'

  return (
    <div className="relative mb-8">
      <div className={`
        relative px-8 pt-8 pb-6 rounded-2xl min-h-[200px]
        bg-white dark:bg-[#1c1c1e]
        border border-gray-100/80 dark:border-white/[0.06]
        shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_2px_8px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.04)]
        dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_2px_8px_rgba(0,0,0,0.2),0_12px_40px_rgba(0,0,0,0.3)]
        transition-all duration-300 ease-out
        ${transitioning ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}
        ${searchOpen ? 'opacity-0 pointer-events-none' : ''}
      `}>
        {/* Action verb */}
        <div className="mb-4">
          <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-400 dark:text-gray-500">
            {top!.actionVerb}
          </span>
        </div>

        {/* Main text + env pill */}
        {(() => {
          const envMatch = top!.sublabel?.match(/env(\d+)/)
          return (
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] leading-[1.35] font-medium text-gray-800 dark:text-gray-100">
                {top!.label}
              </h1>
              {envMatch && (
                <span className="
                  inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg
                  bg-indigo-50 dark:bg-indigo-500/10
                  border border-indigo-200/60 dark:border-indigo-400/20
                  text-[15px] font-medium text-indigo-600 dark:text-indigo-400
                ">
                  <span className="font-mono text-[16px]">⌃</span>
                  <span className="font-mono">{envMatch[1]}</span>
                </span>
              )}
            </div>
          )
        })()}

        {/* Sublabel (non-env) */}
        {top!.sublabel && !top!.sublabel.match(/env\d+/) && (
          <p className="mt-2 text-[13px] font-normal text-gray-400 dark:text-gray-500">
            {top!.sublabel}
          </p>
        )}

        {/* Hotkey hints */}
        <div className="mt-8 flex items-center gap-5">
          <HotkeyHint keys="⌘⇧D" label="done" />
          <HotkeyHint keys="⌘⇧E" label="snooze" />
          <HotkeyHint keys="⌘K" label="override" />
        </div>
      </div>

      {/* Cmd+K search overlay — replaces the card in-place */}
      {searchOpen && (
        <FocusSearch
          onClose={() => setSearchOpen(false)}
          onPromote={handlePromote}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
