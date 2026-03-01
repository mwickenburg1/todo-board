/**
 * Slack Socket Mode plugin — real-time events for channels/threads.
 *
 * Uses the app-level token (xapp-) to open a WebSocket via apps.connections.open.
 * Receives message events for channels the bot is a member of.
 * DMs are NOT handled here — use the polling plugin for those.
 */

import WebSocket from 'ws'
import { getAppToken, resolveUser, isDMRef, ensureBotInChannel } from './slack-helpers.js'

export function createSlackSocketPlugin() {
  const appToken = getAppToken()
  if (!appToken) {
    console.log('[slack-socket] Missing SLACK_APP_TOKEN, skipping')
    return null
  }

  let dispatchers = {}
  let ws = null
  let watchThreads = new Map()   // channel → Set<thread_ts>
  let watchChannels = new Set()
  let reconnectTimer = null

  function indexThreads(refs) {
    const idx = new Map()
    for (const ref of refs) {
      const [ch, ts] = ref.split('/')
      if (!idx.has(ch)) idx.set(ch, new Set())
      idx.get(ch).add(ts)
    }
    return idx
  }

  async function connect() {
    try {
      // apps.connections.open requires POST with app-level token
      const res = await fetch('https://slack.com/api/apps.connections.open', {
        method: 'POST',
        headers: { Authorization: `Bearer ${appToken}` }
      })
      const result = await res.json()
      if (!result.ok) {
        console.error(`[slack-socket] apps.connections.open: ${result.error}`)
        return false
      }

      return new Promise((resolve) => {
        ws = new WebSocket(result.url)

        ws.on('open', () => {
          console.log(`[slack-socket] Connected`)
          resolve(true)
        })

        ws.on('message', async (raw) => {
          try {
            const envelope = JSON.parse(raw.toString())

            // Must acknowledge every envelope immediately
            if (envelope.envelope_id) {
              ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
            }

            if (envelope.type === 'hello') {
              console.log(`[slack-socket] Handshake OK (${watchThreads.size} channels with threads, ${watchChannels.size} channels)`)
              return
            }

            if (envelope.type === 'disconnect') {
              console.log(`[slack-socket] Server requested disconnect: ${envelope.reason}`)
              return
            }

            if (envelope.type !== 'events_api') return

            const event = envelope.payload?.event
            if (!event || event.type !== 'message') return
            if (event.subtype === 'message_changed' || event.subtype === 'message_deleted' || event.hidden) return

            await handleMessage(event)
          } catch {}
        })

        ws.on('close', (code) => {
          console.log(`[slack-socket] Disconnected (${code}), reconnecting in 5s...`)
          reconnectTimer = setTimeout(() => connect(), 5000)
        })

        ws.on('error', (err) => {
          console.error(`[slack-socket] WS error:`, err.message)
        })
      })
    } catch (err) {
      console.error(`[slack-socket] Connect error:`, err.message)
      return false
    }
  }

  async function handleMessage(event) {
    const channel = event.channel
    const threadTs = event.thread_ts
    console.log(`[slack-socket] msg: ch=${channel} thread=${threadTs || 'none'} text="${(event.text || '').slice(0, 50)}"`)
    const author = await resolveUser(event.user)
    const payload = {
      summary: (event.text || '').slice(0, 200),
      author,
      ts: new Date(parseFloat(event.ts) * 1000).toISOString(),
      metadata: { channel, message_ts: event.ts, subtype: event.subtype, user_id: event.user }
    }

    // Thread reply in a watched thread
    if (threadTs && dispatchers.slack_thread) {
      const threads = watchThreads.get(channel)
      console.log(`[slack-socket] lookup ch=${channel}: ${threads ? `[${[...threads].join(',')}]` : 'NOT FOUND'}`)
      if (threads?.has(threadTs)) {
        dispatchers.slack_thread(`${channel}/${threadTs}`, {
          ...payload,
          metadata: { ...payload.metadata, thread_ts: threadTs }
        })
      }
    }

    // Top-level message in a watched channel
    if (!threadTs && dispatchers.slack && watchChannels.has(channel)) {
      dispatchers.slack(channel, payload)
    }
  }

  return {
    types: ['slack_thread', 'slack'],

    async start(dispatcherFns) {
      dispatchers = dispatcherFns
      await connect()
    },

    updateWatchList(refsByType) {
      const threadRefs = (refsByType.slack_thread || []).filter(r => !isDMRef(r))
      const channelRefs = (refsByType.slack || []).filter(r => !isDMRef(r))

      // Auto-join bot to any new public channels
      const allChannelIds = new Set([
        ...threadRefs.map(r => r.split('/')[0]),
        ...channelRefs
      ])
      for (const ch of allChannelIds) ensureBotInChannel(ch)

      watchThreads = indexThreads(threadRefs)
      watchChannels = new Set(channelRefs)

      const total = threadRefs.length + channelRefs.length
      if (total > 0) {
        console.log(`[slack-socket] Watching ${threadRefs.length} thread(s), ${channelRefs.length} channel(s)`)
      }
    },

    async stop() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
      console.log('[slack-socket] Stopped')
    }
  }
}
