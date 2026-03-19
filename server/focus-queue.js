/**
 * Focus Queue — server-side ranking + action endpoints.
 *
 * Computes the top-priority item from all lists, then acts on it.
 * Triggered via curl from global macOS hotkeys.
 *
 * Endpoints:
 *   GET  /api/focus           → current top item + queue depth
 *   POST /api/focus/done      → mark top item done (or dismiss pulse item)
 *   POST /api/focus/wait      → move top item to waiting
 *   POST /api/focus/snooze    → hide top item for 30 minutes
 *   POST /api/focus/promote    → override: pull item to top (or create + promote)
 *   POST /api/focus/reschedule → LLM-parsed reschedule to a specific time
 *   GET  /api/focus/searchable  → all items for Cmd+K search
 */

import { Router } from 'express'
import { readData, saveData, findTask, createTask, migrateWatches } from './store.js'
import { getConversation } from './conversations.js'
import { acknowledgeDigest, dismissSlackItem } from './slack-digest.js'
import { logActivity, readActivity } from './activity.js'
import { markRoutineChecked, isRoutineCheckedToday } from './routine-state.js'
import { ROUTINE_ITEMS } from './routine-items.js'
import { snoozeItem, unsnooze, isSnoozed, getSnoozedIds, getSnoozeInfo } from './snooze-state.js'
import { parseNaturalTime } from './time-parser.js'
import { hasUnread } from './slack-extract.js'
import { fetchPRs, getPRs } from './pr-fetcher.js'
import { retriageItem } from './slack-triage.js'
import { deriveSlackCardState } from './slack-card-state.js'

const router = Router()

function formatTimeAgo(epochSec) {
  const d = Date.now() / 1000 - epochSec
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

const SELF_AUTHORS = ['matthias', 'mwickenburg']
function isSelfEvent(author) {
  const lower = (author || '').toLowerCase()
  return SELF_AUTHORS.some(s => lower.includes(s))
}

// Promoted item: overrides queue ordering. Only one at a time.
let promotedId = null

// When set, inject a priority-sort view after creating a new item so user can position it.
let pendingPrioritySort = false

// When set, inject a fleet view on demand (independent of routine schedule).
let pendingFleet = false

// When set, inject a deadline view on demand.
let pendingDeadlines = false

// When set, inject a PR dashboard view on demand.
let pendingPRs = false

// When set, inject an activity log view on demand.
let pendingActivity = false

// When set, inject an energy check view on demand.
let pendingEnergy = false

function computeFleet(data) {
  const envMap = {} // env label -> [{ id, text, list, status, hasClaudeLink }]
  // Only show tasks from the "today" list (daily-goals)
  const allowedLists = new Set(['daily-goals'])

  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (!tasks || !allowedLists.has(listName)) continue
    for (const t of tasks) {
      if (!t.id || !t.env) continue
      const env = t.env
      if (!envMap[env]) envMap[env] = []
      const claudeLinks = (t.links || [])
        .map((l, idx) => ({ ...l, idx }))
        .filter(l => l.type === 'claude_code')
      envMap[env].push({
        id: t.id, text: t.text, list: listName,
        status: t.status || 'pending',
        escalation: t.escalation || 0,
        hasClaudeLink: claudeLinks.length > 0,
        claudeLinks: claudeLinks.map(l => ({ label: l.label, ref: l.ref, idx: l.idx })),
        deadline: t.deadline || null,
      })
    }
  }

  // Sort tasks within each env: escalation descending, then list position (insertion order)
  for (const tasks of Object.values(envMap)) {
    tasks.sort((a, b) => (b.escalation || 0) - (a.escalation || 0))
  }

  // Sort by env number, return as array
  return Object.entries(envMap)
    .sort(([a], [b]) => {
      const na = parseInt(a.replace('env', ''))
      const nb = parseInt(b.replace('env', ''))
      return na - nb
    })
    .map(([env, tasks]) => ({ env, tasks }))
}

