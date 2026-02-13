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
 *   SLACK_BOT_TOKEN   — Slack bot token (xoxb-...) for API calls
 *   SLACK_APP_TOKEN   — Slack app-level token (xapp-...) for Socket Mode
 *   TODO_API_URL      — Base URL for the todo API (default: http://localhost:5181)
 */

import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'

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
// Uses Socket Mode for real-time message events. No polling needed.
// Link ref format: "C0ABC123/1234567890.123456" (channel/thread_ts)
// Requires SLACK_BOT_TOKEN (xoxb-...) and SLACK_APP_TOKEN (xapp-...).
// Slack app needs: connections:write, channels:history, groups:history scopes
// and Socket Mode enabled + message event subscription.

function createSlackPlugin() {
  const botToken = process.env.SLACK_BOT_TOKEN
  const appToken = process.env.SLACK_APP_TOKEN

  if (!appToken || !botToken) {
    console.log('[slack] Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN, skipping')
    return null
  }

  let dispatch = null
  let watchRefs = new Set()
  let socketClient = null
  const web = new WebClient(botToken)

  return {
    type: 'slack_thread',

    async start(dispatchFn) {
      dispatch = dispatchFn

      socketClient = new SocketModeClient({ appToken })

      // Listen for message events
      socketClient.on('message', async ({ event, ack }) => {
        await ack()

        // Only care about threaded messages in channels we're watching
        if (!event || !event.thread_ts || !event.channel) return

        const ref = `${event.channel}/${event.thread_ts}`
        if (!watchRefs.has(ref)) return

        // Skip bot messages that are our own
        if (event.bot_id) return

        await dispatch(ref, {
          summary: (event.text || '').slice(0, 200),
          author: event.user || 'unknown',
          ts: new Date(parseFloat(event.ts) * 1000).toISOString(),
          metadata: {
            channel: event.channel,
            thread_ts: event.thread_ts,
            message_ts: event.ts,
            subtype: event.subtype
          }
        })
      })

      // Also listen for reactions on watched threads
      socketClient.on('reaction_added', async ({ event, ack }) => {
        await ack()
        if (!event || !event.item?.ts || !event.item?.channel) return

        const ref = `${event.item.channel}/${event.item.ts}`
        if (!watchRefs.has(ref)) return

        await dispatch(ref, {
          summary: `:${event.reaction}: reaction`,
          author: event.user || 'unknown',
          ts: new Date(parseFloat(event.event_ts) * 1000).toISOString(),
          metadata: { channel: event.item.channel, thread_ts: event.item.ts, reaction: event.reaction }
        })
      })

      socketClient.on('connected', () => {
        console.log(`[slack] Socket Mode connected`)
      })

      socketClient.on('disconnected', () => {
        console.log(`[slack] Socket Mode disconnected, will reconnect...`)
      })

      await socketClient.start()
      console.log(`[slack] Plugin ready (Socket Mode, bot: ${botToken.slice(0, 8)}...)`)
    },

    updateWatchList(refs) {
      const prev = watchRefs.size
      watchRefs = new Set(refs)
      if (watchRefs.size !== prev) {
        console.log(`[slack] Watching ${watchRefs.size} thread(s)`)
      }
    },

    async stop() {
      if (socketClient) await socketClient.disconnect()
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
