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

import { callSonnet, cachedAnalyze, clearCacheEntry } from './slack-llm.js'
import { fetchContextForRef } from './slack-scanners.js'

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
  // Format timestamps so the LLM can reason about relative dates ("tomorrow", "Friday")
  const fmtTs = (ts) => {
    if (!ts) return ''
    const d = new Date(parseFloat(ts) * 1000)
    if (isNaN(d)) return ''
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  }

  const transcript = messages
    .map((m, i) => {
      const when = fmtTs(m.ts)
      return `[${i}] ${when ? `(${when}) ` : ''}${m.who}: ${(m.text || '').slice(0, 200)}`
    })
    .join('\n')

  // Derive "now" and "last message time" for deadline context
  const lastTs = [...messages].reverse().find(m => m.ts)?.ts
  const lastMsgDate = lastTs ? new Date(parseFloat(lastTs) * 1000) : null
  const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  const lastMsgStr = lastMsgDate ? lastMsgDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : null

  // For DMs, detect all participants to identify group DMs
  const otherPeople = [...new Set(messages.filter(m => m.who !== 'me').map(m => m.who))]
  const isGroupDM = source === 'dm' && otherPeople.length > 1

  const sourceLabel =
    source === 'dm'
      ? isGroupDM
        ? `Group DM with ${otherPeople.join(', ')}`
        : `DM conversation with ${person}`
    : source === 'mention' ? `@mention in #${channel}` :
    `thread in #${channel}`

  return `You are triaging Slack messages on behalf of Matthias. In the transcript below, "me" = Matthias. All other names are other people. Your job is to advise MATTHIAS on what HE should do next.

${sourceLabel}:

${transcript}

Remember: "me" in the transcript is Matthias. You are advising HIM. Any action/draft must be from Matthias's perspective.

Respond in this EXACT format (no markdown, no extra lines):
Decide:
1. Do I need to REPLY to this conversation?
2. Do I need to CREATE A TASK to track a commitment or follow-up?
3. Or can I DISMISS this as informational?

URGENCY: <ACTION_NEEDED or FYI>
SUMMARY: <EXACTLY 2-4 words, NO MORE. Dashboard label, not a sentence. Examples: "MaintainX Slack access", "Deploy hotfix", "Account fix">
ACTION: <"Track — <what>", "Reply — <what>", "Watch — <what>", or "No action needed — <reason>". 9 words max after the dash.>
DRAFT: <a ready-to-send Slack reply as Matthias, or "none">
KEY_MESSAGES: <JSON array of 1-3 message indices (0-based) that are the key asks or decisions — the messages I MUST read>

Rules for URGENCY:
- ACTION_NEEDED = I need to do something: reply, make a decision, OR track a commitment I made.
- FYI = truly informational, fully resolved with no outstanding commitments, or directed at someone else.

Critical: if I already replied, ask "did I commit to something?"
- "I'll check", "give us a few days", "will look into it", "let me do X" → ACTION_NEEDED. I need a task to track my commitment. First action = "track", NOT "reply".
- Casual sign-off with no commitment ("sounds good", "cool", "thanks") and nothing promised → FYI.

Other distinctions:
- If the @mention is asking someone ELSE to do something (even if I'm cc'd) → FYI.
- If someone already handled it ("done", "on it", "deployed") → FYI.
- Only consider messages AFTER my last reply — everything before is handled.
- CRITICAL: If MY message is the LAST message in the transcript, I already replied. Do NOT suggest "reply" — the ball is in their court. Use "watch" or "done" instead.
- Do NOT suggest "reply" if I already replied and nobody asked a follow-up question AFTER my reply.
- If they said they'll handle it ("noted", "will do", "on it"), ball is in THEIR court → FYI.
- In group DMs: if others are talking to EACH OTHER (not me) → FYI.
- If I haven't said anything and nobody addresses me directly → lean FYI.

Rules for DRAFT:
- Write as Matthias would actually reply — casual, direct, concise (1-3 sentences).
- If no action needed, DRAFT must be "none".

ACTIONS: <JSON array of ranked next steps, most important first>

Each action is an object with "type" and params. "deadline" is REQUIRED on track/watch (never omit it):
- {"type":"reply","draft":"<message>"}
- {"type":"track","taskText":"<2-4 words>","delegateOnly":true/false,"deadline":"2026-03-14T17:00"} — MUST include deadline
- {"type":"watch","taskText":"<2-4 words>","checkHours":24,"delegateOnly":true,"deadline":"2026-03-14T17:00"} — MUST include deadline+delegateOnly
- {"type":"done"}
- {"type":"snooze"}

Rules for ACTIONS:
- Always include 2-4 actions ranked by relevance.
- First action = primary recommendation.
- If URGENCY is ACTION_NEEDED, first action should be "reply" or "track".
- If URGENCY is FYI, first action should be "done".
- "reply" action MUST include the same draft text as DRAFT.
- "track"/"watch" taskText should be ultra-concise (2-4 words max), not the full summary. Examples: "MaintainX Slack access", "Deploy hotfix", "Review PR".
- delegateOnly: set to TRUE when the next action is on someone else (they said "let me check", "I'll get back to you", "let me loop in X", or the ball is in their court after my last message). Set to FALSE only when I personally need to do something next. When in doubt, ask: "who has the next move?" If it's not me, delegateOnly=true.
- "deadline" MUST be included on every "track" and "watch" action. Always estimate a reasonable follow-up time even if the conversation doesn't state one explicitly. Use YYYY-MM-DDTHH:mm format (ET). Guidelines: explicit dates ("tomorrow", "Friday") → resolve relative to when messages were SENT, not now. No explicit date but urgent/blocking → next business day 09:00. Routine follow-up → 2-3 business days out at 17:00. Low priority → end of week (Fri 17:00).${lastMsgStr ? ` Last message was sent: ${lastMsgStr}.` : ''} Current time: ${nowStr}. Time hints: "tomorrow" / "on Friday" = EOD (17:00). "by tomorrow" / "by Friday" = start of day (09:00). "end of week" = Fri 17:00.
- Output valid JSON on a single line after "ACTIONS: ".

Rules for KEY_MESSAGES:
- Pick 1-3 message indices [0-based] from the transcript that are the most important — the key asks, decisions, or requests directed at me.
- Output valid JSON array on a single line after "KEY_MESSAGES: ".
- Example: KEY_MESSAGES: [2, 5]`
}

