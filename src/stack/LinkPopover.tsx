import { useState, useEffect, useRef } from 'react'

export function LinkPopover({ onAdd, onClose }: {
  onAdd: (link: { type: string, ref: string, label?: string }) => void
  onClose: () => void
}) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) { onClose(); return }

    // Auto-detect link type from input
    let type = 'url', ref = trimmed, label = trimmed

    // Slack thread URL: https://workspace.slack.com/archives/C0ABC123/p1234567890123456
    const slackThreadMatch = trimmed.match(/slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/i)
    // Slack channel URL: https://app.slack.com/client/TXXXXX/CXXXXX or /archives/CXXXXX (no thread)
    const slackChannelMatch = trimmed.match(/slack\.com\/(?:client\/[A-Z0-9]+\/|archives\/)([CDGW][A-Z0-9]+)\s*$/i)
    if (slackThreadMatch) {
      type = 'slack_thread'
      const channel = slackThreadMatch[1]
      const rawTs = slackThreadMatch[2]
      ref = `${channel}/${rawTs.slice(0, 10)}.${rawTs.slice(10)}`
      label = `#${channel} thread`
    } else if (slackChannelMatch) {
      type = 'slack'
      ref = slackChannelMatch[1]
      label = `#${ref}`
    } else if (trimmed.match(/^[A-Z]\w+\/[\d.]+$/)) {
      type = 'slack_thread'
    } else if (/^[CDG][A-Z0-9]{8,}$/i.test(trimmed)) {
      // Raw channel/DM ID (e.g. C0ABC123, D0XYZ789)
      type = 'slack'
      ref = trimmed
      label = `#${ref}`
    } else if (/^[A-Z]+-\d+$/i.test(trimmed)) {
      type = 'linear'
    } else if (/claude/i.test(trimmed) || /^session[-_]/i.test(trimmed)) {
      type = 'claude_code'
    } else if (/github\.com/i.test(trimmed)) {
      type = 'github'
      label = trimmed.replace(/https?:\/\/github\.com\//, '')
    } else if (/^https?:\/\//.test(trimmed)) {
      try { label = new URL(trimmed).hostname } catch { label = trimmed }
    }

    onAdd({ type, ref, label })
    setInput('')
    onClose()
  }

  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-64"
      onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') onClose()
        }}
        onBlur={() => { if (!input.trim()) onClose() }}
        placeholder="Paste link, issue key, or URL..."
        className="w-full text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-blue-300"
      />
      <div className="text-[10px] text-gray-400 mt-1 px-1">
        ATT-123 &middot; slack thread/channel &middot; URL &middot; session-id
      </div>
    </div>
  )
}
