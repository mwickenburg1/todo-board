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
import { readData, saveData, findTask, createTask } from './store.js'
import { acknowledgeDigest, dismissSlackItem } from './slack-digest.js'
import { markRoutineChecked, isRoutineCheckedToday } from './routine-state.js'
import { ROUTINE_ITEMS } from './routine-items.js'
import { snoozeItem, unsnooze, isSnoozed, getSnoozedIds, getSnoozeInfo } from './snooze-state.js'
import { parseNaturalTime } from './time-parser.js'
import { hasUnread } from './slack-extract.js'
import { fetchPRs, getPRs } from './pr-fetcher.js'

const router = Router()

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

function computeQueue(data) {
  const items = []
  const pulse = (data.lists.pulse || []).filter(t => t.id && t.status !== 'done')

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
      const kind = routine?.isFleet ? 'fleet' : routine?.isPrioritySort ? 'priority-sort' : 'pulse'
      // Exercise stays above Slack (10000+), other routines sit below Slack DMs/mentions (9200) but above threads (3000)
      const baseScore = p.text === 'Exercise' ? 10000 : 8000
      const item = {
        id: p.id, kind,
        score: baseScore + posBonus, label: p.text,
        sublabel: routine?.sublabel, actionVerb: 'Routine',
        list: 'pulse', emphasizedHotkeys,
        _isFleet: !!routine?.isFleet,
        _isPrioritySort: !!routine?.isPrioritySort,
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
    if (suggestion) {
      try {
        const parsed = JSON.parse(suggestion)
        suggestion = parsed.action || suggestion
        draftReply = parsed.draft || null
      } catch {}
    }
    slackItems.push({ id: p.id, score: score + (p.priority * 10), text: p.text, slackThread: p.slackThread, slackRef: p.slackRef, context: p.context, from: p.from || null, channelLabel: p.channelLabel || null, suggestion, draftReply })
  }

  // Each urgent Slack item is its own card
  for (const s of slackItems) {
    const colonIdx = s.text.indexOf(': ')
    const from = s.from || (colonIdx > 0 ? s.text.slice(0, colonIdx) : null)
    const summary = colonIdx > 0 ? s.text.slice(colonIdx + 2) : s.text
    const verbMap = { 'slack-dms': 'DM', 'slack-mentions': 'Mention', 'slack-threads': 'Thread', 'slack-incidents': 'Incident', 'slack-crashes': 'Crashes' }
    // Clean Slack user mention markup: <@U123|Name> → @Name, <@U123> → @user
    const cleanLabel = summary.replace(/<@[A-Z0-9]+\|([^>]+)>/g, '@$1').replace(/<@[A-Z0-9]+>/g, '@user').replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1').replace(/<#[A-Z0-9]+>/g, '#channel')
    items.push({
      id: s.id, kind: 'slack', score: s.score,
      label: cleanLabel,
      actionVerb: verbMap[s.context] || 'Slack',
      from, channelLabel: s.channelLabel || null,
      list: 'pulse',
      emphasizedHotkeys: ['done', 'create task'],
      slackThread: s.slackThread || null,
      slackRef: s.slackRef || null,
      suggestion: s.suggestion || null,
      draftReply: s.draftReply || null,
    })
  }

  // --- Task items from daily-goals only ---
  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (listName !== 'daily-goals' || !tasks) continue
    const pending = tasks.filter(t => t.id && t.status === 'pending')

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

      // All daily-goals items scored purely by position — priority order is king
      if (listName === 'daily-goals') {
        items.push({
          id: t.id, kind: 'task', score: 1000 + posBonus,
          label: t.text, sublabel: claudeSublabel,
          actionVerb: hasClaudeEvent ? claudeActionVerb : (t.isFireDrill ? 'Fire drill' : 'Do'),
          list: listName, isFireDrill: t.isFireDrill || false,
          slackContext, env: t.env || null, claudeLinks,
          notes: t.notes || '',
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
      }))
    prioritySortItem.priorityTasks = dailyGoals
    prioritySortItem.label = 'Set priorities'
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

// GET /api/focus — current top item + queue depth
router.get('/', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) {
      return res.json({ empty: true, depth: 0, message: 'Nothing needs you right now.' })
    }
    const top = queue[0]
    const snoozeInfo = getSnoozeInfo(top.id)
    if (snoozeInfo) {
      top.rescheduledUntilMs = snoozeInfo.until
      top.rescheduledReason = snoozeInfo.reason
    }
    // Use task's custom snooze duration if set, otherwise global default
    const topTask = findTask(data, top.id)?.task
    const effectiveSnooze = topTask?.snoozeMins || SNOOZE_MINUTES
    res.json({ empty: false, depth: queue.length, position: 1, top, snoozedIds: getSnoozedIds(), snoozeMinutes: effectiveSnooze })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
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

    if (top.kind === 'slack' || top.kind === 'pulse' || top.kind === 'fleet' || top.kind === 'priority-sort' || top.kind === 'prs') {
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

    if (top.kind === 'slack' || top.kind === 'pulse' || top.kind === 'fleet' || top.kind === 'priority-sort' || top.kind === 'prs') {
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
  if (pendingFleet) { pendingPrioritySort = false; pendingPRs = false; pendingDeadlines = false; promotedId = null }
  res.json({ success: true, active: pendingFleet })
})

// POST /api/focus/trigger-priority — toggle on-demand priority sort view
router.post('/trigger-priority', (req, res) => {
  pendingPrioritySort = !pendingPrioritySort
  if (pendingPrioritySort) { pendingFleet = false; pendingPRs = false; pendingDeadlines = false }
  else { promotedId = null }
  res.json({ success: true, active: pendingPrioritySort })
})

// POST /api/focus/trigger-prs — toggle on-demand PR dashboard view
router.post('/trigger-prs', (req, res) => {
  pendingPRs = !pendingPRs
  if (pendingPRs) { pendingFleet = false; pendingPrioritySort = false; pendingDeadlines = false; promotedId = null; fetchPRs() }
  res.json({ success: true, active: pendingPRs })
})

// POST /api/focus/trigger-deadlines — toggle on-demand deadline view
router.post('/trigger-deadlines', (req, res) => {
  pendingDeadlines = !pendingDeadlines
  if (pendingDeadlines) { pendingFleet = false; pendingPrioritySort = false; pendingPRs = false; promotedId = null }
  res.json({ success: true, active: pendingDeadlines })
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

export default router
