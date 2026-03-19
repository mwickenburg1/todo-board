/**
 * Activity log — append-only JSONL tracker for all user actions.
 *
 * Event types:
 *   space_switch   — ctrl+N to switch macOS Space
 *   focus_action   — done/wait/snooze/trigger-* from focus queue
 *   next_blocked   — ⌘⇧, jump to blocked agent
 *   auto_assign    — ⌘⇧. auto-assign task to env
 *   claude_prompt  — user message in Claude Code session
 *   claude_response— assistant reply in Claude Code session
 */

import { appendFileSync, readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = resolve(__dirname, '..', 'data', 'activity.jsonl')

// Ensure data dir exists
import { mkdirSync } from 'fs'
try { mkdirSync(resolve(__dirname, '..', 'data'), { recursive: true }) } catch {}

// Map space identifiers to human-readable labels
const SPACE_LABELS = {
  env1: 'env1', env2: 'env2', env3: 'env3', env4: 'env4',
  env5: 'env5', env6: 'env6', env7: 'env7', env8: 'env8',
  env9: 'env9', env10: 'env10',
  space11: 'todo-board', 'todo-board': 'todo-board',
  space12: 'slack', slack: 'slack',
  space13: 'browser', browser: 'browser',
}

export function logActivity(event) {
  const rawEnv = event.env || null
  const entry = {
    ts: new Date().toISOString(),
    type: event.type || 'unknown',
    session_id: event.session_id || null,
    env: SPACE_LABELS[rawEnv] || rawEnv,
    task_id: event.task_id || null,
    detail: event.detail || null,
  }
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n')
  } catch (err) {
    console.error('[activity] write error:', err.message)
  }
  return entry
}

export function readActivity({ limit = 200, session_id, type, since } = {}) {
  if (!existsSync(LOG_PATH)) return []
  const lines = readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean)
  let entries = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

  if (session_id) entries = entries.filter(e => e.session_id === session_id)
  if (type) entries = entries.filter(e => e.type === type)
  if (since) entries = entries.filter(e => e.ts >= since)

  // Return most recent first, capped
  return entries.slice(-limit).reverse()
}

// Frustration/spinning-wheels keywords
const SPIN_PATTERNS = [
  /still (broken|stuck|slow|taking|not working|the same|failing|hanging)/i,
  /not working/i,
  /same error/i,
  /why (is|are|did|does|doesn't|isn't)/i,
  /what('s| is) (wrong|happening|going on)/i,
  /are you sure/i,
  /broke|breaking/i,
  /this works in prod/i,
  /tried .* still/i,
  /again/i,
]

async function detectSpinning(sessionId, env) {
  const now = Date.now()

  // Get last 45 min of prompts for this session
  const since = new Date(now - 45 * 60 * 1000).toISOString()
  const recent = readActivity({ session_id: sessionId, type: 'claude_prompt', limit: 20 })
    .filter(e => e.ts >= since)

  if (recent.length < 3) return null

  // Count frustration signals
  const spinCount = recent.filter(e => {
    const detail = (e.detail || '').toLowerCase()
    return SPIN_PATTERNS.some(p => p.test(detail))
  }).length

  // Trigger if 3+ frustration signals in 15 min
  if (spinCount >= 3) {
    const envLabel = env || 'unknown env'

    // Inject a pulse item so the focus queue surfaces it
    try {
      const { readData, saveData, createTask } = await import('./store.js')
      const data = readData()
      if (!data.lists.pulse) data.lists.pulse = []

      // Don't duplicate — check if there's already a spinning alert for this env
      const existing = data.lists.pulse.find(t =>
        t.context === 'spinning' && t.text.includes(envLabel)
      )
      if (!existing) {
        const task = createTask(data, {
          text: `Spinning wheels — ${envLabel}`,
          priority: 0,
          context: 'spinning',
          notes: `${spinCount} retry/frustration prompts in last 45 min on session ${sessionId.slice(0, 8)}. Step back, snooze this task, or give a comprehensive prompt.`,
        })
        data.lists.pulse.push(task)
        saveData(data)
      }
    } catch {}

    return {
      message: `Spinning wheels on ${envLabel}`,
      session_id: sessionId,
      env: envLabel,
      spinCount,
    }
  }

  return null
}

// Compute today's baseline from recovery time (last activity yesterday → first today)
export function getBaseline() {
  const entries = readActivity({ limit: 5000 })
  if (entries.length === 0) return { baseline: 100, recoveryHours: null }

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10)

  // Find last activity yesterday and first activity today
  let lastYesterday = null
  let firstToday = null
  for (const e of entries) {  // entries are most-recent-first
    const dateStr = e.ts.slice(0, 10)
    if (dateStr === todayStr && !firstToday) {
      // Keep scanning — we want the EARLIEST today
    }
    if (dateStr === todayStr) {
      firstToday = e.ts  // will end up with earliest since we scan all
    }
    if (dateStr === yesterdayStr && !lastYesterday) {
      lastYesterday = e.ts  // first match = most recent yesterday
    }
  }

  if (!lastYesterday || !firstToday) return { baseline: 100, recoveryHours: null }

  const lastMs = new Date(lastYesterday).getTime()
  const firstMs = new Date(firstToday).getTime()
  const recoveryHours = (firstMs - lastMs) / (1000 * 60 * 60)

  // Baseline: 12h+ = 100%, 4h = 50%, linear between
  const baseline = Math.min(100, Math.max(40, 50 + (recoveryHours - 4) * 6.25))

  return { baseline: Math.round(baseline), recoveryHours: Math.round(recoveryHours * 10) / 10 }
}

