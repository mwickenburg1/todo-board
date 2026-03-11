import React, { useState, useCallback } from 'react'
import { ENV_COLORS, envLabel } from './focusShared'

export interface PR {
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

export function PRView({ prs }: { prs: PR[] }) {
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

  const sortKey = (pr: PR) => {
    if (pr.ci === 'failing' || pr.review === 'CHANGES_REQUESTED') return 0
    if (!pr.slackShared && !pr.stacked) return 1
    if (pr.review === 'APPROVED' && (pr.ci === 'passing' || pr.ci === 'none')) return 2
    return 3
  }

  const branchToPR = new Map<string, PR>()
  for (const pr of prs) branchToPR.set(pr.branch, pr)

  const rootOf = (pr: PR): PR => {
    const visited = new Set<string>()
    let cur = pr
    while (cur.base && cur.base !== 'production' && branchToPR.has(cur.base) && !visited.has(cur.base)) {
      visited.add(cur.base)
      cur = branchToPR.get(cur.base)!
    }
    return cur
  }

  const stackGroups = new Map<number, PR[]>()
  for (const pr of prs) {
    const root = rootOf(pr)
    if (!stackGroups.has(root.number)) stackGroups.set(root.number, [])
    stackGroups.get(root.number)!.push(pr)
  }

  const groups: { label: string; prs: PR[] }[] = []
  const assigned = new Set<number>()

  const projectMap = new Map<string, PR[]>()
  for (const pr of prs) {
    if (pr.project) {
      if (!projectMap.has(pr.project)) projectMap.set(pr.project, [])
      projectMap.get(pr.project)!.push(pr)
    }
  }
  for (const [proj, prList] of projectMap) {
    const expanded = new Set(prList.map(p => p.number))
    for (const pr of prList) {
      const stack = stackGroups.get(rootOf(pr).number) || []
      for (const s of stack) expanded.add(s.number)
    }
    const fullList = prs.filter(p => expanded.has(p.number))
    if (fullList.length >= 1) {
      groups.push({ label: proj, prs: fullList })
      for (const p of fullList) assigned.add(p.number)
    }
  }

  const remaining = prs.filter(p => !assigned.has(p.number))
  const stackGroupsRemaining = new Map<number, PR[]>()
  for (const pr of remaining) {
    const root = rootOf(pr)
    if (!stackGroupsRemaining.has(root.number)) stackGroupsRemaining.set(root.number, [])
    stackGroupsRemaining.get(root.number)!.push(pr)
  }
  for (const [, prList] of stackGroupsRemaining) {
    if (prList.length >= 2) {
      const root = prList.find(p => !p.stacked) || prList[0]
      const label = branchTicket(root.branch) || root.branch
      groups.push({ label, prs: prList })
      for (const p of prList) assigned.add(p.number)
    }
  }

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
  const trueUngrouped: PR[] = []
  const slackNoteGroups = new Map<string, { label: string; prs: PR[] }>()
  for (const pr of ungrouped) {
    if (pr.slackShared || (pr.review === 'APPROVED' && (pr.ci === 'passing' || pr.ci === 'none'))) {
      const noteKey = pr.slackNote?.trim()
      if (noteKey && slackNoteGroups.has(noteKey)) {
        slackNoteGroups.get(noteKey)!.prs.push(pr)
      } else if (noteKey) {
        const label = branchTicket(pr.branch) || pr.title.slice(0, 40)
        const g = { label, prs: [pr] }
        slackNoteGroups.set(noteKey, g)
        groups.push(g)
      } else {
        const label = branchTicket(pr.branch) || pr.title.slice(0, 40)
        groups.push({ label, prs: [pr] })
      }
    } else {
      trueUngrouped.push(pr)
    }
  }
  for (const g of slackNoteGroups.values()) {
    if (g.prs.length > 1) {
      const tickets = g.prs.map(p => branchTicket(p.branch)).filter(Boolean)
      g.label = tickets.join(' + ') || g.label
    }
  }
  ungrouped.length = 0
  ungrouped.push(...trueUngrouped)
  ungrouped.sort((a, b) => sortKey(a) - sortKey(b))
  const hasSlack = (g: { prs: PR[] }) => g.prs.some(p => p.slackShared && !p.stacked)
  const groupSlackActivity = (g: { prs: PR[] }) =>
    Math.max(0, ...g.prs.map(p => p.slackLatestActivity || 0))
  groups.sort((a, b) => {
    const aShared = hasSlack(a), bShared = hasSlack(b)
    if (aShared !== bShared) return aShared ? -1 : 1
    if (aShared && bShared) return groupSlackActivity(b) - groupSlackActivity(a)
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
