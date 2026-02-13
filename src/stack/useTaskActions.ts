import { useCallback } from 'react'
import { setPendingFocus } from './navigation'

function post(url: string, body?: object) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
}

function patch(url: string, body: object) {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export function useTaskActions(fetchData: () => void) {
  const capture = useCallback(async (text: string, stack: string, column: 'actionable' | 'waiting') => {
    await post('/api/capture', {
      text, horizon: stack,
      status: column === 'waiting' ? 'in_progress' : 'pending'
    })
    fetchData()
  }, [fetchData])

  const markDone = useCallback(async (id: number, recursive = false) => {
    await post(`/api/todos/${id}/done`, { recursive })
    fetchData()
  }, [fetchData])

  const updateTask = useCallback(async (id: number, updates: { text?: string }) => {
    await patch(`/api/todos/${id}`, updates)
    fetchData()
  }, [fetchData])

  const toggleStatus = useCallback(async (id: number, currentStatus: string) => {
    await patch(`/api/todos/${id}`, {
      status: currentStatus === 'in_progress' ? 'pending' : 'in_progress'
    })
    fetchData()
  }, [fetchData])

  const dropItem = useCallback(async (itemId: number, targetStack: string, targetColumn: 'actionable' | 'waiting', beforeId?: number) => {
    await patch(`/api/todos/${itemId}`, {
      status: targetColumn === 'waiting' ? 'in_progress' : 'pending'
    })
    await post(`/api/todos/${itemId}/move`, {
      targetList: targetStack, insertBefore: beforeId
    })
    fetchData()
  }, [fetchData])

  const createStack = useCallback(async (name: string) => {
    const normalized = name.toLowerCase().replace(/\s+/g, '-')
    await post('/api/lists', { name: normalized })
    fetchData()
  }, [fetchData])

  const renameStack = useCallback(async (oldName: string, newName: string) => {
    await post('/api/lists/rename', { oldName, newName })
    fetchData()
  }, [fetchData])

  const deleteTask = useCallback(async (id: number) => {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' })
    fetchData()
  }, [fetchData])

  const deleteStack = useCallback(async (name: string) => {
    await fetch(`/api/lists/${encodeURIComponent(name)}`, { method: 'DELETE' })
    fetchData()
  }, [fetchData])

  const insertItem = useCallback(async (stack: string, column: 'actionable' | 'waiting', text: string, beforeId?: number) => {
    const res = await post('/api/todos/split', {
      after: text || '', list: stack,
      status: column === 'waiting' ? 'in_progress' : 'pending',
      beforeId
    })
    const { task } = await res.json()
    if (task?.id) setPendingFocus(task.id)
    fetchData()
  }, [fetchData])

  const splitItem = useCallback(async (id: number, before: string, after: string, stack: string, column: 'actionable' | 'waiting') => {
    const res = await post('/api/todos/split', {
      id, before, after, list: stack,
      status: column === 'waiting' ? 'in_progress' : 'pending'
    })
    const { task } = await res.json()
    if (task?.id) setPendingFocus(task.id)
    fetchData()
  }, [fetchData])

  const reorderSections = useCallback(async (draggedName: string, beforeName?: string) => {
    await post('/api/lists/reorder', { name: draggedName, beforeName })
    fetchData()
  }, [fetchData])

  const insertAboveSection = useCallback(async (beforeSection: string) => {
    const res = await post('/api/lists/insert-above', { beforeSection })
    const { task } = await res.json()
    if (task?.id) setPendingFocus(task.id)
    fetchData()
  }, [fetchData])

  return {
    capture, markDone, updateTask, toggleStatus, dropItem, deleteTask,
    createStack, renameStack, deleteStack, insertItem, splitItem, reorderSections, insertAboveSection
  }
}