export function activityRouter(express) {
  const router = express.Router()

  // POST /api/activity — log an event + detect spinning wheels
  router.post('/', async (req, res) => {
    const entry = logActivity(req.body)

    // Spinning wheels detection: on each claude_prompt, check recent session history
    if (entry.type === 'claude_prompt' && entry.session_id) {
      const alert = await detectSpinning(entry.session_id, entry.env)
      if (alert) {
        return res.json({ success: true, entry, spinning: alert })
      }
    }

    res.json({ success: true, entry })
  })

  // GET /api/activity — read log with optional filters
  router.get('/', (req, res) => {
    const { limit, session_id, type, since } = req.query
    const entries = readActivity({
      limit: limit ? parseInt(limit) : 200,
      session_id,
      type,
      since,
    })
    res.json({ entries, count: entries.length })
  })

  // GET /api/activity/session/:id — all activity for a session
  router.get('/session/:id', (req, res) => {
    const entries = readActivity({ session_id: req.params.id, limit: 1000 })
    res.json({ entries, count: entries.length })
  })

  // In-memory manual override for today's energy rating
  let manualBaseline = null // { baseline, rating, date }

  // GET /api/activity/baseline — today's energy baseline (manual override or auto from recovery)
  router.get('/baseline', (req, res) => {
    const today = new Date().toISOString().split('T')[0]
    if (manualBaseline && manualBaseline.date === today) {
      return res.json({ baseline: manualBaseline.baseline, rating: manualBaseline.rating, manual: true })
    }
    const result = getBaseline()
    res.json(result)
  })

  // POST /api/activity/baseline — manually set today's baseline + rating
  router.post('/baseline', (req, res) => {
    const { baseline, rating } = req.body
    if (typeof baseline !== 'number' || baseline < 0 || baseline > 100) {
      return res.status(400).json({ error: 'baseline must be 0-100' })
    }
    const today = new Date().toISOString().split('T')[0]
    manualBaseline = { baseline, rating: rating || null, date: today }
    logActivity({ type: 'baseline_set', detail: String(baseline), rating: rating || null })
    res.json({ success: true, baseline, rating })
  })

  // GET /api/activity/stats — summary stats
  router.get('/stats', (req, res) => {
    const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const entries = readActivity({ since, limit: 10000 })

    const byType = {}
    const bySessions = {}
    for (const e of entries) {
      byType[e.type] = (byType[e.type] || 0) + 1
      if (e.session_id) {
        if (!bySessions[e.session_id]) bySessions[e.session_id] = { turns: 0, types: {} }
        bySessions[e.session_id].turns++
        bySessions[e.session_id].types[e.type] = (bySessions[e.session_id].types[e.type] || 0) + 1
      }
    }

    res.json({ since, total: entries.length, byType, sessions: bySessions })
  })

  return router
}
