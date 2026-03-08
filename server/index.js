import { readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import { readData, saveData, popUndo, createTask } from './store.js'
import { parseInput, placeSectionBefore } from './helpers.js'
import todosRouter from './routes/todos.js'
import listsRouter from './routes/lists.js'
import eventsRouter from './routes/events.js'
import envStatusRouter from './routes/env-status.js'
import focusQueueRouter from './focus-queue.js'
import { startSlackDigest, acknowledgeDigest, resetAck } from './slack-digest.js'
import { parseSlackUrl, extractThreadContext, fetchThreadMessages, setReadCursor, getAllReadCursors } from './slack-extract.js'
import { markRoutineChecked, isRoutineCheckedToday, clearStaleChecks } from './routine-state.js'
import { getSnoozeMap } from './snooze-state.js'
import { ROUTINE_ITEMS } from './routine-items.js'

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  const envFile = readFileSync(resolve(__dirname, '..', '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    const val = trimmed.slice(eq + 1)
    if (!process.env[key]) process.env[key] = val
  }
} catch {}

const app = express()
app.use(cors())
app.use(express.json())

// --- Cursor IPC: read socket from file written by active sessions ---
function cursorEnv() {
  try {
    const sock = readFileSync('/home/ubuntu/.cursor-ipc-socket', 'utf8').trim()
    if (sock) return { ...process.env, VSCODE_IPC_HOOK_CLI: sock }
  } catch {}
  return process.env
}

// --- Open env workspace in Cursor ---
const DEV_VM2_HOST = process.env.DEV_VM2_HOST || 'ubuntu@dev-vm2'
const REMOTE_ENVS = new Set(['env5', 'env6', 'env7', 'env8'])

app.post('/api/open-env', (req, res) => {
  const { env } = req.body
  if (!env || !/^env[1-8]$/.test(env)) {
    return res.status(400).json({ error: 'Invalid env, must be env1-env8' })
  }
  const workspace = `/home/ubuntu/${env}.code-workspace`
  if (REMOTE_ENVS.has(env)) {
    const remoteCmd = [
      `CURSOR=$(ls -t ~/.cursor-server/cli/servers/Stable-*/server/bin/remote-cli/cursor 2>/dev/null | head -1)`,
      `SOCK=$(cat ~/.cursor-ipc-socket 2>/dev/null || ls -t /run/user/1000/vscode-ipc-*.sock 2>/dev/null | head -1)`,
      `VSCODE_IPC_HOOK_CLI="$SOCK" "$CURSOR" "${workspace}"`,
    ].join(' && ')
    execFile('ssh', [DEV_VM2_HOST, remoteCmd], { timeout: 10000 }, (err) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ ok: true, env, workspace, remote: DEV_VM2_HOST })
    })
  } else {
    execFile('cursor', [workspace], { timeout: 5000, env: cursorEnv() }, (err) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ ok: true, env, workspace })
    })
  }
})


// --- Top-level routes ---

