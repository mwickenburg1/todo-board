/**
 * Slack scanners — DMs, @mentions, crashes, threads, incidents.
 */

import { slack, resolveUser, cleanMentions, extractBlockText, USER_ID, CRASHES_CHANNEL, INCIDENTS_CHANNEL, BOT_SENDERS, SLACK_SEARCH_TOKEN } from './slack-api.js'

// --- DMs ---

export async function scanUnrepliedDMs(since) {
  const searchDate = new Date((since - 86400) * 1000).toISOString().split('T')[0]
  const r = await slack('search.messages', {
    query: `is:dm -from:me after:${searchDate}`,
    sort: 'timestamp', sort_dir: 'desc', count: 50,
  }, { useSearch: true })

  if (!r.ok) return []

  const channelMap = new Map()
  for (const m of (r.messages?.matches || [])) {
    const ts = parseFloat(m.ts)
    if (ts < since) continue
    const sender = m.user ? await resolveUser(m.user) : (m.username || 'unknown')
    if (BOT_SENDERS.has(sender)) continue
    const chId = m.channel?.id
    if (!chId) continue
    if (!channelMap.has(chId) || ts > channelMap.get(chId).ts) {
      channelMap.set(chId, { sender, text: (m.text || '').slice(0, 120), ts, chId })
    }
  }

  const unreplied = []
  for (const [chId, info] of channelMap) {
    const h = await slack('conversations.history', { channel: chId, limit: 15 }, { useSearch: true })
    if (!h.ok) continue
    const msgs = h.messages || []

    // Fetch thread replies for messages that have them (most recent activity may be in threads)
    const threadReplies = new Map() // parentTs → [reply messages]
    for (const m of msgs) {
      if (m.reply_count > 0 && m.thread_ts) {
        const replies = await slack('conversations.replies', { channel: chId, ts: m.thread_ts, limit: 10 })
        if (replies.ok && replies.messages?.length > 1) {
          // Skip first message (it's the parent), keep only replies
          threadReplies.set(m.ts, replies.messages.slice(1))
        }
      }
    }

    // Build a timeline: top-level messages + thread replies, sorted by ts
    const allMessages = []
    for (const m of msgs) {
      if (m.subtype && m.subtype !== 'bot_message') continue
      allMessages.push({ user: m.user || m.bot_id, text: m.text || '', ts: m.ts, isThread: false, username: m.username })
      // Insert thread replies right after their parent
      const replies = threadReplies.get(m.ts)
      if (replies) {
        for (const r of replies) {
          allMessages.push({ user: r.user || r.bot_id, text: r.text || '', ts: r.ts, isThread: true, parentTs: m.ts, username: r.username })
        }
      }
    }
    // Sort by timestamp (oldest first for context, we'll reverse later)
    allMessages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))

    // Find the most recent incoming message (top-level or thread reply, not from me)
    const lastIncoming = allMessages.filter(m => m.user !== USER_ID).pop()
    if (!lastIncoming) continue
    const lastIncomingTs = parseFloat(lastIncoming.ts)
    // Check if I replied after the most recent incoming message (anywhere)
    const replied = allMessages.some(m => m.user === USER_ID && parseFloat(m.ts) > lastIncomingTs)
    if (!replied) {
      const context = []
      for (const m of allMessages) {
        const who = m.user === USER_ID ? 'me' : (m.username || await resolveUser(m.user))
        const prefix = m.isThread ? '↳ ' : ''
        context.push({ who, text: prefix + await cleanMentions(m.text), ts: m.ts })
      }
      unreplied.push({ person: info.sender, count: 1, lastMsg: (lastIncoming.text || '').slice(0, 120), chId, context })
    }
  }

  return unreplied
}

// --- @mentions ---

