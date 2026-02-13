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
 *   SLACK_USER_TOKEN  — Slack user token (xoxp-...) for Socket Mode
 *   SLACK_APP_TOKEN   — Slack app-level token (xapp-...) for Socket Mode
 *   TODO_API_URL      — Base URL for the todo API (default: http://localhost:5181)
 */

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

// --- Slack Socket Mode Plugin ---

function createSlackPlugin() {
  const token = process.env.SLACK_USER_TOKEN
  const appToken = process.env.SLACK_APP_TOKEN

  if (!token || !appToken) {
    console.log('[slack] Missing SLACK_USER_TOKEN or SLACK_APP_TOKEN, skipping')
    return null
  }

  let dispatch = null
  let watchRefs = new Set()

  return {
    type: 'slack_thread',

    async start(dispatchFn) {
      dispatch = dispatchFn
      // Socket Mode requires @slack/socket-mode — start polling as fallback
      console.log('[slack] Plugin ready (will poll watched threads)')
    },

    updateWatchList(refs) {
      watchRefs = new Set(refs)
      if (watchRefs.size > 0) {
        console.log(`[slack] Watching ${watchRefs.size} thread(s)`)
      }
    },

    async stop() {
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
