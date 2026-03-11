import React, { useState, useEffect, useRef, useCallback } from 'react'

// --- @mention autocomplete for Slack textareas ---

interface SlackUser {
  id: string
  name: string
  realName: string
  avatar: string
}

function MentionTextarea({
  value, onChange, onKeyDown, onKeyUp, placeholder, rows, className, disabled,
}: {
  value: string
  onChange: (val: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onKeyUp?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
  className?: string
  disabled?: boolean
}) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [mentionResults, setMentionResults] = useState<SlackUser[]>([])
  const [mentionPos, setMentionPos] = useState(0) // cursor position of @
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (mentionQuery === null || mentionQuery.length < 1) {
      setMentionResults([])
      return
    }
    if (fetchTimer.current) clearTimeout(fetchTimer.current)
    fetchTimer.current = setTimeout(() => {
      fetch(`/api/slack-users?q=${encodeURIComponent(mentionQuery)}`)
        .then(r => r.json())
        .then(users => { setMentionResults(users); setMentionIdx(0) })
        .catch(() => setMentionResults([]))
    }, 150)
    return () => { if (fetchTimer.current) clearTimeout(fetchTimer.current) }
  }, [mentionQuery])

  const insertMention = (user: SlackUser) => {
    const before = value.slice(0, mentionPos)
    const after = value.slice(textareaRef.current?.selectionStart || mentionPos + (mentionQuery?.length || 0) + 1)
    const mention = `<@${user.id}|${user.name}>`
    onChange(before + mention + ' ' + after)
    setMentionQuery(null)
    setMentionResults([])
    setTimeout(() => {
      const pos = before.length + mention.length + 1
      textareaRef.current?.setSelectionRange(pos, pos)
      textareaRef.current?.focus()
    }, 0)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    onChange(val)
    const cursor = e.target.selectionStart
    // Check if we're in an @mention context
    const textBefore = val.slice(0, cursor)
    const atMatch = textBefore.match(/@(\w*)$/)
    if (atMatch) {
      setMentionPos(cursor - atMatch[0].length)
      setMentionQuery(atMatch[1])
    } else {
      setMentionQuery(null)
      setMentionResults([])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, mentionResults.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionResults[mentionIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); setMentionResults([]); return }
    }
    onKeyDown?.(e)
  }

  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={onKeyUp}
        placeholder={placeholder}
        rows={rows}
        className={className}
        disabled={disabled}
      />
      {mentionResults.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-64 max-h-[200px] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          {mentionResults.map((user, i) => (
            <div
              key={user.id}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-[13px] ${
                i === mentionIdx ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
              }`}
              onMouseDown={(e) => { e.preventDefault(); insertMention(user) }}
              onMouseEnter={() => setMentionIdx(i)}
            >
              {user.avatar && <img src={user.avatar} alt="" className="w-5 h-5 rounded" />}
              <span className="font-medium text-gray-700 dark:text-gray-300">{user.name}</span>
              {user.realName !== user.name && (
                <span className="text-gray-400 dark:text-gray-500 truncate">{user.realName}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface ThreadMessage {
  who: string
  isMe: boolean
  text: string
  ts: string
  isUnread?: boolean
  replyCount?: number
  threadTs?: string | null
  latestReplyTs?: string | null
  isThreadOrigin?: boolean  // injected root message from an older thread
}

interface ThreadReply {
  who: string
  isMe: boolean
  text: string
  ts: string
}

interface ThreadData {
  channelName: string
  messages: ThreadMessage[]
  unreadCount: number
  latestTs: string | null
}

interface SlackThreadPreviewProps {
  ref_: string   // "channel" or "channel/ts" format
  label: string  // "#channel-name" or similar
  onUnreadChange?: (ref: string, count: number) => void
  defaultExpanded?: boolean
  focusThreadTs?: string | null  // auto-open this specific thread (fetches channel + thread)
  draftReply?: string | null     // LLM-drafted reply to pre-fill the input
}

// --- Color system: me (blue), team (cool tones), clients (warm tones) ---

// "Me" — always this color (muted)
const ME_COLOR = 'text-blue-500/70 dark:text-blue-400/60'

// Team members — known Attention employees (lowercase match)
const TEAM_MEMBERS = new Set([
  'matthias', 'mwickenburg', 'rishabh', 'jacob', 'sergey', 'sean',
  'jon', 'jonathan', 'nate', 'nathan', 'kyle', 'alex', 'andrew',
  'matt', 'chris', 'josh', 'james', 'ryan', 'taylor', 'laura',
  'michael', 'nick', 'brian', 'kevin', 'derek', 'tyler', 'joe',
])

// Team palette — cool/neutral tones, muted (~20% less intensity)
const TEAM_COLORS = [
  'text-sky-500/70 dark:text-sky-400/60',
  'text-indigo-400/70 dark:text-indigo-400/60',
  'text-teal-500/70 dark:text-teal-400/60',
  'text-cyan-500/70 dark:text-cyan-400/60',
  'text-slate-400/70 dark:text-slate-400/60',
  'text-violet-400/70 dark:text-violet-400/60',
]

// Client/external palette — warm tones, muted (~20% less intensity)
const CLIENT_COLORS = [
  'text-amber-500/70 dark:text-amber-400/60',
  'text-orange-500/70 dark:text-orange-400/60',
  'text-rose-500/70 dark:text-rose-400/60',
  'text-red-400/70 dark:text-red-400/60',
  'text-pink-500/70 dark:text-pink-400/60',
  'text-yellow-500/70 dark:text-yellow-400/60',
]

function isTeamMember(name: string): boolean {
  const lower = name.toLowerCase()
  return TEAM_MEMBERS.has(lower) || TEAM_MEMBERS.has(lower.split(' ')[0])
}

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function userColor(name: string, isMe: boolean, colorMap: Map<string, string>): string {
  if (isMe) return ME_COLOR
  if (!colorMap.has(name)) {
    const palette = isTeamMember(name) ? TEAM_COLORS : CLIENT_COLORS
    colorMap.set(name, palette[hashName(name) % palette.length])
  }
  return colorMap.get(name)!
}

function formatTime(ts: string): string {
  const d = new Date(parseFloat(ts) * 1000)
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDateHeader(ts: string): string {
  const d = new Date(parseFloat(ts) * 1000)
  const now = new Date()
  const ny = (dt: Date) => dt.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  if (ny(d) === ny(now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (ny(d) === ny(yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function shouldShowDateHeader(msgs: ThreadMessage[], idx: number): boolean {
  if (idx === 0) return true
  const prev = new Date(parseFloat(msgs[idx - 1].ts) * 1000)
  const curr = new Date(parseFloat(msgs[idx].ts) * 1000)
  const ny = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  return ny(prev) !== ny(curr)
}

function SlackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
    </svg>
  )
}

function renderText(text: string) {
  // Split on Slack link markup <url|label>, <url>, bold **text**, and *text*
  const parts = text.split(/(<[^>]+>|\*\*[^*]+\*\*|\*[^*]+\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <strong key={i} className="font-semibold">{part.slice(1, -1)}</strong>
    }
    // Slack link: <url|label> or <url>
    if (part.startsWith('<') && part.endsWith('>')) {
      const inner = part.slice(1, -1)
      // @mention: <@U123|Name> or <@U123>
      if (inner.startsWith('@')) {
        const pipeIdx = inner.indexOf('|')
        const name = pipeIdx > 0 ? inner.slice(pipeIdx + 1) : inner
        return <span key={i} className="text-blue-500 dark:text-blue-400 font-medium">@{name}</span>
      }
      // Channel: <#C123|name>
      if (inner.startsWith('#')) {
        const pipeIdx = inner.indexOf('|')
        const name = pipeIdx > 0 ? inner.slice(pipeIdx + 1) : inner
        return <span key={i} className="text-blue-500 dark:text-blue-400 font-medium">#{name}</span>
      }
      // URL with label: <url|label>
      const pipeIdx = inner.indexOf('|')
      if (pipeIdx > 0) {
        const url = inner.slice(0, pipeIdx)
        const label = inner.slice(pipeIdx + 1)
        return <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 dark:text-blue-400 hover:underline">{label}</a>
      }
      // Plain URL: <url>
      if (inner.startsWith('http')) {
        return <a key={i} href={inner} target="_blank" rel="noopener noreferrer" className="text-blue-500 dark:text-blue-400 hover:underline">{inner.length > 60 ? inner.slice(0, 57) + '...' : inner}</a>
      }
      return part
    }
    return part
  })
}

function friendlyChannelName(name: string): string {
  // mpdm-alice--bob--charlie-1 → "Group DM: Alice, Bob, Charlie"
  if (name.startsWith('mpdm-')) {
    const inner = name.replace(/^mpdm-/, '').replace(/-\d+$/, '')
    const people = inner.split('--').map(n =>
      n.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    )
    return `Group DM: ${people.join(', ')}`
  }
  return name
}

const POLL_INTERVAL = 60_000 // refresh thread every 60s

export function SlackThreadPreview({ ref_, label, onUnreadChange, defaultExpanded = false, focusThreadTs = null, draftReply = null }: SlackThreadPreviewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [data, setData] = useState<ThreadData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [activeThread, setActiveThread] = useState<{ threadTs: string; parentText: string; replies: ThreadReply[] } | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [channelText, setChannelText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendingChannel, setSendingChannel] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const threadScrollRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const parts = ref_.split('/')
  const channel = parts[0]
  const ts = parts[1] || null
  // When focusThreadTs is set, always fetch channel messages (not thread-only)
  const isChannelOnly = !ts || !!focusThreadTs
  const msgTs = focusThreadTs || ts
  const slackLink = channel && msgTs
    ? `https://attentiontech.slack.com/archives/${channel}/p${msgTs.replace('.', '')}`
    : `https://attentiontech.slack.com/archives/${channel}`

  const fetchThread = useCallback(() => {
    if (!channel) return Promise.resolve()
    // focusThreadTs mode: always fetch channel messages, we'll open the thread separately
    const url = isChannelOnly
      ? `/api/slack-channel/${channel}`
      : `/api/slack-thread/${channel}/${ts}`
    return fetch(url)
      .then(res => res.ok ? res.json() : null)
      .then((result: ThreadData | null) => {
        if (result) {
          setData(result)
          setUnreadCount(result.unreadCount)
          onUnreadChange?.(ref_, result.unreadCount)
        }
        return result
      })
      .catch(() => null)
  }, [channel, ts, isChannelOnly, ref_, onUnreadChange]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch on mount AND when ref_ changes (fixes stale data when queue advances)
  useEffect(() => {
    setData(null)
    setActiveThread(null)
    setLoading(true)
    setError(false)
    setReplyText(draftReply || '')
    fetchThread().then(async (result) => {
      setLoading(false)
      if (!result || !defaultExpanded) return

      if (focusThreadTs) {
        // Focus mode: auto-open the specific thread that triggered this mention
        // Check if the root message is already in the channel messages
        const rootInChannel = (result.messages || []).some(
          (m: ThreadMessage) => m.threadTs === focusThreadTs
        )
        let rootText = ''
        if (rootInChannel) {
          const rootMsg = (result.messages || []).find((m: ThreadMessage) => m.threadTs === focusThreadTs)
          rootText = rootMsg?.text || ''
        } else {
          // Root message is older than the recent channel messages — fetch and inject it
          try {
            const rootRes = await fetch(`/api/slack-thread/${channel}/${focusThreadTs}`)
            if (rootRes.ok) {
              const threadData = await rootRes.json()
              const rootMsg = threadData.messages?.[0]
              if (rootMsg) {
                rootText = rootMsg.text
                // Inject root message at the end with a separator marker
                setData(prev => prev ? {
                  ...prev,
                  messages: [
                    ...prev.messages,
                    { ...rootMsg, isThreadOrigin: true, replyCount: threadData.messages.length - 1, threadTs: focusThreadTs, latestReplyTs: threadData.messages[threadData.messages.length - 1]?.ts },
                  ],
                } : prev)
              }
            }
          } catch {}
        }
        // Auto-open the focus thread
        openThread(focusThreadTs, rootText)
      } else if (focusThreadTs !== '' && isChannelOnly) {
        // DM/channel mode (focusThreadTs is null, not empty string):
        // auto-open the most recent thread with replies
        const threaded = (result.messages || [])
          .filter((m: ThreadMessage) => m.replyCount && m.replyCount > 0 && m.threadTs)
        if (threaded.length > 0) {
          const last = threaded[threaded.length - 1]
          openThread(last.threadTs!, last.text)
        }
      }
    }).catch(() => { setError(true); setLoading(false) })
  }, [ref_, focusThreadTs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new messages
  useEffect(() => {
    pollRef.current = setInterval(fetchThread, POLL_INTERVAL)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchThread])

  // Scroll: if focusThreadTs, scroll to the thread origin message; otherwise scroll to bottom
  useEffect(() => {
    if (expanded && data && scrollRef.current) {
      if (focusThreadTs) {
        // Scroll to the thread origin / focus message
        const focusEl = scrollRef.current.querySelector('[data-thread-origin]')
        if (focusEl) {
          focusEl.scrollIntoView({ block: 'center' })
          return
        }
      }
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [expanded, data]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll thread panel to bottom when replies load
  useEffect(() => {
    if (activeThread && activeThread.replies.length > 0 && threadScrollRef.current) {
      threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight
    }
  }, [activeThread?.replies.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mark as read when expanded
  const handleExpand = () => {
    const wasExpanded = expanded
    setExpanded(!expanded)
    if (!wasExpanded && data?.latestTs) {
      // Mark read
      const readUrl = isChannelOnly
        ? `/api/slack-channel/${channel}/read`
        : `/api/slack-thread/${channel}/${ts}/read`
      fetch(readUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latestTs: data.latestTs }),
      }).catch(() => {})
      setUnreadCount(0)
      onUnreadChange?.(ref_, 0)
      // Also clear isUnread flags on messages in local state
      setData(prev => prev ? {
        ...prev,
        unreadCount: 0,
        messages: prev.messages.map(m => ({ ...m, isUnread: false })),
      } : null)
    }
  }

  const openThread = async (threadTs: string, parentText: string) => {
    if (activeThread?.threadTs === threadTs) {
      setActiveThread(null)
      return
    }
    setLoadingThread(true)
    setActiveThread({ threadTs, parentText, replies: [] })
    try {
      const res = await fetch(`/api/slack-channel/${channel}/thread/${threadTs}`)
      if (res.ok) {
        const { messages: replies } = await res.json()
        setActiveThread({ threadTs, parentText, replies })
      }
    } catch {} finally {
      setLoadingThread(false)
    }
  }

  const messages = data?.messages || null
  const channelName = data?.channelName || null
  const colorMap = new Map<string, string>()

  // Recency opacity: most recent message brightest, older ones fade out more aggressively
  const recencyOpacity = (idx: number, total: number): number => {
    const fromEnd = total - 1 - idx
    if (fromEnd === 0) return 1.0
    if (fromEnd === 1) return 0.70
    if (fromEnd === 2) return 0.50
    if (fromEnd === 3) return 0.35
    if (fromEnd === 4) return 0.25
    return 0.18
  }

  return (
    <>
      <div
        className="rounded-lg bg-gray-50/30 dark:bg-white/[0.01] border border-gray-200/30 dark:border-white/[0.04] overflow-hidden"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Header — subtle, clickable to toggle */}
        <div className="flex items-center">
          <button
            onClick={handleExpand}
            className="flex-1 flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none hover:bg-gray-100/60 dark:hover:bg-white/[0.03] transition-colors text-left"
          >
            <SlackIcon size={16} />
            <span className="text-[14px] font-medium text-gray-400/80 dark:text-gray-500/80 flex-1">
              {channelName
              ? channelName.startsWith('mpdm-') ? friendlyChannelName(channelName)
                : /^[CDG][A-Z0-9]+$/.test(channelName) ? label  // Raw Slack channel/DM ID — use label
                : `#${channelName}`
              : label}
              {messages && (
                <span className="ml-1.5 text-gray-400/60 dark:text-gray-500/60 font-normal">
                  {messages.length} msg{messages.length !== 1 ? 's' : ''}
                </span>
              )}
            </span>
            {/* Unread badge */}
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 dark:bg-red-500/90 text-white text-[10px] font-medium">
                {unreadCount}
              </span>
            )}
            <span className={`text-[10px] text-gray-400/50 dark:text-gray-500/40 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}>
              &#x25BC;
            </span>
          </button>
          <a
            href={slackLink.replace(/^https:\/\//, 'googlechromes://')}
            onClick={(e) => { e.preventDefault(); window.open(slackLink, '_blank') }}
            className="flex items-center justify-center w-10 h-10 shrink-0 text-[13px] text-gray-400/60 hover:text-gray-600 dark:text-gray-500/40 dark:hover:text-gray-300 hover:bg-gray-100/60 dark:hover:bg-white/[0.03] transition-colors rounded-lg cursor-pointer"
            title="Open in Slack"
          >
            &#x2197;
          </a>
        </div>

        {/* Expandable messages */}
        {expanded && (
          <div className="border-t border-gray-200/30 dark:border-white/[0.04]">
            <div
              ref={scrollRef}
              className="px-4 py-3 max-h-[400px] overflow-y-auto"
            >
              {loading && !messages && (
                <div className="flex items-center gap-2 py-3">
                  <span className="w-3.5 h-3.5 border-2 border-gray-300/40 border-t-gray-500 rounded-full animate-spin" />
                  <span className="text-[12px] text-gray-400 dark:text-gray-500">Loading thread...</span>
                </div>
              )}
              {error && (
                <p className="text-[12px] text-red-400/80 dark:text-red-400/60 py-2">Failed to load thread</p>
              )}
              {messages && messages.map((msg, i) => {
                const isFocusMessage = msg.isThreadOrigin || (focusThreadTs && msg.threadTs === focusThreadTs)
                const fadeOpacity = hovered ? 1 : (isFocusMessage ? 1 : recencyOpacity(i, messages.length))
                return (
                <div key={i} style={{ opacity: fadeOpacity, transition: 'opacity 0.3s ease' }}
                  {...(msg.isThreadOrigin || (focusThreadTs && msg.threadTs === focusThreadTs) ? { 'data-thread-origin': '' } : {})}
                >
                  {/* Thread origin separator — injected root message from an older thread */}
                  {msg.isThreadOrigin && (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-blue-300/30 dark:bg-blue-500/15" />
                      <span className="text-[11px] font-medium text-blue-400/60 dark:text-blue-400/40 uppercase tracking-wider">Mentioned thread</span>
                      <div className="flex-1 h-px bg-blue-300/30 dark:bg-blue-500/15" />
                    </div>
                  )}
                  {/* Date header */}
                  {!msg.isThreadOrigin && shouldShowDateHeader(messages, i) && (
                    <div className="flex items-center gap-3 my-4 first:mt-0">
                      <div className="flex-1 h-px bg-gray-200/60 dark:bg-white/[0.06]" />
                      <span className="text-[11px] font-medium text-gray-400/50 dark:text-gray-500/40 uppercase tracking-wider">
                        {formatDateHeader(msg.ts)}
                      </span>
                      <div className="flex-1 h-px bg-gray-200/60 dark:bg-white/[0.06]" />
                    </div>
                  )}
                  {/* New messages divider */}
                  {msg.isUnread && (i === 0 || !messages[i - 1].isUnread) && (
                    <div className="flex items-center gap-3 my-3">
                      <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-500/20" />
                      <span className="text-[11px] font-medium text-amber-500/60 dark:text-amber-400/40 uppercase tracking-wider">New</span>
                      <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-500/20" />
                    </div>
                  )}
                  {/* Message row */}
                  <div className={`flex items-baseline gap-2.5 py-2 -mx-2 px-2 rounded ${
                    activeThread?.threadTs === msg.threadTs
                      ? 'bg-blue-50/60 dark:bg-blue-500/[0.06]'
                      : msg.isUnread
                        ? 'bg-amber-50/50 dark:bg-amber-500/[0.04] hover:bg-amber-100/50 dark:hover:bg-amber-500/[0.06]'
                        : 'hover:bg-gray-100/40 dark:hover:bg-white/[0.02]'
                  }`}>
                    <span className={`text-[14px] font-semibold w-[110px] shrink-0 truncate ${userColor(msg.who, !!msg.isMe, colorMap)}`}>
                      {msg.isMe ? 'You' : msg.who}
                    </span>
                    <span className="text-[15px] text-gray-500 dark:text-gray-400 leading-relaxed flex-1 min-w-0">
                      {renderText(msg.text)}
                    </span>
                    <span className="text-[11px] text-gray-300/80 dark:text-gray-600/80 shrink-0 ml-2 tabular-nums">
                      {formatTime(msg.ts)}
                    </span>
                  </div>
                  {/* Thread replies badge */}
                  {msg.replyCount != null && msg.replyCount > 0 && msg.threadTs && (
                    <button
                      onClick={() => openThread(msg.threadTs!, msg.text)}
                      className={`ml-[122px] mt-1 mb-2 flex items-center gap-2 py-1.5 px-3 rounded-md cursor-pointer transition-colors ${
                        activeThread?.threadTs === msg.threadTs
                          ? 'bg-blue-100/40 dark:bg-blue-500/[0.08] text-blue-500/80 dark:text-blue-400/70 font-medium'
                          : 'bg-blue-50/30 dark:bg-blue-500/[0.04] text-blue-400/70 dark:text-blue-400/50 hover:bg-blue-100/40 dark:hover:bg-blue-500/[0.08] hover:text-blue-500/80 dark:hover:text-blue-400/60'
                      }`}
                    >
                      <span className="text-[14px]">↳</span>
                      <span className="text-[14px] font-medium">{msg.replyCount} {msg.replyCount === 1 ? 'reply' : 'replies'}</span>
                      {msg.latestReplyTs && (
                        <span className="text-[12px] opacity-60 ml-1">
                          · {formatDateHeader(msg.latestReplyTs)} {formatTime(msg.latestReplyTs)}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                )
              })}
            </div>
            {/* Channel reply input — always visible for sending to channel */}
            <div className="sticky bottom-0 bg-gray-50/95 dark:bg-[#1c1c1e]/95 backdrop-blur-sm border-t border-gray-200/30 dark:border-white/[0.04] px-3 py-2">
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!channelText.trim() || sendingChannel) return
                  setSendingChannel(true)
                  try {
                    const res = await fetch(`/api/slack-reply/${channel}/channel`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ text: channelText.trim() }),
                    })
                    if (res.ok) {
                      const newMsg: ThreadMessage = { who: 'You', isMe: true, text: channelText.trim(), ts: String(Date.now() / 1000) }
                      setData(prev => prev ? { ...prev, messages: [...prev.messages, newMsg] } : prev)
                      setChannelText('')
                    }
                  } catch {} finally {
                    setSendingChannel(false)
                  }
                }}
                className="flex items-end gap-2"
              >
                <MentionTextarea
                  value={channelText}
                  onChange={setChannelText}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLTextAreaElement).form?.requestSubmit() } e.stopPropagation() }}
                  onKeyUp={(e) => e.stopPropagation()}
                  placeholder={channelName ? `Message ${channelName.startsWith('mpdm-') ? 'group' : '#' + channelName}...` : 'Message channel...'}
                  rows={1}
                  className="w-full text-[14px] bg-white dark:bg-white/[0.05] border border-gray-200/50 dark:border-white/[0.08] rounded-md px-3 py-2.5 text-gray-700 dark:text-gray-300 placeholder-gray-400/60 dark:placeholder-gray-500/40 focus:outline-none focus:border-blue-400/50 dark:focus:border-blue-500/30 transition-colors resize-none"
                  disabled={sendingChannel}
                />
                <button
                  type="submit"
                  disabled={!channelText.trim() || sendingChannel}
                  className="text-[13px] font-medium text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-default cursor-pointer px-2 py-2.5 transition-colors"
                >
                  {sendingChannel ? '...' : 'Send'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Thread panel — separate container outside the Slack panel, same visual style */}
      {expanded && activeThread && (
        <div
          ref={threadScrollRef}
          className="mt-3 max-h-[350px] overflow-y-auto rounded-lg bg-gray-50/30 dark:bg-white/[0.01] border border-gray-200/30 dark:border-white/[0.04]"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Thread panel header */}
          <div className="sticky top-0 bg-gray-50/90 dark:bg-[#1c1c1e]/90 backdrop-blur-sm px-4 py-2.5 border-b border-gray-200/30 dark:border-white/[0.04] flex items-center justify-between z-10">
            <span className="text-[12px] font-semibold text-gray-400/80 dark:text-gray-500/80 uppercase tracking-wider">Thread</span>
            <div className="flex items-center gap-1">
              <a
                href={`https://attentiontech.slack.com/archives/${channel}/p${activeThread.threadTs.replace('.', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-gray-400/60 hover:text-gray-600 dark:text-gray-500/40 dark:hover:text-gray-300 px-1 transition-colors"
                title="Open thread in Slack"
              >
                &#x2197;
              </a>
              <button
                onClick={() => setActiveThread(null)}
                className="text-[15px] text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-pointer px-1"
              >
                ✕
              </button>
            </div>
          </div>
          {/* Replies */}
          <div className="px-4 py-2">
            {loadingThread && activeThread.replies.length === 0 && (
              <div className="flex items-center gap-2 py-3">
                <span className="w-3 h-3 border-2 border-blue-300/40 border-t-blue-500 rounded-full animate-spin" />
                <span className="text-[13px] text-gray-400 dark:text-gray-500">Loading replies...</span>
              </div>
            )}
            {activeThread.replies.map((reply, ri) => {
              const isLastReply = ri === activeThread.replies.length - 1
              const replyFade = hovered ? 1 : recencyOpacity(ri, activeThread.replies.length)
              return (
              <div key={ri} style={{ opacity: replyFade, transition: 'opacity 0.3s ease' }}>
                {shouldShowDateHeader(activeThread.replies as ThreadMessage[], ri) && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-gray-200/60 dark:bg-white/[0.06]" />
                    <span className="text-[11px] font-medium text-gray-400/50 dark:text-gray-500/40 uppercase tracking-wider">
                      {formatDateHeader(reply.ts)}
                    </span>
                    <div className="flex-1 h-px bg-gray-200/60 dark:bg-white/[0.06]" />
                  </div>
                )}
                <div className={`flex items-baseline gap-2.5 py-2 -mx-2 px-2 rounded ${
                  isLastReply
                    ? 'bg-blue-50/40 dark:bg-blue-500/[0.04]'
                    : 'hover:bg-gray-100/40 dark:hover:bg-white/[0.02]'
                }`}>
                  <span className={`text-[14px] font-semibold w-[100px] shrink-0 truncate ${userColor(reply.who, !!reply.isMe, colorMap)}`}>
                    {reply.isMe ? 'You' : reply.who}
                  </span>
                  <span className="text-[15px] text-gray-500 dark:text-gray-400 leading-relaxed flex-1 min-w-0">
                    {renderText(reply.text)}
                  </span>
                  <span className="text-[11px] text-gray-300/80 dark:text-gray-600/80 shrink-0 ml-2 tabular-nums">
                    {formatTime(reply.ts)}
                  </span>
                </div>
              </div>
              )
            })}
          </div>
          {/* Reply input */}
          <div className="sticky bottom-0 bg-gray-50/95 dark:bg-[#1c1c1e]/95 backdrop-blur-sm border-t border-gray-200/30 dark:border-white/[0.04] px-3 py-2">
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (!replyText.trim() || sending) return
                setSending(true)
                try {
                  const res = await fetch(`/api/slack-reply/${channel}/${activeThread.threadTs}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: replyText.trim() }),
                  })
                  if (res.ok) {
                    const newReply: ThreadReply = { who: 'You', isMe: true, text: replyText.trim(), ts: String(Date.now() / 1000) }
                    setActiveThread(prev => prev ? { ...prev, replies: [...prev.replies, newReply] } : prev)
                    setReplyText('')
                  }
                } catch {} finally {
                  setSending(false)
                }
              }}
              className="flex items-end gap-2"
            >
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLTextAreaElement).form?.requestSubmit() } e.stopPropagation() }}
                onKeyUp={(e) => e.stopPropagation()}
                placeholder="Reply in thread..."
                rows={2}
                className="w-full text-[14px] bg-white dark:bg-white/[0.05] border border-gray-200/50 dark:border-white/[0.08] rounded-md px-3 py-2.5 text-gray-700 dark:text-gray-300 placeholder-gray-400/60 dark:placeholder-gray-500/40 focus:outline-none focus:border-blue-400/50 dark:focus:border-blue-500/30 transition-colors resize-none"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={!replyText.trim() || sending}
                className="text-[13px] font-medium text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-default cursor-pointer px-2 py-2.5 transition-colors"
              >
                {sending ? '...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