export async function scanMentions(since) {
  if (!SLACK_SEARCH_TOKEN) return []
  const sinceDate = new Date((since - 86400) * 1000).toISOString().split('T')[0]
  const r = await slack('search.messages', {
    query: `<@${USER_ID}> after:${sinceDate}`,
    sort: 'timestamp', sort_dir: 'desc', count: 50,
  }, { useSearch: true })

  if (!r.ok) return []

  // Pre-filter candidates
  const candidates = []
  for (const m of (r.messages?.matches || [])) {
    const ts = parseFloat(m.ts)
    if (ts < since) continue
    const sender = m.username || 'unknown'
    if (BOT_SENDERS.has(sender) || sender === 'mwickenburg') continue
    const chId = m.channel?.id
    if (!chId) continue
    candidates.push(m)
  }

  // Dedupe by thread (channel+threadTs) — keep one mention per thread
  // Note: skip conversations.replies verification — thread_ts from search is good enough
  // for dedup, and the verification was adding 30-40s of serial API calls
  const seen = new Set()
  const mentions = []
  for (const m of candidates) {
    const chId = m.channel.id
    const chName = m.channel?.name || '?'
    const threadTs = m.thread_ts || m.ts
    const key = `${chId}:${threadTs}`
    if (seen.has(key)) continue
    seen.add(key)
    mentions.push({
      sender: m.username || 'unknown',
      channel: chName.startsWith('U') ? 'DM' : `#${chName}`,
      channelName: chName,
      text: await cleanMentions((m.text || '').slice(0, 120)),
      chId,
      threadTs,
      isThread: threadTs !== m.ts,
    })
  }

  // Fetch thread context for each mention (up to 5)
  for (const mention of mentions.slice(0, 5)) {
    const context = []
    if (mention.isThread) {
      const replies = await slack('conversations.replies', { channel: mention.chId, ts: mention.threadTs, limit: 10 })
      if (replies.ok) {
        for (const r of (replies.messages || []).slice(-5)) {
          const who = r.user === USER_ID ? 'me' : await resolveUser(r.user)
          context.push({ who, text: await cleanMentions((r.text || '').slice(0, 200)), ts: r.ts })
        }
      }
    } else {
      // Top-level message — fetch surrounding channel context
      const h = await slack('conversations.history', { channel: mention.chId, latest: String(parseFloat(mention.threadTs) + 1), limit: 5 })
      if (h.ok) {
        for (const msg of (h.messages || []).reverse()) {
          if (msg.subtype) continue
          const who = msg.user === USER_ID ? 'me' : await resolveUser(msg.user)
          context.push({ who, text: await cleanMentions((msg.text || '').slice(0, 200)), ts: msg.ts })
        }
      }
    }
    mention.context = context
  }

  return mentions
}

// --- #crashes-v2 ---

export async function scanCrashes(since) {
  const r = await slack('conversations.history', { channel: CRASHES_CHANNEL, oldest: String(since), limit: 100 }, { useSearch: true })
  if (!r.ok) return { total: 0, tagged: 0, taggedMsgs: [] }

  const msgs = r.messages || []
  const taggedMsgs = []

  for (const m of msgs) {
    const haystack = (m.text || '') + JSON.stringify(m.blocks || []) + JSON.stringify(m.attachments || [])
    if (!haystack.includes(USER_ID)) continue
    const author = await resolveUser(m.user)
    const blockText = extractBlockText(m.blocks)
    taggedMsgs.push({
      author,
      text: (m.text || '').slice(0, 120),
      blockText,
      ts: parseFloat(m.ts),
    })
  }

  taggedMsgs.sort((a, b) => a.ts - b.ts)
  return { total: msgs.length, tagged: taggedMsgs.length, taggedMsgs }
}

// --- Thread activity scanner ---
// Discovery: search active channels for threads I'm in -> tracked set (runs every 5 min)
// Monitoring: Socket Mode handles public threads in real-time; only private threads are polled.

const DISCOVERY_INTERVAL = 5 * 60 * 1000 // 5 min between discovery runs
let lastDiscoveryTime = 0
const THREAD_STALE_DAYS = 7
const trackedThreads = new Map()
// Channels where bot join failed (private channels) — checked once per channel
const privateChanIds = new Set()
const publicChanIds = new Set()

/** Check if a channel is public via conversations.info. Caches result. */
async function isChannelPublic(chId) {
  if (publicChanIds.has(chId)) return true
  if (privateChanIds.has(chId)) return false
  if (chId.startsWith('D') || chId.startsWith('G')) {
    privateChanIds.add(chId)
    return false
  }
  try {
    const result = await slack('conversations.info', { channel: chId })
    if (result.ok && result.channel) {
      const isPublic = result.channel.is_channel && !result.channel.is_private
      ;(isPublic ? publicChanIds : privateChanIds).add(chId)
      return isPublic
    }
    privateChanIds.add(chId)
    return false
  } catch {
    privateChanIds.add(chId)
    return false
  }
}

/**
 * Discover threads I participated in via search API.
 * Extracts thread_ts from permalink — 1 API call instead of ~120.
 */
