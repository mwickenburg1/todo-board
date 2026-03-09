/**
 * Slack Digest — orchestrator that runs scanners and updates pulse items.
 *
 * Imported by server/index.js, runs on a 1-minute interval.
 * All scanners use the ack-based window: only show activity since last ack.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { readData, saveData, createTask } from './store.js'
import { SLACK_TOKEN, INITIAL_LOOKBACK_HOURS } from './slack-api.js'
import { analyzeCrashes, analyzeDM, analyzeThread, analyzeIncidentChannel, generateSuggestion, clearAnalysisCache } from './slack-llm.js'
import { scanUnrepliedDMs, scanMentions, scanCrashes, scanThreadActivity, scanNewIncidents, readIncidentChannelMessages } from './slack-scanners.js'

// --- Acknowledgment state (persisted to disk) ---

const ACK_PATH = resolve(process.env.HOME, 'todos-repo', '.slack-ack-state.json')

let ackedEpoch = 0
const dismissedSlackRefs = new Set()

// Load from disk on startup
try {
  const saved = JSON.parse(readFileSync(ACK_PATH, 'utf8'))
  if (saved.ackedEpoch) ackedEpoch = saved.ackedEpoch
  if (saved.dismissed) for (const ref of saved.dismissed) dismissedSlackRefs.add(ref)
} catch {}

function persistAckState() {
  writeFileSync(ACK_PATH, JSON.stringify({
    ackedEpoch,
    dismissed: [...dismissedSlackRefs],
  }))
}

function estTimeStr(epoch) {
  return new Date(epoch * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true
  })
}

// --- Digest update ---

let running = false

async function updateDigest() {
  if (running) return
  if (!SLACK_TOKEN) return
  running = true

  try {
    const now = Math.floor(Date.now() / 1000)
    const since = ackedEpoch > 0 ? ackedEpoch : now - INITIAL_LOOKBACK_HOURS * 3600

    const [unrepliedDMs, mentions, crashes, newIncidents] = await Promise.all([
      scanUnrepliedDMs(since),
      scanMentions(since),
      scanCrashes(since),
      scanNewIncidents(since),
    ])
    // Thread scanner runs sequentially — many API calls, would hit rate limits in parallel
    const threadActivity = await scanThreadActivity(since)

    const sinceLabel = ackedEpoch > 0 ? `since ${estTimeStr(ackedEpoch)}` : `${INITIAL_LOOKBACK_HOURS}h`
    const items = []

    // DMs — Sonnet classifies each as URGENT or NOT_URGENT
    if (unrepliedDMs.length > 0) {
      const analyses = await Promise.all(
        unrepliedDMs.map(dm => analyzeDM(dm.chId, dm.person, dm.context))
      )
      const urgent = []
      const notUrgent = []
      for (let i = 0; i < unrepliedDMs.length; i++) {
        const dm = unrepliedDMs[i]
        const raw = analyses[i] || ''
        const urgentMatch = raw.match(/URGENT:\s*(.+)/m)
        const notUrgentMatch = raw.match(/NOT_URGENT:\s*(.+)/m)
        // Most recent 5 messages in chronological order (oldest first)
        const thread = (dm.context || []).slice(-5).map(m => ({
          who: m.who, text: (m.text || '').slice(0, 200),
        }))
        if (notUrgentMatch) {
          notUrgent.push(dm.person)
        } else if (urgentMatch) {
          urgent.push({ person: dm.person, summary: urgentMatch[1].trim(), thread, chId: dm.chId })
        } else if (!raw) {
          // LLM failed (null) — default to not urgent rather than surfacing noise
          notUrgent.push(dm.person)
        } else {
          urgent.push({ person: dm.person, summary: raw, thread, chId: dm.chId })
        }
      }
      for (const u of urgent) {
        items.push({ text: `${u.person}: ${u.summary}`, slackThread: u.thread, slackRef: u.chId, context: 'slack-dms', priority: 2 })
      }
      if (notUrgent.length > 0) {
        items.push({ text: `DMs: ${notUrgent.join(', ')} — nothing urgent`, context: 'slack-dms', priority: 0 })
      }
    }

    // @mentions — individual items with thread context
    if (mentions.length > 0) {
      for (const m of mentions) {
        const thread = (m.context || []).map(c => ({
          who: c.who, text: (c.text || '').slice(0, 200),
        }))
        const slackRef = m.isThread ? `${m.chId}/${m.threadTs}` : m.chId
        items.push({
          text: `${m.sender} in ${m.channel}: ${m.text}`,
          slackThread: thread.length > 0 ? thread : undefined,
          slackRef,
          from: m.sender,
          context: 'slack-mentions',
          priority: 2,
        })
      }
    }

    // Threads — LLM triage into ACTION_NEEDED / FYI
    if (threadActivity.length > 0) {
      const analyses = await Promise.all(
        threadActivity.map(t => analyzeThread(t.threadKey, t.channel, t.context))
      )
      const actionNeeded = []
      const fyi = []
      for (let i = 0; i < threadActivity.length; i++) {
        const t = threadActivity[i]
        const raw = analyses[i] || ''
        const thread = (t.context || []).slice(-5).map(m => ({
          who: m.who, text: (m.text || '').slice(0, 200),
        }))
        // threadKey is "channelId:threadTs" — convert to "channelId/threadTs" for slack_thread link ref
        const slackRef = t.threadKey ? t.threadKey.replace(':', '/') : null
        if (raw.startsWith('ACTION_NEEDED:')) {
          actionNeeded.push({ channel: t.channel, from: t.from, summary: raw.slice(14).trim(), thread, slackRef })
        } else if (raw.startsWith('FYI:')) {
          fyi.push({ channel: t.channel, from: t.from })
        } else {
          actionNeeded.push({ channel: t.channel, from: t.from, summary: raw || `${t.from} replied`, thread, slackRef })
        }
      }
      for (const a of actionNeeded) {
        items.push({ text: `#${a.channel}: ${a.summary}`, slackThread: a.thread, slackRef: a.slackRef, context: 'slack-threads', priority: 2 })
      }
      if (fyi.length > 0) {
        const names = [...new Set(fyi.map(f => f.from))].join(', ')
        const channels = [...new Set(fyi.map(f => `#${f.channel}`))].join(', ')
        items.push({ text: `Threads: ${names} replied in ${channels} — FYI only`, context: 'slack-threads', priority: 0 })
      }
    }

    // Incidents — with channel summaries
    if (newIncidents.length > 0) {
      const rawChannelData = await readIncidentChannelMessages(newIncidents)
      const summaryMap = new Map()
      for (const r of rawChannelData) {
        const summary = await analyzeIncidentChannel(r.num, r.title, r.lines, r.fingerprint)
        if (summary) summaryMap.set(r.num, summary)
      }
      for (const i of newIncidents) {
        const summary = summaryMap.get(i.num)
        const desc = `#${i.num}${i.title ? ': ' + i.title : ''} (${i.state})`
        const text = summary ? `${desc} — ${summary}` : desc
        items.push({ text: `Incident ${text}`, context: 'slack-incidents', priority: 3 })
      }
    }

    // #crashes-v2
    if (crashes.tagged > 0) {
      const analysis = await analyzeCrashes(crashes.taggedMsgs)
      const fallback = `${crashes.tagged} alert${crashes.tagged > 1 ? 's' : ''} tagging you`
      const text = analysis ? `#crashes-v2: ${analysis}` : `#crashes-v2: ${fallback}`
      const shouldWorry = analysis && /worry|concern|spike|degrad|investig|alert|critical|elevated|abnormal|outage/i.test(analysis) && !/no.{0,5}worry|not.{0,5}worry|don.t.{0,5}worry|nothing.{0,5}worry|no.{0,5}concern|not.{0,5}concern|normal/i.test(analysis)
      items.push({ text, context: 'slack-crashes', priority: shouldWorry ? 2 : 0 })
    }

    // Filter out individually dismissed items
    const filteredItems = items.filter(item => {
      if (item.slackRef && dismissedSlackRefs.has(item.slackRef)) return false
      if (dismissedSlackRefs.has(item.text)) return false
      return true
    })

    // Generate LLM suggestions for actionable items with thread context
    const suggestionTargets = filteredItems.filter(i => i.priority > 0 && i.slackThread?.length > 0)
    if (suggestionTargets.length > 0) {
      const suggestions = await Promise.all(
        suggestionTargets.map(i => generateSuggestion(
          i.slackRef || i.text,
          i.slackThread.map((m, idx) => ({ ...m, ts: String(idx) })),
          i.text
        ))
      )
      for (let j = 0; j < suggestionTargets.length; j++) {
        if (suggestions[j]) suggestionTargets[j].suggestion = suggestions[j]
      }
    }

    // Update pulse list
    const data = readData()
    if (!data.lists.pulse) data.lists.pulse = []

    // Remove old slack items
    data.lists.pulse = data.lists.pulse.filter(t => !t.context?.startsWith('slack-'))

    // Only add header + items if there's something to show
    if (filteredItems.length > 0) {
      filteredItems.unshift({ text: sinceLabel, context: 'slack-header', priority: -1 })
      for (const item of filteredItems) {
        data.lists.pulse.push(createTask(data, item))
      }
    }

    saveData(data)
    const hasIssues = filteredItems.some(i => i.priority > 0)
    console.log(`[slack-digest] ${hasIssues ? 'Issues found' : 'All clear'} (${sinceLabel}): ${filteredItems.filter(i => i.context !== 'slack-header').map(i => i.text).join(' | ') || 'nothing to report'}`)
  } catch (err) {
    console.error(`[slack-digest] Error:`, err.message)
  } finally {
    running = false
  }
}

// --- Public API ---

export function dismissSlackItem(slackRef, text) {
  if (slackRef) dismissedSlackRefs.add(slackRef)
  if (text) dismissedSlackRefs.add(text)
  persistAckState()
  console.log(`[slack-digest] Dismissed item: ${slackRef || text} (${dismissedSlackRefs.size} total)`)
}

export function resetAck() {
  ackedEpoch = 0
  dismissedSlackRefs.clear()
  persistAckState()
  clearAnalysisCache()
  console.log(`[slack-digest] Ack reset — back to ${INITIAL_LOOKBACK_HOURS}h lookback`)
  setTimeout(updateDigest, 500)
}

export function acknowledgeDigest() {
  ackedEpoch = Math.floor(Date.now() / 1000)
  dismissedSlackRefs.clear()
  persistAckState()
  clearAnalysisCache()
  console.log(`[slack-digest] Acknowledged at ${estTimeStr(ackedEpoch)}`)

  // Immediately clear slack items from pulse (don't wait for rescan)
  try {
    const data = readData()
    if (data.lists.pulse) {
      data.lists.pulse = data.lists.pulse.filter(t => !t.context?.startsWith('slack-'))
      saveData(data)
    }
  } catch {}

  // Trigger re-scan after a short delay
  setTimeout(updateDigest, 500)
  return ackedEpoch
}

export function startSlackDigest() {
  if (!SLACK_TOKEN) {
    console.log('[slack-digest] No SLACK_USER_TOKEN, skipping')
    return
  }
  console.log('[slack-digest] Starting (1m interval)')
  setTimeout(updateDigest, 3000)
  setInterval(updateDigest, 60 * 1000)
}
