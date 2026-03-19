import React from 'react'

interface TopBarProps {
  onFleet: () => void
  onPriority: () => void
  onPRs: () => void
  onDeadlines: () => void
  onNewItem: () => void
  onActivity: () => void
  onEnergy: () => void
  faded?: boolean
}

export function TopBar({ onFleet, onPriority, onPRs, onDeadlines, onNewItem, onActivity, onEnergy, faded }: TopBarProps) {
  const fadedClass = faded ? ' opacity-50 hover:opacity-100' : ''
  const btnBase = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer'

  return (
    <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5">
      <button onClick={onFleet} className={`${btnBase}${fadedClass}`}>
        <span className="font-mono opacity-60">⌘⇧F</span>
        <span>fleet</span>
      </button>
      <button onClick={onPriority} className={`${btnBase}${fadedClass}`}>
        <span className="font-mono opacity-60">⌘⇧;</span>
        <span>priorities</span>
      </button>
      <button onClick={onPRs} className={`${btnBase}${fadedClass}`}>
        <span className="font-mono opacity-60">⌘⇧G</span>
        <span>PRs</span>
      </button>
      <button onClick={onDeadlines} className={`${btnBase}${fadedClass}`}>
        <span className="font-mono opacity-60">⌘⇧'</span>
        <span>deadlines</span>
      </button>
      <button onClick={onEnergy} className={`${btnBase}${fadedClass}`}>
        <span className="font-mono opacity-60">⌘⇧\</span>
        <span>energy</span>
      </button>
      <button onClick={onActivity} className={`${btnBase}${fadedClass}`}>
        <span className="font-mono opacity-60">⌘⇧Y</span>
        <span>activity</span>
      </button>
      <button onClick={onNewItem} className={btnBase}>
        <span className="font-mono opacity-60">⌘N</span>
        <span>new item</span>
      </button>
    </div>
  )
}