export function computeQueue(data) {
  const items = []
  const pulse = (data.lists.pulse || []).filter(t => t.id && t.status !== 'done')

  // Build turn count map from activity log (session_id → prompt count)
  const allActivity = readActivity({ limit: 5000, type: 'claude_prompt' })
  const turnsBySession = {}
  for (const e of allActivity) {
    if (e.session_id) turnsBySession[e.session_id] = (turnsBySession[e.session_id] || 0) + 1
  }

  // --- Pulse items ---
  const slackItems = []
  for (const p of pulse) {
    if (!p.context) continue

    if (p.context === 'routine') {
      // Skip if already checked off today (defensive — repopulateRoutine should handle this)
      if (isRoutineCheckedToday(p.text)) continue
      // Small bonus by position in ROUTINE_ITEMS so earlier routines rank higher
      const routineIdx = ROUTINE_ITEMS.findIndex(r => r.text === p.text)
      const posBonus = routineIdx >= 0 ? (ROUTINE_ITEMS.length - routineIdx) : 0
      const routine = routineIdx >= 0 ? ROUTINE_ITEMS[routineIdx] : null
      const dayOfWeek = new Date().getDay()
      const emphasizedHotkeys = routine?.hotkeys
        ? (routine.hotkeys[dayOfWeek] || routine.hotkeys.default || ['done', 'reschedule'])
        : ['done', 'reschedule']
      const kind = routine?.isFleet ? 'fleet' : routine?.isPrioritySort ? 'priority-sort' : routine?.isEnergyCheck ? 'energy' : 'pulse'
      // Exercise stays above Slack (10000+), energy checks at 10500 (above everything except morning), other routines sit below Slack DMs/mentions (9200) but above threads (3000)
      const baseScore = routine?.isEnergyCheck ? 10500 : p.text === 'Exercise' ? 10000 : 8000
      const item = {
        id: p.id, kind,
        score: baseScore + posBonus, label: p.text,
        sublabel: routine?.sublabel, actionVerb: routine?.isEnergyCheck ? 'Energy' : 'Routine',
        list: 'pulse', emphasizedHotkeys,
        _isFleet: !!routine?.isFleet,
        _isPrioritySort: !!routine?.isPrioritySort,
        _isEnergyCheck: !!routine?.isEnergyCheck,
      }
      items.push(item)
      continue
    }
    // time-blocks disabled — skip them
    if (p.context === 'time-block') continue
    if (p.context === 'slack-header' || p.context === 'time-next') continue
    if (!p.context.startsWith('slack-') || p.priority <= 0) continue

    let score
    if (p.context === 'slack-incidents') score = 9500
    else if (p.context === 'slack-dms' || p.context === 'slack-mentions') score = 9200
    else if (p.context === 'slack-threads') score = 3000
    else if (p.context === 'slack-crashes') score = 1000
    else continue

    let suggestion = p.suggestion || null
    let draftReply = null
    let actions = null
    let keyMessageTs = null
    if (suggestion) {
      try {
        const parsed = JSON.parse(suggestion)
        suggestion = parsed.action || suggestion
        draftReply = parsed.draft || null
        actions = parsed.actions || null
        keyMessageTs = parsed.keyMessageTs || null
      } catch {}
    }
    slackItems.push({ id: p.id, score: score + (p.priority * 10), text: p.text, slackThread: p.slackThread, slackRef: p.slackRef, context: p.context, from: p.from || null, channelLabel: p.channelLabel || null, suggestion, draftReply, actions, keyMessageTs })
  }

  // Each urgent Slack item is its own card
  for (const s of slackItems) {
    const colonIdx = s.text.indexOf(': ')
    const from = s.from || (colonIdx > 0 ? s.text.slice(0, colonIdx) : null)
    const summary = colonIdx > 0 ? s.text.slice(colonIdx + 2) : s.text
    const verbMap = { 'slack-dms': 'DM', 'slack-mentions': 'Mention', 'slack-threads': 'Thread', 'slack-incidents': 'Incident', 'slack-crashes': 'Crashes' }
    // Clean Slack user mention markup: <@U123|Name> → @Name, <@U123> → @user
    const cleanLabel = summary.replace(/<@[A-Z0-9]+\|([^>]+)>/g, '@$1').replace(/<@[A-Z0-9]+>/g, '@user').replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1').replace(/<#[A-Z0-9]+>/g, '#channel')
    // Derive UI state from LLM-ranked actions
    const cardState = deriveSlackCardState(s.actions)
    items.push({
      id: s.id, kind: 'slack', score: s.score,
      label: cleanLabel,
      actionVerb: verbMap[s.context] || 'Slack',
      from, channelLabel: s.channelLabel || null,
      list: 'pulse',
      emphasizedHotkeys: cardState.emphasizedHotkeys,
      slackPanelEmphasis: cardState.slackPanelEmphasis,
      replyFirst: cardState.replyFirst,
      slackThread: s.slackThread || null,
      slackRef: s.slackRef || null,
      context: s.context || null,
      suggestion: s.suggestion || null,
      draftReply: s.draftReply || null,
      actions: s.actions || null,
      keyMessageTs: s.keyMessageTs || null,
    })
  }

  // --- Task items from daily-goals only (stop at relax marker) ---
  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (listName !== 'daily-goals' || !tasks) continue

    // Find relax marker position in the FULL list — items after it are below the waterline
    const relaxIdx = tasks.findIndex(t => t.isRelaxMarker)
    const aboveWaterline = relaxIdx >= 0 ? tasks.slice(0, relaxIdx + 1) : tasks
    const pending = aboveWaterline.filter(t => t.id && t.status === 'pending')

    for (let i = 0; i < pending.length; i++) {
      const t = pending[i]
      const posBonus = 100 - Math.min(i, 99)

      // Collect slack context from links — include ref for URL building
      const slackLinks = (t.links || []).filter(l => l.type === 'slack_thread')
      const slackContext = slackLinks.length > 0 ? slackLinks.map(l => ({
        label: l.label || l.ref,
        ref: l.ref,
      })) : null

      // Collect claude_code links with their indices for unlink
      const claudeLinks = (t.links || [])
        .map((l, idx) => ({ ...l, idx }))
        .filter(l => l.type === 'claude_code')
        .map(l => ({ label: l.label, ref: l.ref, idx: l.idx }))

      // Claude Code finished — detect but score purely by position
      const hasClaudeLink = (t.links || []).some(l => l.type === 'claude_code')
      const hasClaudeEvent = hasClaudeLink && (t.events || []).some(e =>
        e.source === 'claude_code' && !isSelfEvent(e.author) && e.metadata?.action !== 'claim'
      )
      let claudeSublabel = undefined
      let claudeActionVerb = 'Do'
      if (hasClaudeEvent) {
        let env = null
        for (const l of (t.links || [])) {
          if (l.type === 'claude_code' && l.label) {
            const m = l.label.match(/env(\d+)/)
            if (m) { env = m[0]; break }
          }
        }
        claudeSublabel = env ? `Claude finished in ${env}` : 'Claude finished'
        claudeActionVerb = 'Claude Code'
      }

      // --- slackWatches logic (pick best watch to surface) ---
      migrateWatches(t)
      let watchSublabel = undefined
      let watchActionVerb = null
      let watchData = null
      let allDelegateOnly = false

      if (t.slackWatches?.length > 0) {
        // Evaluate each watch, pick the most interesting one
        let bestWatch = null
        let bestPriority = -1  // activity=3, nudge=2, waiting=1, delegate-quiet=0
        allDelegateOnly = t.slackWatches.every(sw => sw.delegateOnly)

        for (const sw of t.slackWatches) {
          const hasNewActivity = sw.lastOtherTs > (sw.lastMyReplyTs || 0)
          const hoursSinceMyReply = sw.lastMyReplyTs
            ? (Date.now() / 1000 - sw.lastMyReplyTs) / 3600
            : Infinity
          const nudgeFired = sw.lastMyReplyTs && hoursSinceMyReply >= (sw.checkHours || 24)

          let priority = 0
          let sublabel, verb, reason
          if (hasNewActivity) {
            priority = 3
            sublabel = `replied ${formatTimeAgo(sw.lastOtherTs)}`
            verb = 'Thread'
            reason = 'activity'
          } else if (nudgeFired) {
            priority = 2
            const hours = Math.floor(hoursSinceMyReply)
            sublabel = `No reply in ${hours}h`
            verb = 'Nudge'
            reason = 'nudge'
          } else if (!sw.delegateOnly) {
            priority = 1
            const waitHours = sw.lastMyReplyTs
              ? Math.floor((Date.now() / 1000 - sw.lastMyReplyTs) / 3600)
              : null
            if (waitHours !== null) sublabel = `Waiting (${waitHours}h)`
            reason = null
          }
          // else delegate-only with no trigger → priority stays 0

          if (priority > bestPriority) {
            bestPriority = priority
            bestWatch = sw
            watchSublabel = sublabel
            watchActionVerb = verb
            watchData = { ref: sw.ref, surfaceReason: reason || null, surfaceContext: sw.surfaceContext || null, delegateOnly: sw.delegateOnly }
          }
        }

        // If all watches are delegate-only and none triggered, skip task
        if (allDelegateOnly && bestPriority === 0) continue
      }

      // All daily-goals items scored purely by position — priority order is king
      if (listName === 'daily-goals') {
        // Prep marker — shows next N items with editable notes
        if (t.isPrepMarker) {
          // Gather the next 10 pending tasks after this marker in the raw list
          const rawIdx = tasks.indexOf(t)
          const upcoming = tasks.slice(rawIdx + 1)
            .filter(u => u.id && u.status !== 'done' && !u.isRelaxMarker && !u.isPrepMarker)
            .slice(0, 10)
            .map(u => ({
              id: u.id, text: u.text, env: u.env || null,
              notes: u.notes || '', priority: u.priority,
              escalation: u.escalation || 0,
              hasClaudeLink: (u.links || []).some(l => l.type === 'claude_code'),
            }))
          items.push({
            id: t.id, kind: 'prep', score: 1000 + posBonus,
            label: 'Prep next sessions', actionVerb: 'Prep',
            list: listName, isPrepMarker: true,
            prepItems: upcoming,
            emphasizedHotkeys: ['done'],
          })
          continue
        }
        // Relax marker — special item that acts as a priority waterline
        if (t.isRelaxMarker) {
          items.push({
            id: t.id, kind: 'relax', score: 1000 + posBonus,
            label: 'All priority items handled', actionVerb: 'Relax',
            list: listName, isRelaxMarker: true,
            emphasizedHotkeys: ['snooze'],
          })
          continue
        }
        // Sum turns across all linked sessions
        const turnCount = claudeLinks.reduce((sum, l) => sum + (turnsBySession[l.ref] || 0), 0)
        items.push({
          id: t.id, kind: 'task', score: 1000 + posBonus,
          label: t.text, sublabel: watchSublabel || claudeSublabel,
          actionVerb: watchActionVerb || (hasClaudeEvent ? claudeActionVerb : (t.isFireDrill ? 'Fire drill' : 'Do')),
          list: listName, isFireDrill: t.isFireDrill || false,
          slackContext, env: t.env || null, claudeLinks,
          notes: t.notes || '',
          hasConversation: getConversation(t.id).messages.length > 0,
          slackWatch: watchData || null,
          visitedAt: t.visitedAt || null,
          turnCount,
          pipelineStatus: t.pipelineStatus || null,
          pipelineNext: t.pipelineNext || null,
          envHealth: t.envHealth || null,
        })
      }
    }
  }

  // --- Fleet management: inject fleet data into routine fleet item if present ---
  const fleetItem = items.find(item => item._isFleet)
  if (fleetItem) {
    const fleet = computeFleet(data)
    fleetItem.fleet = fleet
    fleetItem.label = 'Manage fleet'
    if (pendingFleet) fleetItem.score = 15002
  }

  // --- Priority sort: inject all daily-goals tasks (pending + in_progress) as flat list ---
  const prioritySortItem = items.find(item => item._isPrioritySort)
  if (prioritySortItem) {
    const dailyGoals = (data.lists['daily-goals'] || [])
      .filter(t => t.id && (t.status === 'pending' || t.status === 'in_progress'))
      .map(t => ({
        id: t.id, text: t.text, env: t.env || null,
        escalation: t.escalation || 0, isFireDrill: !!t.isFireDrill,
        deadline: t.deadline || null, status: t.status,
        snoozedUntil: isSnoozed(t.id) ? getSnoozeInfo(t.id)?.until : null,
        slackWatches: (t.slackWatches || []).map(w => ({ ref: w.ref, checkHours: w.checkHours, delegateOnly: w.delegateOnly, surfaceContext: (w.surfaceContext || []).slice(0, 2) })),
      }))
    prioritySortItem.priorityTasks = dailyGoals
    prioritySortItem.label = 'Set priorities'
    // When hotkey-triggered, boost score so it rises above Slack items
    if (pendingPrioritySort) prioritySortItem.score = 15001
  }

  // --- Pending priority sort: injected after creating a new item ---
  if (pendingPrioritySort && !prioritySortItem) {
    const dailyGoals = (data.lists['daily-goals'] || [])
      .filter(t => t.id && (t.status === 'pending' || t.status === 'in_progress'))
      .map(t => ({
        id: t.id, text: t.text, env: t.env || null,
        escalation: t.escalation || 0, isFireDrill: !!t.isFireDrill,
        deadline: t.deadline || null, status: t.status,
        snoozedUntil: isSnoozed(t.id) ? getSnoozeInfo(t.id)?.until : null,
        slackWatches: (t.slackWatches || []).map(w => ({ ref: w.ref, checkHours: w.checkHours, delegateOnly: w.delegateOnly, surfaceContext: (w.surfaceContext || []).slice(0, 2) })),
      }))
    items.push({
      id: -1, kind: 'priority-sort', score: 15001,
      label: 'Set priorities', actionVerb: 'Reorder',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isPrioritySort: true, priorityTasks: dailyGoals,
    })
  }

  // --- On-demand fleet: triggered by hotkey independent of routine ---
  if (pendingFleet && !fleetItem) {
    const fleet = computeFleet(data)
    items.push({
      id: -2, kind: 'fleet', score: 15002,
      label: 'Manage fleet', actionVerb: 'Fleet',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isFleet: true, fleet,
    })
  }

  // --- On-demand Deadline view: triggered by hotkey ---
  if (pendingDeadlines) {
    const deadlineItems = []
    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks || listName === 'done') continue
      for (const t of tasks) {
        if (t.done) continue
        deadlineItems.push({ id: t.id, text: t.text, list: listName, deadline: t.deadline || null, status: t.status || 'pending', env: t.env || null, escalation: t.escalation || 0, created: t.created || null })
      }
    }
    items.push({
      id: -5, kind: 'deadlines', score: 15004,
      label: 'Deadlines', actionVerb: 'Deadlines',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isDeadlines: true, deadlineItems,
    })
  }

  // --- On-demand PR dashboard: triggered by hotkey ---
  if (pendingPRs) {
    const prs = getPRs()
    items.push({
      id: -4, kind: 'prs', score: 15003,
      label: 'Pull Requests', actionVerb: 'PRs',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isPRs: true, prs,
    })
  }

  // --- On-demand Activity log: triggered by hotkey ---
  if (pendingActivity) {
    const activityEntries = readActivity({ limit: 200 })
    items.push({
      id: -6, kind: 'activity', score: 15005,
      label: 'Activity Log', actionVerb: 'Activity',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isActivity: true, activityEntries,
    })
  }

  // --- On-demand Energy check: triggered by hotkey ---
  if (pendingEnergy) {
    items.push({
      id: -7, kind: 'energy', score: 15006,
      label: 'Energy Check', actionVerb: 'Energy',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isEnergyCheck: true,
    })
  }

  // Morning overlay — inject as top synthetic item so done hotkey dismisses it
  if (!isRoutineCheckedToday('__morning_dismissed')) {
    items.push({
      id: -3, kind: 'morning', score: 20000,
      label: 'peak · don\'t waste it', actionVerb: 'Morning',
      list: 'pulse', emphasizedHotkeys: ['done'],
    })
  }

  // One-item-per-env rule: for envs 1-8, only the highest-scoring item survives.
  // Determined BEFORE snooze filtering so snoozed top items block lower env items.
  const topIdPerEnv = new Map()
  const sortedForEnv = [...items].sort((a, b) => b.score - a.score)
  for (const item of sortedForEnv) {
    const env = item.env
    if (!env) continue
    const m = env.match(/^env(\d+)$/)
    if (!m) continue
    const n = parseInt(m[1])
    if (n >= 1 && n <= 8 && !topIdPerEnv.has(env)) topIdPerEnv.set(env, item.id)
  }

  // Filter snoozed items, sort by score — also drop non-top env items
  const effective = items
    .filter(item => {
      // Enforce one-item-per-env: drop non-top items for envs 1-8
      if (item.env && topIdPerEnv.has(item.env) && topIdPerEnv.get(item.env) !== item.id) return false
      return !isSnoozed(item.id) && !(item.slackRef && isSnoozed(item.slackRef)) && item.score > 0
    })
    .sort((a, b) => b.score - a.score)

  // If there's a promoted item, force it to position 0 (skip when priority sort is pending)
  if (promotedId && !pendingPrioritySort) {
    const idx = effective.findIndex(item => item.id === promotedId)
    if (idx > 0) {
      const [item] = effective.splice(idx, 1)
      effective.unshift(item)
    } else if (idx === -1) {
      // Not in computed queue — find in raw data and inject
      for (const [listName, tasks] of Object.entries(data.lists)) {
        if (!tasks) continue
        const task = tasks.find(t => t.id === promotedId)
        if (task) {
          const claudeLinks = (task.links || [])
            .map((l, idx) => ({ ...l, idx }))
            .filter(l => l.type === 'claude_code')
            .map(l => ({ label: l.label, ref: l.ref, idx: l.idx }))
          const slackLinks = (task.links || []).filter(l => l.type === 'slack_thread')
          effective.unshift({
            id: task.id, kind: 'task', score: 15000,
            label: task.text, actionVerb: task.isFireDrill ? 'Fire drill' : 'Do', list: listName,
            isFireDrill: !!task.isFireDrill,
            env: task.env || null, claudeLinks,
            slackContext: slackLinks.length > 0 ? slackLinks.map(l => ({ label: l.label || l.ref, ref: l.ref })) : null,
          })
          break
        }
      }
    }
  }

  return effective
}

