/**
 * Slack API primitives and shared constants.
 */

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const SLACK_TOKEN = process.env.SLACK_USER_TOKEN
export const SLACK_SEARCH_TOKEN = process.env.SLACK_SEARCH_TOKEN || SLACK_TOKEN
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
export const USER_ID = 'U02BMLFJJ64'
export const CRASHES_CHANNEL = 'C09TBCMEPPA'
export const INCIDENTS_CHANNEL = 'C07QTH1005N'
export const INITIAL_LOOKBACK_HOURS = 12
export const BOT_SENDERS = new Set(['triage buddy', 'support-router', 'Datadog', 'Triage Buddy'])
export const LLM_LOG = resolve(__dirname, '..', 'llm-calls.log')

export async function slack(method, params = {}, { useSearch = false } = {}) {
  const token = useSearch ? SLACK_SEARCH_TOKEN : SLACK_TOKEN
  const url = new URL(`https://slack.com/api/${method}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  return res.json()
}

const userCache = {}
export async function resolveUser(uid) {
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

export function extractBlockText(blocks) {
  const parts = []
  for (const b of (blocks || [])) {
    if (b.text?.text) parts.push(b.text.text)
    for (const f of (b.fields || [])) {
      if (f?.text) parts.push(f.text)
    }
  }
  return parts.join('\n')
}
