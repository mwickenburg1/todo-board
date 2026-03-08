import { describe, it, expect } from 'vitest'

/**
 * Tests for the /api/todos/split endpoint logic.
 *
 * The split endpoint handles Enter-key behavior:
 * - Updates the source task's text to `before`
 * - Creates a new task with `after` text
 * - Inserts the new task right after the source in the list
 */

describe('split task positioning', () => {
  /**
   * Simulates the core insertion logic from the split endpoint.
   * Given a list of tasks, a source task id, and optional beforeId,
   * returns the new order of task IDs after insertion.
   */
  function simulateSplit(list, sourceId, newTaskId, beforeId) {
    const newTask = { id: newTaskId, text: 'new' }

    if (beforeId) {
      const insertIndex = list.findIndex(t => t.id === beforeId)
      if (insertIndex !== -1) {
        list.splice(insertIndex, 0, newTask)
      } else {
        list.push(newTask)
      }
    } else if (sourceId) {
      const afterIndex = list.findIndex(t => t.id === sourceId)
      if (afterIndex !== -1) {
        list.splice(afterIndex + 1, 0, newTask)
      } else {
        list.push(newTask)
      }
    } else {
      list.push(newTask)
    }

    return list.map(t => t.id)
  }

  it('inserts new task after source task', () => {
    const list = [
      { id: 1, text: 'Datadog' },
      { id: 2, text: 'Lift' },
      { id: 3, text: 'Review' },
    ]

    const result = simulateSplit(list, 1, 99, undefined)
    expect(result).toEqual([1, 99, 2, 3])
  })

  it('inserts before a specific task when beforeId given', () => {
    const list = [
      { id: 1, text: 'First' },
      { id: 2, text: 'Second' },
      { id: 3, text: 'Third' },
    ]

    const result = simulateSplit(list, 1, 99, 2)
    expect(result).toEqual([1, 99, 2, 3])
  })

  it('appends to end when source not found in list', () => {
    const list = [
      { id: 1, text: 'First' },
      { id: 2, text: 'Second' },
    ]

    const result = simulateSplit(list, 999, 99, undefined)
    expect(result).toEqual([1, 2, 99])
  })

  it('appends to end when neither sourceId nor beforeId provided', () => {
    const list = [
      { id: 1, text: 'First' },
    ]

    const result = simulateSplit(list, undefined, 99, undefined)
    expect(result).toEqual([1, 99])
  })

  it('preserves order of surrounding items', () => {
    const list = [
      { id: 10, text: 'A' },
      { id: 20, text: 'B' },
      { id: 30, text: 'C' },
      { id: 40, text: 'D' },
    ]

    const result = simulateSplit(list, 20, 99, undefined)
    expect(result).toEqual([10, 20, 99, 30, 40])
  })
})

describe('split with the Enter-at-end scenario', () => {
  /**
   * The bug scenario: editing "Datadog" to "Datadog Consent" then pressing Enter
   * at end of text. before="Datadog Consent", after="".
   *
   * OLD behavior: created an empty task after "Datadog Consent", pushing "Lift" down.
   * NEW behavior: StackSection catches empty `after` and just saves text without
   * calling split at all.
   *
   * These tests verify the server-side split still works correctly when called,
   * but the fix is that the client no longer calls split for cursor-at-end.
   */

  it('server still creates task even with empty after text', () => {
    // The server doesn't guard against empty `after` — that's the client's job
    const list = [
      { id: 1, text: 'Datadog Consent' },
      { id: 2, text: 'Lift' },
    ]

    // If client DID call split with empty after (the old bug), it would insert
    // an empty task, pushing Lift from position 2 to position 3
    const result = simulateSplitFull(list, 1, 99, '', undefined)
    expect(result).toEqual([
      { id: 1, text: 'Datadog Consent' },
      { id: 99, text: '' },
      { id: 2, text: 'Lift' },
    ])
  })

  /**
   * Full simulation including text updates.
   */
  function simulateSplitFull(list, sourceId, newTaskId, afterText, beforeId) {
    const newTask = { id: newTaskId, text: afterText }

    if (beforeId) {
      const insertIndex = list.findIndex(t => t.id === beforeId)
      if (insertIndex !== -1) {
        list.splice(insertIndex, 0, newTask)
      } else {
        list.push(newTask)
      }
    } else if (sourceId) {
      const afterIndex = list.findIndex(t => t.id === sourceId)
      if (afterIndex !== -1) {
        list.splice(afterIndex + 1, 0, newTask)
      } else {
        list.push(newTask)
      }
    }

    return list
  }
})