// Track last top task to clear visitedAt when displaced
let lastTopTaskId = null

// GET /api/focus — current top item + queue depth
router.get('/', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) {
      lastTopTaskId = null
      return res.json({ empty: true, depth: 0, message: 'Nothing needs you right now.' })
    }
    const top = queue[0]

    // Clear visitedAt when a different task becomes top
    if (top.kind === 'task' && top.id !== lastTopTaskId && lastTopTaskId !== null) {
      const prevResult = findTask(data, lastTopTaskId, { skipDone: true })
      if (prevResult?.task?.visitedAt) {
        delete prevResult.task.visitedAt
        saveData(data)
      }
    }
    if (top.kind === 'task') lastTopTaskId = top.id
    const snoozeInfo = getSnoozeInfo(top.id)
    if (snoozeInfo) {
      top.rescheduledUntilMs = snoozeInfo.until
      top.rescheduledReason = snoozeInfo.reason
    }
    // Use task's custom snooze duration if set, otherwise global default
    const topTask = findTask(data, top.id)?.task
    const effectiveSnooze = topTask?.snoozeMins || SNOOZE_MINUTES
    // Add linkPrompt for poller consumption
    if (top.kind === 'task' && topTask) {
      top.linkPrompt = topTask.notes ? `/link ${topTask.text}\n\n---\n\n## Notes\n${topTask.notes}` : `/link ${topTask.text}`
    }
    res.json({ empty: false, depth: queue.length, position: 1, top, snoozedIds: getSnoozedIds(), snoozeMinutes: effectiveSnooze })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Activity logging middleware for focus actions ---
