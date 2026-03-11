import React, { useEffect, useState, useCallback, useRef } from 'react'
import { FleetView } from './FleetView'
import { PrioritySortView } from './PrioritySortView'
import { NewItemFlow, type SlackContext } from './NewItemFlow'
import { RescheduleInput } from './RescheduleInput'
import { SlackThreadPreview } from './SlackThreadPreview'
import { evaluateAlerts, alertStyle } from './focusAlerts'
import { ENV_COLORS, openFleetEnv, envLabel, smartDeadlineLabel } from './focusShared'

function EditableTitle({ label, isSlack, onSave }: { label: string; isSlack: boolean; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(label) }, [label])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const colorClass = isSlack ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100'

  const commit = () => {
    setEditing(false)
    const trimmed = value.trim()
    if (trimmed && trimmed !== label) onSave(trimmed)
    else setValue(label)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setValue(label); setEditing(false) }
          e.stopPropagation()
        }}
        onKeyUp={e => e.stopPropagation()}
        onKeyPress={e => e.stopPropagation()}
        className={`text-[24px] leading-[1.35] font-medium ${colorClass} bg-transparent border-b-2 border-blue-400 outline-none w-full`}
      />
    )
  }

  return (
    <h1
      onClick={() => setEditing(true)}
      className={`text-[24px] leading-[1.35] font-medium ${colorClass} cursor-text hover:border-b hover:border-gray-300 dark:hover:border-gray-600`}
    >
      {label}
    </h1>
  )
}

function Scratchpad({ taskId, initialNotes, onSave }: { taskId: number; initialNotes: string; onSave: (id: number, notes: string) => void }) {
  const [value, setValue] = useState(initialNotes)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(initialNotes)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusedRef = useRef(false)

  // Reset when task changes — but skip if user is actively typing
  useEffect(() => {
    if (!focusedRef.current) {
      setValue(initialNotes)
      lastSavedRef.current = initialNotes
    }
  }, [taskId, initialNotes])

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = '100px'
      el.style.height = Math.max(100, el.scrollHeight) + 'px'
    }
  }, [value])

  const debouncedSave = useCallback((text: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (text !== lastSavedRef.current) {
        lastSavedRef.current = text
        onSave(taskId, text)
      }
    }, 600)
  }, [taskId, onSave])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    setValue(newVal)
    debouncedSave(newVal)
  }

  return (
    <div className="mt-4">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onFocus={() => { focusedRef.current = true }}
        onBlur={() => { focusedRef.current = false }}
        onKeyDown={e => e.stopPropagation()}
        onKeyUp={e => e.stopPropagation()}
        onKeyPress={e => e.stopPropagation()}
        placeholder="Notes..."
        className="w-full bg-gray-50/50 dark:bg-white/[0.02] text-[18px] leading-relaxed text-gray-600 dark:text-gray-400 placeholder-gray-300 dark:placeholder-gray-600 border-none rounded-xl px-5 py-4 outline-none resize-none overflow-hidden"
        style={{ minHeight: '100px' }}
      />
    </div>
  )
}

interface PR {
  number: number
  title: string
  branch: string
  base?: string
  review: string
  url: string
  ci: string
  mergeable: string
  updatedAt: string
  ticket?: string
  project?: string | null
  stacked?: boolean
  env?: string | null
  slackShared?: string | null
  slackPermalink?: string | null
  slackLatestActivity?: number | null
  slackNote?: string | null
  repo?: string
}

