/**
 * Content-aware alert rules for the Focus Queue.
 *
 * Each rule evaluates the current top item and returns an alert
 * (or null) based on card type, content patterns, fleet data, etc.
 *
 * To add a new alert: append a rule function to ALERT_RULES.
 */

interface FleetEnv {
  env: string
  tasks: { id: number; text: string; list: string; status: string; hasClaudeLink: boolean }[]
}

interface TopItem {
  id: number
  kind: string
  label: string
  sublabel?: string
  actionVerb: string
  fleet?: FleetEnv[]
}

export interface FocusAlert {
  text: string
  severity: 'error' | 'warning' | 'info'
}

type AlertRule = (top: TopItem) => FocusAlert | null

const ALERT_RULES: AlertRule[] = [
  // Fleet: items without [Label] or (Label) prefix
  (top) => {
    if (top.kind !== 'fleet' || !top.fleet) return null
    const count = top.fleet.reduce(
      (n, env) => n + env.tasks.filter(t => !/^[\(\[][^\)\]]+[\)\]]/.test(t.text)).length, 0
    )
    if (count === 0) return null
    return { text: `${count} unlabeled`, severity: 'error' }
  },

  // Fleet: items not yet linked to Claude Code
  (top) => {
    if (top.kind !== 'fleet' || !top.fleet) return null
    const count = top.fleet.reduce(
      (n, env) => n + env.tasks.filter(t => !t.hasClaudeLink).length, 0
    )
    if (count === 0) return null
    return { text: `${count} not linked`, severity: 'info' }
  },
]

const SEVERITY_STYLES = {
  error: {
    bg: 'bg-red-50 dark:bg-red-500/10',
    border: 'border-red-200/60 dark:border-red-400/20',
    text: 'text-red-600 dark:text-red-400',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200/60 dark:border-amber-400/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    border: 'border-blue-200/60 dark:border-blue-400/20',
    text: 'text-blue-600 dark:text-blue-400',
  },
}

export function evaluateAlerts(top: TopItem): FocusAlert[] {
  return ALERT_RULES.map(rule => rule(top)).filter((a): a is FocusAlert => a !== null)
}

export function alertStyle(severity: FocusAlert['severity']) {
  return SEVERITY_STYLES[severity]
}
