/**
 * Unified snooze/reschedule state with disk persistence.
 *
 * Replaces the in-memory Map that was in focus-queue.js.
 * Persists across server restarts so reschedules to future dates survive.
 *
 * Each entry: { until: number (epoch ms), reason: 'snooze' | 'reschedule' }
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const SNOOZE_PATH = resolve(process.env.HOME, 'todos-repo', '.snooze-state.json')

let snoozed = new Map()

// Load from disk on startup
try {
  const saved = JSON.parse(readFileSync(SNOOZE_PATH, 'utf8'))
  for (const [id, entry] of Object.entries(saved)) {
    // String keys (slackRef) stay as strings, numeric IDs become numbers
    const key = /^\d+$/.test(id) ? Number(id) : id
    snoozed.set(key, entry)
  }
} catch {}

function persist() {
  writeFileSync(SNOOZE_PATH, JSON.stringify(Object.fromEntries(snoozed)))
}

export function snoozeItem(id, untilMs, reason = 'snooze') {
  snoozed.set(id, { until: untilMs, reason })
  persist()
}

export function unsnooze(id) {
  if (snoozed.has(id)) {
    snoozed.delete(id) // full delete — item was acted on
    persist()
  }
}

export function isSnoozed(id) {
  const entry = snoozed.get(id)
  if (!entry || entry.expired) return false
  if (Date.now() >= entry.until) {
    entry.expired = true
    persist()
    return false
  }
  return true
}

/** Get the last snooze/reschedule info for an item (even if expired). */
export function getSnoozeInfo(id) {
  const entry = snoozed.get(id)
  if (!entry) return null
  return { until: entry.until, reason: entry.reason }
}

/** Get all active (non-expired) snooze entries as { [id]: { until, reason } }. */
export function getSnoozeMap() {
  const now = Date.now()
  const map = {}
  let changed = false
  for (const [id, entry] of snoozed) {
    if (entry.expired) continue
    if (now >= entry.until) {
      entry.expired = true
      changed = true
      continue
    }
    map[id] = { until: entry.until, reason: entry.reason }
  }
  if (changed) persist()
  return map
}

export function getSnoozedIds() {
  const now = Date.now()
  const active = []
  let changed = false
  for (const [id, entry] of snoozed) {
    if (entry.expired) continue
    if (now < entry.until) {
      active.push(id)
    } else {
      entry.expired = true
      changed = true
    }
  }
  if (changed) persist()
  return active
}
