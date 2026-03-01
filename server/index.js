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
import { startSlackDigest, acknowledgeDigest } from './slack-digest.js'

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
app.post('/api/open-env', (req, res) => {
  const { env } = req.body
  if (!env || !/^env[1-8]$/.test(env)) {
    return res.status(400).json({ error: 'Invalid env, must be env1-env8' })
  }
  const workspace = `/home/ubuntu/${env}.code-workspace`
  execFile('cursor', [workspace], { timeout: 5000, env: cursorEnv() }, (err) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ ok: true, env, workspace })
  })
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
    res.json(readData())
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

// --- Route modules ---

app.use('/api/todos', todosRouter)
app.use('/api/lists', listsRouter)
app.use('/api/events', eventsRouter)
app.use('/api/env-status', envStatusRouter)

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
]

// Daily energy blocks (EST). Each appears when its window starts.
const TIME_BLOCKS = [
  { start: '07:45', end: '11:00', label: '7:45-11',
    text: 'Deep work - 100%, RPE 8/9 not 10. Leave "I could do 30 more mins". If I don\'t nail this, company drifts at 9m' },
  { start: '11:15', end: '12:30', label: '11:15-12:30',
    text: 'Important meetings - RPE 6/7' },
  { start: '13:00', end: '15:00', label: '1-3 PM',
    text: 'Trough -> MED / NSDR / Exercise' },
  { start: '15:00', end: '17:00', label: '3-5 PM',
    text: 'Second piece - RPE 5-6, wind down' },
  { start: '17:00', end: '17:30', label: '5-5:30 PM',
    text: 'Wind down, disconnect at 5:30. RPE 2-3. Pick the 1 item for DW block tmrw' },
]

// All possible time-block texts (for cleanup)
const ALL_BLOCK_TEXTS = new Set(TIME_BLOCKS.map(b => b.text))
const NEXT_PREFIX = 'Next: '

function estNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
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

    // --- Time blocks: rotate based on current EST time ---
    const { current, next } = currentAndNextBlock()

    // Remove stale block items (not current block, not current next-preview)
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

    // Add current block if active and not already present
    const nowTexts = new Set(data.lists.pulse.map(t => t.text))
    if (current && !nowTexts.has(current.text)) {
      data.lists.pulse.unshift(createTask(data, { text: current.text, priority: 1, context: 'time-block' }))
      changed = true
    }

    // Add next-block preview if not already present
    if (nextText && !nowTexts.has(nextText)) {
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

const ROUTINE_ITEMS = [
  { time: '06:15', text: 'Exercise done' },
  { time: '06:15', text: 'Any urgent flags overnight?' },
  { time: '08:15', text: 'At least 3 Claude instances launched with specs' },
  { time: '11:00', text: '11am review: check board, review Claude outputs, relaunch/redirect' },
  { time: '12:00', text: 'Pill day', day: 0 }, // Sunday only
  { time: '14:00', text: '2pm review: check board, review Claude outputs, relaunch/redirect' },
  { time: '16:30', text: '4:30 review: Claude outputs, course-correct' },
  { time: '17:00', text: "Tomorrow's 4-8 tasks listed (even rough one-liners)" },
  { time: '17:00', text: 'Top 4 ranked by leverage' },
  { time: '17:00', text: "Calendar checked — tomorrow's fragmentation noted" },
  { time: '17:30', text: 'Disconnected' },
]

// Track checked routine items per day: Map<text, 'YYYY-MM-DD'>
// Persisted to disk so server restarts don't lose checked state
const ROUTINE_CHECKED_PATH = resolve(process.env.HOME, 'todos-repo', '.routine-checked.json')
let routineCheckedToday = new Map()
try {
  const saved = JSON.parse(readFileSync(ROUTINE_CHECKED_PATH, 'utf8'))
  routineCheckedToday = new Map(Object.entries(saved))
} catch {}

function persistRoutineChecked() {
  writeFileSync(ROUTINE_CHECKED_PATH, JSON.stringify(Object.fromEntries(routineCheckedToday)))
}

function estDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function repopulateRoutine() {
  try {
    const data = readData()
    if (!data.lists.pulse) data.lists.pulse = []
    const now = estNow()
    const nowMins = now.getHours() * 60 + now.getMinutes()
    const today = estDateStr()
    let changed = false

    // Clear yesterday's checks
    let cleared = false
    for (const [text, date] of routineCheckedToday) {
      if (date !== today) { routineCheckedToday.delete(text); cleared = true }
    }
    if (cleared) persistRoutineChecked()

    // Remove routine items from previous days (stale)
    const beforeLen = data.lists.pulse.length
    data.lists.pulse = data.lists.pulse.filter(t => {
      if (t.context !== 'routine') return true
      // Keep if created today
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
      if (item.day !== undefined && now.getDay() !== item.day) continue // wrong day of week
      const activateMins = timeToMinutes(item.time)
      if (nowMins < activateMins) continue // not yet
      if (existing.has(item.text)) continue // already in list
      if (routineCheckedToday.get(item.text) === today) continue // checked off today

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

    // Mark as checked for today and persist
    routineCheckedToday.set(item.text, estDateStr())
    persistRoutineChecked()

    // Remove from pulse list
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
