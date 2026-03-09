import { useState, useRef, type JSX } from 'react'
import type { TaskLink, TaskEvent } from '../shared/types'

// Link type logos — inline SVGs for each source type
export const linkLogos: Record<string, { icon: (props: { size?: number }) => JSX.Element, label: string }> = {
  slack_thread: {
    label: 'Slack',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
        <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
        <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
        <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
      </svg>
    ),
  },
  slack: {
    label: 'Slack',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
        <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
        <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
        <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
      </svg>
    ),
  },
  linear: {
    label: 'Linear',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M2.357 13.643a10.97 10.97 0 0 1-.354-2.165l10.52 10.519a10.97 10.97 0 0 1-2.166-.354L2.357 13.643zm-1.007-4.2a11.08 11.08 0 0 0-.227 1.07l12.364 12.364c.356-.06.715-.138 1.07-.227L1.35 9.443zm.837-2.263a11.027 11.027 0 0 0-.504 1.1L14.28 22.317c.383-.144.758-.308 1.1-.504L2.187 7.18zm1.205-1.96a11.09 11.09 0 0 0-.748 1.02L17.76 21.356c.357-.222.697-.474 1.02-.748L3.392 5.22zm2.042-1.726a11.015 11.015 0 0 0-.97.912l16.11 16.11c.33-.3.632-.625.912-.97L5.434 3.494zm2.513-1.558a11.123 11.123 0 0 0-1.13.724l16.023 16.023c.27-.36.51-.738.724-1.13L7.947 1.936zm2.816-1.114a10.952 10.952 0 0 0-1.293.453l14.24 14.24c.196-.42.343-.849.453-1.293L10.763.822zM24 12c0-1.37-.25-2.685-.71-3.896L7.897 22.497A10.988 10.988 0 0 0 12 24c6.627 0 12-5.373 12-12zM12 0C5.373 0 0 5.373 0 12c0 .736.067 1.457.194 2.163L14.163.194A12.1 12.1 0 0 0 12 0z" fill="#5E6AD2"/>
      </svg>
    ),
  },
  claude_code: {
    label: 'Claude',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M16.358 4.666l-4.324 14.669-2.063-.608 4.324-14.67 2.063.609zM19.4 7.2l4.2 4.8-4.2 4.8-1.5-1.312L21.55 12l-3.65-3.488L19.4 7.2zM4.6 7.2l-4.2 4.8 4.2 4.8 1.5-1.312L2.45 12l3.65-3.488L4.6 7.2z" fill="#D97706"/>
      </svg>
    ),
  },
  github: {
    label: 'GitHub',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" fill="#333"/>
      </svg>
    ),
  },
  url: {
    label: 'Link',
    icon: ({ size = 14 }) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    ),
  },
}

export function linkUrl(link: TaskLink): string | null {
  if (link.type === 'url' || link.type === 'github') {
    return /^https?:\/\//.test(link.ref) ? link.ref : null
  }
  if (link.type === 'linear') {
    return `https://linear.app/issue/${link.ref}`
  }
  if (link.type === 'slack_thread') {
    const [channel, ts] = link.ref.split('/')
    if (channel && ts) {
      return `https://attentiontech.slack.com/archives/${channel}/p${ts.replace('.', '')}`
    }
  }
  if (link.type === 'slack') {
    return `https://attentiontech.slack.com/archives/${link.ref}`
  }
  return null
}

