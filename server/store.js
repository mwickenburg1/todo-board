import { readFileSync, writeFileSync, watchFile } from 'fs'
import { join } from 'path'

const TODOS_PATH = join(process.env.HOME, 'todos-repo', 'todos.json')

// Undo stack: save snapshots before mutations (persisted to disk)
const UNDO_PATH = join(process.env.HOME, 'todos-repo', '.undo-stack.json')
const MAX_UNDO = 100

let undoStack = []
try { undoStack = JSON.parse(readFileSync(UNDO_PATH, 'utf-8')) } catch {}

function persistUndoStack() {
  writeFileSync(UNDO_PATH, JSON.stringify(undoStack))
}

function saveSnapshot() {
  const snapshot = readFileSync(TODOS_PATH, 'utf-8')
  undoStack.push(snapshot)
  if (undoStack.length > MAX_UNDO) undoStack.shift()
  persistUndoStack()
}

// Pinned lists that are auto-created if missing
export const PINNED_LISTS = ['daily-goals']

// In-memory cache — avoids 26 disk reads/sec from 500ms polling
let _cache = null

export function readData() {
  if (_cache) return _cache
  const data = JSON.parse(readFileSync(TODOS_PATH, 'utf-8'))
  for (const name of PINNED_LISTS) {
    if (!data.lists[name]) data.lists[name] = []
  }
  _cache = data
  return data
}

export function saveData(data) {
  saveSnapshot()
  writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
  _cache = data
}

export function invalidateCache() {
  _cache = null
}

// Invalidate cache if file changes externally (git sync, direct edits)
watchFile(TODOS_PATH, { interval: 2000 }, () => { _cache = null })

export function popUndo() {
  if (undoStack.length === 0) return null
  const snapshot = undoStack.pop()
  writeFileSync(TODOS_PATH, snapshot)
  _cache = null
  persistUndoStack()
  return undoStack.length
}

export function findTask(data, id, opts = {}) {
  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (!tasks || (opts.skipDone && listName === 'done')) continue
    const found = tasks.find(t => t.id === id)
    if (found) return { list: listName, task: opts.copy ? { ...found } : found }
  }
  return null
}

export function createTask(data, overrides = {}) {
  const task = {
    id: data.next_id || 1,
    text: '',
    priority: 2,
    context: '',
    status: 'pending',
    created: new Date().toISOString(),
    started: null,
    completed: null,
    parent_id: null,
    ...overrides
  }
  data.next_id = (data.next_id || 1) + 1
  return task
}

export function insertInList(list, task, beforeId) {
  if (beforeId !== undefined && beforeId !== null) {
    const idx = list.findIndex(t => t.id === beforeId)
    if (idx !== -1) {
      list.splice(idx, 0, task)
      return
    }
  }
  list.push(task)
}

export function createEmptySlot(focusSlot) {
  return {
    id: null,
    text: '',
    priority: 2,
    context: '',
    status: 'pending',
    created: null,
    started: null,
    completed: null,
    parent_id: null,
    focus_slot: focusSlot,
    is_empty_slot: true
  }
}

/**
 * Migrate legacy slackWatch (single object) → slackWatches (array).
 * Called on any task before reading watches. Mutates in place, returns task.
 */
export function migrateWatches(task) {
  if (task.slackWatch && !task.slackWatches) {
    task.slackWatches = [task.slackWatch]
    delete task.slackWatch
  }
  return task
}

/** Get all watched thread refs from non-done tasks. Returns Map<ref, taskId>. */
export function getWatchedThreadRefs(data) {
  const map = new Map()
  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (!tasks || listName === 'done') continue
    for (const t of tasks) {
      migrateWatches(t)
      for (const sw of (t.slackWatches || [])) {
        if (sw.ref) map.set(sw.ref, t.id)
      }
    }
  }
  return map
}

// In-memory env status store
const envStatus = {}

export function getEnvStatus() { return envStatus }

export function setEnvStatus(key, value) {
  envStatus[key] = { ...value, updated: new Date().toISOString() }
}