async function discoverThreads() {
  const searchDate = new Date(Date.now() - THREAD_STALE_DAYS * 86400 * 1000).toISOString().split('T')[0]
  const r = await slack('search.messages', {
    query: `from:me -is:dm after:${searchDate}`,
    sort: 'timestamp', sort_dir: 'desc', count: 100,
  }, { useSearch: true })
  if (!r.ok) return

  // Extract unique threads from permalink's thread_ts param
  const newThreads = new Map()
  for (const m of (r.messages?.matches || [])) {
    const chId = m.channel?.id
    const chName = m.channel?.name
    if (!chId || chId.startsWith('D')) continue
    if (chId === CRASHES_CHANNEL || chId === INCIDENTS_CHANNEL) continue
    const threadMatch = m.permalink?.match(/thread_ts=([0-9.]+)/)
    if (!threadMatch) continue // top-level message, not in a thread
    const threadTs = threadMatch[1]
    const key = `${chId}:${threadTs}`
    if (!trackedThreads.has(key) && !newThreads.has(key)) {
      newThreads.set(key, { chId, chName, threadTs })
    }
  }

  // Resolve public/private for new threads (parallel, batched)
  const entries = [...newThreads.entries()]
  const batchSize = 5
  for (let i = 0; i < entries.length; i += batchSize) {
    await Promise.all(entries.slice(i, i + batchSize).map(async ([key, { chId, chName, threadTs }]) => {
      const isPublic = await isChannelPublic(chId)
      trackedThreads.set(key, { channelId: chId, channelName: chName, threadTs, lastActivity: Date.now() / 1000, isPublic })
    }))
  }

  lastDiscoveryTime = Date.now()
  const pub = [...trackedThreads.values()].filter(t => t.isPublic).length
  console.log(`[thread-monitor] Discovery: ${trackedThreads.size} tracked (${pub} socket, ${trackedThreads.size - pub} polled)`)
}

export async function scanThreadActivity(since) {
  // Throttle discovery — only run every 5 min
  if (!lastDiscoveryTime || Date.now() - lastDiscoveryTime > DISCOVERY_INTERVAL) {
    await discoverThreads(since)
  }

  const staleThreshold = Date.now() / 1000 - THREAD_STALE_DAYS * 86400
  for (const [key, t] of trackedThreads) {
    if (t.lastActivity < staleThreshold) trackedThreads.delete(key)
  }

  // Only poll private threads + public threads with pending Socket Mode notifications
  const results = []
  for (const [key, t] of trackedThreads) {
    if (t.isPublic && !t.needsPoll) continue // Socket Mode watches these; skip unless notified
    if (t.needsPoll) t.needsPoll = false

    const replies = await slack('conversations.replies', { channel: t.channelId, ts: t.threadTs, limit: 50 })
    if (!replies.ok) continue

    const msgs = replies.messages || []
    if (msgs.length > 0) {
      t.lastActivity = parseFloat(msgs[msgs.length - 1].ts)
    }

    const newReplies = msgs.filter(r =>
      parseFloat(r.ts) > since && r.user !== USER_ID
    )

    // Check if I have any new replies in this thread (for watch state updates)
    const myNewReplies = msgs.filter(r =>
      parseFloat(r.ts) > since && r.user === USER_ID
    )

    if (newReplies.length === 0 && myNewReplies.length === 0) continue

    // Build context for both pulse items and watch state
    const context = []
    for (const r of msgs.slice(-10)) {
      const who = r.user === USER_ID ? 'me' : await resolveUser(r.user)
      context.push({ who, text: await cleanMentions((r.text || '').slice(0, 200)), ts: r.ts })
    }

    // Skip from pulse if I already replied after the last message from someone else
    const lastOtherTs = newReplies.length > 0 ? parseFloat(newReplies[newReplies.length - 1].ts) : 0
    const myReplyAfter = lastOtherTs > 0 && msgs.some(r => r.user === USER_ID && parseFloat(r.ts) > lastOtherTs)

    const latest = newReplies.length > 0 ? newReplies[newReplies.length - 1] : null
    const latestName = latest ? await resolveUser(latest.user) : null
    results.push({
      channel: t.channelName,
      from: latestName,
      text: latest ? (latest.text || '').slice(0, 80) : '',
      parentText: (msgs[0]?.text || '').slice(0, 60),
      ts: latest ? parseFloat(latest.ts) : 0,
      threadKey: key,
      context,
      myReplyHandled: myReplyAfter || newReplies.length === 0,
    })
  }

  return results
}

