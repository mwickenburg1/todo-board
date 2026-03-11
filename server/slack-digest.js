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
import { analyzeCrashes, analyzeIncidentChannel, clearAnalysisCache } from './slack-llm.js'
import { triageSlackItem } from './slack-triage.js'
import { scanUnrepliedDMs, scanMentions, scanCrashes, scanThreadActivity, scanNewIncidents, readIncidentChannelMessages } from './slack-scanners.js'

// --- Acknowledgment state (persisted to disk) ---

const ACK_PATH = resolve(process.env.HOME, 'todos-repo', '.slack-ack-state.json')

let ackedEpoch = 0
// dismissedSlackRefs: Map<ref, dismissedAtTs> — only suppress until new messages arrive
const dismissedSlackRefs = new Map()

// Load from disk on startup
try {
  const saved = JSON.parse(readFileSync(ACK_PATH, 'utf8'))
  if (saved.ackedEpoch) ackedEpoch = saved.ackedEpoch
  // Migrate from old Set format (array of strings) to Map format (object of ref→ts)
  if (saved.dismissed) {
    if (Array.isArray(saved.dismissed)) {
      // Old format: just refs, no timestamps — use current time
      for (const ref of saved.dismissed) dismissedSlackRefs.set(ref, Date.now() / 1000)
    } else {
      // New format: { ref: ts, ... }
      for (const [ref, ts] of Object.entries(saved.dismissed)) dismissedSlackRefs.set(ref, ts)
    }
  }
} catch {}