router.use((req, res, next) => {
  if (req.method !== 'POST') return next()
  const origJson = res.json.bind(res)
  res.json = (body) => {
    const action = req.path.replace('/', '')
    if (body?.success !== false) {
      logActivity({
        type: 'focus_action',
        detail: `${action}: ${body?.item || body?.action || action}`,
        task_id: body?.taskId || null,
      })
    }
    return origJson(body)
  }
  next()
})

// POST /api/focus/done — complete top item
let lastDoneTs = 0
router.post('/done', (req, res) => {
  const now = Date.now()
  if (now - lastDoneTs < 500) return res.json({ success: false, reason: 'too fast — debounced' })
  lastDoneTs = now
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    unsnooze(top.id)
    if (promotedId === top.id) promotedId = null

    // Morning overlay — dismiss via done hotkey
    if (top.id === -3 && top.kind === 'morning') {
      markRoutineChecked('__morning_dismissed')
      return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
    }

    // Prep marker — done = snooze 30m (never completes)
    if (top.kind === 'prep') {
      const until = Date.now() + 30 * 60 * 1000
      snoozeItem(top.id, until, 'snooze')
      return res.json({ success: true, action: 'prep-snoozed', item: top.label, remaining: queue.length - 1 })
    }

    // Relax marker — done = snooze 30m (never completes)
    if (top.kind === 'relax') {
      const until = Date.now() + 30 * 60 * 1000
      snoozeItem(top.id, until, 'snooze')
      return res.json({ success: true, action: 'relax-snoozed', item: top.label, remaining: queue.length - 1 })
    }

    if (top.kind === 'slack' || top.kind === 'pulse' || top.kind === 'fleet' || top.kind === 'priority-sort' || top.kind === 'prs' || top.kind === 'activity' || top.kind === 'energy' || top.kind === 'prep') {
      // Synthetic priority-sort (from item creation or hotkey) — just clear the flag
      if (top.id === -1 && top.kind === 'priority-sort') {
        pendingPrioritySort = false
        promotedId = null
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Synthetic fleet (from hotkey) — just clear the flag
      if (top.id === -2 && top.kind === 'fleet') {
        pendingFleet = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Synthetic PRs (from hotkey) — just clear the flag
      if (top.id === -4 && top.kind === 'prs') {
        pendingPRs = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Synthetic Activity (from hotkey) — just clear the flag
      if (top.id === -6 && top.kind === 'activity') {
        pendingActivity = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Synthetic Energy (from hotkey) — just clear the flag
      if (top.id === -7 && top.kind === 'energy') {
        pendingEnergy = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Find the pulse item to check if it's a routine
      const pulseItem = (data.lists.pulse || []).find(t => t.id === top.id)
      if (pulseItem?.context === 'routine') {
        markRoutineChecked(pulseItem.text)
        console.log(`[focus] Routine checked off: "${pulseItem.text}"`)
      }
      // Individually dismiss slack items so digest doesn't re-add them
      if (top.kind === 'slack' && pulseItem) {
        dismissSlackItem(pulseItem.slackRef, pulseItem.text)
      }
      data.lists.pulse = (data.lists.pulse || []).filter(t => t.id !== top.id)
      saveData(data)
      return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
    }

    // Watched task: "done" on a watch trigger resets the watch, doesn't complete the task
    if (top.slackWatch?.surfaceReason) {
      const result = findTask(data, top.id, { skipDone: true })
      if (result) {
        migrateWatches(result.task)
        const sw = (result.task.slackWatches || []).find(w => w.ref === top.slackWatch.ref)
        if (sw) {
          if (top.slackWatch.surfaceReason === 'activity') {
            sw.lastOtherTs = null
            sw.surfaceContext = null
          }
          if (top.slackWatch.surfaceReason === 'nudge') {
            sw.lastMyReplyTs = Date.now() / 1000
          }
          if (sw.delegateOnly) result.task.status = 'in_progress'
          saveData(data)
          return res.json({ success: true, action: 'watch-reset', item: top.label, remaining: queue.length - 1 })
        }
      }
    }

    // Task item — move to done
    const result = findTask(data, top.id, { skipDone: true })
    if (!result) return res.json({ success: false, reason: 'task not found' })

    const { list: fromList, task } = result
    data.lists[fromList] = data.lists[fromList].filter(t => t.id !== top.id)
    task.status = 'done'
    task.completed = new Date().toISOString()
    task.from_list = fromList
    if (!data.lists.done) data.lists.done = []
    data.lists.done.unshift(task)
    saveData(data)

    res.json({ success: true, action: 'done', item: top.label, remaining: queue.length - 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/wait — move top item to waiting (in_progress)
router.post('/wait', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    unsnooze(top.id)
    if (promotedId === top.id) promotedId = null

    if (top.kind === 'slack' || top.kind === 'pulse' || top.kind === 'fleet' || top.kind === 'priority-sort' || top.kind === 'prs' || top.kind === 'activity' || top.kind === 'energy' || top.kind === 'prep') {
      if (top.id === -1 && top.kind === 'priority-sort') {
        pendingPrioritySort = false
        promotedId = null
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      if (top.id === -2 && top.kind === 'fleet') {
        pendingFleet = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      if (top.kind === 'slack') {
        const pulseItem = (data.lists.pulse || []).find(t => t.id === top.id)
        if (pulseItem) dismissSlackItem(pulseItem.slackRef, pulseItem.text)
      }
      data.lists.pulse = (data.lists.pulse || []).filter(t => t.id !== top.id)
      saveData(data)
      return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
    }

    const result = findTask(data, top.id, { skipDone: true })
    if (!result) return res.json({ success: false, reason: 'task not found' })

    result.task.status = 'in_progress'
    result.task.started = result.task.started || new Date().toISOString()
    saveData(data)

    res.json({ success: true, action: 'waiting', item: top.label, remaining: queue.length - 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/snooze — hide item for N minutes (default 30)
const SNOOZE_MINUTES = 30

router.post('/snooze', (req, res) => {
  try {
    const { id: targetId, minutes } = req.body || {}
    const snoozeLen = minutes || SNOOZE_MINUTES

    if (targetId) {
      // Snooze a specific item by ID
      if (promotedId === targetId) promotedId = null
      const until = Date.now() + snoozeLen * 60 * 1000
      snoozeItem(targetId, until, 'snooze')
      return res.json({ success: true, action: 'snoozed', id: targetId, minutes: snoozeLen })
    }

    // Default: snooze the current top item
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    if (promotedId === top.id) promotedId = null
    // Use task's custom snoozeMins if set, otherwise request minutes, otherwise default
    const task = findTask(data, top.id)?.task
    const effectiveMins = minutes || task?.snoozeMins || SNOOZE_MINUTES
    const until = Date.now() + effectiveMins * 60 * 1000
    snoozeItem(top.id, until, 'snooze')
    // For slack items, also snooze by slackRef so it survives digest rescans (IDs change)
    if (top.slackRef) snoozeItem(top.slackRef, until, 'snooze')

    res.json({ success: true, action: 'snoozed', item: top.label, minutes: effectiveMins, remaining: queue.length - 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/promote — override queue: pull item to top or create new
// itemType: 'fire-drill' | 'today' | 'backlog' (default: 'today')
router.post('/promote', (req, res) => {
  try {
    const { id, text, itemType, snoozeMins } = req.body

    if (id) {
      promotedId = id
      unsnooze(id) // Unsnooze if snoozed
      return res.json({ success: true, promoted: id })
    }

    if (text) {
      const data = readData()
      const list = itemType === 'backlog' ? 'backlog' : 'daily-goals'
      const overrides = { text, priority: 1, status: 'pending' }
      if (itemType === 'fire-drill') {
        overrides.isFireDrill = true
        overrides.escalation = 3
        if (snoozeMins) overrides.snoozeMins = snoozeMins
      }
      const newTask = createTask(data, overrides)
      if (!data.lists[list]) data.lists[list] = []
      data.lists[list].unshift(newTask)
      saveData(data)
      promotedId = newTask.id
      if (list !== 'backlog') pendingPrioritySort = true
      return res.json({ success: true, promoted: newTask.id, created: true, itemType })
    }

    return res.status(400).json({ error: 'id or text required' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/watch — create a task with slackWatches from a Slack card
router.post('/watch', (req, res) => {
  try {
    const { text, slackRef, checkHours = 24, delegateOnly = false, existingTaskId, deadline } = req.body
    if (!slackRef) return res.status(400).json({ error: 'slackRef required' })

    const data = readData()

    // Dismiss the slack pulse item
    dismissSlackItem(slackRef, text || '')
    data.lists.pulse = (data.lists.pulse || []).filter(t => t.slackRef !== slackRef)

    const watchEntry = {
      ref: slackRef,
      checkHours,
      lastMyReplyTs: null,
      lastOtherTs: null,
      delegateOnly,
      surfaceContext: null,
    }

    if (existingTaskId) {
      // Attach watch to existing task
      const result = findTask(data, existingTaskId, { skipDone: true })
      if (!result) return res.status(404).json({ error: 'task not found' })
      migrateWatches(result.task)
      if (!result.task.slackWatches) result.task.slackWatches = []
      // Don't duplicate refs
      if (!result.task.slackWatches.some(w => w.ref === slackRef)) {
        result.task.slackWatches.push(watchEntry)
      }
      if (deadline && !result.task.deadline) result.task.deadline = deadline
      saveData(data)
      pendingPrioritySort = true
      return res.json({ success: true, taskId: result.task.id, attached: true })
    }

    // Create new task in daily-goals with slackWatches
    if (!text) return res.status(400).json({ error: 'text required for new task' })
    const newTask = createTask(data, {
      text,
      priority: 1,
      status: delegateOnly ? 'in_progress' : 'pending',
      slackWatches: [watchEntry],
      ...(deadline ? { deadline } : {}),
    })

    if (!data.lists['daily-goals']) data.lists['daily-goals'] = []
    data.lists['daily-goals'].unshift(newTask)
    saveData(data)
    pendingPrioritySort = true

    res.json({ success: true, taskId: newTask.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/focus/task/:id — single task with full data for pinned overlay
router.get('/task/:id', (req, res) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
  try {
    const data = readData()
    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { task, list } = result
    const slackLinks = (task.links || []).filter(l => l.type === 'slack_thread')
    const claudeLinks = (task.links || [])
      .map((l, idx) => ({ ...l, idx }))
      .filter(l => l.type === 'claude_code')
      .map(l => ({ label: l.label, ref: l.ref, idx: l.idx }))
    const convo = getConversation(task.id)
    res.json({
      id: task.id, text: task.text, list, status: task.status || 'pending',
      env: task.env || null, notes: task.notes || '',
      deadline: task.deadline || null,
      slackContext: slackLinks.length > 0 ? slackLinks.map(l => ({ label: l.label || l.ref, ref: l.ref })) : null,
      claudeLinks: claudeLinks.map(l => ({ label: l.label, ref: l.ref, idx: l.idx })),
      hasConversation: convo.messages.length > 0,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/focus/searchable — all items for Cmd+K search overlay
router.get('/searchable', (req, res) => {
  try {
    const data = readData()
    const items = []

    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks || listName === 'done') continue
      for (const t of tasks) {
        if (!t.id) continue
        if (listName === 'pulse') {
          // Only include routine pulse items in search
          if (t.context !== 'routine') continue
          items.push({ id: t.id, text: t.text, list: 'routine', status: 'active' })
        } else {
          items.push({ id: t.id, text: t.text, list: listName, status: t.status || 'pending' })
        }
      }
    }

    res.json({ items, routines: ROUTINE_ITEMS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/focus/task-search?q=... — fuzzy search tasks for linking
router.get('/task-search', (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim()
    if (!q || q.length < 2) return res.json([])

    const data = readData()
    const results = []
    const skipLists = new Set(['done', 'pulse'])

    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks || skipLists.has(listName)) continue
      for (const t of tasks) {
        if (!t.id || !t.text) continue
        const text = t.text.toLowerCase()
        if (text.includes(q)) {
          // Extract env from claude_code links (e.g. "claude (env5): ...")
          let env = null
          if (t.links) {
            const ccLink = t.links.find(l => l.type === 'claude_code' && l.label)
            if (ccLink) {
              const envMatch = ccLink.label.match(/\b(env\d+)\b/)
              if (envMatch) env = envMatch[1]
            }
          }
          results.push({ id: t.id, text: t.text, list: listName, priority: t.priority ?? 1, env })
        }
      }
    }

    // Sort: composite score — active lists (daily-goals, focus) boosted, then priority, then list
    const listBoost = { 'daily-goals': 10, focus: 8, 'right-now': 6, queue: 2, tomorrow: 2 }
    const score = (r) => (listBoost[r.list] ?? 0) + (r.priority ?? 1)
    results.sort((a, b) => score(b) - score(a))
    res.json(results.slice(0, 10))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/parse-date — parse natural language date+time for deadlines
// Input like "tomorrow", "friday 2pm", "march 20 EOD", "next week"
// Default time is 5:00 PM (EOD) if no time specified
router.post('/parse-date', async (req, res) => {
  try {
    const { text } = req.body
    if (!text) return res.status(400).json({ error: 'text is required' })
    // Expand shorthand: EOD → 5pm, midday → 1pm, AM → 9am, PM → 5pm
    let expanded = text
      .replace(/\bEOD\b/i, '5:00 PM')
      .replace(/\bmidday\b/i, '1:00 PM')
      .replace(/\bAM\b(?!\s*\d)/i, '9:00 AM')
      .replace(/\bPM\b(?!\s*\d)/i, '5:00 PM')
    // If no time indicator at all, append EOD
    if (!/\d{1,2}(:\d{2})?\s*(am|pm)|noon|midnight|morning|evening|night|eod|midday/i.test(expanded)) {
      expanded += ' 5:00 PM'
    }
    const untilMs = await parseNaturalTime(expanded)
    if (!untilMs) return res.json({ success: false, reason: 'could not parse' })
    const d = new Date(untilMs)
    const label = d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    // Store as ISO datetime string
    const iso = d.toISOString()
    res.json({ success: true, label, iso })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/reschedule — LLM-parsed reschedule to a specific time
// Two-phase: { text } → preview, { text, confirm: true } → apply
router.post('/reschedule', async (req, res) => {
  try {
    const { text, confirm } = req.body
    if (!text) return res.status(400).json({ error: 'text is required' })

    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    const untilMs = await parseNaturalTime(text)
    if (!untilMs) return res.json({ success: false, reason: 'could not parse time' })

    const untilStr = new Date(untilMs).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })

    if (!confirm) {
      return res.json({ success: true, action: 'preview', item: top.label, until: untilStr, untilMs })
    }

    if (promotedId === top.id) promotedId = null
    snoozeItem(top.id, untilMs, 'reschedule')
    // Also snooze by slackRef so it survives digest rescans (IDs change each cycle)
    if (top.slackRef) snoozeItem(top.slackRef, untilMs, 'reschedule')

    res.json({ success: true, action: 'rescheduled', item: top.label, until: untilStr })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/trigger-fleet — toggle on-demand fleet view
router.post('/trigger-fleet', (req, res) => {
  pendingFleet = !pendingFleet
  if (pendingFleet) { pendingPrioritySort = false; pendingPRs = false; pendingDeadlines = false; pendingActivity = false; pendingEnergy = false; promotedId = null }
  res.json({ success: true, active: pendingFleet })
})

// POST /api/focus/trigger-priority — toggle on-demand priority sort view
router.post('/trigger-priority', (req, res) => {
  pendingPrioritySort = !pendingPrioritySort
  if (pendingPrioritySort) { pendingFleet = false; pendingPRs = false; pendingDeadlines = false; pendingActivity = false; pendingEnergy = false }
  else { promotedId = null }
  res.json({ success: true, active: pendingPrioritySort })
})

// POST /api/focus/trigger-prs — toggle on-demand PR dashboard view
router.post('/trigger-prs', (req, res) => {
  pendingPRs = !pendingPRs
  if (pendingPRs) { pendingFleet = false; pendingPrioritySort = false; pendingDeadlines = false; pendingActivity = false; pendingEnergy = false; promotedId = null; fetchPRs() }
  res.json({ success: true, active: pendingPRs })
})

// POST /api/focus/trigger-deadlines — toggle on-demand deadline view
router.post('/trigger-deadlines', (req, res) => {
  pendingDeadlines = !pendingDeadlines
  if (pendingDeadlines) { pendingFleet = false; pendingPrioritySort = false; pendingPRs = false; pendingActivity = false; pendingEnergy = false; promotedId = null }
  res.json({ success: true, active: pendingDeadlines })
})

// POST /api/focus/trigger-activity — toggle on-demand activity log view
router.post('/trigger-activity', (req, res) => {
  pendingActivity = !pendingActivity
  if (pendingActivity) { pendingFleet = false; pendingPrioritySort = false; pendingPRs = false; pendingDeadlines = false; pendingEnergy = false; promotedId = null }
  res.json({ success: true, active: pendingActivity })
})

// POST /api/focus/trigger-energy — toggle on-demand energy check view
router.post('/trigger-energy', (req, res) => {
  pendingEnergy = !pendingEnergy
  if (pendingEnergy) { pendingFleet = false; pendingPrioritySort = false; pendingPRs = false; pendingDeadlines = false; pendingActivity = false; promotedId = null }
  res.json({ success: true, active: pendingEnergy })
})

// GET /api/focus/fleet — current fleet status
router.get('/fleet', (req, res) => {
  try {
    const data = readData()
    const fleet = computeFleet(data)
    res.json({ fleet })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/focus/snoozed — list currently snoozed item IDs
router.get('/snoozed', (req, res) => {
  res.json({ snoozedIds: getSnoozedIds() })
})

// One-time migration: backfill task.env from claude_code link labels
function migrateEnvFromLinks() {
  const data = readData()
  let migrated = 0
  for (const [, tasks] of Object.entries(data.lists)) {
    if (!tasks) continue
    for (const t of tasks) {
      if (t.env) continue // already has env
      for (const l of (t.links || [])) {
        if (l.type === 'claude_code' && l.label) {
          const m = l.label.match(/env(\d+)/)
          if (m) { t.env = m[0]; migrated++; break }
        }
      }
    }
  }
  if (migrated > 0) {
    saveData(data)
    console.log(`[fleet] Migrated ${migrated} tasks: backfilled task.env from claude_code links`)
  }
}
migrateEnvFromLinks()

// POST /api/focus/retriage — re-triage a single slack item (fresh Slack fetch + LLM)
router.post('/retriage', async (req, res) => {
  const { id } = req.body
  if (!id) return res.status(400).json({ error: 'id required' })

  try {
    const data = readData()
    const pulse = data.lists.pulse || []
    const item = pulse.find(t => t.id === id)
    if (!item || !item.slackRef) return res.status(404).json({ error: 'Pulse item not found or has no slackRef' })

    const result = await retriageItem(item.slackRef, item.context)
    if (!result) return res.status(500).json({ error: 'Triage returned no result' })

    const { triage, messages } = result
    // Update pulse item in-place
    const keyMessageTs = triage.keyMessages
      ? triage.keyMessages.map(i => messages[i]?.ts).filter(Boolean)
      : null
    item.suggestion = JSON.stringify({ action: triage.action, draft: triage.draft, actions: triage.actions, keyMessageTs })
    if (triage.summary) {
      const colonIdx = item.text.indexOf(': ')
      const prefix = colonIdx > 0 ? item.text.slice(0, colonIdx + 2) : ''
      item.text = prefix + triage.summary
    }
    // Update thread preview with fresh messages
    item.slackThread = messages.slice(-5).map(m => ({ who: m.who, text: (m.text || '').slice(0, 200), ts: m.ts }))
    // Re-evaluate priority based on new urgency
    if (triage.urgency === 'FYI') {
      item.priority = 0
      // Auto-dismiss FYI items so the next digest cycle doesn't re-surface them
      if (item.slackRef) dismissSlackItem(item.slackRef)
    } else if (triage.urgency === 'ACTION_NEEDED') {
      item.priority = 2
    }

    saveData(data)
    res.json({ success: true, triage })
  } catch (err) {
    console.error('[retriage]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export function clearOverlays() {
  pendingPrioritySort = false
  pendingFleet = false
  pendingPRs = false
  pendingDeadlines = false
  pendingActivity = false
  pendingEnergy = false
  promotedId = null
}

export default router
