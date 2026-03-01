export interface TaskLink {
  type: string      // 'slack_thread' | 'linear' | 'claude_code' | 'url' | ...
  ref: string       // source-specific reference (channel/ts, issue key, session id, url)
  label: string     // human-readable label
  icon: string      // icon key for display
  added: string     // ISO timestamp
}

export interface TaskEvent {
  source: string
  ref: string
  summary: string
  author: string
  ts: string
  metadata?: Record<string, unknown>
}

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
  escalation?: number  // 0=none, 1=!, 2=!!
  links?: TaskLink[]
  events?: TaskEvent[]
}

export interface TodoData {
  lists: {
    now?: Todo[]
    queue?: Todo[]
    tomorrow?: Todo[]
    backlog?: Todo[]
    monitoring?: Todo[]
    done?: Todo[]
    [key: string]: Todo[] | undefined
  }
  stacks?: string[]
  section_labels?: Record<string, string>
}
