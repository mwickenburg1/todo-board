/**
 * Slack URL parsing and thread context extraction.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { slack, resolveUser, USER_ID } from './slack-api.js'
import { callSonnet } from './slack-llm.js'

// --- Read cursor persistence ---
// Tracks lastReadTs per thread ref (channel/ts) so we can show unread indicators.
const CURSOR_PATH = resolve(process.env.HOME, 'todos-repo', '.slack-read-cursors.json')
let readCursors = {}

try {
  readCursors = JSON.parse(readFileSync(CURSOR_PATH, 'utf8'))
} catch {}

function persistCursors() {
  writeFileSync(CURSOR_PATH, JSON.stringify(readCursors))
}

export function getReadCursor(ref) {
  return readCursors[ref]?.readTs || null
}

export function setReadCursor(ref, ts) {
  if (!readCursors[ref]) readCursors[ref] = {}
  readCursors[ref].readTs = ts
  persistCursors()
}

export function setLatestTs(ref, ts) {
  if (!readCursors[ref]) readCursors[ref] = {}
  readCursors[ref].latestTs = ts
  persistCursors()
}

export function getAllReadCursors() {
  return { ...readCursors }
}

/**
 * Check if a thread ref has unread messages.
 */
export function hasUnread(ref) {
  const entry = readCursors[ref]
  if (!entry || !entry.latestTs) return false
  if (!entry.readTs) return true
  return parseFloat(entry.latestTs) > parseFloat(entry.readTs)
}

/**
 * Get unread count for refs linked to a task.
 * Returns total unread threads count.
 */
export function countUnreadThreads(refs) {
  return refs.filter(ref => hasUnread(ref)).length
}

/**
 * Parse a Slack archive URL into channel + ts.
 * Formats:
 *   https://<workspace>.slack.com/archives/<channel>/p<ts_digits>
 *   https://<workspace>.slack.com/archives/<channel>/p<ts_digits>?thread_ts=<ts>
 *
 * Returns { channel, ts } or null.
 */
export function parseSlackUrl(url) {
  if (!url) return null
  const match = url.match(/^https:\/\/[^/]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/)
  if (!match) return null

  const channel = match[1]
  const pDigits = match[2]

  // Check for ?thread_ts= query param — use that as the canonical ts
  const threadTsMatch = url.match(/[?&]thread_ts=([0-9.]+)/)
  if (threadTsMatch) {
    return { channel, ts: threadTsMatch[1] }
  }

  // Convert p-value to Slack ts format: first 10 digits = seconds, rest = microseconds
  const seconds = pDigits.slice(0, 10)
  const micros = pDigits.slice(10).padEnd(6, '0')
  return { channel, ts: `${seconds}.${micros}` }
}

/**
 * Extract thread context from Slack given channel + ts.
 * Fetches the thread, resolves user names, and generates an LLM summary.
 *
 * Returns { channel, ts, channelName, messageCount, participants, summary, threadPreview }
 */
export async function extractThreadContext(channel, ts) {
  // Fetch thread messages
  const threadRes = await slack('conversations.replies', { channel, ts, limit: 50 })
  if (!threadRes.ok) {
    throw new Error(`Failed to fetch thread: ${threadRes.error}`)
  }

  const messages = threadRes.messages || []

  // Fetch channel name
  let channelName = channel
  try {
    const chanRes = await slack('conversations.info', { channel })
    if (chanRes.ok) channelName = chanRes.channel.name
  } catch {}

  // Resolve unique users
  const userIds = [...new Set(messages.map(m => m.user).filter(Boolean))]
  const nameMap = {}
  await Promise.all(userIds.map(async uid => {
    nameMap[uid] = await resolveUser(uid)
  }))

  const participants = [...new Set(Object.values(nameMap))]

  // Build transcript for LLM
  const transcript = messages
    .map(m => `${nameMap[m.user] || 'unknown'}: ${(m.text || '').slice(0, 300)}`)
    .join('\n')

  const prompt = `Summarize this Slack thread in one sentence (max 15 words) as a task title. No markdown, no quotes.\n\n${transcript}`
  const llmSummary = await callSonnet(prompt)

  // Fallback to first message text if LLM fails
  const summary = llmSummary || (messages[0]?.text || '').slice(0, 100)

  // Thread preview: first message truncated
  const threadPreview = (messages[0]?.text || '').slice(0, 200)

  return {
    channel,
    ts,
    channelName,
    messageCount: messages.length,
    participants,
    summary,
    threadPreview,
  }
}

/**
 * Resolve <@USERID> mentions in text to display names.
 * Collects all mentioned IDs, resolves any not already in nameMap, then replaces.
 */
