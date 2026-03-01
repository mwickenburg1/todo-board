/**
 * Slack Digest — orchestrator that runs scanners and updates pulse items.
 *
 * Imported by server/index.js, runs on a 1-minute interval.
 * All scanners use the ack-based window: only show activity since last ack.
 */

import { readData, saveData, createTask } from './store.js'
import { SLACK_TOKEN, INITIAL_LOOKBACK_HOURS } from './slack-api.js'
import { analyzeCrashes, analyzeDM, analyzeThread, analyzeIncidentChannel, clearAnalysisCache } from './slack-llm.js'
import { scanUnrepliedDMs, scanMentions, scanCrashes, scanThreadActivity, scanNewIncidents, readIncidentChannelMessages } from './slack-scanners.js'

// --- Acknowledgment state ---

let ackedEpoch = 0  // 0 = never acked, use INITIAL_LOOKBACK_HOURS

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
        if (raw.startsWith('URGENT:')) {
          urgent.push({ person: dm.person, summary: raw.slice(7).trim() })
        } else if (raw.startsWith('NOT_URGENT:')) {
          notUrgent.push(dm.person)
        } else {
          urgent.push({ person: dm.person, summary: raw || dm.lastMsg })
        }
      }
      for (const u of urgent) {
        items.push({ text: `${u.person}: ${u.summary}`, context: 'slack-dms', priority: 2 })
      }
      if (notUrgent.length > 0) {
        items.push({ text: `DMs: ${notUrgent.join(', ')} — nothing urgent`, context: 'slack-dms', priority: 0 })
      }
    }

    // @mentions
    if (mentions.length > 0) {
      const senders = [...new Set(mentions.map(m => m.sender))].slice(0, 3).join(', ')
      const extra = mentions.length > 3 ? ` +${mentions.length - 3}` : ''
      items.push({ text: `@mentions: ${mentions.length} (${senders}${extra})`, context: 'slack-mentions', priority: 2 })
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
        if (raw.startsWith('ACTION_NEEDED:')) {
          actionNeeded.push({ channel: t.channel, from: t.from, summary: raw.slice(14).trim() })
        } else if (raw.startsWith('FYI:')) {
          fyi.push({ channel: t.channel, from: t.from })
        } else {
          actionNeeded.push({ channel: t.channel, from: t.from, summary: raw || `${t.from} replied` })
        }
      }
      for (const a of actionNeeded) {
        items.push({ text: `#${a.channel}: ${a.summary}`, context: 'slack-threads', priority: 2 })
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
      const noWorry = analysis && /don.t worry|no worry|not worry|normal range|within.*(baseline|range)|no concern/i.test(analysis)
      items.push({ text, context: 'slack-crashes', priority: noWorry ? 0 : 2 })
    }

    // Update pulse list
    const data = readData()
    if (!data.lists.pulse) data.lists.pulse = []

    // Remove old slack items
    data.lists.pulse = data.lists.pulse.filter(t => !t.context?.startsWith('slack-'))

    // Only add header + items if there's something to show
    if (items.length > 0) {
      items.unshift({ text: sinceLabel, context: 'slack-header', priority: -1 })
      for (const item of items) {
        data.lists.pulse.push(createTask(data, item))
      }
    }

    saveData(data)
    const hasIssues = items.some(i => i.priority > 0)
    console.log(`[slack-digest] ${hasIssues ? 'Issues found' : 'All clear'} (${sinceLabel}): ${items.filter(i => i.context !== 'slack-header').map(i => i.text).join(' | ') || 'nothing to report'}`)
  } catch (err) {
    console.error(`[slack-digest] Error:`, err.message)
  } finally {
    running = false
  }
}

// --- Public API ---

export function acknowledgeDigest() {
  ackedEpoch = Math.floor(Date.now() / 1000)
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