/**
 * Get public tracked thread refs for Socket Mode watch list.
 * Returns array of "channelId/threadTs" strings.
 */
export function getTrackedPublicThreadRefs() {
  const refs = []
  for (const [, t] of trackedThreads) {
    if (t.isPublic) refs.push(`${t.channelId}/${t.threadTs}`)
  }
  return refs
}

/**
 * Notify that a public tracked thread received a new message (from Socket Mode).
 * Marks the thread for a one-time poll on the next scan cycle to build context.
 */
export function notifyThreadActivity(channelId, threadTs) {
  const key = `${channelId}:${threadTs}`
  const t = trackedThreads.get(key)
  if (t) {
    t.needsPoll = true
    t.lastActivity = Date.now() / 1000
  }
}

/**
 * Fast-track: immediately add a thread to tracking when user sends a reply.
 */
export async function trackThread(channelId, threadTs, channelName) {
  const key = `${channelId}:${threadTs}`
  if (trackedThreads.has(key)) return
  const isPublic = await isChannelPublic(channelId)
  trackedThreads.set(key, {
    channelId,
    channelName: channelName || channelId,
    threadTs,
    lastActivity: Date.now() / 1000,
    isPublic,
  })
}

// --- Incidents ---

const joinedIncidentChannels = new Set()

export async function scanNewIncidents(since) {
  const r = await slack('conversations.history', { channel: INCIDENTS_CHANNEL, oldest: String(since), limit: 50 }, { useSearch: true })
  if (!r.ok) return []

  const incidentMap = new Map()
  for (const m of (r.messages || [])) {
    const text = m.text || ''
    const blockText = extractBlockText(m.blocks)

    const newMatch = text.match(/New Incident:\s*#(\d+)\s+(.+)/)
    const stateMatch = text.match(/Incident #(\d+)\s+.*?State set to (\w+)/)
    if (!newMatch && !stateMatch) continue

    const num = newMatch ? newMatch[1] : stateMatch[1]
    const state = newMatch ? 'New' : stateMatch[2]
    const title = newMatch ? newMatch[2].trim() : ''
    const ts = parseFloat(m.ts)

    const chMatch = blockText.match(/<#(C[A-Z0-9]+)\|?([^>]*)>/)
    const incidentChannelId = chMatch ? chMatch[1] : null

    const existing = incidentMap.get(num)
    if (!existing || ts > existing.ts) {
      const existingTitle = existing?.title || ''
      const titleFromBlock = blockText.match(/#\d+:\s*([^>*\n]+)/)
      incidentMap.set(num, {
        num, state,
        title: title || (titleFromBlock ? titleFromBlock[1].trim() : existingTitle),
        ts, incidentChannelId: incidentChannelId || existing?.incidentChannelId,
      })
    }
  }

  for (const inc of incidentMap.values()) {
    if (inc.incidentChannelId && !joinedIncidentChannels.has(inc.incidentChannelId)) {
      try {
        await slack('conversations.join', { channel: inc.incidentChannelId }, { useSearch: true })
        joinedIncidentChannels.add(inc.incidentChannelId)
        console.log(`[slack-digest] Auto-joined incident channel #${inc.num}: ${inc.incidentChannelId}`)
      } catch {}
    }
  }

  return [...incidentMap.values()].filter(i => i.state !== 'Resolved' && !/stable|mitigated/i.test(i.state))
}

export async function readIncidentChannelMessages(incidents) {
  const results = []
  for (const inc of incidents) {
    if (!inc.incidentChannelId) continue

    const h = await slack('conversations.history', { channel: inc.incidentChannelId, limit: 15 })
    if (!h.ok || !h.messages?.length) continue

    const lines = []
    for (const m of (h.messages || []).reverse()) {
      if (m.subtype === 'channel_join') continue
      const name = await resolveUser(m.user || m.bot_id)
      const text = (m.text || extractBlockText(m.blocks)).slice(0, 150)
      if (text) lines.push(`${name}: ${text}`)
    }
    if (lines.length === 0) continue

    const fingerprint = (h.messages || []).map(m => m.ts).join(',')
    results.push({ num: inc.num, title: inc.title, state: inc.state, lines, fingerprint })
  }
  return results
}
