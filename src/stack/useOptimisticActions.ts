import { useCallback, useRef } from 'react'
import type { Todo, TodoData } from './types'
import { columnToStatus, statusToColumn } from '../shared/helpers'
import { setPendingSectionFocus, setPendingFocus } from './navigation'

type SetData = React.Dispatch<React.SetStateAction<TodoData | null>>
type Actions = ReturnType<typeof import('./useTaskActions').useTaskActions>

export function useOptimisticActions(actions: Actions, setData: SetData) {
  const tempIdRef = useRef(-1)

  const createStack = useCallback((sectionName: string, beforeSection?: string) => {
    const normalized = sectionName.toLowerCase().replace(/\s+/g, '-')
    setPendingSectionFocus(normalized)
    setData(prev => {
      if (!prev) return prev
      const newLists = { ...prev.lists }
      if (!newLists[normalized]) newLists[normalized] = []
      const entries = Object.entries(newLists)
      if (beforeSection) {
        const newIdx = entries.findIndex(([k]) => k === normalized)
        const [entry] = entries.splice(newIdx, 1)
        const beforeIdx = entries.findIndex(([k]) => k === beforeSection)
        if (beforeIdx !== -1) entries.splice(beforeIdx, 0, entry)
        else entries.push(entry)
      }
      return { ...prev, lists: Object.fromEntries(entries) as typeof prev.lists }
    })
    actions.createStack(sectionName, beforeSection)
  }, [actions, setData])

  const renameStack = useCallback((key: string, newLabel: string) => {
    setData(prev => {
      if (!prev) return prev
      return { ...prev, section_labels: { ...prev.section_labels, [key]: newLabel } }
    })
    actions.renameStack(key, newLabel)
  }, [actions, setData])

  const toggleStatus = useCallback((id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'in_progress' ? 'pending' : 'in_progress'
    setData(prev => {
      if (!prev) return prev
      const newLists = { ...prev.lists }
      for (const [listName, items] of Object.entries(newLists)) {
        if (!items) continue
        const idx = items.findIndex(t => t.id === id)
        if (idx !== -1) {
          const newItems = [...items]
          newItems[idx] = { ...newItems[idx], status: newStatus as Todo['status'] }
          newLists[listName] = newItems
          break
        }
      }
      return { ...prev, lists: newLists }
    })
    actions.toggleStatus(id, currentStatus)
  }, [actions, setData])

  const capture = useCallback((text: string, stack: string, column: 'actionable' | 'waiting') => {
    const status = columnToStatus(column)
    const tempId = tempIdRef.current--
    setData(prev => {
      if (!prev) return prev
      const newLists = { ...prev.lists }
      const list = [...(newLists[stack] || [])]
      list.unshift({
        id: tempId, text, priority: 1, context: '', status,
        parent_id: null, created: new Date().toISOString(),
        started: status === 'in_progress' ? new Date().toISOString() : null,
        completed: null,
      } as Todo)
      newLists[stack] = list
      return { ...prev, lists: newLists }
    })
    actions.capture(text, stack, column)
  }, [actions, setData])

  const splitItem = useCallback((id: number, before: string, after: string, stack: string, column: 'actionable' | 'waiting') => {
    const status = columnToStatus(column)
    const tempId = tempIdRef.current--
    setPendingFocus(tempId)
    setData(prev => {
      if (!prev) return prev
      const newLists = { ...prev.lists }
      const list = [...(newLists[stack] || [])]
      const idx = list.findIndex(t => t.id === id)
      if (idx === -1) return prev
      if (before.trim()) list[idx] = { ...list[idx], text: before.trim() }
      const newItem = {
        id: tempId, text: after.trim(), priority: 1, context: '', status,
        parent_id: null, created: new Date().toISOString(),
        started: status === 'in_progress' ? new Date().toISOString() : null,
        completed: null,
      } as Todo
      list.splice(idx + 1, 0, newItem)
      newLists[stack] = list
      return { ...prev, lists: newLists }
    })
    actions.splitItem(id, before, after, stack, column)
  }, [actions, setData])

  const insertItem = useCallback((stack: string, column: 'actionable' | 'waiting', text: string, beforeId?: number) => {
    const status = columnToStatus(column)
    const tempId = tempIdRef.current--
    setPendingFocus(tempId)
    setData(prev => {
      if (!prev) return prev
      const newLists = { ...prev.lists }
      const list = [...(newLists[stack] || [])]
      const newItem = {
        id: tempId, text, priority: 1, context: '', status,
        parent_id: null, created: new Date().toISOString(),
        started: status === 'in_progress' ? new Date().toISOString() : null,
        completed: null,
      } as Todo
      if (beforeId !== undefined) {
        const idx = list.findIndex(t => t.id === beforeId)
        if (idx !== -1) list.splice(idx, 0, newItem)
        else list.push(newItem)
      } else {
        list.push(newItem)
      }
      newLists[stack] = list
      return { ...prev, lists: newLists }
    })
    actions.insertItem(stack, column, text, beforeId)
  }, [actions, setData])

  const moveItem = useCallback((id: number, stack: string, column: 'actionable' | 'waiting', direction: 'up' | 'down') => {
    let beforeId: number | undefined
    setData(prev => {
      if (!prev) return prev
      const items = prev.lists[stack] || []
      const colItems = items.filter(t => statusToColumn(t.status) === column)
      const idx = colItems.findIndex(t => t.id === id)
      if (idx === -1) return prev
      if (direction === 'up' && idx === 0) return prev
      if (direction === 'down' && idx === colItems.length - 1) return prev

      const swapTarget = direction === 'up' ? colItems[idx - 1] : colItems[idx + 1]

      if (direction === 'up') {
        beforeId = swapTarget.id!
      } else {
        const rawWithout = items.filter(t => t.id !== id)
        const swapRawIdx = rawWithout.findIndex(t => t.id === swapTarget.id)
        beforeId = rawWithout[swapRawIdx + 1]?.id ?? undefined
      }

      const newItems = [...items]
      const myRawIdx = newItems.findIndex(t => t.id === id)
      const otherRawIdx = newItems.findIndex(t => t.id === swapTarget.id)
      ;[newItems[myRawIdx], newItems[otherRawIdx]] = [newItems[otherRawIdx], newItems[myRawIdx]]
      return { ...prev, lists: { ...prev.lists, [stack]: newItems } }
    })
    actions.moveItem(id, stack, beforeId)
  }, [actions, setData])

  return { createStack, renameStack, toggleStatus, capture, splitItem, insertItem, moveItem }
}
