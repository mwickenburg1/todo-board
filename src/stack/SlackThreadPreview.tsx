import { useState, useEffect, useRef, useCallback } from 'react'

interface ThreadMessage {
  who: string
  isMe: boolean
  text: string
  ts: string
  isUnread?: boolean
}

interface ThreadData {
  channelName: string
  messages: ThreadMessage[]
  unreadCount: number
  latestTs: string | null
}

interface SlackThreadPreviewProps {
  ref_: string   // "channel/ts" format
  label: string  // "#channel-name" or similar
  onUnreadChange?: (ref: string, count: number) => void
  defaultExpanded?: boolean
}

// Deterministic color per user name — muted, readable palette
const USER_COLORS = [
  'text-blue-600 dark:text-blue-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-amber-600 dark:text-amber-400',
  'text-rose-600 dark:text-rose-400',
  'text-violet-600 dark:text-violet-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-orange-600 dark:text-orange-400',
  'text-teal-600 dark:text-teal-400',
]

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function userColor(name: string, colorMap: Map<string, string>): string {
  if (!colorMap.has(name)) {
    colorMap.set(name, USER_COLORS[hashName(name) % USER_COLORS.length])
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
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    return part
  })
}

const POLL_INTERVAL = 60_000 // refresh thread every 60s

export function SlackThreadPreview({ ref_, label, onUnreadChange, defaultExpanded = false }: SlackThreadPreviewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [data, setData] = useState<ThreadData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const parts = ref_.split('/')
  const channel = parts[0]
  const ts = parts[1] || null
  const isChannelOnly = !ts
  const slackLink = channel && ts
    ? `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`
    : `https://slack.com/app_redirect?channel=${channel}`

  const fetchThread = useCallback(() => {
    if (!channel) return Promise.resolve()
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
  }, [channel, ts, isChannelOnly, ref_, onUnreadChange])

  // Fetch on mount to get unread count for the badge
  useEffect(() => {
    setLoading(true)
    fetchThread().then(() => setLoading(false)).catch(() => { setError(true); setLoading(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new messages
  useEffect(() => {
    pollRef.current = setInterval(fetchThread, POLL_INTERVAL)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchThread])

  // Scroll to bottom when expanded and messages available
  useEffect(() => {
    if (expanded && data && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [expanded, data])

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

  const messages = data?.messages || null
  const channelName = data?.channelName || null
  const colorMap = new Map<string, string>()

  return (
    <div className="rounded-lg bg-gray-50/60 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/[0.06] overflow-hidden">
      {/* Header — subtle, clickable to toggle */}
      <div className="flex items-center">
        <button
          onClick={handleExpand}
          className="flex-1 flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none hover:bg-gray-100/60 dark:hover:bg-white/[0.03] transition-colors text-left"
        >
          <SlackIcon size={16} />
          <span className="text-[13px] font-medium text-gray-500 dark:text-gray-400 flex-1">
            {channelName ? `#${channelName}` : label}
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
          href={slackLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center w-10 h-10 shrink-0 text-[13px] text-gray-400/60 hover:text-gray-600 dark:text-gray-500/40 dark:hover:text-gray-300 hover:bg-gray-100/60 dark:hover:bg-white/[0.03] transition-colors rounded-lg"
          title="Open in Slack"
        >
          &#x2197;
        </a>
      </div>

      {/* Expandable messages */}
      {expanded && (
        <div
          ref={scrollRef}
          className="border-t border-gray-200/40 dark:border-white/[0.05] px-4 py-3 max-h-[350px] overflow-y-auto"
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
          {messages && messages.map((msg, i) => (
            <div key={i}>
              {/* Date header */}
              {shouldShowDateHeader(messages, i) && (
                <div className="flex items-center gap-3 my-2.5 first:mt-0">
                  <div className="flex-1 h-px bg-gray-200/60 dark:bg-white/[0.06]" />
                  <span className="text-[10px] font-medium text-gray-400/70 dark:text-gray-500/60 uppercase tracking-wider">
                    {formatDateHeader(msg.ts)}
                  </span>
                  <div className="flex-1 h-px bg-gray-200/60 dark:bg-white/[0.06]" />
                </div>
              )}
              {/* New messages divider */}
              {msg.isUnread && (i === 0 || !messages[i - 1].isUnread) && (
                <div className="flex items-center gap-3 my-2">
                  <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-500/20" />
                  <span className="text-[10px] font-medium text-amber-500/60 dark:text-amber-400/40 uppercase tracking-wider">New</span>
                  <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-500/20" />
                </div>
              )}
              {/* Message row */}
              <div className={`flex items-baseline gap-3 py-1.5 -mx-2 px-2 rounded ${
                msg.isUnread
                  ? 'bg-amber-50/50 dark:bg-amber-500/[0.04] hover:bg-amber-100/50 dark:hover:bg-amber-500/[0.06]'
                  : 'hover:bg-gray-100/40 dark:hover:bg-white/[0.02]'
              }`}>
                <span className={`text-[14px] font-semibold w-[110px] shrink-0 truncate ${userColor(msg.who, colorMap)}`}>
                  {msg.isMe ? 'You' : msg.who}
                </span>
                <span className="text-[15px] text-gray-600 dark:text-gray-300 leading-relaxed flex-1 min-w-0">
                  {renderText(msg.text)}
                </span>
                <span className="text-[11px] text-gray-300 dark:text-gray-600 shrink-0 ml-4 tabular-nums">
                  {formatTime(msg.ts)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
