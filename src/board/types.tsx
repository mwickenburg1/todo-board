// Re-export shared types for board view consumers
export type { Todo, TodoData } from '../shared/types'
import type { Todo } from '../shared/types'

export function DragHandle({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 text-gray-400 ${className}`} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  )
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

export function sortByStatus<T extends { status: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1
    if (b.status === 'in_progress' && a.status !== 'in_progress') return 1
    return 0
  })
}

export function filterByCategory(tasks: (Todo & { category?: string })[], category: string) {
  return sortByStatus(tasks.filter(t =>
    t.category?.toLowerCase().includes(category.toLowerCase()) ||
    t.stored_category?.toLowerCase().includes(category.toLowerCase())
  ))
}
