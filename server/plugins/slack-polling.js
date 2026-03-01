/**
 * Slack DM polling plugin — polls conversations.replies and conversations.history
 * for DM channels (D-prefix) using the user token.
 *
 * Socket Mode can't see user-to-user DMs, so we poll those separately.
 * DM count is typically small, so rate limits aren't a concern.
 */

import { getSlackToken, slackAPI, resolveUser, isDMRef } from './slack-helpers.js'

export function createSlackDMPollingPlugin() {
  const slackToken = getSlackToken()
  if (!slackToken) {
    console.log('[slack-dm] Missing SLACK_USER_TOKEN, skipping')
    return null
  }

  let dispatchers = {}
  let watchThreads = new Set()
  let watchChannels = new Set()
  let pollTimer = null
  const lastSeen = {}

  async function pollThread(ref) {
    const [channel, thread_ts] = ref.split('/')
    if (!channel || !thread_ts) return

    const isFirst = !lastSeen[ref]
    const params = { channel, ts: thread_ts, limit: '10' }
    if (lastSeen[ref]) params.oldest = lastSeen[ref]

    try {
      const result = await slackAPI('conversations.replies', params)
      if (!result.ok) {
        if (result.error !== 'thread_not_found') console.error(`[slack-dm] Thread ${ref}: ${result.error}`)
        return
      }

      const messages = result.messages || []
      if (isFirst) {
        if (messages.length > 0) {
          const latest = messages[messages.length - 1]
          const author = await resolveUser(latest.user)
          const ok = await dispatchers.slack_thread(ref, {
            summary: (latest.text || '').slice(0, 200),
            author,
            ts: new Date(parseFloat(latest.ts) * 1000).toISOString(),
            metadata: { channel, thread_ts, message_ts: latest.ts, is_root: true, user_id: latest.user }
          })
          if (ok) lastSeen[ref] = messages[messages.length - 1].ts
        }
        return
      }

      for (const msg of messages.filter(m => m.ts !== thread_ts && (!lastSeen[ref] || m.ts > lastSeen[ref]))) {
        const author = await resolveUser(msg.user)
        const ok = await dispatchers.slack_thread(ref, {
          summary: (msg.text || '').slice(0, 200),
          author,
          ts: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          metadata: { channel, thread_ts, message_ts: msg.ts, subtype: msg.subtype, user_id: msg.user }
        })
        if (!ok) break
        lastSeen[ref] = msg.ts
      }
    } catch (err) {
      console.error(`[slack-dm] Thread poll error ${ref}:`, err.message)
    }
  }

  async function pollChannel(channelId) {
    const isFirst = !lastSeen[channelId]
    const params = { channel: channelId, limit: '5' }
    if (lastSeen[channelId]) params.oldest = lastSeen[channelId]

    try {
      const result = await slackAPI('conversations.history', params)
      if (!result.ok) {
        console.error(`[slack-dm] Channel ${channelId}: ${result.error}`)
        return
      }

      const messages = (result.messages || []).reverse()
      if (isFirst) {
        if (messages.length > 0) {
          const latest = messages[messages.length - 1]
          const author = await resolveUser(latest.user)
          const ok = await dispatchers.slack(channelId, {
            summary: (latest.text || '').slice(0, 200),
            author,
            ts: new Date(parseFloat(latest.ts) * 1000).toISOString(),
            metadata: { channel: channelId, message_ts: latest.ts, is_root: true, user_id: latest.user }
          })
          if (ok) lastSeen[channelId] = latest.ts
        }
        return
      }

      for (const msg of messages.filter(m => !lastSeen[channelId] || m.ts > lastSeen[channelId])) {
        const author = await resolveUser(msg.user)
        const ok = await dispatchers.slack(channelId, {
          summary: (msg.text || '').slice(0, 200),
          author,
          ts: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          metadata: { channel: channelId, message_ts: msg.ts, subtype: msg.subtype, user_id: msg.user }
        })
        if (!ok) break
        lastSeen[channelId] = msg.ts
      }
    } catch (err) {
      console.error(`[slack-dm] Channel poll error ${channelId}:`, err.message)
    }
  }

  async function pollAll() {
    for (const ref of watchThreads) {
      await pollThread(ref)
      await new Promise(r => setTimeout(r, 500))
    }
    for (const ref of watchChannels) {
      await pollChannel(ref)
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return {
    types: ['slack_thread', 'slack'],

    async start(dispatcherFns) {
      dispatchers = dispatcherFns
      console.log(`[slack-poll] Polling ready (token: ${slackToken.slice(0, 8)}...)`)
      pollTimer = setInterval(pollAll, 15000)
    },

    updateWatchList(refsByType) {
      const threadRefs = refsByType.slack_thread || []
      const channelRefs = refsByType.slack || []

      const prevTotal = watchThreads.size + watchChannels.size
      watchThreads = new Set(threadRefs)
      watchChannels = new Set(channelRefs)
      const newTotal = watchThreads.size + watchChannels.size

      if (newTotal !== prevTotal) {
        console.log(`[slack-poll] Watching ${watchThreads.size} thread(s), ${watchChannels.size} channel(s)`)
      }
      if (newTotal > prevTotal) pollAll()
    },

    async stop() {
      if (pollTimer) clearInterval(pollTimer)
      console.log('[slack-dm] Stopped')
    }
  }
}
