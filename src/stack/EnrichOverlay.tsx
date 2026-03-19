import React, { useState, useCallback } from 'react'

interface EnrichMessage {
  username: string
  channel: string
  isDM: boolean
  text: string
  permalink: string | null
}

interface Hypothesis {
  hypothesis: string
  confidence: 'high' | 'medium' | 'low'
  summary: string
  messages: EnrichMessage[]
}

interface EnrichOverlayProps {
  taskId: number
  taskText: string
  onClose: () => void
  onApplied: () => void
}

const CONFIDENCE_COLORS = {
  high: 'text-emerald-500',
  medium: 'text-amber-500',
  low: 'text-gray-400',
}

const CONFIDENCE_BG = {
  high: 'border-emerald-500/30 hover:border-emerald-500/60',
  medium: 'border-amber-500/30 hover:border-amber-500/60',
  low: 'border-gray-500/30 hover:border-gray-500/60',
}

const SlackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
  </svg>
)

export function EnrichOverlay({ taskId, taskText, onClose, onApplied }: EnrichOverlayProps) {
  const [loading, setLoading] = useState(true)
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [searchCount, setSearchCount] = useState(0)
  const [applying, setApplying] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Start search on mount
  React.useEffect(() => {
    fetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setHypotheses(data.hypotheses || [])
        setSearchCount(data.searchResultCount || 0)
        setLoading(false)
      })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [taskId])

  const applyHypothesis = useCallback((idx: number) => {
    const h = hypotheses[idx]
    if (!h) return
    setApplying(idx)

    fetch('/api/enrich/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId,
        hypothesis: h.hypothesis,
        summary: h.summary,
        messages: h.messages,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          onApplied()
          onClose()
        } else {
          setApplying(null)
          setError(data.error || 'Failed to apply')
        }
      })
      .catch(err => { setApplying(null); setError(err.message) })
  }, [hypotheses, taskId, onApplied, onClose])

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 rounded-2xl" onClick={onClose} />
      <div className="relative z-10 bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-purple-500"><SlackIcon /></span>
          <h3 className="text-[16px] font-semibold text-gray-800 dark:text-gray-100">
            Enrich from Slack
          </h3>
          <span className="text-[12px] text-gray-400 ml-auto">
            {!loading && `${searchCount} messages found`}
          </span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-[18px] leading-none ml-2">&times;</button>
        </div>

        <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4 truncate">
          &ldquo;{taskText}&rdquo;
        </p>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[14px] text-gray-400">Searching Slack &amp; synthesizing...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-[14px] text-red-500 py-4">{error}</p>
        )}

        {/* Hypotheses */}
        {!loading && !error && hypotheses.map((h, idx) => (
          <button
            key={idx}
            onClick={() => applyHypothesis(idx)}
            disabled={applying !== null}
            className={`w-full text-left border rounded-lg p-4 mb-3 transition-all ${CONFIDENCE_BG[h.confidence]} ${
              applying === idx ? 'opacity-50' : applying !== null ? 'opacity-30' : ''
            }`}
          >
            <div className="flex items-start gap-2">
              <span className={`text-[11px] font-bold uppercase mt-0.5 ${CONFIDENCE_COLORS[h.confidence]}`}>
                {h.confidence}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-gray-800 dark:text-gray-100 leading-snug">
                  {h.hypothesis}
                </p>
                {h.summary && (
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                    {h.summary}
                  </p>
                )}
                {h.messages.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {h.messages.slice(0, 3).map((m, mi) => (
                      <p key={mi} className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                        <span className={m.isDM ? 'text-purple-400' : 'text-blue-400'}>
                          {m.isDM ? 'DM' : `#${m.channel}`}
                        </span>
                        {' '}@{m.username}: {m.text.slice(0, 100)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {applying === idx && (
              <p className="text-[12px] text-purple-400 mt-2">Applying to notes...</p>
            )}
          </button>
        ))}

        {!loading && !error && hypotheses.length === 0 && (
          <p className="text-[14px] text-gray-400 py-4 text-center">No hypotheses generated.</p>
        )}
      </div>
    </div>
  )
}

export { SlackIcon }
