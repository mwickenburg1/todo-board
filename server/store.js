import { readFileSync, writeFileSync } from 'fs'
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

export function readData() {
  return JSON.parse(readFileSync(TODOS_PATH, 'utf-8'))
}

export function saveData(data) {
  saveSnapshot()
  writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
}

export function popUndo() {
  if (undoStack.length === 0) return null
  const snapshot = undoStack.pop()
  writeFileSync(TODOS_PATH, snapshot)
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

// In-memory env status store
const envStatus = {}

export function getEnvStatus() { return envStatus }

export function setEnvStatus(key, value) {
  envStatus[key] = { ...value, updated: new Date().toISOString() }
}
