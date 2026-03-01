/**
 * Event Hub — watches external sources and routes events to tasks via links.
 *
 * Plugins:
 *   Single-type:  { type, start(dispatch), updateWatchList(refs), stop() }
 *   Multi-type:   { types, start(dispatchers), updateWatchList(refsByType), stop() }
 *
 * Usage:  node server/event-hub.js
 *
 * Env vars:
 *   SLACK_USER_TOKEN  — Slack user token (xoxp-...) for DM polling
 *   SLACK_APP_TOKEN   — Slack app token (xapp-...) for Socket Mode
 *   TODO_API_URL      — Base URL for the todo API (default: http://localhost:5181)
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createSlackSocketPlugin } from './plugins/slack-socket.js'
import { createSlackDMPollingPlugin } from './plugins/slack-polling.js'

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

const TODO_API = process.env.TODO_API_URL || 'http://localhost:5181'

// --- EventHub core ---

class EventHub {
  constructor() {
    this.plugins = []
  }

  register(plugin) {
    const label = plugin.types ? plugin.types.join('+') : plugin.type
    this.plugins.push(plugin)
    console.log(`[hub] Registered: ${label}`)
  }

  async dispatch(source, ref, event) {
    try {
      const res = await fetch(`${TODO_API}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, ref, ...event })
      })
      const result = await res.json()
      if (result.matched > 0) {
        console.log(`[hub] Event routed: ${source}/${ref} → ${result.matched} task(s)`)
      }
      return true
    } catch (err) {
      console.error(`[hub] Dispatch failed:`, err.message)
      return false
    }
  }

  async start() {
    console.log(`[hub] Starting ${this.plugins.length} plugin(s)...`)
    for (const plugin of this.plugins) {
      try {
        if (plugin.types) {
          // Multi-type plugin: pass dispatcher per type
          const dispatchers = {}
          for (const t of plugin.types) {
            dispatchers[t] = (ref, event) => this.dispatch(t, ref, event)
          }
          await plugin.start(dispatchers)
        } else {
          await plugin.start((ref, event) => this.dispatch(plugin.type, ref, event))
        }
      } catch (err) {
        const label = plugin.types ? plugin.types.join('+') : plugin.type
        console.error(`[hub] Failed to start ${label}:`, err.message)
      }
    }

    this.pollInterval = setInterval(() => this.syncWatchList(), 30000)
    await this.syncWatchList()
  }

  async syncWatchList() {
    try {
      const res = await fetch(`${TODO_API}/api/todos`)
      const data = await res.json()

      const refs = {}
      for (const [listName, tasks] of Object.entries(data.lists)) {
        if (listName === 'done') continue
        for (const task of (tasks || [])) {
          for (const link of (task.links || [])) {
            if (!refs[link.type]) refs[link.type] = new Set()
            refs[link.type].add(link.ref)
          }
        }
      }

      for (const plugin of this.plugins) {
        if (!plugin.updateWatchList) continue
        if (plugin.types) {
          // Multi-type: pass { type: [...refs] } object
          const byType = {}
          for (const t of plugin.types) {
            byType[t] = refs[t] ? [...refs[t]] : []
          }
          plugin.updateWatchList(byType)
        } else {
          plugin.updateWatchList(refs[plugin.type] ? [...refs[plugin.type]] : [])
        }
      }
    } catch (err) {
      console.error(`[hub] Watch list sync failed:`, err.message)
    }
  }

  async stop() {
    clearInterval(this.pollInterval)
    for (const plugin of this.plugins) {
      try { if (plugin.stop) await plugin.stop() } catch {}
    }
  }
}

// --- Passive plugins (receive events via POST /api/events) ---

function createPassivePlugin(type) {
  return {
    type,
    async start() { console.log(`[${type}] Ready (passive)`) },
    updateWatchList() {},
    async stop() {}
  }
}

// --- Main ---

const hub = new EventHub()

const socketPlugin = createSlackSocketPlugin()
if (socketPlugin) hub.register(socketPlugin)

const dmPlugin = createSlackDMPollingPlugin()
if (dmPlugin) hub.register(dmPlugin)

hub.register(createPassivePlugin('claude_code'))
hub.register(createPassivePlugin('url'))

hub.start().catch(err => {
  console.error('[hub] Fatal:', err)
  process.exit(1)
})

process.on('SIGINT', async () => {
  console.log('\n[hub] Shutting down...')
  await hub.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await hub.stop()
  process.exit(0)
})
