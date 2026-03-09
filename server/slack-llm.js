/**
 * LLM analysis layer — Sonnet calls with caching.
 */

import { appendFileSync } from 'fs'
import { ANTHROPIC_API_KEY, OPENAI_API_KEY, LLM_LOG } from './slack-api.js'

const MAX_RETRIES = 2
const RETRY_DELAY = 3000

async function callAnthropic(prompt) {
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
  if (data.type === 'error') {
    const errType = data.error?.type || 'unknown'
    throw new Error(`anthropic:${errType}: ${data.error?.message || 'unknown'}`)
  }
  return {
    result: data.content?.[0]?.text?.trim() || null,
    model: 'claude-sonnet-4-6',
    input_tokens: data.usage?.input_tokens,
    output_tokens: data.usage?.output_tokens,
  }
}

async function callOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (data.error) {
    throw new Error(`openai:${data.error.type || 'error'}: ${data.error.message || 'unknown'}`)
  }
  return {
    result: data.choices?.[0]?.message?.content?.trim() || null,
    model: 'gpt-4.1',
    input_tokens: data.usage?.prompt_tokens,
    output_tokens: data.usage?.completion_tokens,
  }
}

export async function callSonnet(prompt) {
  if (!ANTHROPIC_API_KEY && !OPENAI_API_KEY) return null
  const ts = new Date().toISOString()

  // Try Anthropic first with one retry, then fall back to OpenAI
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { result, model, input_tokens, output_tokens } = await callAnthropic(prompt)
      appendFileSync(LLM_LOG, JSON.stringify({
        ts, model, prompt_tokens: input_tokens, output_tokens,
        prompt: prompt.slice(0, 300), result, cached: false,
      }) + '\n')
      return result
    } catch (err) {
      const isOverloaded = err.message.includes('overloaded') || err.message.includes('rate_limit')
      if (isOverloaded && attempt < MAX_RETRIES) {
        console.error(`[slack-llm] Anthropic ${err.message} (attempt ${attempt + 1}), retrying...`)
        await new Promise(r => setTimeout(r, RETRY_DELAY))
        continue
      }
      // Anthropic failed — try OpenAI fallback
      if (OPENAI_API_KEY) {
        console.error(`[slack-llm] Anthropic failed (${err.message}), falling back to GPT-4.1`)
        try {
          const { result, model, input_tokens, output_tokens } = await callOpenAI(prompt)
          appendFileSync(LLM_LOG, JSON.stringify({
            ts, model, prompt_tokens: input_tokens, output_tokens,
            prompt: prompt.slice(0, 300), result, cached: false, fallback: true,
          }) + '\n')
          return result
        } catch (oaiErr) {
          appendFileSync(LLM_LOG, JSON.stringify({ ts, error: `both failed: anthropic=${err.message}, openai=${oaiErr.message}`, prompt: prompt.slice(0, 300) }) + '\n')
          console.error(`[slack-llm] Both providers failed: ${oaiErr.message}`)
          return null
        }
      }
      appendFileSync(LLM_LOG, JSON.stringify({ ts, error: err.message, prompt: prompt.slice(0, 300) }) + '\n')
      console.error(`[slack-llm] Anthropic failed, no fallback: ${err.message}`)
      return null
    }
  }
  return null
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
    const prompt = `Recent DM conversation with ${person}. I am Matthias (shown as "me" or "mwickenburg" in the transcript). Any message addressed to @Matthias is addressed to ME.\n\n${transcript}\n\nRespond in this exact format (no markdown):\nURGENT: <summary max 12 words>\nor\nNOT_URGENT: <summary max 12 words>\n\nURGENT = they're blocked, waiting on me right now, or it's time-sensitive. They asked a direct question or need a decision and can't proceed without me.\nNOT_URGENT = FYI, casual, sharing info/updates, completed task, questions that can wait, or no immediate action needed.\n\nIMPORTANT:\n- Only consider messages AFTER my last reply — everything before that is handled.\n- Classify based on the MOST urgent unaddressed topic only.\n- Sharing plans, updates, or logistics is NOT_URGENT unless they explicitly asked me to do something and are blocked.\n- If they acknowledged, confirmed, or said they'll handle it (e.g. "noted", "will do", "on it", "I'll look into it"), the ball is in THEIR court — that's NOT_URGENT.`
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
    const prompt = `I am Matthias (shown as "me" or "mwickenburg" in the transcript) in this Slack thread in #${channel}. Any message addressed to @Matthias is addressed to ME. Summarize what's happening and if I need to act.\n\n${transcript}\n\nYou MUST respond with EXACTLY one of these two formats (first word must be ACTION_NEEDED or FYI):\nACTION_NEEDED: <summary max 12 words>\nFYI: <summary max 12 words>\n\nACTION_NEEDED = someone asked ME (Matthias) a direct question, is waiting on ME, or I specifically need to respond.\nFYI = status update, someone else handled it, informational, or the request/question is directed at someone else.\n\nCRITICAL: If a message @mentions or directs a question at someone OTHER than me (e.g. "@Sam can you check this?"), that is FYI for me — the ball is in THEIR court, not mine. Only classify as ACTION_NEEDED if I am specifically asked to do something or the question is directed at me.`
    return callSonnet(prompt)
  })
}

export async function generateSuggestion(cacheKey, context, itemText) {
  if (context.length === 0) return null
  const fingerprint = context.map(m => m.ts || '').sort().join(',') + itemText

  return cachedAnalyze(`suggest:${cacheKey}`, fingerprint, () => {
    const transcript = context
      .sort((a, b) => parseFloat(a.ts || '0') - parseFloat(b.ts || '0'))
      .map(m => `${m.who}: ${(m.text || '').slice(0, 200)}`)
      .join('\n')
    const prompt = `I am Matthias (shown as "me" or "mwickenburg" in the transcript). Any message addressed to @Matthias is addressed to ME. Based on the context, suggest what I should do next AND draft a reply I can send.

Respond in this exact format (no markdown):
ACTION: <what I should do in 1-2 sentences>
DRAFT: <a ready-to-send reply message, written as me (Matthias), conversational and concise>

If no action is needed (directed at someone else, or already handled), respond:
ACTION: No action needed — <reason>
DRAFT: none

Guidelines for DRAFT:
- Write as Matthias would actually reply in Slack — casual, direct, helpful
- Keep it short (1-3 sentences max)
- Don't be overly formal or add unnecessary pleasantries
- If acknowledging, just acknowledge naturally
- If answering a question, answer it directly

Item: ${itemText}

Conversation:
${transcript}`
    return callSonnet(prompt).then(result => {
      if (!result) return null
      const actionMatch = result.match(/^ACTION:\s*(.+)/m)
      const draftMatch = result.match(/^DRAFT:\s*(.+)/m)
      const action = actionMatch ? actionMatch[1].trim() : result
      const draft = draftMatch && draftMatch[1].trim().toLowerCase() !== 'none' ? draftMatch[1].trim() : null
      return JSON.stringify({ action, draft })
    })
  })
}

export async function analyzeIncidentChannel(num, title, lines, fingerprint) {
  return cachedAnalyze(`incident:${num}`, fingerprint, () => {
    const prompt = `Recent messages from incident channel #${num} (${title || 'no title'}):\n\n${lines.join('\n')}\n\nSummarize the current status in ONE sentence (max 20 words). Focus on: what's broken, who's investigating, any progress. No markdown.`
    return callSonnet(prompt)
  })
}
