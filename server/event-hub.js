/**
 * Event Hub — watches external sources and routes events to tasks via links.
 *
 * Architecture:
 *   Plugin registers with: { type, start(dispatch), stop() }
 *   dispatch(source, ref, event) → POST /api/events on the main server
 *
 * Usage:
 *   node server/event-hub.js
 *
 * Env vars:
 *   SLACK_USER_TOKEN  — Slack user token (xoxp-...) — sees all your channels/DMs
 *   TODO_API_URL      — Base URL for the todo API (default: http://localhost:5181)
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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

// --- Plugin interface ---

class EventHub {
  constructor() {
    this.plugins = []
    this.running = false
  }

  register(plugin) {
    this.plugins.push(plugin)
    console.log(`[hub] Registered plugin: ${plugin.type}`)
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
    } catch (err) {
      console.error(`[hub] Failed to dispatch event:`, err.message)
    }
  }

  async start() {
    this.running = true
    console.log(`[hub] Starting ${this.plugins.length} plugin(s)...`)
    for (const plugin of this.plugins) {
      try {
        await plugin.start((ref, event) => this.dispatch(plugin.type, ref, event))
        console.log(`[hub] Plugin started: ${plugin.type}`)
      } catch (err) {
        console.error(`[hub] Failed to start ${plugin.type}:`, err.message)
      }
    }

    // Poll for active link refs to inform plugins what to watch
    this.pollInterval = setInterval(() => this.syncWatchList(), 30000)
    await this.syncWatchList()
  }

  async syncWatchList() {
    try {
      const res = await fetch(`${TODO_API}/api/todos`)
      const data = await res.json()
      // Extract all active link refs grouped by type
      const refs = {}
      for (const [listName, tasks] of Object.entries(data.lists)) {
        if (listName === 'done') continue
        for (const task of (tasks || [])) {
          if (!task.links) continue
          for (const link of task.links) {
            if (!refs[link.type]) refs[link.type] = new Set()
            refs[link.type].add(link.ref)
          }
        }
      }
      // Notify plugins of current watch list
      for (const plugin of this.plugins) {
        if (plugin.updateWatchList) {
          const pluginRefs = refs[plugin.type] ? [...refs[plugin.type]] : []
          plugin.updateWatchList(pluginRefs)
        }
      }
    } catch (err) {
      console.error(`[hub] Failed to sync watch list:`, err.message)
    }
  }

  async stop() {
    this.running = false
    clearInterval(this.pollInterval)
    for (const plugin of this.plugins) {
      try {
        if (plugin.stop) await plugin.stop()
      } catch (err) {
        console.error(`[hub] Failed to stop ${plugin.type}:`, err.message)
      }
    }
  }
}

// --- Slack User Token Polling Plugin ---
// Polls conversations.replies for watched threads using a user token (xoxp-...).
// User token sees all channels/DMs you're in — no bot installation needed.
// Link ref format: "C0ABC123/1234567890.123456" (channel/thread_ts)

function createSlackPlugin() {
  const token = process.env.SLACK_USER_TOKEN

  if (!token) {
    console.log('[slack] Missing SLACK_USER_TOKEN, skipping')
    return null
  }

  let dispatch = null
  let watchRefs = new Set()
  let pollTimer = null
  // Track last-seen message ts per thread to only dispatch new messages
  const lastSeen = {}
  // Cache resolved Slack user IDs → display names
  const userNames = {}

  async function slackAPI(method, params = {}) {
    const url = new URL(`https://slack.com/api/${method}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    return res.json()
  }

  async function resolveUser(userId) {
    if (!userId || userId === 'unknown') return userId
    if (userNames[userId]) return userNames[userId]
    try {
      const result = await slackAPI('users.info', { user: userId })
      if (result.ok) {
        const name = result.user.profile?.display_name || result.user.real_name || userId
        userNames[userId] = name
        console.log(`[slack] Resolved ${userId} → ${name}`)
        return name
      }
      console.log(`[slack] users.info failed for ${userId}: ${result.error}`)
    } catch (err) {
      console.error(`[slack] users.info error for ${userId}:`, err.message)
    }
    return userId
  }

  async function pollThread(ref) {
    const [channel, thread_ts] = ref.split('/')
    if (!channel || !thread_ts) return
    const isFirstPoll = !lastSeen[ref]

    try {
      const params = { channel, ts: thread_ts, limit: '10' }
      if (lastSeen[ref]) params.oldest = lastSeen[ref]

      const result = await slackAPI('conversations.replies', params)
      if (!result.ok) {
        if (result.error !== 'thread_not_found') {
          console.error(`[slack] API error for ${ref}: ${result.error}`)
        }
        return
      }

      const messages = result.messages || []

      // On first poll: only set thread label from root message, skip historical replies
      if (isFirstPoll) {
        if (messages.length > 0) {
          // Use last reply as label (most recent activity), fall back to root
          const latest = messages[messages.length - 1]
          const authorName = await resolveUser(latest.user)
          await dispatch(ref, {
            summary: (latest.text || '').slice(0, 200),
            author: authorName,
            ts: new Date(parseFloat(latest.ts) * 1000).toISOString(),
            metadata: { channel, thread_ts, message_ts: latest.ts, is_root: true }
          })
          // Initialize lastSeen so subsequent polls only get new messages
          lastSeen[ref] = messages[messages.length - 1].ts
        }
        return
      }

      const newMessages = messages.filter(m => {
        if (m.ts === thread_ts) return false
        if (lastSeen[ref] && m.ts <= lastSeen[ref]) return false
        return true
      })

      for (const msg of newMessages) {
        const authorName = await resolveUser(msg.user)
        await dispatch(ref, {
          summary: (msg.text || '').slice(0, 200),
          author: authorName,
          ts: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          metadata: { channel, thread_ts, message_ts: msg.ts, subtype: msg.subtype }
        })
      }

      if (messages.length > 0) {
        lastSeen[ref] = messages[messages.length - 1].ts
      }
    } catch (err) {
      console.error(`[slack] Poll error for ${ref}:`, err.message)
    }
  }

  async function pollAll() {
    if (watchRefs.size === 0) return
    for (const ref of watchRefs) {
      await pollThread(ref)
      // Small delay between API calls to respect rate limits
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return {
    type: 'slack_thread',

    async start(dispatchFn) {
      dispatch = dispatchFn
      console.log(`[slack] Plugin ready (user token polling, token: ${token.slice(0, 8)}...)`)
      // Poll every 15s for near-real-time updates
      pollTimer = setInterval(pollAll, 15000)
    },

    updateWatchList(refs) {
      const prev = watchRefs.size
      watchRefs = new Set(refs)
      if (watchRefs.size !== prev) {
        console.log(`[slack] Watching ${watchRefs.size} thread(s)`)
      }
      // Immediately poll new threads
      if (watchRefs.size > prev) pollAll()
    },

    async stop() {
      if (pollTimer) clearInterval(pollTimer)
      console.log('[slack] Stopped')
    }
  }
}

// --- Claude Code Webhook Plugin ---

function createClaudeCodePlugin() {
  return {
    type: 'claude_code',

    async start(dispatch) {
      // This plugin is passive — it receives events via POST /api/events
      // from Claude Code hooks (session.end, task.complete, etc.)
      console.log('[claude_code] Plugin ready (receives events via /api/events)')
    },

    updateWatchList(refs) {
      // Nothing to actively watch — Claude Code pushes events
    },

    async stop() {}
  }
}

// --- Generic URL/webhook Plugin ---

function createWebhookPlugin() {
  return {
    type: 'url',

    async start(dispatch) {
      console.log('[webhook] Plugin ready (receives events via /api/events)')
    },

    updateWatchList() {},
    async stop() {}
  }
}

// --- Main ---

const hub = new EventHub()

// Register available plugins
const slackPlugin = createSlackPlugin()
if (slackPlugin) hub.register(slackPlugin)

hub.register(createClaudeCodePlugin())
hub.register(createWebhookPlugin())

hub.start().catch(err => {
  console.error('[hub] Fatal error:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[hub] Shutting down...')
  await hub.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await hub.stop()
  process.exit(0)
})
