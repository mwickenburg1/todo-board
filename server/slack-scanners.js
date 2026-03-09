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
    const sender = m.username || 'unknown'
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
      if (m.subtype) continue
      allMessages.push({ user: m.user, text: m.text || '', ts: m.ts, isThread: false })
      // Insert thread replies right after their parent
      const replies = threadReplies.get(m.ts)
      if (replies) {
        for (const r of replies) {
          allMessages.push({ user: r.user, text: r.text || '', ts: r.ts, isThread: true, parentTs: m.ts })
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
        const who = m.user === USER_ID ? 'me' : await resolveUser(m.user)
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

  // Dedupe by thread (channel+threadTs) — keep one mention per thread
  const seen = new Set()
  const mentions = []
  for (const m of (r.messages?.matches || [])) {
    const ts = parseFloat(m.ts)
    if (ts < since) continue
    const sender = m.username || 'unknown'
    if (BOT_SENDERS.has(sender) || sender === 'mwickenburg') continue
    const chId = m.channel?.id
    if (!chId) continue
    const chName = m.channel?.name || '?'
    // Thread ts if in a thread, else the message's own ts
    const threadTs = m.thread_ts || m.ts
    const key = `${chId}:${threadTs}`
    if (seen.has(key)) continue
    seen.add(key)
    mentions.push({
      sender,
      channel: chName.startsWith('U') ? 'DM' : `#${chName}`,
      channelName: chName,
      text: await cleanMentions((m.text || '').slice(0, 120)),
      chId,
      threadTs,
      isThread: !!m.thread_ts,
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
// Discovery: search active channels for threads I'm in -> tracked set
// Monitoring: check tracked threads directly via conversations.replies

let activeChannelsCache = null
let activeChannelsCacheTime = 0
const CHANNEL_CACHE_TTL = 30 * 60 * 1000
const THREAD_STALE_DAYS = 7
const trackedThreads = new Map()

async function getActiveChannels() {
  if (activeChannelsCache && Date.now() - activeChannelsCacheTime < CHANNEL_CACHE_TTL) {
    return activeChannelsCache
  }
  const searchDate = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split('T')[0]
  const r = await slack('search.messages', {
    query: `from:me -is:dm after:${searchDate}`,
    sort: 'timestamp', sort_dir: 'desc', count: 100,
  }, { useSearch: true })
  if (!r.ok) return activeChannelsCache || new Map()

  const channels = new Map()
  for (const m of (r.messages?.matches || [])) {
    if (m.channel?.id && !channels.has(m.channel.id)) {
      channels.set(m.channel.id, m.channel.name)
    }
  }
  activeChannelsCache = channels
  activeChannelsCacheTime = Date.now()
  return channels
}

async function discoverThreads(since) {
  const channels = await getActiveChannels()

  for (const [chId, chName] of channels) {
    if (chId === CRASHES_CHANNEL || chId === INCIDENTS_CHANNEL) continue

    const h = await slack('conversations.history', { channel: chId, limit: 20 })
    if (!h.ok) continue

    for (const m of (h.messages || [])) {
      if (!m.reply_count || m.reply_count === 0) continue
      const latestReply = parseFloat(m.latest_reply || '0')
      if (latestReply < since) continue
      const key = `${chId}:${m.ts}`
      if (trackedThreads.has(key)) continue

      const replies = await slack('conversations.replies', { channel: chId, ts: m.ts, limit: 50 })
      if (!replies.ok) continue

      const participants = new Set(replies.messages?.map(r => r.user))
      if (!participants.has(USER_ID)) continue

      trackedThreads.set(key, { channelId: chId, channelName: chName, threadTs: m.ts, lastActivity: latestReply })
    }
  }
}

export async function scanThreadActivity(since) {
  await discoverThreads(since)

  const staleThreshold = Date.now() / 1000 - THREAD_STALE_DAYS * 86400
  for (const [key, t] of trackedThreads) {
    if (t.lastActivity < staleThreshold) trackedThreads.delete(key)
  }

  const results = []
  for (const [key, t] of trackedThreads) {
    const replies = await slack('conversations.replies', { channel: t.channelId, ts: t.threadTs, limit: 50 })
    if (!replies.ok) continue

    const msgs = replies.messages || []
    if (msgs.length > 0) {
      t.lastActivity = parseFloat(msgs[msgs.length - 1].ts)
    }

    const newReplies = msgs.filter(r =>
      parseFloat(r.ts) > since && r.user !== USER_ID
    )
    if (newReplies.length === 0) continue

    // Skip if I already replied after the last message from someone else
    const lastOtherTs = parseFloat(newReplies[newReplies.length - 1].ts)
    const myReplyAfter = msgs.some(r => r.user === USER_ID && parseFloat(r.ts) > lastOtherTs)
    if (myReplyAfter) continue

    const context = []
    for (const r of msgs.slice(-10)) {
      const who = r.user === USER_ID ? 'me' : await resolveUser(r.user)
      context.push({ who, text: await cleanMentions((r.text || '').slice(0, 200)), ts: r.ts })
    }

    const latest = newReplies[newReplies.length - 1]
    const latestName = await resolveUser(latest.user)
    results.push({
      channel: t.channelName,
      from: latestName,
      text: (latest.text || '').slice(0, 80),
      parentText: (msgs[0]?.text || '').slice(0, 60),
      ts: parseFloat(latest.ts),
      threadKey: key,
      context,
    })
  }

  return results
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

  return [...incidentMap.values()].filter(i => i.state !== 'Resolved')
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
    results.push({ num: inc.num, title: inc.title, lines, fingerprint })
  }
  return results
}
