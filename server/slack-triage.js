/**
 * Unified Slack triage — single LLM call per conversation.
 *
 * Replaces separate analyzeDM / analyzeThread / generateSuggestion calls
 * with one prompt that returns urgency + summary + action + draft together,
 * eliminating the disconnect where triage and suggestion could disagree.
 *
 * Exports pure functions (buildTriagePrompt, parseTriageResult) for testing
 * and the async triageSlackItem for production use.
 */

import { callSonnet, cachedAnalyze } from './slack-llm.js'

// --- Prompt builder (pure, testable) ---

/**
 * @param {'dm' | 'thread' | 'mention'} source
 * @param {object} opts
 * @param {string} [opts.person]     - DM partner name
 * @param {string} [opts.channel]    - channel name (threads/mentions)
 * @param {Array<{who: string, text: string}>} opts.messages - conversation context
 * @returns {string} prompt
 */
export function buildTriagePrompt(source, { person, channel, messages }) {
  const transcript = messages
    .map(m => `${m.who}: ${(m.text || '').slice(0, 200)}`)
    .join('\n')

  const sourceLabel =
    source === 'dm' ? `DM conversation with ${person}` :
    source === 'mention' ? `@mention in #${channel}` :
    `thread in #${channel}`

  return `I am Matthias (shown as "me" or "mwickenburg" in the transcript). Any message addressed to @Matthias is addressed to ME.

${sourceLabel}:

${transcript}

Respond in this EXACT format (no markdown, no extra lines):
URGENCY: <ACTION_NEEDED or FYI>
SUMMARY: <what's happening, max 12 words>
ACTION: <what I should do, 1-2 sentences — or "No action needed — <reason>">
DRAFT: <a ready-to-send Slack reply as Matthias, or "none">

Rules for URGENCY:
- ACTION_NEEDED = someone asked ME a direct question, is waiting on ME, or I need to respond/decide.
- FYI = status update, someone else is handling it, directed at someone else, already resolved, or informational.

Critical distinctions:
- If the @mention is asking someone ELSE to do something (even if I'm cc'd), that's FYI.
- If someone already handled the request (e.g. "done", "on it", "deployed"), that's FYI.
- If the conversation continued AFTER the @mention and resolved without me, that's FYI.
- Only consider messages AFTER my last reply — everything before that is handled.
- If they acknowledged or said they'll handle it ("noted", "will do", "on it"), ball is in THEIR court — FYI.

Rules for DRAFT:
- Write as Matthias would actually reply — casual, direct, concise (1-3 sentences).
- If no action needed, DRAFT must be "none".`
}

// --- Response parser (pure, testable) ---

/**
 * @param {string | null} raw - LLM response text
 * @returns {{ urgency: 'ACTION_NEEDED' | 'FYI' | null, summary: string | null, action: string | null, draft: string | null }}
 */
export function parseTriageResult(raw) {
  if (!raw) return { urgency: null, summary: null, action: null, draft: null }

  const urgencyMatch = raw.match(/^URGENCY:\s*(.+)/m)
  const summaryMatch = raw.match(/^SUMMARY:\s*(.+)/m)
  const actionMatch = raw.match(/^ACTION:\s*(.+)/m)
  const draftMatch = raw.match(/^DRAFT:\s*(.+)/m)

  const urgencyRaw = urgencyMatch ? urgencyMatch[1].trim() : null
  const urgency = urgencyRaw?.startsWith('ACTION') ? 'ACTION_NEEDED'
    : urgencyRaw?.startsWith('FYI') ? 'FYI'
    : null

  const summary = summaryMatch ? summaryMatch[1].trim() : null
  const action = actionMatch ? actionMatch[1].trim() : null
  const draftRaw = draftMatch ? draftMatch[1].trim() : null
  const draft = draftRaw && draftRaw.toLowerCase() !== 'none' ? draftRaw : null

  return { urgency, summary, action, draft }
}

// --- Async triage with caching ---

/**
 * Single LLM call that returns urgency + summary + action + draft.
 *
 * @param {string} cacheKey - unique key for caching (e.g. "dm:C123" or "thread:C123:ts")
 * @param {'dm' | 'thread' | 'mention'} source
 * @param {object} opts - same as buildTriagePrompt
 * @returns {Promise<{ urgency: string, summary: string, action: string, draft: string | null } | null>}
 */
export async function triageSlackItem(cacheKey, source, opts) {
  const messages = opts.messages || []
  if (messages.length === 0) return null
  const fingerprint = messages.map(m => m.ts || '').sort().join(',')

  return cachedAnalyze(`triage:${cacheKey}`, fingerprint, async () => {
    const prompt = buildTriagePrompt(source, opts)
    const raw = await callSonnet(prompt)
    const parsed = parseTriageResult(raw)
    // Return as JSON string for cachedAnalyze compatibility
    return JSON.stringify(parsed)
  }).then(result => {
    if (!result) return null
    try { return JSON.parse(result) } catch { return null }
  })
}
