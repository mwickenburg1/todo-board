/**
 * Shared Slack API helpers — used by both socket and polling plugins.
 * Tokens are read lazily since .env is loaded at runtime in event-hub.js.
 */

const userCache = {}

export function getSlackToken() { return process.env.SLACK_USER_TOKEN }
export function getAppToken() { return process.env.SLACK_APP_TOKEN }
export function getBotToken() { return process.env.SLACK_BOT_TOKEN }

export async function slackAPI(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getSlackToken()}` } })
  return res.json()
}

export async function resolveUser(userId) {
  if (!userId || userId === 'unknown') return userId
  if (userCache[userId]) return userCache[userId]
  try {
    const result = await slackAPI('users.info', { user: userId })
    if (result.ok) {
      const name = result.user.profile?.display_name || result.user.real_name || userId
      userCache[userId] = name
      return name
    }
  } catch {}
  return userId
}

export function isDMRef(ref) {
  return ref.startsWith('D')
}

const joinedChannels = new Set()

/** Try to join the bot to a public channel. Silently fails for private/DM channels. */
export async function ensureBotInChannel(channelId) {
  if (isDMRef(channelId) || joinedChannels.has(channelId)) return
  const botToken = getBotToken()
  if (!botToken) return
  try {
    const res = await fetch('https://slack.com/api/conversations.join', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId })
    })
    const result = await res.json()
    if (result.ok) {
      console.log(`[slack] Bot joined ${channelId}`)
    } else if (result.error !== 'channel_not_found' && result.error !== 'method_not_supported_for_channel_type') {
      console.log(`[slack] Bot join ${channelId}: ${result.error}`)
    }
    joinedChannels.add(channelId)
  } catch {}
}
