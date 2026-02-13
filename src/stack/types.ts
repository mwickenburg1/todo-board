export interface Todo {
  id: number | null
  text: string
  priority: number
  context: string
  status: 'pending' | 'in_progress' | 'done'
  parent_id: number | null
  children?: Todo[]
  childCount?: number
  focus_slot?: string
  is_empty_slot?: boolean
  stored_category?: string
  in_progress_order?: number
}

export interface TodoData {
  lists: {
    now?: Todo[]
    today?: Todo[]
    tomorrow?: Todo[]
    backlog?: Todo[]
    monitoring?: Todo[]
    done?: Todo[]
    [key: string]: Todo[] | undefined
  }
  stacks?: string[]
}

export interface StackItem {
  id: number | null
  text: string
  status: string
  groupName?: string
  linkedEnv?: string
  waitingReason?: string
  sourceList: string
  children: StackItem[]
  childCount: number
  original: Todo
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
