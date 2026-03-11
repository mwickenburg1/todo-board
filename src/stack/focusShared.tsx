export const ENV_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  env1: { bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-200/60 dark:border-red-400/20', text: 'text-red-600 dark:text-red-400' },
  env2: { bg: 'bg-orange-50 dark:bg-orange-500/10', border: 'border-orange-200/60 dark:border-orange-400/20', text: 'text-orange-600 dark:text-orange-400' },
  env3: { bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200/60 dark:border-amber-400/20', text: 'text-amber-600 dark:text-amber-400' },
  env4: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200/60 dark:border-emerald-400/20', text: 'text-emerald-600 dark:text-emerald-400' },
  env5: { bg: 'bg-teal-50 dark:bg-teal-500/10', border: 'border-teal-200/60 dark:border-teal-400/20', text: 'text-teal-600 dark:text-teal-400' },
  env6: { bg: 'bg-blue-50 dark:bg-blue-500/10', border: 'border-blue-200/60 dark:border-blue-400/20', text: 'text-blue-600 dark:text-blue-400' },
  env7: { bg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'border-indigo-200/60 dark:border-indigo-400/20', text: 'text-indigo-600 dark:text-indigo-400' },
  env8: { bg: 'bg-purple-50 dark:bg-purple-500/10', border: 'border-purple-200/60 dark:border-purple-400/20', text: 'text-purple-600 dark:text-purple-400' },
  env9: { bg: 'bg-pink-50 dark:bg-pink-500/10', border: 'border-pink-200/60 dark:border-pink-400/20', text: 'text-pink-600 dark:text-pink-400' },
  env10: { bg: 'bg-rose-50 dark:bg-rose-500/10', border: 'border-rose-200/60 dark:border-rose-400/20', text: 'text-rose-600 dark:text-rose-400' },
}

export const ESCALATION_COLORS = [
  '', // 0 = none
  'text-amber-500 dark:text-amber-400',   // !
  'text-red-500 dark:text-red-400',        // !!
  'text-fuchsia-500 dark:text-fuchsia-400', // !!!
]

export const REMOTE_ENVS: Record<string, { space: number }> = {
  env5: { space: 5 }, env6: { space: 6 }, env7: { space: 7 }, env8: { space: 8 }, env9: { space: 9 }, env10: { space: 10 },
}

export function showToast(message: string, duration = 10000) {
  const el = document.createElement('div')
  el.textContent = message
  Object.assign(el.style, {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    background: '#1e1e2e', color: '#cdd6f4', padding: '10px 20px',
    borderRadius: '8px', fontSize: '13px', fontWeight: '500',
    zIndex: '9999', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transition: 'opacity 0.3s', opacity: '1',
  })
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, duration)
}

export function openFleetEnv(env: string, copyPrompt?: string) {
  const remote = REMOTE_ENVS[env]
  if (remote) {
    if (copyPrompt) {
      navigator.clipboard.writeText(copyPrompt).catch(() => {})
      showToast(`\u2303${envNum(env)} to switch \u00b7 /link copied`)
    } else {
      showToast(`\u2303${envNum(env)} to switch`)
    }
    return
  }
  const path = `/home/ubuntu/${env}.code-workspace`
  const host = import.meta.env.VITE_SSH_HOST || 'dev-vm'
  const uri = `cursor://vscode-remote/ssh-remote+${host}${path}`
  window.location.href = uri
  if (copyPrompt) {
    navigator.clipboard.writeText(copyPrompt).catch(() => {})
  }
}

/** Display label for an env: env10 → "^0", env3 → "3" */
export function envLabel(env: string): string {
  const n = env.replace('env', '')
  return n === '10' ? '^0' : n
}

/** Short number for env: env10 → "0", env3 → "3". Use where ⌃ prefix is already shown. */
export function envNum(env: string): string {
  const n = env.replace('env', '')
  return n === '10' ? '0' : n
}

/** Smart deadline label: "9 AM" for today, "Fri 9 AM" for this week, "Mar 15" for this year, "Mar 15 '27" for future years */
export function smartDeadlineLabel(d: string): { label: string; color: string } {
  const now = new Date()
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const today = nyNow.toLocaleDateString('en-CA')
  const ds = d.includes('T') ? new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : d
  const isPast = d.includes('T') ? new Date(d).getTime() < Date.now() : ds < today
  const isToday = ds === today

  // Color
  const color = isPast ? 'text-red-500 dark:text-red-400' : isToday ? 'text-amber-500 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'

  // Time string if datetime
  const timeStr = d.includes('T') ? new Date(d).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }) : null

  // Today: just show time (e.g. "9 AM") or "Today"
  if (isToday) return { label: timeStr || 'Today', color }

  // Parse the target date
  const target = d.includes('T') ? new Date(d) : new Date(ds + 'T12:00:00')
  const targetNY = new Date(target.toLocaleString('en-US', { timeZone: 'America/New_York' }))

  // Days difference
  const todayStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), nyNow.getDate())
  const targetStart = new Date(targetNY.getFullYear(), targetNY.getMonth(), targetNY.getDate())
  const diffDays = Math.round((targetStart.getTime() - todayStart.getTime()) / 86400000)

  // Tomorrow
  if (diffDays === 1) return { label: timeStr ? `Tomorrow ${timeStr}` : 'Tomorrow', color }

  // Yesterday
  if (diffDays === -1) return { label: timeStr ? `Yesterday ${timeStr}` : 'Yesterday', color }

  // This week (within 6 days forward)
  if (diffDays > 1 && diffDays <= 6) {
    const dayName = target.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' })
    return { label: timeStr ? `${dayName} ${timeStr}` : dayName, color }
  }

  // Same year
  const thisYear = nyNow.getFullYear()
  const targetYear = targetNY.getFullYear()
  const monthDay = target.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
  if (targetYear === thisYear) return { label: timeStr ? `${monthDay} ${timeStr}` : monthDay, color }

  // Different year
  const shortYear = `'${String(targetYear).slice(2)}`
  return { label: timeStr ? `${monthDay} ${shortYear} ${timeStr}` : `${monthDay} ${shortYear}`, color }
}

export function StyledTaskText({ text }: { text: string }) {
  const parts = text.split(/(\([^)]*\)|\[[^\]]*\])/)
  return (
    <>
      {parts.map((part, i) =>
        /^[\(\[]/.test(part)
          ? <span key={i} className="font-medium text-gray-600 dark:text-gray-300">{part}</span>
          : <span key={i} className="font-normal text-gray-400 dark:text-gray-500">{part}</span>
      )}
    </>
  )
}
