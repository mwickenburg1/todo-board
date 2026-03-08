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
import { acknowledgeDigest } from './slack-digest.js'
import { markRoutineChecked } from './routine-state.js'
import { ROUTINE_ITEMS } from './routine-items.js'
import { snoozeItem, unsnooze, isSnoozed, getSnoozedIds, getSnoozeInfo } from './snooze-state.js'
import { parseNaturalTime } from './time-parser.js'

const router = Router()

const SELF_AUTHORS = ['matthias', 'mwickenburg']
function isSelfEvent(author) {
  const lower = (author || '').toLowerCase()
  return SELF_AUTHORS.some(s => lower.includes(s))
}

// Promoted item: overrides queue ordering. Only one at a time.
let promotedId = null

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
        hasClaudeLink: claudeLinks.length > 0,
        claudeLinks: claudeLinks.map(l => ({ label: l.label, ref: l.ref, idx: l.idx })),
      })
    }
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
      // Small bonus by position in ROUTINE_ITEMS so earlier routines rank higher
      const routineIdx = ROUTINE_ITEMS.findIndex(r => r.text === p.text)
      const posBonus = routineIdx >= 0 ? (ROUTINE_ITEMS.length - routineIdx) : 0
      const routine = routineIdx >= 0 ? ROUTINE_ITEMS[routineIdx] : null
      const dayOfWeek = new Date().getDay()
      const emphasizedHotkeys = routine?.hotkeys
        ? (routine.hotkeys[dayOfWeek] || routine.hotkeys.default || ['done', 'reschedule'])
        : ['done', 'reschedule']
      const item = {
        id: p.id, kind: routine?.isFleet ? 'fleet' : 'pulse',
        score: 10000 + posBonus, label: p.text,
        sublabel: routine?.sublabel, actionVerb: 'Routine',
        list: 'pulse', emphasizedHotkeys,
        _isFleet: !!routine?.isFleet,
      }
      items.push(item)
      continue
    }
    // time-blocks disabled — skip them
    if (p.context === 'time-block') continue
    if (p.context === 'slack-header' || p.context === 'time-next') continue
    if (!p.context.startsWith('slack-') || p.priority <= 0) continue

    let score
    if (p.context === 'slack-incidents') score = 7000
    else if (p.context === 'slack-dms' || p.context === 'slack-mentions') score = 5000
    else if (p.context === 'slack-threads') score = 3000
    else if (p.context === 'slack-crashes') score = 1000
    else continue

    slackItems.push({ id: p.id, score: score + (p.priority * 10), text: p.text, context: p.context })
  }

  // Bundle all urgent Slack items into one card
  if (slackItems.length > 0) {
    slackItems.sort((a, b) => b.score - a.score)
    const topSlack = slackItems[0]
    const label = slackItems.length === 1
      ? topSlack.text
      : `${slackItems.length} Slack items — ${topSlack.text}`
    items.push({
      id: topSlack.id, kind: 'slack-bundle', score: topSlack.score,
      label, actionVerb: 'Slack', list: 'pulse',
      bundledIds: slackItems.map(s => s.id),
    })
  }

  // --- Task items from actionable lists ---
  const skipLists = new Set(['now', 'monitoring', 'done', 'pulse'])
  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (!tasks || skipLists.has(listName)) continue
    const pending = tasks.filter(t => t.id && t.status === 'pending')

    for (let i = 0; i < pending.length; i++) {
      const t = pending[i]
      const posBonus = 100 - Math.min(i, 99)

      // Claude Code blocked on user — check first, takes priority over escalation
      const hasClaudeLink = (t.links || []).some(l => l.type === 'claude_code')
      const hasClaudeEvent = hasClaudeLink && (t.events || []).some(e =>
        e.source === 'claude_code' && !isSelfEvent(e.author)
      )
      if (hasClaudeEvent) {
        let env = null
        for (const l of (t.links || [])) {
          if (l.type === 'claude_code' && l.label) {
            const m = l.label.match(/env(\d+)/)
            if (m) { env = m[0]; break }
          }
        }
        const escalationBonus = t.escalation === 3 ? 3000 : t.escalation === 2 ? 2000 : 0
        items.push({
          id: t.id, kind: 'task', score: 6000 + escalationBonus + posBonus,
          label: t.text, sublabel: env ? `Claude finished in ${env}` : 'Claude finished',
          actionVerb: 'Claude Code', list: listName,
        })
        continue
      }

      // Escalated
      if (t.escalation && t.escalation > 0) {
        const base = t.escalation === 3 ? 9000 : t.escalation === 2 ? 8000 : 4000
        items.push({
          id: t.id, kind: 'task', score: base + posBonus,
          label: t.text, sublabel: listName === 'daily-goals' ? undefined : listName,
          actionVerb: 'Do', list: listName,
        })
        continue
      }

      // Regular daily-goals pending
      if (listName === 'daily-goals') {
        items.push({
          id: t.id, kind: 'task', score: 2000 + posBonus,
          label: t.text,
          actionVerb: 'Do', list: listName,
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

  // Filter snoozed items, sort by score
  const effective = items
    .filter(item => !isSnoozed(item.id) && item.score > 0)
    .sort((a, b) => b.score - a.score)

  // If there's a promoted item, force it to position 0
  if (promotedId) {
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
          effective.unshift({
            id: task.id, kind: 'task', score: 15000,
            label: task.text, actionVerb: 'Do', list: listName,
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
    res.json({ empty: false, depth: queue.length, position: 1, top, snoozedIds: getSnoozedIds() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/done — complete top item
router.post('/done', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    unsnooze(top.id)
    if (promotedId === top.id) promotedId = null

    if (top.kind === 'slack-bundle') {
      acknowledgeDigest()
      return res.json({ success: true, action: 'acked', item: top.label, remaining: queue.length - 1 })
    }

    if (top.kind === 'pulse') {
      // Find the pulse item to check if it's a routine
      const pulseItem = (data.lists.pulse || []).find(t => t.id === top.id)
      if (pulseItem?.context === 'routine') {
        markRoutineChecked(pulseItem.text)
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

    if (top.kind === 'slack-bundle' || top.kind === 'pulse') {
      // Pulse/slack items → just dismiss (can't "wait" on these)
      if (top.kind === 'slack-bundle') {
        acknowledgeDigest()
      } else {
        data.lists.pulse = (data.lists.pulse || []).filter(t => t.id !== top.id)
        saveData(data)
      }
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

// POST /api/focus/snooze — hide top item for 30 minutes
const SNOOZE_MINUTES = 30

router.post('/snooze', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    if (promotedId === top.id) promotedId = null
    const until = Date.now() + SNOOZE_MINUTES * 60 * 1000
    snoozeItem(top.id, until, 'snooze')

    res.json({ success: true, action: 'snoozed', item: top.label, minutes: SNOOZE_MINUTES, remaining: queue.length - 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/promote — override queue: pull item to top or create new
router.post('/promote', (req, res) => {
  try {
    const { id, text } = req.body

    if (id) {
      promotedId = id
      unsnooze(id) // Unsnooze if snoozed
      return res.json({ success: true, promoted: id })
    }

    if (text) {
      const data = readData()
      const newTask = createTask(data, { text, priority: 1, status: 'pending' })
      if (!data.lists['daily-goals']) data.lists['daily-goals'] = []
      data.lists['daily-goals'].unshift(newTask)
      saveData(data)
      promotedId = newTask.id
      return res.json({ success: true, promoted: newTask.id, created: true })
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

    res.json({ success: true, action: 'rescheduled', item: top.label, until: untilStr })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
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