function PRView({ prs }: { prs: PR[] }) {
  const [mutedGroups, setMutedGroups] = useState<Set<string>>(new Set())
  const toggleMute = useCallback((label: string) => {
    setMutedGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })
  }, [])
  const ciIcon = (ci: string) => {
    switch (ci) {
      case 'passing': return '✓'
      case 'failing': return '✗'
      case 'running': return '◌'
      default: return '—'
    }
  }
  const ciColor = (ci: string) => {
    switch (ci) {
      case 'passing': return 'text-emerald-500 dark:text-emerald-400'
      case 'failing': return 'text-red-500 dark:text-red-400'
      case 'running': return 'text-amber-500 dark:text-amber-400'
      default: return 'text-gray-400 dark:text-gray-500'
    }
  }
  const reviewLabel = (r: string) => {
    switch (r) {
      case 'APPROVED': return { text: 'Approved', color: 'text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' }
      case 'CHANGES_REQUESTED': return { text: 'Changes', color: 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10' }
      case 'REVIEW_REQUIRED': return { text: 'Review needed', color: 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' }
      default: return { text: 'No review', color: 'text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-white/[0.04]' }
    }
  }

  const timeAgo = (epochSec: number) => {
    const mins = Math.floor((Date.now() / 1000 - epochSec) / 60)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    const days = Math.floor(hrs / 24)
    return `${days}d`
  }

  const branchTicket = (branch: string): string | null => {
    const m = branch.match(/([A-Z]{2,}-\d+)/)
    return m ? m[1] : null
  }

  const statusBadge = (pr: PR) => {
    if (pr.ci === 'failing' || pr.review === 'CHANGES_REQUESTED') return { text: 'Fix', color: 'text-red-400 dark:text-red-400/80 bg-red-50 dark:bg-red-500/10' }
    if (!pr.slackShared && !pr.stacked) return { text: 'Share', color: 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10' }
    if (pr.review === 'APPROVED' && (pr.ci === 'passing' || pr.ci === 'none')) return { text: 'Ready', color: 'text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' }
    return null
  }

  const renderPR = (pr: PR, indent = false) => {
    const rv = reviewLabel(pr.review)
    const ticket = branchTicket(pr.branch)
    const sb = statusBadge(pr)
    return (
      <React.Fragment key={pr.number}>
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-gray-200/40 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/[0.12] transition-colors cursor-pointer group ${indent ? 'ml-6 opacity-50 hover:opacity-80' : ''}`}
      >
        {indent && <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">↳</span>}
        <span className={`text-[16px] font-mono font-bold ${ciColor(pr.ci)}`}>{ciIcon(pr.ci)}</span>
        {pr.env && (() => { const c = ENV_COLORS[pr.env]; return c ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.bg} ${c.border} ${c.text} border shrink-0`}>{envLabel(pr.env)}</span> : null })()}
        {pr.repo === 'widget' && <span className="text-[9px] font-mono font-bold text-violet-400 dark:text-violet-400/70 bg-violet-50 dark:bg-violet-500/10 px-1 py-0.5 rounded shrink-0">W</span>}
        <span className="text-[13px] font-mono text-gray-400 dark:text-gray-500 w-[45px] shrink-0">#{pr.number}</span>
        {ticket && <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500 shrink-0">{ticket}</span>}
        <span className="text-[14px] text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
          {pr.title}
        </span>
        {pr.mergeable === 'CONFLICTING' && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-md text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10">Conflict</span>
        )}
        {pr.review === 'APPROVED'
          ? <span className="text-[11px] font-medium px-2 py-0.5 rounded-md text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10">Approved</span>
          : pr.review === 'CHANGES_REQUESTED'
          ? <span className="text-[11px] font-medium px-2 py-0.5 rounded-md text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10">Changes</span>
          : null}
        {pr.slackShared
          ? <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-md text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
              title={pr.slackPermalink ? `Click to copy Slack link` : `Shared in #${pr.slackShared}`}
              onClick={(e) => {
                e.preventDefault(); e.stopPropagation()
                if (pr.slackPermalink) navigator.clipboard.writeText(pr.slackPermalink)
              }}
            >#{pr.slackShared}</span>
          : <span className="text-[11px] font-medium px-2 py-0.5 rounded-md text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-white/[0.04]">Not shared</span>}
        {pr.slackLatestActivity ? <span className="text-[10px] text-gray-400 dark:text-gray-600 shrink-0">{timeAgo(pr.slackLatestActivity)}</span> : null}
        <span
          className="text-[12px] text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 px-1"
          title="Copy PR URL"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(pr.url) }}
        >
          {'⧉'}
        </span>
      </a>
      {pr.slackNote && !indent && (
        <div className="text-[11px] text-gray-400 dark:text-gray-500 pl-12 -mt-1 mb-1 truncate italic">{pr.slackNote}</div>
      )}
      </React.Fragment>
    )
  }

  // Build stack tree: base PRs first, then their children indented
  const renderPRStack = (prList: PR[]) => {
    // Find PRs that are stacked on another PR in this list
    const branchSet = new Set(prList.map(p => p.branch))
    const roots = prList.filter(p => !p.base || !branchSet.has(p.base) || p.base === 'production')
    const children = new Map<string, PR[]>()
    for (const pr of prList) {
      if (pr.base && branchSet.has(pr.base) && pr.base !== 'production') {
        if (!children.has(pr.base)) children.set(pr.base, [])
        children.get(pr.base)!.push(pr)
      }
    }
    const result: JSX.Element[] = []
    const renderTree = (pr: PR, depth: number) => {
      result.push(renderPR(pr, depth > 0))
      const kids = children.get(pr.branch) || []
      for (const kid of kids) renderTree(kid, depth + 1)
    }
    for (const root of roots) renderTree(root, 0)
    return result
  }

  // Sort: fix needed → unshared → ready → waiting
  const sortKey = (pr: PR) => {
    if (pr.ci === 'failing' || pr.review === 'CHANGES_REQUESTED') return 0
    if (!pr.slackShared && !pr.stacked) return 1
    if (pr.review === 'APPROVED' && (pr.ci === 'passing' || pr.ci === 'none')) return 2
    return 3
  }

  // Step 1: merge stacked PRs into their base PR's group (follow base chain)
  const branchToPR = new Map<string, PR>()
  for (const pr of prs) branchToPR.set(pr.branch, pr)

  // Find the root of each stack chain
  const rootOf = (pr: PR): PR => {
    const visited = new Set<string>()
    let cur = pr
    while (cur.base && cur.base !== 'production' && branchToPR.has(cur.base) && !visited.has(cur.base)) {
      visited.add(cur.base)
      cur = branchToPR.get(cur.base)!
    }
    return cur
  }

  // Group stacked PRs with their root
  const stackGroups = new Map<number, PR[]>() // root PR number -> all PRs in stack
  for (const pr of prs) {
    const root = rootOf(pr)
    if (!stackGroups.has(root.number)) stackGroups.set(root.number, [])
    stackGroups.get(root.number)!.push(pr)
  }

  // Step 2: Group by Linear project, ticket ID, or stack
  const groups: { label: string; prs: PR[] }[] = []
  const assigned = new Set<number>()

  // Group by Linear project first
  const projectMap = new Map<string, PR[]>()
  for (const pr of prs) {
    if (pr.project) {
      if (!projectMap.has(pr.project)) projectMap.set(pr.project, [])
      projectMap.get(pr.project)!.push(pr)
    }
  }
  for (const [proj, prList] of projectMap) {
    // Also pull in any stacked PRs whose root is in this project group
    const expanded = new Set(prList.map(p => p.number))
    for (const pr of prList) {
      const stack = stackGroups.get(rootOf(pr).number) || []
      for (const s of stack) expanded.add(s.number)
    }
    const fullList = prs.filter(p => expanded.has(p.number))
    if (fullList.length >= 2) {
      groups.push({ label: proj, prs: fullList })
      for (const p of fullList) assigned.add(p.number)
    }
  }

  // Then group remaining by stack (2+ PRs in same stack)
  const remaining = prs.filter(p => !assigned.has(p.number))
  const stackGroupsRemaining = new Map<number, PR[]>()
  for (const pr of remaining) {
    const root = rootOf(pr)
    if (!stackGroupsRemaining.has(root.number)) stackGroupsRemaining.set(root.number, [])
    stackGroupsRemaining.get(root.number)!.push(pr)
  }
  for (const [, prList] of stackGroupsRemaining) {
    if (prList.length >= 2) {
      // Use the root's ticket or branch as label
      const root = prList.find(p => !p.stacked) || prList[0]
      const label = branchTicket(root.branch) || root.branch
      groups.push({ label, prs: prList })
      for (const p of prList) assigned.add(p.number)
    }
  }

  // Then group remaining by ticket ID
  const stillRemaining = prs.filter(p => !assigned.has(p.number))
  const ticketMap = new Map<string, PR[]>()
  const ungrouped: PR[] = []
  for (const pr of stillRemaining) {
    const t = branchTicket(pr.branch)
    if (t) {
      if (!ticketMap.has(t)) ticketMap.set(t, [])
      ticketMap.get(t)!.push(pr)
    } else {
      ungrouped.push(pr)
    }
  }
  for (const [ticket, prList] of ticketMap) {
    if (prList.length >= 2) {
      groups.push({ label: ticket, prs: prList })
    } else {
      ungrouped.push(...prList)
    }
  }
  // Promote ungrouped PRs with Slack shares or ready status into their own 1-item group
  // so they participate in the group sort (instead of being buried under "Other")
  const trueUngrouped: PR[] = []
  for (const pr of ungrouped) {
    if (pr.slackShared || (pr.review === 'APPROVED' && (pr.ci === 'passing' || pr.ci === 'none'))) {
      const label = branchTicket(pr.branch) || pr.title.slice(0, 40)
      groups.push({ label, prs: [pr] })
    } else {
      trueUngrouped.push(pr)
    }
  }
  ungrouped.length = 0
  ungrouped.push(...trueUngrouped)
  ungrouped.sort((a, b) => sortKey(a) - sortKey(b))
  // Sort groups: Slack recency first, unshared sink to bottom
  const hasSlack = (g: { prs: PR[] }) => g.prs.some(p => p.slackShared && !p.stacked)
  const groupSlackActivity = (g: { prs: PR[] }) =>
    Math.max(0, ...g.prs.map(p => p.slackLatestActivity || 0))
  groups.sort((a, b) => {
    const aShared = hasSlack(a), bShared = hasSlack(b)
    if (aShared !== bShared) return aShared ? -1 : 1  // shared above unshared
    if (aShared && bShared) return groupSlackActivity(b) - groupSlackActivity(a)  // most recent first
    return Math.min(...a.prs.map(sortKey)) - Math.min(...b.prs.map(sortKey))
  })

  return (
    <div className="mt-6">
      <div className="text-[13px] text-gray-400 dark:text-gray-500 mb-4">{prs.length} open PRs</div>
      {groups.map(g => {
        const muted = mutedGroups.has(g.label)
        return (
        <div key={g.label} className={`mb-5 transition-opacity ${muted ? 'opacity-30 hover:opacity-50' : ''}`}>
          <div className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 px-1 mb-2 flex items-center gap-2 group/hdr">
            <span className="w-3 h-px bg-gray-300 dark:bg-gray-600" />
            <span className={`cursor-pointer select-none ${muted ? 'line-through' : ''}`} onClick={() => toggleMute(g.label)}>{g.label}</span>
            <span className="text-[11px] font-normal text-gray-400 dark:text-gray-500">({g.prs.length})</span>
            <button
              onClick={() => toggleMute(g.label)}
              className={`p-0.5 rounded transition-all cursor-pointer shrink-0 ${
                muted
                  ? 'text-gray-400 dark:text-gray-500'
                  : 'text-gray-300/0 group-hover/hdr:text-gray-300 dark:group-hover/hdr:text-gray-600 hover:text-gray-400 dark:hover:text-gray-500'
              }`}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M1 1l22 22"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
                  <path d="M17 16.95A7 7 0 015 12"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 01-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              )}
            </button>
            <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>
          {!muted && (
            <div className="space-y-2">
              {renderPRStack(g.prs)}
            </div>
          )}
        </div>
        )
      })}
      {ungrouped.length > 0 && (
        <div className="mb-5">
          {groups.length > 0 && (
            <div className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 px-1 mb-2 flex items-center gap-2">
              <span className="w-3 h-px bg-gray-300 dark:bg-gray-600" />
              Other
              <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>
          )}
          <div className="space-y-2">
            {renderPRStack(ungrouped)}
          </div>
        </div>
      )}
    </div>
  )
}