function persistAckState() {
  writeFileSync(ACK_PATH, JSON.stringify({
    ackedEpoch,
    dismissed: Object.fromEntries(dismissedSlackRefs),
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

    // Helper: extract latest message timestamp from context array
    function contextLatestTs(context) {
      if (!context || context.length === 0) return 0
      return Math.max(...context.map(m => parseFloat(m.ts) || 0))
    }

    // DMs — unified triage (urgency + suggestion in one call)
    if (unrepliedDMs.length > 0) {
      const triages = await Promise.all(
        unrepliedDMs.map(dm => triageSlackItem(`dm:${dm.chId}`, 'dm', {
          person: dm.person,
          messages: (dm.context || []).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts)),
        }))
      )
      const urgent = []
      const notUrgent = []
      for (let i = 0; i < unrepliedDMs.length; i++) {
        const dm = unrepliedDMs[i]
        const t = triages[i]
        const thread = (dm.context || []).slice(-5).map(m => ({
          who: m.who, text: (m.text || '').slice(0, 200),
        }))
        const latestTs = contextLatestTs(dm.context)
        if (!t || t.urgency === 'FYI') {
          notUrgent.push(dm.person)
        } else {
          const suggestion = t.action ? JSON.stringify({ action: t.action, draft: t.draft }) : null
          urgent.push({ person: dm.person, summary: t.summary || 'needs response', thread, chId: dm.chId, latestTs, suggestion })
        }
      }
      for (const u of urgent) {
        items.push({ text: `${u.person}: ${u.summary}`, slackThread: u.thread, slackRef: u.chId, context: 'slack-dms', priority: 2, latestTs: u.latestTs, suggestion: u.suggestion })
      }
      if (notUrgent.length > 0) {
        items.push({ text: `DMs: ${notUrgent.join(', ')} — nothing urgent`, context: 'slack-dms', priority: 0 })
      }
    }

    // @mentions — unified triage (urgency + suggestion in one call)
    if (mentions.length > 0) {
      const triages = await Promise.all(
        mentions.map(m => triageSlackItem(
          `mention:${m.chId}:${m.threadTs}`,
          'mention',
          {
            channel: m.channelName,
            messages: (m.context || []).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts)),
          }
        ))
      )
      const actionMentions = []
      const fyiMentions = []
      for (let i = 0; i < mentions.length; i++) {
        const m = mentions[i]
        const t = triages[i]
        const thread = (m.context || []).map(c => ({
          who: c.who, text: (c.text || '').slice(0, 200),
        }))
        const slackRef = m.isThread ? `${m.chId}/${m.threadTs}` : m.chId
        const latestTs = contextLatestTs(m.context)
        if (!t || t.urgency === 'FYI') {
          fyiMentions.push({ sender: m.sender, channel: m.channel })
        } else {
          const suggestion = t.action ? JSON.stringify({ action: t.action, draft: t.draft }) : null
          actionMentions.push({
            text: `${m.sender} in ${m.channel}: ${t.summary || m.text}`,
            slackThread: thread.length > 0 ? thread : undefined,
            slackRef, from: m.sender, channelLabel: m.channel,
            context: 'slack-mentions', priority: 2, latestTs, suggestion,
          })
        }
      }
      for (const a of actionMentions) {
        items.push(a)
      }
      if (fyiMentions.length > 0) {
        const names = [...new Set(fyiMentions.map(f => f.sender))].join(', ')
        const channels = [...new Set(fyiMentions.map(f => f.channel))].join(', ')
        items.push({ text: `Mentions: ${names} in ${channels} — FYI only`, context: 'slack-mentions', priority: 0 })
      }
    }

    // Threads — unified triage (urgency + suggestion in one call)
    if (threadActivity.length > 0) {
      const triages = await Promise.all(
        threadActivity.map(t => triageSlackItem(t.threadKey, 'thread', {
          channel: t.channel,
          messages: (t.context || []).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts)),
        }))
      )
      const actionNeeded = []
      const fyi = []
      for (let i = 0; i < threadActivity.length; i++) {
        const t = threadActivity[i]
        const tr = triages[i]
        const thread = (t.context || []).slice(-5).map(m => ({
          who: m.who, text: (m.text || '').slice(0, 200),
        }))
        const slackRef = t.threadKey ? t.threadKey.replace(':', '/') : null
        const latestTs = contextLatestTs(t.context)
        if (!tr || tr.urgency === 'FYI') {
          fyi.push({ channel: t.channel, from: t.from })
        } else {
          const suggestion = tr.action ? JSON.stringify({ action: tr.action, draft: tr.draft }) : null
          actionNeeded.push({ channel: t.channel, from: t.from, summary: tr.summary || `${t.from} replied`, thread, slackRef, latestTs, suggestion })
        }
      }
      for (const a of actionNeeded) {
        items.push({ text: `#${a.channel}: ${a.summary}`, slackThread: a.thread, slackRef: a.slackRef, context: 'slack-threads', priority: 2, latestTs: a.latestTs, suggestion: a.suggestion })
      }
      if (fyi.length > 0) {
        const names = [...new Set(fyi.map(f => f.from))].join(', ')
        const channels = [...new Set(fyi.map(f => `#${f.channel}`))].join(', ')
        items.push({ text: `Threads: ${names} replied in ${channels} — FYI only`, context: 'slack-threads', priority: 0 })
      }
    }

    // Incidents — with channel summaries and LLM attention judgment
    if (newIncidents.length > 0) {
      const rawChannelData = await readIncidentChannelMessages(newIncidents)
      const analysisMap = new Map()
      for (const r of rawChannelData) {
        const raw = await analyzeIncidentChannel(r.num, r.title, r.state, r.lines, r.fingerprint)
        if (raw) {
          try { analysisMap.set(r.num, JSON.parse(raw)) } catch { analysisMap.set(r.num, { summary: raw, needs_attention: true }) }
        }
      }
      for (const i of newIncidents) {
        const analysis = analysisMap.get(i.num)
        const desc = `#${i.num}${i.title ? ': ' + i.title : ''} (${i.state})`
        const text = analysis?.summary ? `${desc} — ${analysis.summary}` : desc
        // Hard rule: Stable/Mitigated incidents never need attention, regardless of LLM output
        const stableState = /stable|mitigated/i.test(i.state)
        const needsAttention = stableState ? false : analysis?.needs_attention !== false
        items.push({ text: `Incident ${text}`, slackRef: `incident:${i.num}`, context: 'slack-incidents', priority: needsAttention ? 3 : 0 })
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

    // Filter out dismissed items — only suppress if no new messages since dismissal
    const filteredItems = items.filter(item => {
      const dismissedAt = item.slackRef ? dismissedSlackRefs.get(item.slackRef) : dismissedSlackRefs.get(item.text)
      if (!dismissedAt) return true // not dismissed
      // If item has a latestTs newer than when it was dismissed, re-surface it
      if (item.latestTs && item.latestTs > dismissedAt) {
        // New activity — remove the dismissal so it surfaces
        if (item.slackRef) dismissedSlackRefs.delete(item.slackRef)
        dismissedSlackRefs.delete(item.text)
        return true
      }
      return false // still dismissed, no new activity
    })

    // Suggestions already included from unified triage — no separate pass needed

    // Update pulse list — atomic replace to avoid flicker during 500ms poll
    const data = readData()
    if (!data.lists.pulse) data.lists.pulse = []

    // Build new slack items first — skip priority<=0 items (FYI/stable, never shown in queue)
    const newSlackItems = []
    const actionableItems = filteredItems.filter(i => i.priority > 0)
    if (actionableItems.length > 0) {
      actionableItems.unshift({ text: sinceLabel, context: 'slack-header', priority: -1 })
      for (const item of actionableItems) {
        newSlackItems.push(createTask(data, item))
      }
    }

    // Atomic swap: remove old + add new in one write
    const nonSlack = data.lists.pulse.filter(t => !t.context?.startsWith('slack-'))
    data.lists.pulse = [...nonSlack, ...newSlackItems]

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
  const now = Date.now() / 1000
  if (slackRef) dismissedSlackRefs.set(slackRef, now)
  if (text) dismissedSlackRefs.set(text, now)
  persistAckState()
  console.log(`[slack-digest] Dismissed item until new activity: ${slackRef || text} (${dismissedSlackRefs.size} total)`)
}

export function resetAck() {
  ackedEpoch = 0
  // Keep dismissals — user explicitly dismissed these items
  persistAckState()
  clearAnalysisCache()
  console.log(`[slack-digest] Ack reset — back to ${INITIAL_LOOKBACK_HOURS}h lookback (${dismissedSlackRefs.size} dismissals preserved)`)
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
  // Clear stale slack items from disk on startup (digest will repopulate)
  try {
    const data = readData()
    if (data.lists.pulse) {
      const before = data.lists.pulse.length
      data.lists.pulse = data.lists.pulse.filter(t => !t.context?.startsWith('slack-'))
      if (data.lists.pulse.length < before) {
        saveData(data)
        console.log(`[slack-digest] Cleared ${before - data.lists.pulse.length} stale slack items on startup`)
      }
    }
  } catch {}
  console.log('[slack-digest] Starting (1m interval)')
  setTimeout(updateDigest, 3000)
  setInterval(updateDigest, 60 * 1000)
}