async function resolveMentions(text, nameMap) {
  const mentionRe = /<@(U[A-Z0-9]+)>/g
  const ids = new Set()
  let match
  while ((match = mentionRe.exec(text)) !== null) {
    ids.add(match[1])
  }
  // Resolve any IDs not already in nameMap
  await Promise.all([...ids].filter(id => !nameMap[id]).map(async id => {
    nameMap[id] = await resolveUser(id)
  }))
  return text.replace(/<@(U[A-Z0-9]+)>/g, (_, id) => `**@${nameMap[id] || id}**`)
}

/**
 * Fetch thread messages (no LLM). Returns array of { who, text, ts }.
 */
export async function fetchThreadMessages(channel, ts) {
  const threadRes = await slack('conversations.replies', { channel, ts, limit: 50 })
  if (!threadRes.ok) {
    throw new Error(`Failed to fetch thread: ${threadRes.error}`)
  }

  const messages = threadRes.messages || []
  const userIds = [...new Set(messages.map(m => m.user).filter(Boolean))]
  const nameMap = {}
  await Promise.all(userIds.map(async uid => {
    nameMap[uid] = await resolveUser(uid)
  }))

  // Fetch channel name
  let channelName = channel
  try {
    const chanRes = await slack('conversations.info', { channel })
    if (chanRes.ok) channelName = chanRes.channel.name
  } catch {}

  const ref = `${channel}/${ts}`
  const cursor = getReadCursor(ref)
  const mapped = await Promise.all(messages.map(async m => ({
    who: nameMap[m.user] || 'unknown',
    isMe: m.user === USER_ID,
    text: await resolveMentions((m.text || '').slice(0, 500), nameMap),
    ts: m.ts,
    isUnread: cursor ? parseFloat(m.ts) > parseFloat(cursor) : false,
  })))
  const unreadCount = mapped.filter(m => m.isUnread).length
  const latestTs = messages.length > 0 ? messages[messages.length - 1].ts : null

  // Persist latest known ts so the focus queue can detect unreads without calling Slack
  if (latestTs) setLatestTs(ref, latestTs)

  return {
    channelName,
    messages: mapped,
    unreadCount,
    latestTs,
  }
}

/**
 * Fetch recent channel messages (for DMs where there's no thread ts).
 */
export async function fetchChannelMessages(channel) {
  const histRes = await slack('conversations.history', { channel, limit: 20 })
  if (!histRes.ok) {
    throw new Error(`Failed to fetch channel history: ${histRes.error}`)
  }

  const messages = (histRes.messages || []).filter(m => !m.subtype).reverse()
  const userIds = [...new Set(messages.map(m => m.user).filter(Boolean))]
  const nameMap = {}
  await Promise.all(userIds.map(async uid => {
    nameMap[uid] = await resolveUser(uid)
  }))

  let channelName = channel
  try {
    const chanRes = await slack('conversations.info', { channel })
    if (chanRes.ok) channelName = chanRes.channel.name
  } catch {}

  const ref = channel
  const cursor = getReadCursor(ref)
  const mapped = await Promise.all(messages.map(async m => ({
    who: nameMap[m.user] || 'unknown',
    isMe: m.user === USER_ID,
    text: await resolveMentions((m.text || '').slice(0, 500), nameMap),
    ts: m.ts,
    isUnread: cursor ? parseFloat(m.ts) > parseFloat(cursor) : false,
    replyCount: m.reply_count || 0,
    threadTs: m.thread_ts || null,
    latestReplyTs: m.latest_reply || null,
  })))
  const unreadCount = mapped.filter(m => m.isUnread).length
  const latestTs = messages.length > 0 ? messages[messages.length - 1].ts : null

  if (latestTs) setLatestTs(ref, latestTs)

  return {
    channelName,
    messages: mapped,
    unreadCount,
    latestTs,
  }
}

/**
 * Fetch thread replies within a DM channel. Same as fetchThreadMessages but for
 * threads that exist inside a DM conversation (not a channel thread).
 */
export async function fetchDMThreadReplies(channel, threadTs) {
  const threadRes = await slack('conversations.replies', { channel, ts: threadTs, limit: 50 })
  if (!threadRes.ok) {
    throw new Error(`Failed to fetch DM thread: ${threadRes.error}`)
  }

  const messages = threadRes.messages || []
  // Skip the parent message (index 0) — only return replies
  const replies = messages.slice(1)
  if (replies.length === 0) return { messages: [] }

  const userIds = [...new Set(replies.map(m => m.user).filter(Boolean))]
  const nameMap = {}
  await Promise.all(userIds.map(async uid => {
    nameMap[uid] = await resolveUser(uid)
  }))

  const mapped = await Promise.all(replies.map(async m => ({
    who: nameMap[m.user] || 'unknown',
    isMe: m.user === USER_ID,
    text: await resolveMentions((m.text || '').slice(0, 500), nameMap),
    ts: m.ts,
  })))

  return { messages: mapped }
}
