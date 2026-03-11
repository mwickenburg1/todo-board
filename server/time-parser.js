/**
 * LLM-based natural language time parser.
 *
 * Converts expressions like "2pm today", "tomorrow morning", "next Monday 9am"
 * into epoch timestamps in EST (America/New_York).
 *
 * Uses callSonnet from slack-llm.js (reuses existing Anthropic API setup).
 */

import { callSonnet } from './slack-llm.js'

function currentNYString() {
  const now = new Date()
  const base = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  // Detect current offset (EST=-05:00, EDT=-04:00)
  const utc = now.getTime()
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const offsetMin = (ny.getTime() - utc) / 60000
  const sign = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(Math.round(offsetMin))
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0')
  const mm = String(absMin % 60).padStart(2, '0')
  const offsetStr = `${sign}${hh}:${mm}`
  const isDST = offsetMin > -300
  return `${base} (${isDST ? 'EDT' : 'EST'}, UTC${offsetStr})`
}

/**
 * Parse a natural language time expression into an epoch timestamp (ms).
 * Returns null if parsing fails.
 */
export async function parseNaturalTime(input) {
  const prompt = `Current date and time in America/New_York: ${currentNYString()}

Parse this time expression: "${input}"

IMPORTANT: Always resolve to a FUTURE date/time unless the input explicitly says "last", "past", or "ago". This is for scheduling — the result must never be in the past.

Respond with ONLY an ISO 8601 timestamp with the correct UTC offset for America/New_York (use -04:00 during EDT, -05:00 during EST). Nothing else.
Example: 2026-06-15T14:00:00-04:00`

  const result = await callSonnet(prompt)
  if (!result) return null

  const parsed = new Date(result.trim())
  if (isNaN(parsed.getTime())) return null

  return parsed.getTime()
}
