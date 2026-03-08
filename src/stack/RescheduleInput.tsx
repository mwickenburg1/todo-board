import { useState, useRef, useEffect } from 'react'

interface RescheduleInputProps {
  onSubmit: (text: string, confirm?: boolean) => Promise<{ action?: string; until?: string }>
  onClose: () => void
}

export function RescheduleInput({ onSubmit, onClose }: RescheduleInputProps) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await onSubmit(text.trim())
      if (result.action === 'preview') {
        setPreview(result.until!)
        setLoading(false)
      }
    } catch {
      setError('Failed to parse time')
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (loading) return
    setLoading(true)
    try {
      await onSubmit(text.trim(), true)
    } catch {
      setError('Failed to reschedule')
      setLoading(false)
    }
  }

  // Window-level key listener for confirmation phase (no input to capture keys)
  useEffect(() => {
    if (!preview) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); handleConfirm() }
      if (e.key === 'Escape') { e.preventDefault(); setPreview(null); setTimeout(() => inputRef.current?.focus(), 0) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [preview]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') handleSubmit()
  }

  return (
    <div
      ref={backdropRef}
      className="absolute inset-0 z-50 flex items-start justify-center"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="w-full bg-white dark:bg-[#1c1c1e] rounded-2xl border border-gray-200/80 dark:border-white/[0.08] shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_4px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_4px_16px_rgba(0,0,0,0.4)] overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4">
          <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-amber-500 dark:text-amber-400 shrink-0">
            Reschedule
          </span>

          {!preview ? (
            <>
              <input
                ref={inputRef}
                value={text}
                onChange={e => { setText(e.target.value); setError(null) }}
                onKeyDown={handleInputKeyDown}
                placeholder="2pm today, tomorrow morning, next Monday..."
                className="flex-1 bg-transparent text-[15px] text-gray-800 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-600"
                disabled={loading}
                autoFocus
              />
              {loading && (
                <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">parsing...</span>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center gap-3">
              <span className="text-[15px] text-gray-800 dark:text-gray-100">{preview}</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">
                  ↵
                </kbd>
                {' '}confirm
              </span>
            </div>
          )}

          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}
          <kbd className="px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-200/80 dark:border-white/[0.08]">
            esc
          </kbd>
        </div>
      </div>
    </div>
  )
}