interface DeadlineItem {
  id: number; text: string; list: string; deadline: string | null
  status: string; env: string | null; escalation: number; created?: string
}

function DeadlineView({ items, onSetDeadline, onDone }: { items: DeadlineItem[]; onSetDeadline: (id: number, deadline: string | null) => void; onDone: (id: number) => void }) {
  const [search, setSearch] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [dateInput, setDateInput] = useState<{ id: number; text: string } | null>(null)
  const [dateText, setDateText] = useState('')
  const [dateParsing, setDateParsing] = useState(false)
  const [datePreview, setDatePreview] = useState<{ label: string; iso: string } | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (dateInput) { setDateInput(null); setDateText(''); setDatePreview(null); setDateError(null) }
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [dateInput])

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  const withDeadline = items.filter(i => i.deadline && i.deadline !== 'none').sort((a, b) => (a.deadline || '') < (b.deadline || '') ? -1 : 1)
  const withoutDeadline = items.filter(i => !i.deadline)
  const filtered = search.trim()
    ? withoutDeadline.filter(i => i.text.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => (b.created || '') > (a.created || '') ? 1 : -1)
        .slice(0, 15)
    : []

  // Reset selection when results change
  useEffect(() => { setSelectedIdx(0) }, [search])

  const deadlineDateStr = (d: string) => {
    // Handle both "2026-03-12" (date-only) and ISO datetime
    if (d.includes('T')) return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    return d
  }

  const deadlineColor = (d: string) => smartDeadlineLabel(d).color
  const deadlineLabel = (d: string) => smartDeadlineLabel(d).label

  const parseDate = async (text: string) => {
    setDateParsing(true)
    setDateError(null)
    try {
      const res = await fetch('/api/focus/parse-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const result = await res.json()
      if (result.success && result.iso) {
        setDatePreview({ label: result.label, iso: result.iso })
      } else {
        setDateError('Could not parse date')
      }
    } catch {
      setDateError('Failed to parse')
    }
    setDateParsing(false)
  }

  const confirmDate = () => {
    if (!dateInput || !datePreview) return
    onSetDeadline(dateInput.id, datePreview.iso)
    setDateInput(null)
    setDateText('')
    setDatePreview(null)
    setDateError(null)
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  // Confirm handler for preview phase
  useEffect(() => {
    if (!datePreview) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmDate() }
      if (e.key === 'Escape') { e.preventDefault(); setDatePreview(null); setTimeout(() => dateInputRef.current?.focus(), 0) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [datePreview]) // eslint-disable-line react-hooks/exhaustive-deps

  const startDateInput = (item: DeadlineItem) => {
    setDateInput({ id: item.id, text: item.text })
    setDateText('')
    setDatePreview(null)
    setDateError(null)
    setTimeout(() => dateInputRef.current?.focus(), 50)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      startDateInput(filtered[selectedIdx])
    }
    else if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur() }
  }

  const envBadge = (env: string | null) => {
    if (!env) return null
    const c = ENV_COLORS[env]
    if (!c) return null
    return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.bg} ${c.border} ${c.text} border shrink-0`}>{envLabel(env)}</span>
  }

  const renderDeadlineItem = (item: DeadlineItem) => (
    <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-gray-200/40 dark:border-white/[0.06] group">
      <button
        className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors cursor-pointer shrink-0 flex items-center justify-center text-transparent hover:text-green-500"
        onClick={() => onDone(item.id)}
        title="Mark done"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      </button>
      {envBadge(item.env)}
      <span className="text-[15px] text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{item.text}</span>
      <span className="text-[12px] text-gray-400 dark:text-gray-600 shrink-0">{item.list}</span>
      {editingId === item.id ? (
        <input
          type="date"
          autoFocus
          defaultValue={item.deadline || today}
          className="text-[14px] bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 text-gray-700 dark:text-gray-300 outline-none"
          onBlur={(e) => { onSetDeadline(item.id, e.target.value || null); setEditingId(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSetDeadline(item.id, (e.target as HTMLInputElement).value || null); setEditingId(null) }
            if (e.key === 'Escape') setEditingId(null)
          }}
        />
      ) : (
        <span
          className={`text-[14px] font-medium cursor-pointer hover:underline shrink-0 ${deadlineColor(item.deadline!)}`}
          onClick={() => setEditingId(item.id)}
        >
          {deadlineLabel(item.deadline!)}
        </span>
      )}
      <button
        className="text-[20px] leading-none text-gray-400 dark:text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0 px-1 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-500/10"
        onClick={() => onSetDeadline(item.id, null)}
        title="Remove deadline"
      >×</button>
    </div>
  )

  const renderSearchResult = (item: DeadlineItem, idx: number) => (
    <div
      key={item.id}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors cursor-pointer ${
        idx === selectedIdx
          ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200/60 dark:border-blue-500/20'
          : 'bg-white/50 dark:bg-white/[0.03] border-gray-200/40 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/[0.12]'
      }`}
      onClick={() => startDateInput(item)}
      onMouseEnter={() => setSelectedIdx(idx)}
    >
      <button
        className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors cursor-pointer shrink-0 flex items-center justify-center text-transparent hover:text-green-500"
        onClick={(e) => { e.stopPropagation(); onDone(item.id) }}
        title="Mark done"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      </button>
      {envBadge(item.env)}
      <span className="text-[15px] text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{item.text}</span>
      <span className="text-[12px] text-gray-400 dark:text-gray-600 shrink-0">{item.list}</span>
      <span className="text-[13px] text-gray-400 dark:text-gray-600 shrink-0">↵ set date</span>
    </div>
  )

  const [deadlinesCollapsed, setDeadlinesCollapsed] = useState(false)
  const [dailyGoalsCollapsed, setDailyGoalsCollapsed] = useState(false)

  return (
    <div className="mt-6">
      {/* Search / assign deadline — always at top */}
      <div className="mb-4 relative">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search tasks to assign deadline... (⌘K)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="w-full px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-gray-200/40 dark:border-white/[0.06] text-[16px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none focus:border-blue-300 dark:focus:border-blue-500/30 transition-colors relative z-50"
        />
        {(filtered.length > 0 || (search.trim() && filtered.length === 0)) && !dateInput && (
          <>
            <div className="fixed inset-0 z-40 bg-black/50 dark:bg-black/70" onClick={() => setSearch('')} />
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-[400px] overflow-y-auto bg-white dark:bg-[#1c1c1e] rounded-xl border border-gray-200/80 dark:border-white/[0.08] shadow-lg dark:shadow-[0_4px_24px_rgba(0,0,0,0.5)] p-2">
              {filtered.length > 0 ? (
                <div className="space-y-1.5">
                  {filtered.map(renderSearchResult)}
                </div>
              ) : (
                <div className="text-[15px] text-gray-400 dark:text-gray-500 px-4 py-3">No matches</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Date input overlay */}
      {dateInput && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-blue-50/50 dark:bg-blue-500/5 border border-blue-200/60 dark:border-blue-500/20">
          <div className="text-[14px] text-gray-500 dark:text-gray-400 mb-1.5 truncate">{dateInput.text}</div>
          {!datePreview ? (
            <div className="flex items-center gap-2">
              <input
                ref={dateInputRef}
                value={dateText}
                onChange={(e) => { setDateText(e.target.value); setDateError(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && dateText.trim()) parseDate(dateText.trim())
                  if (e.key === 'Escape') { setDateInput(null); setDateText(''); setTimeout(() => searchRef.current?.focus(), 50) }
                }}
                placeholder="tomorrow, friday 2pm, midday, AM, EOD..."
                className="flex-1 bg-transparent text-[16px] text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-600"
                disabled={dateParsing}
                autoFocus
              />
              {dateParsing && <span className="text-[13px] text-gray-400 animate-pulse">parsing...</span>}
              {dateError && <span className="text-[13px] text-red-400">{dateError}</span>}
              <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[11px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">esc</kbd>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-[16px] text-gray-800 dark:text-gray-100">{datePreview.label}</span>
              <span className="text-[12px] text-gray-400 dark:text-gray-500">
                <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[11px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">↵</kbd>
                {' '}confirm
              </span>
              <kbd
                className="px-1.5 py-0.5 rounded-[5px] font-mono text-[11px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] cursor-pointer"
                onClick={() => { setDatePreview(null); setTimeout(() => dateInputRef.current?.focus(), 0) }}
              >esc</kbd>
            </div>
          )}
        </div>
      )}

      {/* Deadlines list — collapsible */}
      {withDeadline.length > 0 && (
        <div className="mb-6">
          <div
            className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 px-1 py-1.5 mb-2 flex items-center gap-2 cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            onClick={() => setDeadlinesCollapsed(c => !c)}
          >
            <span className={`text-[11px] transition-transform ${deadlinesCollapsed ? '' : 'rotate-90'}`}>▶</span>
            Deadlines
            <span className="text-[13px] font-normal text-gray-400 dark:text-gray-500">({withDeadline.length})</span>
            <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>
          {!deadlinesCollapsed && (
            <div className="space-y-1.5">
              {withDeadline.map(renderDeadlineItem)}
            </div>
          )}
        </div>
      )}

      {/* Daily-goals items without deadlines */}
      {(() => {
        const dailyGoalsNoDeadline = withoutDeadline.filter(i => i.list === 'daily-goals')
        if (dailyGoalsNoDeadline.length === 0) return null
        return (
          <div className="mt-4 opacity-40">
            <div
              className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 px-1 py-1.5 mb-2 flex items-center gap-2 cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              onClick={() => setDailyGoalsCollapsed(c => !c)}
            >
              <span className={`text-[11px] transition-transform ${dailyGoalsCollapsed ? '' : 'rotate-90'}`}>▶</span>
              Daily goals — no deadline
              <span className="text-[13px] font-normal text-gray-400 dark:text-gray-500">({dailyGoalsNoDeadline.length})</span>
              <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>
            {!dailyGoalsCollapsed && <div className="space-y-1.5">
              {dailyGoalsNoDeadline.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-gray-200/40 dark:border-white/[0.06] group">
                  <button
                    className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors cursor-pointer shrink-0 flex items-center justify-center text-transparent hover:text-green-500"
                    onClick={() => onDone(item.id)}
                    title="Mark done"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  </button>
                  {envBadge(item.env)}
                  <span className="text-[15px] text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{item.text}</span>
                  <span
                    className="text-[13px] text-gray-400 dark:text-gray-600 shrink-0 cursor-pointer hover:text-blue-500 dark:hover:text-blue-400"
                    onClick={() => startDateInput(item)}
                  >+ deadline</span>
                  <span
                    className="text-[13px] text-gray-400 dark:text-gray-600 shrink-0 cursor-pointer hover:text-gray-500 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onSetDeadline(item.id, 'none')}
                    title="Mark as not needing a deadline"
                  >n/a</span>
                </div>
              ))}
            </div>}
          </div>
        )
      })()}
    </div>
  )
}

interface FleetEnv {
  env: string
  tasks: { id: number; text: string; list: string; status: string; escalation: number; hasClaudeLink: boolean; claudeLinks: { label: string; ref: string; idx: number }[] }[]
}

interface FocusResponse {
  empty: boolean
  depth: number
  snoozeMinutes?: number
  top?: {
    id: number
    kind: string
    label: string
    sublabel?: string
    actionVerb: string
    rescheduledUntilMs?: number
    rescheduledReason?: string
    emphasizedHotkeys?: string[]
    fleet?: FleetEnv[]
    from?: string | null
    channelLabel?: string | null
    isFireDrill?: boolean
    slackThread?: { who: string; text: string }[] | null
    slackRef?: string | null
    suggestion?: string | null
    draftReply?: string | null
    slackContext?: { label: string; ref: string }[] | null
    env?: string | null
    claudeLinks?: { label: string; ref: string; idx: number }[] | null
    priorityTasks?: { id: number; text: string; env: string | null; escalation: number; isFireDrill: boolean; deadline: string | null; status?: string }[]
    notes?: string
    prs?: PR[]
    deadlineItems?: DeadlineItem[]
  }
}

type HotkeyEmphasis = 'primary' | 'secondary' | 'default'

function HotkeyHint({ keys, label, emphasis = 'default' }: { keys: string; label: string; emphasis?: HotkeyEmphasis }) {
  const kbdClass = emphasis === 'primary'
    ? 'px-2.5 py-1 rounded-md font-mono text-[14px] font-medium bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-400/20 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'
    : emphasis === 'secondary'
    ? 'px-2.5 py-1 rounded-md font-mono text-[14px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-200/60 dark:border-amber-400/15 shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'
    : 'px-2.5 py-1 rounded-md font-mono text-[14px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)]'

  const labelClass = emphasis === 'primary'
    ? 'text-emerald-500 dark:text-emerald-400'
    : emphasis === 'secondary'
    ? 'text-amber-400 dark:text-amber-400/70'
    : 'text-gray-300 dark:text-gray-600'

  return (
    <span className={`inline-flex items-center gap-1.5 text-[15px] tracking-wide`}>
      <kbd className={kbdClass}>{keys}</kbd>
      <span className={labelClass}>{label}</span>
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

const ALL_ENVS = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8', 'env9', 'env10']

function EnvControls({ taskId, env, label, isLinked, onSetEnv }: {
  taskId: number
  env: string | null
  label: string
  isLinked: boolean
  onSetEnv: (id: number, env: string | null) => void
}) {
  const [showPicker, setShowPicker] = useState(false)

  return (
    <span className="relative ml-auto inline-flex items-center gap-3">
      {env ? (
        <>
          <button
            onClick={() => openFleetEnv(env, isLinked ? undefined : `/link ${label}`)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[14px] font-medium cursor-pointer transition-colors ${
              isLinked
                ? 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08] shadow-[0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_rgba(0,0,0,0.3)] hover:text-gray-600 dark:hover:text-gray-300'
                : 'bg-transparent text-gray-300 dark:text-gray-600 border border-dashed border-gray-300/80 dark:border-gray-600/60 hover:text-gray-500 dark:hover:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
            title={isLinked ? 'Open environment' : 'Not linked — click to open env & copy /link'}
          >
            <span>&#x2303;</span>
            <span>{envLabel(env)}</span>
          </button>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-[13px] text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-pointer transition-colors"
          >
            change
          </button>
          <button
            onClick={() => onSetEnv(taskId, null)}
            className="text-[13px] text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 cursor-pointer transition-colors"
          >
            unlink
          </button>
        </>
      ) : (
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="text-[13px] text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 cursor-pointer transition-colors"
        >
          assign env
        </button>
      )}
      {showPicker && (
        <div className="absolute right-0 bottom-full mb-2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg px-3 py-2.5 flex items-center gap-2">
          {ALL_ENVS.map(e => {
            const c = ENV_COLORS[e] || ENV_COLORS.env7
            const isActive = e === env
            return (
              <button
                key={e}
                onClick={() => { onSetEnv(taskId, e); setShowPicker(false); openFleetEnv(e, `/link ${label}`) }}
                className={`px-2.5 py-1 rounded-lg text-[13px] font-mono font-medium border cursor-pointer transition-colors ${
                  isActive
                    ? `${c.bg} ${c.border} ${c.text} ring-2 ring-offset-1 dark:ring-offset-gray-900`
                    : `bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border-gray-200/60 dark:border-white/[0.08]`
                }`}
              >
                {envLabel(e)}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

export function FocusQueue() {
  const [data, setData] = useState<FocusResponse | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [lastItemId, setLastItemId] = useState<number | null>(null)
  const [newItemOpen, setNewItemOpen] = useState(false)
  const [newItemFireDrill, setNewItemFireDrill] = useState(false)
  const [newItemPrefill, setNewItemPrefill] = useState('')
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const lastJsonRef = useRef('')
  const dataRef = useRef<FocusResponse | null>(null)

  const fetchQueue = useCallback(() => {
    fetch('/api/focus')
      .then(res => res.text())
      .then(text => {
        // Strip notes from comparison so typing doesn't cause jitter
        const strip = (s: string) => s.replace(/"notes":"[^"]*"/, '"notes":""')
        if (strip(text) !== strip(lastJsonRef.current)) {
          lastJsonRef.current = text
          const parsed = JSON.parse(text)
          dataRef.current = parsed
          setData(parsed)
        } else {
          lastJsonRef.current = text
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

  const triggerFleet = useCallback(() => {
    fetch('/api/focus/trigger-fleet', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const triggerPriority = useCallback(() => {
    fetch('/api/focus/trigger-priority', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const triggerPRs = useCallback(() => {
    fetch('/api/focus/trigger-prs', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const triggerDeadlines = useCallback(() => {
    fetch('/api/focus/trigger-deadlines', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  // Cmd+N (new item), Cmd+J (reschedule), Cmd+Shift+C (create task from Slack)
  // Cmd+Shift+F (fleet), Cmd+P (priorities), Cmd+Shift+G (PRs), Cmd+Shift+L (deadlines)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n') {
        e.preventDefault()
        setRescheduleOpen(false)
        setNewItemFireDrill(false)
        setNewItemPrefill('')
        setNewItemOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setNewItemOpen(false)
        setRescheduleOpen(prev => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        triggerFleet()
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'p') {
        e.preventDefault()
        triggerPriority()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        triggerPRs()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        triggerDeadlines()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        const currentTop = dataRef.current?.top
        if (currentTop?.kind !== 'slack') return
        setRescheduleOpen(false)
        setNewItemOpen(false)
        const prefill = currentTop.label || ''
        setNewItemFireDrill(true)
        setNewItemPrefill(prefill)
        setTimeout(() => setNewItemOpen(true), 10)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [triggerFleet, triggerPriority, triggerPRs, triggerDeadlines])

  const handlePromote = useCallback((id: number) => {
    fetch('/api/focus/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleCreate = useCallback((text: string, type?: 'fire-drill' | 'today' | 'backlog', snoozeMins?: number, pastedSlack?: SlackContext) => {
    const currentTop = dataRef.current?.top
    const isSlack = currentTop?.kind === 'slack'
    const slackRef = isSlack ? currentTop.slackRef : null
    const slackLabel = isSlack ? currentTop.label : null
    const originalId = currentTop?.id

    // Step 1: Dismiss the slack pulse item first (so it doesn't reappear)
    const dismissPromise = isSlack && originalId
      ? fetch('/api/focus/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      : Promise.resolve(null)

    dismissPromise.then(() =>
      // Step 2: Create the new task via promote
      fetch('/api/focus/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, itemType: type, snoozeMins: type === 'fire-drill' ? snoozeMins : undefined }),
      }).then(res => res.json())
    ).then(result => {
      if (!result) return
      const promises: Promise<unknown>[] = []
      // Attach slack thread link — from focus queue item or from pasted URL
      const linkRef = slackRef || (pastedSlack ? `${pastedSlack.channel}/${pastedSlack.ts}` : null)
      const linkLabel = slackLabel || (pastedSlack ? `#${pastedSlack.channelName}` : null)
      if (result.created && result.promoted && linkRef) {
        promises.push(fetch(`/api/todos/${result.promoted}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'slack_thread', ref: linkRef, label: linkLabel || '' }),
        }))
      }
      return Promise.all(promises)
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleUpdateTask = useCallback((id: number, text: string) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleUnlink = useCallback((id: number, linkIdx: number) => {
    fetch(`/api/todos/${id}/links/${linkIdx}`, { method: 'DELETE' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleSetEnv = useCallback((id: number, env: string | null) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: env || '' }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleSaveNotes = useCallback((id: number, notes: string) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    }).catch(() => {})
  }, [])

  const handleDone = useCallback((id: number) => {
    fetch(`/api/todos/${id}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleEscalate = useCallback((id: number, level: number) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalation: level }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleAddFleetItem = useCallback((text: string, env: string) => {
    fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, list: 'daily-goals', env }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleReorder = useCallback((id: number, beforeId?: number) => {
    fetch(`/api/todos/${id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeId }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue])

  const handleReschedule = useCallback(async (text: string, confirm?: boolean) => {
    const res = await fetch('/api/focus/reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, confirm }),
    })
    const result = await res.json()
    if (!result.success) throw new Error(result.reason)
    if (result.action === 'rescheduled') {
      lastJsonRef.current = ''
      setRescheduleOpen(false)
      fetchQueue()
    }
    return result
  }, [fetchQueue])

  const overlayOpen = newItemOpen || rescheduleOpen

  if (!data || data.empty) {
    return (
      <div className="relative min-h-[1450px]">
        {/* Top-right buttons — empty state */}
        <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5">
          <button
            onClick={triggerFleet}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
          >
            <span className="font-mono opacity-60">⌘⇧F</span>
            <span>fleet</span>
          </button>
          <button
            onClick={triggerPriority}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
          >
            <span className="font-mono opacity-60">⌘P</span>
            <span>priorities</span>
          </button>
          <button
            onClick={triggerPRs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
          >
            <span className="font-mono opacity-60">⌘⇧G</span>
            <span>PRs</span>
          </button>
          <button
            onClick={triggerDeadlines}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
          >
            <span className="font-mono opacity-60">⌘⇧L</span>
            <span>deadlines</span>
          </button>
          <button
            onClick={() => { setNewItemFireDrill(false); setNewItemPrefill(''); setNewItemOpen(true) }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
          >
            <span className="font-mono opacity-60">⌘N</span>
            <span>new item</span>
          </button>
        </div>
        <DeepWork />
        {overlayOpen && (
          <div className="absolute inset-0 z-40 bg-black/50 dark:bg-black/60 rounded-2xl" />
        )}
        {newItemOpen && (
          <NewItemFlow
            onClose={() => { setNewItemOpen(false); setNewItemFireDrill(false); setNewItemPrefill('') }}
            onCreate={handleCreate}
            isCreateTask={newItemFireDrill}
            prefill={newItemPrefill}
          />
        )}
        {rescheduleOpen && (
          <RescheduleInput
            onSubmit={handleReschedule}
            onClose={() => setRescheduleOpen(false)}
          />
        )}
      </div>
    )
  }

  const { top } = data
  const isFireDrill = top!.isFireDrill

  return (
    <div className="relative min-h-[1450px]">
      {/* Top-right buttons: fleet, priorities, new item */}
      <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5">
        <button
          onClick={triggerFleet}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer opacity-50 hover:opacity-100"
        >
          <span className="font-mono opacity-60">⌘⇧F</span>
          <span>fleet</span>
        </button>
        <button
          onClick={triggerPriority}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer opacity-50 hover:opacity-100"
        >
          <span className="font-mono opacity-60">⌘P</span>
          <span>priorities</span>
        </button>
        <button
          onClick={triggerPRs}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer opacity-50 hover:opacity-100"
        >
          <span className="font-mono opacity-60">⌘⇧G</span>
          <span>PRs</span>
        </button>
        <button
          onClick={triggerDeadlines}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer opacity-50 hover:opacity-100"
        >
          <span className="font-mono opacity-60">⌘⇧L</span>
          <span>deadlines</span>
        </button>
        <button
          onClick={() => { setNewItemFireDrill(false); setNewItemPrefill(''); setNewItemOpen(true) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200/80 dark:border-white/[0.08] text-[12px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
        >
          <span className="font-mono opacity-60">⌘N</span>
          <span>new item</span>
        </button>
      </div>
      <div className={`
        relative px-8 pt-8 pb-8 rounded-2xl ${top!.kind === 'fleet' || top!.kind === 'priority-sort' || top!.kind === 'prs' || top!.kind === 'deadlines' ? 'min-h-[700px]' : ''}
        bg-white dark:bg-[#1c1c1e]
        ${isFireDrill ? 'border-2 border-red-300/60 dark:border-red-500/30' : 'border border-gray-100/80 dark:border-white/[0.06]'}
        shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_2px_8px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.04)]
        dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_2px_8px_rgba(0,0,0,0.2),0_12px_40px_rgba(0,0,0,0.3)]
        transition-all duration-300 ease-out
        ${transitioning ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}
        ${overlayOpen ? 'opacity-0 pointer-events-none' : ''}
      `}>
        {/* Action verb */}
        <div className="mb-4">
          <span className={`text-[13px] font-semibold tracking-[0.12em] uppercase ${
            isFireDrill ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'
          }`}>
            {isFireDrill ? 'Fire drill' : top!.actionVerb}
          </span>
        </div>

        {/* Main text + env pill + alerts */}
        {(() => {
          const envKey = top!.env || null
          const envLinked = (top!.claudeLinks && top!.claudeLinks.length > 0) || false
          const alerts = evaluateAlerts(top!)
          return (
            <>
              <div className="flex items-center gap-3">
                <EditableTitle
                  label={top!.label}
                  isSlack={top!.kind === 'slack'}
                  onSave={(newText) => handleUpdateTask(top!.id, newText)}
                />
                {alerts.map((alert, i) => {
                  const s = alertStyle(alert.severity)
                  return (
                    <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg ${s.bg} border ${s.border} text-[12px] font-medium ${s.text}`}>
                      {alert.text}
                    </span>
                  )
                })}
                {envKey && (() => {
                  const colors = ENV_COLORS[envKey] || ENV_COLORS.env7
                  return (
                    <span
                      onClick={() => openFleetEnv(envKey, envLinked ? undefined : `/link ${top!.label}`)}
                      title={envLinked ? 'Open environment' : 'Not linked — click to open env & copy /link'}
                      className={envLinked
                        ? `inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg cursor-pointer hover:opacity-80 transition-opacity ${colors.bg} border ${colors.border} text-[15px] font-medium ${colors.text}`
                        : `inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg cursor-pointer hover:opacity-80 transition-opacity bg-transparent border border-dashed ${colors.border} text-[15px] font-medium ${colors.text} opacity-50 hover:opacity-70`
                      }
                    >
                      <span className="font-mono text-[16px]">&#x2303;</span>
                      <span className="font-mono">{envLabel(envKey)}</span>
                    </span>
                  )
                })()}
              </div>
              {top!.sublabel && !top!.sublabel.match(/env\d+/) && (
                <p className="mt-2 text-[19px] font-normal text-gray-400 dark:text-gray-500">
                  {top!.sublabel}
                </p>
              )}
            </>
          )
        })()}

        {/* Scratchpad — free-form notes for task items */}
        {top!.kind === 'task' && (
          <Scratchpad key={top!.id} taskId={top!.id} initialNotes={top!.notes || ''} onSave={handleSaveNotes} />
        )}

        {/* LLM suggestion — actionable advice between title and Slack panel */}
        {top!.kind === 'slack' && top!.suggestion && (
          <p className="mt-4 text-[19px] text-gray-700 dark:text-gray-200 leading-relaxed">
            {top!.suggestion}
          </p>
        )}

        {/* Hotkey hints + env controls — above Slack context for slack cards */}
        {top!.kind === 'slack' && (() => {
          const em = top!.emphasizedHotkeys || []
          const emphasisOf = (label: string): HotkeyEmphasis =>
            em[0] === label ? 'primary' : em[1] === label ? 'secondary' : 'default'
          const snoozeMins = data?.snoozeMinutes || 30
          const allHotkeys: { keys: string; label: string }[] = [
            { keys: '\u2318\u21e7D', label: 'done' },
            { keys: '\u2318\u21e7E', label: `snooze ${snoozeMins}m` },
            { keys: '\u2318J', label: 'reschedule' },
            { keys: '\u2318\u21e7C', label: 'create task' },
          ]
          const rank = { primary: 0, secondary: 1, default: 2 }
          const sorted = [...allHotkeys].sort((a, b) =>
            rank[emphasisOf(a.label)] - rank[emphasisOf(b.label)]
          )
          return (
            <div className="mt-6 flex items-center gap-5">
              {sorted.map(h => (
                <HotkeyHint key={h.label} keys={h.keys} label={h.label} emphasis={emphasisOf(h.label)} />
              ))}
            </div>
          )
        })()}

        {/* Fleet view */}
        {top!.kind === 'fleet' && top!.fleet && (
          <FleetView fleet={top!.fleet} onSave={handleUpdateTask} onUnlink={handleUnlink} onDone={handleDone} onEscalate={handleEscalate} onAdd={handleAddFleetItem} onReorder={handleReorder} />
        )}

        {/* PR dashboard view */}
        {top!.kind === 'prs' && top!.prs && (
          <PRView prs={top!.prs} />
        )}

        {/* Deadline view */}
        {top!.kind === 'deadlines' && top!.deadlineItems && (
          <DeadlineView items={top!.deadlineItems} onSetDeadline={(id, deadline) => {
            fetch(`/api/todos/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deadline }),
            }).then(() => { lastJsonRef.current = ''; fetchQueue() }).catch(() => {})
          }} onDone={handleDone} />
        )}

        {/* Priority sort view */}
        {top!.kind === 'priority-sort' && top!.priorityTasks && (
          <PrioritySortView tasks={top!.priorityTasks} onReorder={handleReorder} onDone={handleDone} />
        )}

        {/* Rescheduled indicator */}
        {top!.rescheduledUntilMs && (() => {
          const d = new Date(top!.rescheduledUntilMs)
          const now = new Date()
          const ny = (dt: Date) => dt.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
          const sameDay = ny(d) === ny(now)
          const timeStr = d.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
          })
          const dateStr = d.toLocaleDateString('en-US', {
            timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })
          return (
            <p className={`mt-2 font-normal text-amber-500/70 dark:text-amber-400/50 ${sameDay ? 'text-[15px]' : 'text-[12px]'}`}>
              {sameDay ? timeStr : dateStr}
            </p>
          )
        })()}

        {/* Slack context — collapsible thread previews */}
        {top!.kind === 'task' && top!.slackContext && top!.slackContext.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {top!.slackContext.map((ctx, i) => (
              <SlackThreadPreview key={i} ref_={ctx.ref} label={ctx.label} />
            ))}
          </div>
        )}

        {/* Hotkey hints + env controls — only for non-slack cards (slack hotkeys are above) */}
        {top!.kind !== 'slack' && (() => {
          const em = top!.emphasizedHotkeys || (top!.kind === 'task' ? ['done'] : [])
          const emphasisOf = (label: string): HotkeyEmphasis =>
            em[0] === label ? 'primary' : em[1] === label ? 'secondary' : 'default'
          const snoozeMins = data?.snoozeMinutes || 30
          const allHotkeys: { keys: string; label: string }[] = [
            { keys: '\u2318\u21e7D', label: 'done' },
            { keys: '\u2318\u21e7E', label: `snooze ${snoozeMins}m` },
            { keys: '\u2318J', label: 'reschedule' },
          ]
          const rank = { primary: 0, secondary: 1, default: 2 }
          const sorted = [...allHotkeys].sort((a, b) =>
            rank[emphasisOf(a.label)] - rank[emphasisOf(b.label)]
          )
          const taskEnv = top!.kind === 'task' ? (top!.env || null) : null
          const hasEnvControls = top!.kind === 'task'
          return (
            <div className="mt-8 flex items-center gap-5">
              {sorted.map(h => (
                <HotkeyHint key={h.label} keys={h.keys} label={h.label} emphasis={emphasisOf(h.label)} />
              ))}
              {hasEnvControls && (
                <EnvControls
                  taskId={top!.id}
                  env={taskEnv}
                  label={top!.label}
                  isLinked={!!(top!.claudeLinks && top!.claudeLinks.length > 0)}
                  onSetEnv={handleSetEnv}
                />
              )}
            </div>
          )
        })()}
        {/* Slack thread — inside card, reuse SlackThreadPreview */}
        {top!.kind === 'slack' && top!.slackRef && (() => {
          const isMention = top!.actionVerb === 'Mention'
          const refParts = top!.slackRef!.split('/')
          const hasThreadTs = refParts.length > 1
          // Mentions with a thread ref: show channel context + auto-open the specific thread
          // Mentions without a thread ref: show channel context, NO random thread auto-open
          const channelRef = isMention && hasThreadTs ? refParts[0] : top!.slackRef!
          const focusTs = isMention ? (hasThreadTs ? refParts[1] : '') : null
          return (
            <div className="mt-8">
              <SlackThreadPreview ref_={channelRef} label={top!.channelLabel || top!.from || 'Slack'} defaultExpanded focusThreadTs={focusTs} draftReply={top!.draftReply || null} />
            </div>
          )
        })()}
      </div>

      {/* Overlay backdrop */}
      {overlayOpen && (
        <div className="absolute inset-0 z-40 bg-black/50 dark:bg-black/60 rounded-2xl" />
      )}

      {/* Cmd+N new item overlay */}
      {newItemOpen && (
        <NewItemFlow
          onClose={() => { setNewItemOpen(false); setNewItemFireDrill(false); setNewItemPrefill('') }}
          onCreate={handleCreate}
          isCreateTask={newItemFireDrill}
          prefill={newItemPrefill}
        />
      )}

      {/* Cmd+J reschedule overlay */}
      {rescheduleOpen && (
        <RescheduleInput
          onSubmit={handleReschedule}
          onClose={() => setRescheduleOpen(false)}
        />
      )}
    </div>
  )
}

