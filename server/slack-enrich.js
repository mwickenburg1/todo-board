/**
 * Slack Enrich — search Slack for context about a task, synthesize hypotheses via LLM.
 *
 * Given a task's text, runs targeted Slack searches (DMs weighted higher),
 * then asks an LLM to produce 2-4 hypotheses for what the task means,
 * each backed by supporting message snippets.
 */

import { slack, USER_ID, cleanMentions } from './slack-api.js'
import { callSonnet } from './slack-llm.js'

/**
 * Search Slack for messages relevant to a query string.
 * Returns deduplicated messages sorted by relevance, DMs boosted.
 */
export async function searchSlack(query, { maxResults = 30 } = {}) {
  if (!query || query.trim().length < 2) return []

  // Generate search variants: full text, key phrases, individual keywords
  const variants = generateSearchVariants(query)

  // Run all searches in parallel
  const allResults = await Promise.all(
    variants.map(async (v) => {
      const data = await slack('search.messages', {
        query: v.query,
        count: v.count || 15,
        sort: 'timestamp',
        sort_dir: 'desc',
      }, { useSearch: true })
      if (!data.ok) return []
      return (data.messages?.matches || []).map(m => ({
        text: m.text || '',
        username: m.username || 'unknown',
        channel: m.channel?.name || m.channel?.id || '?',
        channelId: m.channel?.id || null,
        isDM: m.channel?.is_im || m.channel?.is_mpim || /^D[A-Z0-9]+$/.test(m.channel?.id || ''),
        ts: m.ts,
        permalink: m.permalink || null,
        searchVariant: v.label,
      }))
    })
  )

  // Flatten + deduplicate by ts
  const seen = new Set()
  const messages = []
  for (const batch of allResults) {
    for (const m of batch) {
      if (seen.has(m.ts)) continue
      seen.add(m.ts)
      messages.push(m)
    }
  }

  // Score: DMs get 2x boost, recency matters
  const now = Date.now() / 1000
  for (const m of messages) {
    const ageDays = (now - parseFloat(m.ts)) / 86400
    const recencyScore = Math.max(0, 1 - ageDays / 90) // decay over 90 days
    const dmBoost = m.isDM ? 2 : 1
    m.score = recencyScore * dmBoost
  }

  messages.sort((a, b) => b.score - a.score)
  return messages.slice(0, maxResults)
}

/**
 * Generate search variants from a task title.
 * Produces: full text, bracketed prefix extracted, individual keywords.
 */
export function generateSearchVariants(text) {
  const variants = []

  // 1. Full text (minus brackets)
  const cleaned = text.replace(/\[.*?\]/g, '').trim()
  if (cleaned.length >= 3) {
    variants.push({ query: cleaned, label: 'full', count: 15 })
  }

  // 2. Bracketed prefix as context filter (e.g. "[Deal View]" → "deal view")
  const bracketMatch = text.match(/\[(.*?)\]/)
  if (bracketMatch) {
    const prefix = bracketMatch[1].trim()
    const rest = text.replace(/\[.*?\]/g, '').trim()
    if (rest.length >= 3) {
      variants.push({ query: `${prefix} ${rest}`, label: 'with-prefix', count: 10 })
    }
  }

  // 3. Individual significant keywords (skip short/common words)
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'add', 'get', 'set', 'fix', 'run', 'use', 'check'])
  const words = cleaned.split(/[\s;,\-/]+/).filter(w => w.length >= 3 && !stopWords.has(w.toLowerCase()))
  if (words.length >= 2) {
    // Pairs of keywords
    for (let i = 0; i < Math.min(words.length - 1, 3); i++) {
      variants.push({ query: `${words[i]} ${words[i + 1]}`, label: `pair-${i}`, count: 8 })
    }
  }

  // 4. DM-specific search (from:me or to:me)
  if (cleaned.length >= 3) {
    variants.push({ query: `${cleaned} from:me`, label: 'from-me', count: 10 })
  }

  return variants
}

/**
 * Given search results, call LLM to synthesize hypotheses.
 * Returns array of { hypothesis, confidence, messages[] }.
 */
export async function synthesizeHypotheses(taskText, messages) {
  if (messages.length === 0) {
    return [{ hypothesis: 'No Slack messages found for this task.', confidence: 'low', messages: [] }]
  }

  // Build transcript for LLM
  const transcript = messages.slice(0, 25).map((m, i) => {
    const label = m.isDM ? '[DM]' : `[#${m.channel}]`
    return `${i + 1}. ${label} @${m.username}: ${m.text.slice(0, 300)}`
  }).join('\n')

  const prompt = `I have a todo item: "${taskText}"

Here are related Slack messages I found:

${transcript}

Based on these messages, generate 2-4 hypotheses for what this todo item specifically refers to. Each hypothesis should be a concrete interpretation of what needs to be done.

Respond in this exact JSON format (no markdown, no code fences):
[
  {
    "hypothesis": "One sentence describing what the task likely means",
    "confidence": "high" or "medium" or "low",
    "summary": "2-3 sentence context from the messages supporting this interpretation",
    "messageIndices": [1, 3, 7]
  }
]

Rules:
- Order by confidence (highest first)
- messageIndices are 1-indexed references to the messages above
- Each hypothesis should be meaningfully different
- Be specific — "analyze X for Y purpose" is better than "do something with X"
- If messages clearly point to one interpretation, it's fine to have just 1-2 hypotheses with high confidence`

  const result = await callSonnet(prompt)
  if (!result) return [{ hypothesis: 'LLM synthesis failed.', confidence: 'low', messages: [] }]

  try {
    const hypotheses = JSON.parse(result)
    // Attach actual message data to each hypothesis
    return hypotheses.map(h => ({
      ...h,
      messages: (h.messageIndices || [])
        .filter(i => i >= 1 && i <= messages.length)
        .map(i => {
          const m = messages[i - 1]
          return { username: m.username, channel: m.channel, isDM: m.isDM, text: m.text.slice(0, 300), permalink: m.permalink }
        }),
    }))
  } catch {
    // LLM returned non-JSON — wrap as single hypothesis
    return [{ hypothesis: result.slice(0, 200), confidence: 'medium', summary: '', messages: [] }]
  }
}

/**
 * Full enrichment pipeline: search → synthesize → return hypotheses.
 */
export async function enrichTask(taskText) {
  const messages = await searchSlack(taskText)
  const hypotheses = await synthesizeHypotheses(taskText, messages)
  return { hypotheses, searchResultCount: messages.length }
}
