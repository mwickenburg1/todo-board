/**
 * Routine checked state — shared between index.js and focus-queue.js.
 * Tracks which routine items have been checked off today.
 * Persisted to disk so server restarts don't lose state.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const ROUTINE_CHECKED_PATH = resolve(process.env.HOME, 'todos-repo', '.routine-checked.json')

let routineCheckedToday = new Map()
try {
  const saved = JSON.parse(readFileSync(ROUTINE_CHECKED_PATH, 'utf8'))
  routineCheckedToday = new Map(Object.entries(saved))
} catch {}

function persist() {
  writeFileSync(ROUTINE_CHECKED_PATH, JSON.stringify(Object.fromEntries(routineCheckedToday)))
}

function estDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export function markRoutineChecked(text) {
  routineCheckedToday.set(text, estDateStr())
  persist()
}

export function isRoutineCheckedToday(text) {
  return routineCheckedToday.get(text) === estDateStr()
}

export function clearStaleChecks() {
  const today = estDateStr()
  let cleared = false
  for (const [text, date] of routineCheckedToday) {
    if (date !== today) { routineCheckedToday.delete(text); cleared = true }
  }
  if (cleared) persist()
}