// --- Response parser (pure, testable) ---

/**
 * @param {string | null} raw - LLM response text
 * @returns {{ urgency: 'ACTION_NEEDED' | 'FYI' | null, summary: string | null, action: string | null, draft: string | null }}
 */
export function parseTriageResult(raw) {
  if (!raw) return { urgency: null, summary: null, action: null, draft: null, actions: null, keyMessages: null }

  const urgencyMatch = raw.match(/^URGENCY:\s*(.+)/m)
  const summaryMatch = raw.match(/^SUMMARY:\s*(.+)/m)
  const actionMatch = raw.match(/^ACTION:\s*(.+)/m)
  const draftMatch = raw.match(/^DRAFT:\s*(.+)/m)
  const actionsMatch = raw.match(/^ACTIONS:\s*(.+)/m)
  const keyMsgMatch = raw.match(/^KEY_MESSAGES:\s*(.+)/m)

  const urgencyRaw = urgencyMatch ? urgencyMatch[1].trim() : null
  const urgency = urgencyRaw?.startsWith('ACTION') ? 'ACTION_NEEDED'
    : urgencyRaw?.startsWith('FYI') ? 'FYI'
    : null

  const summary = summaryMatch ? summaryMatch[1].trim() : null
  const action = actionMatch ? actionMatch[1].trim() : null
  const draftRaw = draftMatch ? draftMatch[1].trim() : null
  const draft = draftRaw && draftRaw.toLowerCase() !== 'none' ? draftRaw : null

  let actions = null
  if (actionsMatch) {
    try {
      const parsed = JSON.parse(actionsMatch[1].trim())
      if (Array.isArray(parsed)) actions = parsed
    } catch {}
  }

  // Fallback: synthesize actions from urgency/draft if LLM didn't provide them
  if (!actions) {
    actions = []
    if (urgency === 'ACTION_NEEDED') {
      if (draft) actions.push({ type: 'reply', draft })
      actions.push({ type: 'track', taskText: summary || 'Follow up', delegateOnly: false })
      actions.push({ type: 'done' })
    } else {
      actions.push({ type: 'done' })
      if (draft) actions.push({ type: 'reply', draft })
      actions.push({ type: 'snooze' })
    }
  }

  let keyMessages = null
  if (keyMsgMatch) {
    try {
      const parsed = JSON.parse(keyMsgMatch[1].trim())
      if (Array.isArray(parsed)) keyMessages = parsed.filter(n => typeof n === 'number').slice(0, 3)
    } catch {}
  }

  return { urgency, summary, action, draft, actions, keyMessages }
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

/**
 * Re-triage a single item: fetch fresh context, clear cache, re-run LLM.
 * Returns the new triage result + context, or null on failure.
 */
export async function retriageItem(slackRef, contextType) {
  const { source, person, channel, messages } = await fetchContextForRef(slackRef)
  // Determine cache key — same format as digest uses
  const isThread = slackRef.includes('/')
  const cacheKey = contextType === 'slack-mentions'
    ? `mention:${slackRef.replace('/', ':')}`
    : isThread
      ? `${slackRef.replace('/', ':')}`
      : `dm:${slackRef}`
  clearCacheEntry(`triage:${cacheKey}`)
  const triage = await triageSlackItem(cacheKey, source, { person, channel, messages })
  return triage ? { triage, messages } : null
}
