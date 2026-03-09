import type { Todo, TodoData, StackItem, EnvSlotInfo, SnoozeInfo } from './types'
import { statusToColumn } from '../shared/helpers'

// Lists that are handled specially (not shown as toggle sections)
const HIDDEN_LISTS = ['now', 'monitoring', 'done', 'pulse']

// Pinned lists: rendered at fixed positions, not in the normal section flow
export const PINNED_LISTS = ['daily-goals']
export const PINNED_LABELS: Record<string, string> = { 'daily-goals': 'Today' }

// Extract env names from claude_code link labels (format: "claude (env4): ...")
// and from focus_slot
function extractEnvs(item: Todo): Set<string> {
  const envs = new Set<string>()
  if (item.focus_slot) envs.add(item.focus_slot)
  for (const link of (item.links || [])) {
    if (link.type === 'claude_code' && link.label) {
      const m = link.label.match(/^claude \((env\d+)\)/)
      if (m) envs.add(m[1])
    }
  }
  return envs
}

export function processList(list: Todo[]): (Todo & { category?: string; childCount?: number })[] {
  const tree = list.filter(t => !t.parent_id).map(parent => ({
    ...parent,
    children: list.filter(t => t.parent_id === parent.id)
  }))

  const tasks: (Todo & { category?: string; childCount?: number })[] = []
  tree.forEach(parent => {
    if (parent.children && parent.children.length > 0) {
      parent.children.forEach(child => {
        const childCount = list.filter(t => t.parent_id === child.id && t.status !== 'done').length
        tasks.push({ ...child, category: parent.text, childCount })
      })
    } else {
      tasks.push(parent)
    }
  })
  return tasks
}

export function getStackNames(data: TodoData): string[] {
  if (data.stacks && data.stacks.length > 0) return data.stacks

  const names: string[] = []
  for (const key of Object.keys(data.lists)) {
    if (HIDDEN_LISTS.includes(key) || PINNED_LISTS.includes(key)) continue
    names.push(key)
  }
  return names
}

export function processForStack(data: TodoData, snoozeMap?: Record<number, SnoozeInfo>) {
  const snz = snoozeMap || {}
  const getSnooze = (id: number | null) => id ? snz[id] : undefined
  const stackNames = getStackNames(data)
  const nowItems = (data.lists.now || []).filter(n => !n.is_empty_slot && n.id)

  // Collect IDs claimed by "now" items
  const claimedByNow = new Set<number>()
  for (const n of nowItems) {
    claimedByNow.add(n.id!)
    for (const t of (data.lists.queue || [])) {
      if (t.parent_id === n.id) claimedByNow.add(t.id!)
    }
  }

  const stacks: Record<string, { actionable: StackItem[], waiting: StackItem[] }> = {}

  for (const name of stackNames) {
    stacks[name] = { actionable: [], waiting: [] }
  }

  // Also initialize pinned lists
  for (const name of PINNED_LISTS) {
    if (data.lists[name]) {
      stacks[name] = { actionable: [], waiting: [] }
    }
  }

  // Process "now" items → today/waiting
  if (stacks.queue) {
    for (const item of nowItems) {
      const subtasks = (data.lists.queue || []).filter(t => t.parent_id === item.id)
      stacks.queue.waiting.push({
        id: item.id, text: item.text, status: item.status,
        envs: extractEnvs(item), waitingReason: 'env', sourceList: 'now',
        children: subtasks.map(s => ({
          id: s.id, text: s.text, status: s.status, sourceList: 'queue',
          children: [], childCount: 0, original: s, envs: extractEnvs(s),
          links: s.links || [], events: s.events || [],
          snoozeInfo: getSnooze(s.id),
        })),
        childCount: subtasks.length, original: item,
        links: item.links || [], events: item.events || [],
        snoozeInfo: getSnooze(item.id),
      })
    }
  }

  // Process each stack's list
  function processStackList(listName: string) {
    if (!stacks[listName]) return
    const items = data.lists[listName] || []
    const filtered = listName === 'queue'
      ? items.filter(t => !claimedByNow.has(t.id!))
      : items
    const processed = processList(filtered)

    for (const item of processed) {
      if (item.parent_id && nowItems.some(n => n.id === item.parent_id)) continue
      const column = statusToColumn(item.status)
      const childItems = filtered.filter(t => t.parent_id === item.id && t.status !== 'done')

      stacks[listName][column].push({
        id: item.id, text: item.text, status: item.status,
        groupName: (item as Todo & { category?: string }).category || undefined,
        envs: extractEnvs(item),
        waitingReason: item.status === 'in_progress' ? 'in_progress' : undefined,
        sourceList: listName,
        children: childItems.map(c => ({
          id: c.id, text: c.text, status: c.status, sourceList: listName,
          children: [], childCount: 0, original: c, envs: extractEnvs(c),
          links: c.links || [], events: c.events || [],
          snoozeInfo: getSnooze(c.id),
        })),
        childCount: item.childCount || childItems.length, original: item,
        escalation: item.escalation || 0,
        links: item.links || [], events: item.events || [],
        snoozeInfo: getSnooze(item.id),
      })
    }
  }

  for (const name of stackNames) {
    processStackList(name)
  }

  // Process pinned lists
  for (const name of PINNED_LISTS) {
    processStackList(name)
  }

  // Monitoring → today/waiting
  if (stacks.queue) {
    for (const item of (data.lists.monitoring || [])) {
      stacks.queue.waiting.push({
        id: item.id, text: item.text, status: item.status,
        envs: extractEnvs(item), waitingReason: 'monitoring', sourceList: 'monitoring',
        children: [], childCount: 0, original: item,
        links: item.links || [], events: item.events || [],
        snoozeInfo: getSnooze(item.id),
      })
    }
  }

  const doneItems: StackItem[] = (data.lists.done || []).map(item => ({
    id: item.id, text: item.text, status: item.status, envs: extractEnvs(item), sourceList: 'done',
    children: [], childCount: 0, original: item,
    links: item.links || [], events: item.events || [],
    snoozeInfo: getSnooze(item.id),
  }))

  // Env slots
  const envSlots: Record<string, EnvSlotInfo> = {}
  const envOrder = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8', 'env9', 'env10', 'sync']
  for (const slot of envOrder) {
    const nowItem = (data.lists.now || []).find(n => n.focus_slot === slot)
    envSlots[slot] = {
      item: nowItem && !nowItem.is_empty_slot && nowItem.id ? nowItem : null,
      status: nowItem && !nowItem.is_empty_slot && nowItem.id ? 'assigned' : 'idle',
    }
  }

  return { stacks, stackNames, doneItems, envSlots }
}
