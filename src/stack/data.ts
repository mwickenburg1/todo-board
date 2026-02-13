import type { Todo, TodoData, StackItem, EnvSlotInfo } from './types'

// Lists that are handled specially (not shown as toggle sections)
const HIDDEN_LISTS = ['now', 'monitoring', 'done']

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
    if (HIDDEN_LISTS.includes(key)) continue
    names.push(key)
  }
  return names
}

export function processForStack(data: TodoData) {
  const stackNames = getStackNames(data)
  const nowItems = (data.lists.now || []).filter(n => !n.is_empty_slot && n.id)

  // Collect IDs claimed by "now" items
  const claimedByNow = new Set<number>()
  for (const n of nowItems) {
    claimedByNow.add(n.id!)
    for (const t of (data.lists.today || [])) {
      if (t.parent_id === n.id) claimedByNow.add(t.id!)
    }
  }

  const stacks: Record<string, { actionable: StackItem[], waiting: StackItem[] }> = {}

  for (const name of stackNames) {
    stacks[name] = { actionable: [], waiting: [] }
  }

  // Process "now" items → today/waiting
  if (stacks.today) {
    for (const item of nowItems) {
      const subtasks = (data.lists.today || []).filter(t => t.parent_id === item.id)
      stacks.today.waiting.push({
        id: item.id, text: item.text, status: item.status,
        linkedEnv: item.focus_slot, waitingReason: 'env', sourceList: 'now',
        children: subtasks.map(s => ({
          id: s.id, text: s.text, status: s.status, sourceList: 'today',
          children: [], childCount: 0, original: s,
        })),
        childCount: subtasks.length, original: item,
      })
    }
  }

  // Process each stack's list
  function processStackList(listName: string) {
    if (!stacks[listName]) return
    const items = data.lists[listName] || []
    const filtered = listName === 'today'
      ? items.filter(t => !claimedByNow.has(t.id!))
      : items
    const processed = processList(filtered)

    for (const item of processed) {
      if (item.parent_id && nowItems.some(n => n.id === item.parent_id)) continue
      const column = item.status === 'in_progress' ? 'waiting' : 'actionable'
      const childItems = filtered.filter(t => t.parent_id === item.id && t.status !== 'done')

      stacks[listName][column].push({
        id: item.id, text: item.text, status: item.status,
        groupName: (item as Todo & { category?: string }).category || undefined,
        waitingReason: item.status === 'in_progress' ? 'in_progress' : undefined,
        sourceList: listName,
        children: childItems.map(c => ({
          id: c.id, text: c.text, status: c.status, sourceList: listName,
          children: [], childCount: 0, original: c,
        })),
        childCount: item.childCount || childItems.length, original: item,
      })
    }
  }

  for (const name of stackNames) {
    processStackList(name)
  }

  // Monitoring → today/waiting
  if (stacks.today) {
    for (const item of (data.lists.monitoring || [])) {
      stacks.today.waiting.push({
        id: item.id, text: item.text, status: item.status,
        waitingReason: 'monitoring', sourceList: 'monitoring',
        children: [], childCount: 0, original: item,
      })
    }
  }

  const doneItems: StackItem[] = (data.lists.done || []).map(item => ({
    id: item.id, text: item.text, status: item.status, sourceList: 'done',
    children: [], childCount: 0, original: item,
  }))

  // Env slots
  const envSlots: Record<string, EnvSlotInfo> = {}
  const envOrder = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8', 'sync']
  for (const slot of envOrder) {
    const nowItem = (data.lists.now || []).find(n => n.focus_slot === slot)
    envSlots[slot] = {
      item: nowItem && !nowItem.is_empty_slot && nowItem.id ? nowItem : null,
      status: nowItem && !nowItem.is_empty_slot && nowItem.id ? 'assigned' : 'idle',
    }
  }

  return { stacks, stackNames, doneItems, envSlots }
}
