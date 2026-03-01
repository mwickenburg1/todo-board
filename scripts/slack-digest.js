#!/usr/bin/env node
/**
 * Slack Morning Digest
 *
 * Scans DMs, @mentions, and #crashes-v2 from the last N hours.
 * Pushes a single digest item to the todo board's pulse list.
 *
 * If nothing needs attention → "Slack: nothing to worry about"
 * If items need attention    → "Slack: 3 unreplied DMs, 1 incident channel"
 *
 * Usage:
 *   node scripts/slack-digest.js                   # one-shot, last 12h
 *   node scripts/slack-digest.js --watch           # refresh every 5m
 *   node scripts/slack-digest.js --watch --interval 3  # refresh every 3m
 *   node scripts/slack-digest.js --hours 8         # custom lookback window
 *   node scripts/slack-digest.js --dry-run         # print only, don't push to board
 *
 * Env vars (from ../.env):
 *   SLACK_USER_TOKEN    — xoxp-... token for conversation history
 *   SLACK_SEARCH_TOKEN  — xoxp-... token with search:read scope (for @mentions)
 *   TODO_API_URL        — default http://localhost:5181
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env
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

const SLACK_TOKEN = process.env.SLACK_USER_TOKEN
const SLACK_SEARCH_TOKEN = process.env.SLACK_SEARCH_TOKEN || SLACK_TOKEN
const TODO_API = process.env.TODO_API_URL || 'http://localhost:5181'
const USER_ID = 'U02BMLFJJ64'
const CRASHES_CHANNEL = 'C09TBCMEPPA' // #crashes-v2

// Bot usernames to ignore in @mentions
const BOT_SENDERS = new Set(['triage buddy', 'support-router', 'Datadog', 'Triage Buddy'])

// Parse args
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const watch = args.includes('--watch')
const hoursIdx = args.indexOf('--hours')
const hours = hoursIdx !== -1 ? parseInt(args[hoursIdx + 1], 10) : 12
const intervalIdx = args.indexOf('--interval')
const intervalMin = intervalIdx !== -1 ? parseInt(args[intervalIdx + 1], 10) : 5

if (!SLACK_TOKEN) {
  console.error('Missing SLACK_USER_TOKEN')
  process.exit(1)
}

// --- Slack API helpers ---

async function slack(method, params = {}, { useSearch = false } = {}) {
  const token = useSearch ? SLACK_SEARCH_TOKEN : SLACK_TOKEN
  const url = new URL(`https://slack.com/api/${method}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  return res.json()
}

const userCache = {}
async function resolveUser(uid) {
  if (!uid) return 'unknown'
  if (userCache[uid]) return userCache[uid]
  try {
    const r = await slack('users.info', { user: uid })
    if (r.ok) {
      const name = r.user.profile?.display_name || r.user.real_name || uid
      userCache[uid] = name
      return name
    }
  } catch {}
  userCache[uid] = uid
  return uid
}

function toEST(ts) {
  return new Date(ts * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
}

// --- Scanners ---

async function scanUnrepliedDMs(since) {
  // Get all IM conversations
  const convos = []
  let cursor = ''
  do {
    const r = await slack('users.conversations', { types: 'im', limit: 200, ...(cursor ? { cursor } : {}) })
    if (!r.ok) break
    convos.push(...(r.channels || []))
    cursor = r.response_metadata?.next_cursor || ''
  } while (cursor)

  const unreplied = []

  for (const im of convos) {
    const r = await slack('conversations.history', { channel: im.id, oldest: String(since), limit: 20 })
    if (!r.ok) continue

    const msgs = (r.messages || []).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))
    if (msgs.length === 0) continue

    // Filter to messages from the other person
    const incoming = msgs.filter(m => m.user !== USER_ID && m.user !== 'USLACKBOT' && !m.subtype)
    if (incoming.length === 0) continue

    // Check if you replied AFTER the last incoming message
    const lastIncoming = incoming[incoming.length - 1]
    const lastIncomingTs = parseFloat(lastIncoming.ts)
    const yourRepliesAfter = msgs.filter(m => m.user === USER_ID && parseFloat(m.ts) > lastIncomingTs)

    if (yourRepliesAfter.length === 0) {
      const person = await resolveUser(im.user)
      unreplied.push({
        person,
        count: incoming.length,
        lastMsg: (lastIncoming.text || '').slice(0, 120),
        time: toEST(parseFloat(lastIncoming.ts)),
      })
    }

    // Small delay to stay under rate limits
    await new Promise(r => setTimeout(r, 300))
  }

  return unreplied
}

async function scanMentions(since) {
  // Use search API to find @mentions
  const sinceDate = new Date(since * 1000).toISOString().split('T')[0]
  const r = await slack('search.messages', {
    query: `<@${USER_ID}> after:${sinceDate}`,
    sort: 'timestamp',
    sort_dir: 'desc',
    count: 50,
  }, { useSearch: true })

  if (!r.ok) return []

  const mentions = []
  for (const m of (r.messages?.matches || [])) {
    const ts = parseFloat(m.ts)
    if (ts < since) continue

    const sender = m.username || 'unknown'
    if (BOT_SENDERS.has(sender)) continue
    if (sender === 'mwickenburg') continue // self-mentions (link shares)

    const chName = m.channel?.name || '?'
    mentions.push({
      sender,
      channel: chName.startsWith('U') ? `DM` : `#${chName}`,
      text: (m.text || '').slice(0, 120),
      time: toEST(ts),
    })
  }

  return mentions
}

async function scanCrashes(since) {
  const r = await slack('conversations.history', { channel: CRASHES_CHANNEL, oldest: String(since), limit: 100 })
  if (!r.ok) return { total: 0, humans: 0, incidents: [], humanMsgs: [] }

  const msgs = r.messages || []
  const humanMsgs = []
  const incidentChannels = new Set()

  for (const m of msgs) {
    const text = m.text || ''
    // Check for incident channel creation mentions
    const incMatch = text.match(/incident-\d+/g)
    if (incMatch) incMatch.forEach(i => incidentChannels.add(i))

    // Is this a human message (not bot)?
    if (m.user && !m.bot_id && m.subtype !== 'bot_message') {
      const author = await resolveUser(m.user)
      if (!BOT_SENDERS.has(author)) {
        humanMsgs.push({
          author,
          text: text.slice(0, 120),
          time: toEST(parseFloat(m.ts)),
        })
      }
    }
  }

  return {
    total: msgs.length,
    humans: humanMsgs.length,
    incidents: [...incidentChannels],
    humanMsgs: humanMsgs.slice(0, 5),
  }
}

async function scanNewIncidentChannels(since) {
  // Search for recently created incident channels
  const r = await slack('search.messages', {
    query: `in:engineering "incident channel created" after:${new Date(since * 1000).toISOString().split('T')[0]}`,
    sort: 'timestamp',
    sort_dir: 'desc',
    count: 10,
  }, { useSearch: true })

  if (!r.ok) return []

  const channels = []
  for (const m of (r.messages?.matches || [])) {
    const text = m.text || ''
    const match = text.match(/incident-\d+-[^\s>|]+/)
    if (match) channels.push(match[0])
  }
  return [...new Set(channels)]
}

// --- Main ---

async function run() {
  const since = Math.floor(Date.now() / 1000) - hours * 3600
  const sinceEST = toEST(since)
  console.log(`Scanning last ${hours}h (since ${sinceEST} EST)...\n`)

  const [unrepliedDMs, mentions, crashes, newIncidents] = await Promise.all([
    scanUnrepliedDMs(since),
    scanMentions(since),
    scanCrashes(since),
    scanNewIncidentChannels(since),
  ])

  // --- Build digest ---
  const issues = []
  const details = []

  // Unreplied DMs
  if (unrepliedDMs.length > 0) {
    issues.push(`${unrepliedDMs.length} unreplied DM${unrepliedDMs.length > 1 ? 's' : ''}`)
    for (const dm of unrepliedDMs) {
      details.push(`  DM: ${dm.person} (${dm.count} msg${dm.count > 1 ? 's' : ''}, ${dm.time}) — "${dm.lastMsg}"`)
    }
  }

  // Human @mentions
  if (mentions.length > 0) {
    issues.push(`${mentions.length} @mention${mentions.length > 1 ? 's' : ''}`)
    for (const m of mentions.slice(0, 5)) {
      details.push(`  @mention: ${m.sender} in ${m.channel} (${m.time}) — "${m.text.slice(0, 80)}"`)
    }
    if (mentions.length > 5) details.push(`  ... +${mentions.length - 5} more`)
  }

  // New incident channels
  if (newIncidents.length > 0) {
    issues.push(`${newIncidents.length} new incident${newIncidents.length > 1 ? 's' : ''}`)
    for (const inc of newIncidents) details.push(`  Incident: #${inc}`)
  }

  // Human messages in crashes-v2
  if (crashes.humans > 0) {
    issues.push(`${crashes.humans} human msg${crashes.humans > 1 ? 's' : ''} in #crashes-v2`)
    for (const m of crashes.humanMsgs) {
      details.push(`  crashes-v2: ${m.author} (${m.time}) — "${m.text.slice(0, 80)}"`)
    }
  }

  // --- Output ---
  let digestText
  let isClean

  if (issues.length === 0) {
    digestText = `Slack ${hours}h: nothing to worry about`
    isClean = true
    console.log('✓ Nothing to worry about\n')
    console.log(`  DMs: all replied`)
    console.log(`  @mentions: none (from humans)`)
    console.log(`  #crashes-v2: ${crashes.total} bot alerts, 0 human messages`)
    console.log(`  Incidents: none new`)
  } else {
    digestText = `Slack: ${issues.join(', ')}`
    isClean = false
    console.log(`⚠ ${digestText}\n`)
    for (const d of details) console.log(d)
  }

  // --- Push to todo board pulse ---
  if (!dryRun) {
    try {
      // Remove any existing slack digest items from pulse
      const boardRes = await fetch(`${TODO_API}/api/todos`)
      const board = await boardRes.json()
      const pulse = board.lists?.pulse || []
      const existing = pulse.filter(t => t.text?.startsWith('Slack'))
      for (const item of existing) {
        await fetch(`${TODO_API}/api/todos/${item.id}`, { method: 'DELETE' })
      }

      // Add new digest item
      const captureRes = await fetch(`${TODO_API}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: digestText,
          horizon: 'pulse',
          status: 'pending',
        }),
      })
      const result = await captureRes.json()
      if (result.success) {
        console.log(`\n→ Pushed to pulse: "${digestText}"`)
      } else {
        console.error(`\n→ Failed to push:`, result)
      }
    } catch (err) {
      console.error(`\n→ Board push failed:`, err.message)
    }
  } else {
    console.log(`\n[dry-run] Would push to pulse: "${digestText}"`)
  }
}

async function main() {
  await run()

  if (watch) {
    console.log(`\n[watch] Refreshing every ${intervalMin}m (Ctrl+C to stop)`)
    setInterval(async () => {
      try {
        await run()
      } catch (err) {
        console.error(`[watch] Error:`, err.message)
      }
    }, intervalMin * 60 * 1000)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
