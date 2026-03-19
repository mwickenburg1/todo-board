import type { PR } from './PRView'
import type { DeadlineItem } from './DeadlineView'

export interface FleetEnv {
  env: string
  tasks: { id: number; text: string; list: string; status: string; escalation: number; hasClaudeLink: boolean; claudeLinks: { label: string; ref: string; idx: number }[]; deadline: string | null }[]
}

export interface FocusResponse {
  empty: boolean
  depth: number
  snoozeMinutes?: number
  top?: {
    id: number
    kind: string
    label: string
    sublabel?: string
    actionVerb: string
    rescheduledUntilMs?: number
    rescheduledReason?: string
    emphasizedHotkeys?: string[]
    fleet?: FleetEnv[]
    from?: string | null
    channelLabel?: string | null
    isFireDrill?: boolean
    slackThread?: { who: string; text: string }[] | null
    slackRef?: string | null
    context?: string | null
    suggestion?: string | null
    draftReply?: string | null
    slackContext?: { label: string; ref: string }[] | null
    env?: string | null
    claudeLinks?: { label: string; ref: string; idx: number }[] | null
    priorityTasks?: { id: number; text: string; env: string | null; escalation: number; isFireDrill: boolean; deadline: string | null; status?: string }[]
    notes?: string
    hasConversation?: boolean
    prs?: PR[]
    deadlineItems?: DeadlineItem[]
    activityEntries?: { ts: string; type: string; detail: string | null; session_id: string | null; env: string | null; task_id: number | null }[]
    prepItems?: { id: number; text: string; env: string | null; notes: string; priority: number; escalation: number; hasClaudeLink: boolean }[]
    turnCount?: number
    envHealth?: string
    slackWatch?: {
      ref: string
      surfaceReason: 'activity' | 'nudge' | null
      surfaceContext: { who: string; text: string }[] | null
      delegateOnly: boolean
    } | null
    actions?: TriageAction[] | null
    keyMessageTs?: string[] | null
    slackPanelEmphasis?: 'emphasized' | 'faded'
    replyFirst?: boolean
    visitedAt?: string | null
  }
}

export interface TriageAction {
  type: 'reply' | 'track' | 'watch' | 'done' | 'snooze'
  draft?: string
  taskText?: string
  delegateOnly?: boolean
  checkHours?: number
  deadline?: string
}

export interface PinnedTaskData {
  id: number
  text: string
  list: string
  status: string
  env: string | null
  notes: string
  deadline: string | null
  slackContext: { label: string; ref: string }[] | null
  claudeLinks: { label: string; ref: string; idx: number }[]
  hasConversation: boolean
}
