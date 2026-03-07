/**
 * LLM analysis layer — Sonnet calls with caching.
 */

import { appendFileSync } from 'fs'
import { ANTHROPIC_API_KEY, LLM_LOG } from './slack-api.js'

export async function callSonnet(prompt) {
  if (!ANTHROPIC_API_KEY) return null
  const ts = new Date().toISOString()
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    const result = data.content?.[0]?.text?.trim() || null
    const usage = data.usage || {}
    appendFileSync(LLM_LOG, JSON.stringify({
      ts, model: 'claude-sonnet-4-6', prompt_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      prompt: prompt.slice(0, 300), result, cached: false,
    }) + '\n')
    return result
  } catch (err) {
    appendFileSync(LLM_LOG, JSON.stringify({ ts, error: err.message, prompt: prompt.slice(0, 300) }) + '\n')
    console.error('[slack-digest] LLM error:', err.message)
    return null
  }
}

// analysisCache: keyed by category, stores { fingerprint, result }
const analysisCache = new Map()

export function cachedAnalyze(cacheKey, fingerprint, promptFn) {
  const cached = analysisCache.get(cacheKey)
  if (cached && cached.fingerprint === fingerprint) {
    appendFileSync(LLM_LOG, JSON.stringify({ ts: new Date().toISOString(), cacheKey, cached: true }) + '\n')
    return Promise.resolve(cached.result)
  }
  return promptFn().then(result => {
    if (result) analysisCache.set(cacheKey, { fingerprint, result })
    return result
  })
}

export function clearAnalysisCache() {
  analysisCache.clear()
}

export async function analyzeCrashes(taggedMsgs) {
  if (taggedMsgs.length === 0) return null
  const fingerprint = taggedMsgs.map(m => m.ts.toFixed(6)).join(',')
  const oldest = taggedMsgs[0]
  const newest = taggedMsgs[taggedMsgs.length - 1]

  return cachedAnalyze('crashes', fingerprint, () => {
    const context = `Baselines from 80 triage-buddy reports — IGNORE fluctuations within these ranges:
- Fatal rate: median 13%, p90 17%. Only flag if >20% or sudden spike >5pp above recent trend.
- Query AAS: median 1.4, p90 1.8. ONLY flag if an individual query AAS >= 2.0.
- Video Recall→S3 p50: median 2.9s, range 2.5-3.4s. Only flag if >5s.
- PostProcess TOTAL p50: median 10s, p95: median 23s. Only flag if p50 >15s or p95 >45s.
- Intelligence step: p50 median 4.3s, p95 median 23s. Only flag if p50 >8s or p95 >45s.
- Schedule-to-Start: p50 0s, p95 0s. Only flag if >1s.
- Bots fail fatally for many reasons (network, permissions, meeting ended). Small samples are noise.
- K8s CPU warnings for calendar-importer-worker-google: baseline ~76%, ignore unless >85%.
- DD monitor "Workflow Failure Rate" alerts are common, ignore unless multiple new alerts.

IMPORTANT: Most alerts are noise. Only say "worry" if something is genuinely outside normal ranges.`

    const prompt = taggedMsgs.length === 1
      ? `Triage Buddy alert from #crashes-v2:\n\n${oldest.blockText}\n\n${context}\n\nRespond with ONLY a single short sentence (max 15 words): what's the issue and should I worry? No markdown.`
      : `${taggedMsgs.length} sequential Triage Buddy alerts (15min apart). Compare oldest vs newest:\n\nOLDEST:\n${oldest.blockText}\n\nNEWEST:\n${newest.blockText}\n\n${context}\n\nRespond with ONLY a single short sentence (max 15 words): trending better/worse/stable, core issue, worry or not? No markdown.`
    return callSonnet(prompt)
  })
}

export async function analyzeDM(chId, person, messages) {
  if (messages.length === 0) return null
  const fingerprint = messages.map(m => m.ts).sort().join(',')

  return cachedAnalyze(`dm:${chId}`, fingerprint, () => {
    const transcript = messages
      .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))
      .map(m => `${m.who}: ${(m.text || '').slice(0, 200)}`)
      .join('\n')
    const prompt = `Recent DM conversation with ${person} (I am "me"):\n\n${transcript}\n\nRespond in this exact format (no markdown):\nURGENT: <summary max 12 words>\nor\nNOT_URGENT: <summary max 12 words>\n\nURGENT = they're blocked, waiting on me right now, or it's time-sensitive. They asked a direct question or need a decision and can't proceed without me.\nNOT_URGENT = FYI, casual, sharing info/updates, completed task, questions that can wait, or no immediate action needed.\n\nIMPORTANT:\n- Only consider messages AFTER my last reply — everything before that is handled.\n- Classify based on the MOST urgent unaddressed topic only.\n- Sharing plans, updates, or logistics is NOT_URGENT unless they explicitly asked me to do something and are blocked.`
    return callSonnet(prompt)
  })
}

export async function analyzeThread(threadKey, channel, context) {
  if (context.length === 0) return null
  const fingerprint = context.map(m => m.ts).sort().join(',')

  return cachedAnalyze(`thread:${threadKey}`, fingerprint, () => {
    const transcript = context
      .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))
      .map(m => `${m.who}: ${m.text}`)
      .join('\n')
    const prompt = `I am "me" in this Slack thread in #${channel}. Summarize what's happening and if I need to act.\n\n${transcript}\n\nYou MUST respond with EXACTLY one of these two formats (first word must be ACTION_NEEDED or FYI):\nACTION_NEEDED: <summary max 12 words>\nFYI: <summary max 12 words>\n\nACTION_NEEDED = someone asked me something, waiting on me, or I need to respond.\nFYI = status update, someone else handled it, or just informational.`
    return callSonnet(prompt)
  })
}

export async function analyzeIncidentChannel(num, title, lines, fingerprint) {
  return cachedAnalyze(`incident:${num}`, fingerprint, () => {
    const prompt = `Recent messages from incident channel #${num} (${title || 'no title'}):\n\n${lines.join('\n')}\n\nSummarize the current status in ONE sentence (max 20 words). Focus on: what's broken, who's investigating, any progress. No markdown.`
    return callSonnet(prompt)
  })
}
