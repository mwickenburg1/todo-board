/**
 * Pure-logic resolver that determines how to display a Slack item.
 * No React, no API calls — just input → config mapping.
 */

export interface SlackViewConfig {
  /** Which API to call: channel history or thread replies */
  fetchMode: 'channel' | 'thread'
  /** Slack channel ID */
  channelId: string
  /** Thread ts for thread-mode fetch (null for channel mode) */
  threadTs: string | null
  /** Where the reply input targets (null = channel root) */
  replyThreadTs: string | null
  /** Placeholder text for the reply input */
  replyPlaceholder: string
  /** Display label for the header */
  headerLabel: string
  /** Specific message ts to scroll to / highlight (null = scroll to bottom) */
  focusMessageTs: string | null
}

export interface SlackViewInput {
  /** "D123" or "C123/1234.5678" */
  slackRef: string
  /** "slack-dms" | "slack-mentions" | "slack-threads" */
  context: string
  /** Channel name from API or pulse item label */
  channelName?: string
  /** Override label (e.g. person name for DMs) */
  label?: string
}

function parseRef(slackRef: string): { channelId: string; threadTs: string | null } {
  const slash = slackRef.indexOf('/')
  if (slash === -1) return { channelId: slackRef, threadTs: null }
  return { channelId: slackRef.slice(0, slash), threadTs: slackRef.slice(slash + 1) }
}

function isDmChannel(channelId: string): boolean {
  return channelId.startsWith('D')
}

function isGroupDm(channelName: string | undefined): boolean {
  return !!channelName?.startsWith('mpdm-')
}

function friendlyGroupName(name: string): string {
  const inner = name.replace(/^mpdm-/, '').replace(/-\d+$/, '')
  const people = inner.split('--').map(n =>
    n.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  )
  return `Group DM: ${people.join(', ')}`
}

function formatChannelLabel(channelId: string, channelName?: string, label?: string): string {
  if (isDmChannel(channelId)) return label || channelName || 'DM'
  if (isGroupDm(channelName)) return friendlyGroupName(channelName!)
  if (channelName && !/^[CDG][A-Z0-9]+$/.test(channelName)) return `#${channelName}`
  return label || channelName || channelId
}

export function resolveSlackView(input: SlackViewInput): SlackViewConfig {
  const { slackRef, context, channelName, label } = input
  const { channelId, threadTs } = parseRef(slackRef)
  const headerLabel = formatChannelLabel(channelId, channelName, label)

  // DMs (direct or group): show channel history, reply to latest thread or root
  if (context === 'slack-dms') {
    return {
      fetchMode: 'channel',
      channelId,
      threadTs: null,
      replyThreadTs: null, // determined at render time from messages
      replyPlaceholder: isGroupDm(channelName)
        ? 'Message group...'
        : `Message ${label || channelName || 'DM'}...`,
      headerLabel,
      focusMessageTs: null,
    }
  }

  // Mentions: thread reply vs top-level
  if (context === 'slack-mentions') {
    if (threadTs) {
      // Mention inside a thread — show just that thread
      return {
        fetchMode: 'thread',
        channelId,
        threadTs,
        replyThreadTs: threadTs,
        replyPlaceholder: 'Reply in thread...',
        headerLabel,
        focusMessageTs: null, // thread view scrolls to bottom naturally
      }
    }
    // Top-level mention — show channel context, highlight the message
    return {
      fetchMode: 'channel',
      channelId,
      threadTs: null,
      replyThreadTs: null, // determined from messages at render time
      replyPlaceholder: `Message ${headerLabel}...`,
      headerLabel,
      focusMessageTs: null,
    }
  }

  // Thread activity: show just the thread
  if (context === 'slack-threads') {
    return {
      fetchMode: 'thread',
      channelId,
      threadTs,
      replyThreadTs: threadTs,
      replyPlaceholder: 'Reply in thread...',
      headerLabel,
      focusMessageTs: null,
    }
  }

  // Fallback: channel view
  return {
    fetchMode: 'channel',
    channelId,
    threadTs: null,
    replyThreadTs: null,
    replyPlaceholder: `Message ${headerLabel}...`,
    headerLabel,
    focusMessageTs: null,
  }
}
