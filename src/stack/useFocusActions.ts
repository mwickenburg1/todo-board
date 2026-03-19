import { useCallback } from 'react'
import type { SlackContext } from './NewItemFlow'
import type { FocusResponse } from './focusTypes'

export function useFocusActions(
  fetchQueue: () => void,
  lastJsonRef: React.MutableRefObject<string>,
  dataRef: React.MutableRefObject<FocusResponse | null>
) {
  const triggerFleet = useCallback(() => {
    fetch('/api/focus/trigger-fleet', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const triggerPriority = useCallback(() => {
    fetch('/api/focus/trigger-priority', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const triggerPRs = useCallback(() => {
    fetch('/api/focus/trigger-prs', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const triggerDeadlines = useCallback(() => {
    fetch('/api/focus/trigger-deadlines', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const triggerActivity = useCallback(() => {
    fetch('/api/focus/trigger-activity', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const triggerEnergy = useCallback(() => {
    fetch('/api/focus/trigger-energy', { method: 'POST' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleRetriage = useCallback((id: number) => {
    fetch('/api/focus/retriage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handlePromote = useCallback((id: number) => {
    fetch('/api/focus/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleCreate = useCallback((
    text: string,
    type?: 'fire-drill' | 'today' | 'backlog',
    snoozeMins?: number,
    pastedSlack?: SlackContext,
    deadline?: string,
    delegateOnly?: boolean,
    checkHours?: number,
    existingTaskId?: number,
    slackRefOverride?: string | null,
    slackLabelOverride?: string | null,
    originalIdOverride?: number | undefined,
  ) => {
    const currentTop = dataRef.current?.top
    const isSlack = currentTop?.kind === 'slack'
    const slackRef = slackRefOverride !== undefined ? slackRefOverride : (isSlack ? currentTop!.slackRef : null)
    const slackLabel = slackLabelOverride !== undefined ? slackLabelOverride : (isSlack ? currentTop!.label : null)
    const originalId = originalIdOverride !== undefined ? originalIdOverride : currentTop?.id

    // Watch flow: create or attach via /api/focus/watch (handles dismiss + slackWatches)
    if (delegateOnly !== undefined && slackRef) {
      fetch('/api/focus/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, slackRef, delegateOnly, checkHours: checkHours || 24, existingTaskId, deadline }),
      }).then(() => {
        lastJsonRef.current = ''
        fetchQueue()
      }).catch(() => {})
      return
    }

    // Step 1: Dismiss the slack pulse item first (so it doesn't reappear)
    const dismissPromise = isSlack && originalId
      ? fetch('/api/focus/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      : Promise.resolve(null)

    dismissPromise.then(() =>
      // Step 2: Create the new task via promote
      fetch('/api/focus/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, itemType: type, snoozeMins: type === 'fire-drill' ? snoozeMins : undefined }),
      }).then(res => res.json())
    ).then(result => {
      if (!result) return
      const promises: Promise<unknown>[] = []
      // Attach slack thread link — from focus queue item or from pasted URL
      const linkRef = slackRef || (pastedSlack ? `${pastedSlack.channel}/${pastedSlack.ts}` : null)
      const linkLabel = slackLabel || (pastedSlack ? `#${pastedSlack.channelName}` : null)
      if (result.created && result.promoted && linkRef) {
        promises.push(fetch(`/api/todos/${result.promoted}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'slack_thread', ref: linkRef, label: linkLabel || '' }),
        }))
      }
      if (result.created && result.promoted && deadline) {
        promises.push(fetch(`/api/todos/${result.promoted}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deadline }),
        }))
      }
      return Promise.all(promises)
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef, dataRef])

  const handleUpdateTask = useCallback((id: number, text: string) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleUnlink = useCallback((id: number, linkIdx: number) => {
    fetch(`/api/todos/${id}/links/${linkIdx}`, { method: 'DELETE' }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleSetEnv = useCallback((id: number, env: string | null) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: env || '' }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleSaveNotes = useCallback((id: number, notes: string) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    }).catch(() => {})
  }, [])

  const handleDone = useCallback((id: number) => {
    fetch(`/api/todos/${id}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleEscalate = useCallback((id: number, level: number) => {
    fetch(`/api/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalation: level }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleAddFleetItem = useCallback((text: string, env: string) => {
    fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, list: 'daily-goals', env }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleReorder = useCallback((id: number, beforeId?: number) => {
    fetch(`/api/todos/${id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeId }),
    }).then(() => {
      lastJsonRef.current = ''
      fetchQueue()
    }).catch(() => {})
  }, [fetchQueue, lastJsonRef])

  const handleReschedule = useCallback(async (text: string, confirm?: boolean) => {
    const res = await fetch('/api/focus/reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, confirm }),
    })
    const result = await res.json()
    if (!result.success) throw new Error(result.reason)
    if (result.action === 'rescheduled') {
      lastJsonRef.current = ''
      fetchQueue()
    }
    return result
  }, [fetchQueue, lastJsonRef])

  return {
    triggerFleet, triggerPriority, triggerPRs, triggerDeadlines, triggerActivity, triggerEnergy,
    handleRetriage, handlePromote, handleCreate, handleUpdateTask,
    handleUnlink, handleSetEnv, handleSaveNotes, handleDone,
    handleEscalate, handleAddFleetItem, handleReorder, handleReschedule,
  }
}
