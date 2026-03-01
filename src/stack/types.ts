// Re-export shared types used across both board and stack views
export type { TaskLink, TaskEvent, Todo, TodoData } from '../shared/types'
import type { Todo, TaskLink, TaskEvent } from '../shared/types'

export interface StackItem {
  id: number | null
  text: string
  status: string
  groupName?: string
  envs: Set<string>
  waitingReason?: string
  sourceList: string
  children: StackItem[]
  childCount: number
  original: Todo
  escalation?: number
  links: TaskLink[]
  events: TaskEvent[]
}

export interface EnvSlotInfo {
  item: Todo | null
  status: string
}

export interface EnvStatusRemote {
  vm: string
  env: string
  branch: string
  status: string
  task: string
  lastActivity: string
  updated: string
}