app.post('/api/undo', (req, res) => {
  try {
    const remaining = popUndo()
    if (remaining === null) return res.status(400).json({ error: 'Nothing to undo' })
    res.json({ success: true, remaining })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/todos', (req, res) => {
  try {
    const data = readData()
    data.snoozeMap = getSnoozeMap()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Quick capture — top-level route (not under /api/todos)
app.post('/api/capture', (req, res) => {
  try {
    const { text, horizon = 'queue', status = 'pending' } = req.body
    if (!text) return res.status(400).json({ error: 'text is required' })

    const parsed = parseInput(text)
    if (parsed.type === 'section') {
      const data = readData()
      if (!data.lists[parsed.normalized]) data.lists[parsed.normalized] = []
      if (data.lists[horizon]) {
        placeSectionBefore(data, parsed.normalized, horizon)
      }
      saveData(data)
      return res.json({ success: true, section: parsed.normalized })
    }

    const data = readData()
    const newTask = createTask(data, {
      text, priority: 1, status,
      started: status === 'in_progress' ? new Date().toISOString() : null
    })

    if (!data.lists[horizon]) data.lists[horizon] = []
    data.lists[horizon].unshift(newTask)

    saveData(data)
    res.json({ success: true, task: newTask })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/slack-digest/ack', (req, res) => {
  try {
    const ackedAt = acknowledgeDigest()
    res.json({ success: true, ackedAt })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/slack-digest/reset-ack', (req, res) => {
  try {
    resetAck()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/slack-extract', async (req, res) => {
  try {
    const { url } = req.body || {}
    const parsed = parseSlackUrl(url)
    if (!parsed) return res.status(400).json({ error: 'Not a Slack URL' })
    const context = await extractThreadContext(parsed.channel, parsed.ts)
    res.json(context)
  } catch (err) {
    console.error('[slack-extract] error:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/slack-thread/:channel/:ts', async (req, res) => {
  try {
    const { channel, ts } = req.params
    const result = await fetchThreadMessages(channel, ts)
    res.json(result)
  } catch (err) {
    console.error('[slack-thread] error:', err.message)
    res.status(502).json({ error: err.message })
  }
})

app.post('/api/slack-thread/:channel/:ts/read', (req, res) => {
  const { channel, ts } = req.params
  const { latestTs } = req.body || {}
  if (latestTs) {
    setReadCursor(`${channel}/${ts}`, latestTs)
  }
  res.json({ success: true })
})

app.get('/api/slack-cursors', (req, res) => {
  res.json(getAllReadCursors())
})

// --- Route modules ---

app.use('/api/todos', todosRouter)
app.use('/api/lists', listsRouter)
app.use('/api/events', eventsRouter)
app.use('/api/env-status', envStatusRouter)
app.use('/api/focus', focusQueueRouter)

// --- Pulse check timer ---
// Repopulates the "pulse" list every 20 min with any missing check items.
// Dismissing an item (click in UI) deletes it; this timer re-adds it next cycle.
// Time blocks rotate based on current EST time.

const PULSE_ITEMS = [
  'Dehydrated -> water',
  'Tired/pain/fuzzy/hungry -> fix',
  "Haven't moved in 1h -> move",
  'Just checked slack -> 20m deep work',
  'Caring -> 0% emotional, 100% intellectual',
  'Not on track 85-95 -> get on track',
  'Views organized, Hazeover at 85%, items on list -> tidy up',
  '15 breaths down-reg or breath hold -> reset',
  'Grinding after 1pm? -> prep tomorrow, don\'t force today',
]

// Daily energy blocks (EST). Each appears when its window starts.
// Day runs 1pm-1pm: morning = today's execution, afternoon = tomorrow's prep.
const TIME_BLOCKS = [
  { start: '07:45', end: '11:00', label: '7:45-11',
    text: 'Deep work - 100%, RPE 8/9 not 10. Leave "I could do 30 more mins". If I don\'t nail this, company drifts at 9m' },
  { start: '11:15', end: '12:30', label: '11:15-12:30',
    text: 'Important meetings - RPE 6/7' },
  { start: '13:00', end: '13:30', label: '1-1:30 PM',
    text: 'Today is shipped. NSDR / walk. Reset.' },
  { start: '13:30', end: '17:00', label: '1:30-5 PM',
    text: 'Tomorrow mode: clear replies, review Claude outputs, write specs, prep sessions' },
  { start: '17:00', end: '17:30', label: '5-5:30 PM',
    text: 'Lock the board. Tomorrow\'s #1 is specific + first step written. Close laptop.' },
]

// All possible time-block texts (for cleanup)
const ALL_BLOCK_TEXTS = new Set(TIME_BLOCKS.map(b => b.text))
const NEXT_PREFIX = 'Next: '

function estNow() {
  // Build a Date whose local fields (getHours, getDay, etc.) reflect EST/EDT.
  // The toLocaleString round-trip approach can misparse near midnight,
  // so we use Intl.DateTimeFormat for reliable field extraction.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map(p => [p.type, p.value])
  )
  return new Date(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  )
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function currentAndNextBlock() {
  const now = estNow()
  const mins = now.getHours() * 60 + now.getMinutes()

  let current = null
  let next = null

  for (let i = 0; i < TIME_BLOCKS.length; i++) {
    const block = TIME_BLOCKS[i]
    const start = timeToMinutes(block.start)
    const end = timeToMinutes(block.end)
    if (mins >= start && mins < end) {
      current = block
      next = TIME_BLOCKS[i + 1] || null
      break
    }
    if (mins < start) {
      next = block
      break
    }
  }

  return { current, next }
}

function repopulatePulse() {
  try {
    const data = readData()
    if (!data.lists.pulse) data.lists.pulse = []
    let changed = false

    // --- Static items: add if missing ---
    const existing = new Set(data.lists.pulse.map(t => t.text))
    for (const text of PULSE_ITEMS) {
      if (!existing.has(text)) {
        data.lists.pulse.push(createTask(data, { text, priority: 1 }))
        changed = true
      }
    }

    // --- Time blocks: disabled — these meta-items are subsumed by the board's card routing ---
    // Clean up any existing time-block items
    const before = data.lists.pulse.length
    data.lists.pulse = data.lists.pulse.filter(t => {
      if (ALL_BLOCK_TEXTS.has(t.text)) return false
      if (t.text.startsWith(NEXT_PREFIX)) return false
      if (t.context === 'time-block' || t.context === 'time-next') return false
      return true
    })
    if (data.lists.pulse.length !== before) changed = true

    /*
    const { current, next } = currentAndNextBlock()
    const keepTexts = new Set()
    if (current) keepTexts.add(current.text)
    const nextText = next ? NEXT_PREFIX + next.label + ' - ' + next.text : null
    if (nextText) keepTexts.add(nextText)

    const before = data.lists.pulse.length
    data.lists.pulse = data.lists.pulse.filter(t => {
      if (ALL_BLOCK_TEXTS.has(t.text) && !keepTexts.has(t.text)) return false
      if (t.text.startsWith(NEXT_PREFIX) && !keepTexts.has(t.text)) return false
      return true
    })
    if (data.lists.pulse.length !== before) changed = true

    const nowTexts = new Set(data.lists.pulse.map(t => t.text))
    if (current && !nowTexts.has(current.text)) {
      data.lists.pulse.unshift(createTask(data, { text: current.text, priority: 1, context: 'time-block' }))
      changed = true
    }
    */

    // Add next-block preview if not already present (disabled)
    const nowTexts = new Set(data.lists.pulse.map(t => t.text))
    const nextText = null
    if (false && nextText && !nowTexts.has(nextText)) {
      data.lists.pulse.push(createTask(data, { text: nextText, priority: 1, context: 'time-next' }))
      changed = true
    }

    if (changed) saveData(data)
  } catch (err) {
    console.error('Pulse repopulate error:', err.message)
  }
}

// --- Daily routine checklist ---
// Items activate at specific EST times, must be explicitly checked off.
// Reset daily. Checked items don't reappear until next day.

// ROUTINE_ITEMS imported from ./routine-items.js

function repopulateRoutine() {
  try {
    const data = readData()
    if (!data.lists.pulse) data.lists.pulse = []
    const now = estNow()
    const nowMins = now.getHours() * 60 + now.getMinutes()
    let changed = false

    clearStaleChecks()

    // Remove routine items from previous days (stale)
    const beforeLen = data.lists.pulse.length
    data.lists.pulse = data.lists.pulse.filter(t => {
      if (t.context !== 'routine') return true
      if (t.created) {
        const createdDate = new Date(t.created).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        const todayDate = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        if (createdDate !== todayDate) return false
      }
      return true
    })
    if (data.lists.pulse.length !== beforeLen) changed = true

    const existing = new Set(data.lists.pulse.filter(t => t.context === 'routine').map(t => t.text))

    for (const item of ROUTINE_ITEMS) {
      if (item.day !== undefined && now.getDay() !== item.day) continue
      if (item.skipDays?.includes(now.getDay())) continue
      const activateMins = timeToMinutes(item.time)
      if (nowMins < activateMins) continue
      if (existing.has(item.text)) continue
      if (isRoutineCheckedToday(item.text)) continue

      data.lists.pulse.push(createTask(data, {
        text: item.text,
        priority: 1,
        context: 'routine',
      }))
      changed = true
    }

    if (changed) saveData(data)
  } catch (err) {
    console.error('Routine repopulate error:', err.message)
  }
}

app.post('/api/routine/check', (req, res) => {
  try {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const data = readData()
    const item = data.lists.pulse?.find(t => t.id === id && t.context === 'routine')
    if (!item) return res.status(404).json({ error: 'Not found' })

    markRoutineChecked(item.text)
    data.lists.pulse = data.lists.pulse.filter(t => t.id !== id)
    saveData(data)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Routine seeds on startup; pulse only on interval (so dismissals survive restarts)
repopulateRoutine()
setInterval(repopulatePulse, 30 * 60 * 1000)
setInterval(repopulateRoutine, 60 * 1000) // check every minute for new activations

const PORT = 5181
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Todo API server running on http://0.0.0.0:${PORT}`)
  startSlackDigest()
})