function TypeBadge({ type, typeLinks, allLinks, onRemove }: {
  type: string
  typeLinks: TaskLink[]
  allLinks: TaskLink[]
  onRemove?: (idx: number) => void
}) {
  const [showPopover, setShowPopover] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const info = linkLogos[type] || linkLogos.url
  const Icon = info.icon
  const handleEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setShowPopover(true)
  }
  const handleLeave = () => {
    hideTimer.current = setTimeout(() => setShowPopover(false), 200)
  }

  return (
    <span
      className="relative inline-flex items-center gap-0.5 cursor-default opacity-70 hover:opacity-100 transition-opacity"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span className="inline-flex items-center justify-center w-4 h-4">
        <Icon size={14} />
      </span>
      {typeLinks.length > 1 && (
        <span className="absolute -top-1 -right-1 text-[8px] text-gray-400 font-medium leading-none">{typeLinks.length}</span>
      )}
      {showPopover && (
        <div
          className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px] max-w-[320px]"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onClick={e => e.stopPropagation()}
        >
          {typeLinks.map((link) => {
            const LinkIcon = (linkLogos[link.type] || linkLogos.url).icon
            const url = linkUrl(link)
            const globalIdx = allLinks.indexOf(link)
            return (
              <div
                key={globalIdx}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 group/link"
              >
                <span className="shrink-0 opacity-70"><LinkIcon size={12} /></span>
                {url ? (
                  link.type === 'slack_thread' || link.type === 'slack' ? (
                  <a
                    href={url.replace(/^https:\/\//, 'googlechromes://')}
                    onClick={(e) => { e.preventDefault(); window.open(url, '_blank') }}
                    className="flex-1 text-xs text-gray-700 dark:text-gray-300 hover:text-blue-600 truncate text-left cursor-pointer"
                  >
                    {link.label || link.ref}
                  </a>
                  ) : (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs text-gray-700 dark:text-gray-300 hover:text-blue-600 truncate"
                  >
                    {link.label || link.ref}
                  </a>
                  )
                ) : (
                  <span className="flex-1 text-xs text-gray-600 dark:text-gray-400 truncate">{link.label || link.ref}</span>
                )}
                {onRemove && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(globalIdx) }}
                    className="text-[10px] text-gray-300 hover:text-red-400 opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0"
                    title="Remove link"
                  >
                    &#x2715;
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}

const ENV_NUM_COLORS: Record<string, string> = {
  '1': 'text-blue-500 dark:text-blue-400',
  '2': 'text-emerald-500 dark:text-emerald-400',
  '3': 'text-amber-500 dark:text-amber-400',
  '4': 'text-purple-500 dark:text-purple-400',
  '5': 'text-rose-500 dark:text-rose-400',
  '6': 'text-cyan-500 dark:text-cyan-400',
  '7': 'text-orange-500 dark:text-orange-400',
  '8': 'text-indigo-500 dark:text-indigo-400',
  '9': 'text-pink-500 dark:text-pink-400',
  '10': 'text-red-500 dark:text-red-400',
}

function ClaudeEnvBadges({ typeLinks, allLinks, onRemove }: {
  typeLinks: TaskLink[]
  allLinks: TaskLink[]
  onRemove?: (idx: number) => void
}) {
  const [showPopover, setShowPopover] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setShowPopover(true)
  }
  const handleLeave = () => {
    hideTimer.current = setTimeout(() => setShowPopover(false), 200)
  }

  // Extract unique env numbers from labels
  const envNums = [...new Set(typeLinks.map(l => {
    const m = (l.label || '').match(/env(\d+)/)
    return m ? m[1] : null
  }).filter(Boolean))] as string[]

  return (
    <span
      className="relative inline-flex items-center gap-0 cursor-default"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {envNums.map(n => (
        <span key={n} className={`text-[10px] font-bold leading-none ${ENV_NUM_COLORS[n] || 'text-gray-400'}`}>
          {n === '10' ? '^0' : n}
        </span>
      ))}
      {showPopover && (
        <div
          className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[200px] max-w-[320px]"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onClick={e => e.stopPropagation()}
        >
          {typeLinks.map((link) => {
            const globalIdx = allLinks.indexOf(link)
            const envMatch = (link.label || '').match(/env(\d+)/)
            const envNum = envMatch ? envMatch[1] : null
            return (
              <div
                key={globalIdx}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 group/link"
              >
                {envNum && (
                  <span className={`text-[10px] font-bold shrink-0 ${ENV_NUM_COLORS[envNum] || 'text-gray-400'}`}>{envNum === '10' ? '^0' : envNum}</span>
                )}
                <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 truncate">{link.label || link.ref}</span>
                {onRemove && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(globalIdx) }}
                    className="text-[10px] text-gray-300 hover:text-red-400 opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0"
                    title="Remove link"
                  >
                    &#x2715;
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}

export function LinkBadges({ links, onRemove }: { links: TaskLink[], onRemove?: (idx: number) => void }) {
  if (!links || links.length === 0) return null

  const byType = new Map<string, TaskLink[]>()
  for (const link of links) {
    const existing = byType.get(link.type) || []
    existing.push(link)
    byType.set(link.type, existing)
  }

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {[...byType.entries()].map(([type, typeLinks]) =>
        type === 'claude_code' ? (
          <ClaudeEnvBadges key={type} typeLinks={typeLinks} allLinks={links} onRemove={onRemove} />
        ) : (
          <TypeBadge key={type} type={type} typeLinks={typeLinks} allLinks={links} onRemove={onRemove} />
        )
      )}
    </span>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

export function EventBadge({ events }: { events: TaskEvent[] }) {
  const [showPopover, setShowPopover] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (!events || events.length === 0) return null

  const handleEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setShowPopover(true)
  }
  const handleLeave = () => {
    hideTimer.current = setTimeout(() => setShowPopover(false), 200)
  }

  const recent = [...events].reverse().slice(0, 10)

  return (
    <span
      className="relative inline-flex items-center cursor-default"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span className="text-[9px] text-gray-400 bg-gray-50 dark:bg-gray-800 rounded px-1">
        {events.length}
      </span>
      {showPopover && (
        <div
          className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[240px] max-w-[360px]"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">
            Recent activity
          </div>
          {recent.map((ev, i) => (
            <div key={i} className="px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700">
              <div className="flex items-center gap-1.5">
                {linkLogos[ev.source] && (
                  <span className="shrink-0 opacity-60">
                    {linkLogos[ev.source].icon({ size: 10 })}
                  </span>
                )}
                <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{ev.author}</span>
                <span className="text-[10px] text-gray-300 dark:text-gray-600 ml-auto shrink-0">{timeAgo(ev.ts)}</span>
              </div>
              {ev.summary && (
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2 leading-snug">{ev.summary}</div>
              )}
            </div>
          ))}
          {events.length > 10 && (
            <div className="px-3 py-1 text-[10px] text-gray-300 dark:text-gray-600 text-center border-t border-gray-100 dark:border-gray-700">
              +{events.length - 10} older
            </div>
          )}
        </div>
      )}
    </span>
  )
}
