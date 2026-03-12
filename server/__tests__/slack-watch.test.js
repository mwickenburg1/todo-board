/**
 * Tests for slack-watch.js — pure helper functions for watch state updates.
 *
 * Run: cd /home/ubuntu/todo-board && npx vitest run server/__tests__/slack-watch.test.js
 */

import { describe, it, expect } from 'vitest'
import { buildMessageContext, updateWatchFromContext } from '../slack-watch.js'

describe('buildMessageContext', () => {
  it('returns empty array for null/empty input', () => {
    expect(buildMessageContext(null)).toEqual([])
    expect(buildMessageContext([])).toEqual([])
    expect(buildMessageContext(undefined)).toEqual([])
  })

  it('normalizes and sorts messages by ts', () => {
    const raw = [
      { who: 'alice', text: 'second', ts: '200' },
      { who: 'me', text: 'first', ts: '100' },
      { who: 'bob', text: 'third', ts: '300' },
    ]
    const result = buildMessageContext(raw)
    expect(result).toEqual([
      { who: 'me', text: 'first', ts: '100' },
      { who: 'alice', text: 'second', ts: '200' },
      { who: 'bob', text: 'third', ts: '300' },
    ])
  })

  it('truncates long text to 200 chars', () => {
    const longText = 'x'.repeat(500)
    const result = buildMessageContext([{ who: 'a', text: longText, ts: '1' }])
    expect(result[0].text.length).toBe(200)
  })

  it('handles missing text gracefully', () => {
    const result = buildMessageContext([{ who: 'a', ts: '1' }])
    expect(result[0].text).toBe('')
  })
})

describe('updateWatchFromContext', () => {
  function makeTask(watchOverrides = {}) {
    return {
      text: 'Test task',
      slackWatch: {
        ref: 'C123/ts456',
        checkHours: 24,
        lastMyReplyTs: null,
        lastOtherTs: null,
        delegateOnly: false,
        surfaceContext: null,
        ...watchOverrides,
      },
    }
  }

  it('returns false for task without slackWatch', () => {
    const task = { text: 'no watch' }
    expect(updateWatchFromContext(task, [{ who: 'alice', ts: '100' }])).toBe(false)
  })

  it('returns false for empty context', () => {
    const task = makeTask()
    expect(updateWatchFromContext(task, [])).toBe(false)
    expect(updateWatchFromContext(task, null)).toBe(false)
  })

  it('updates lastOtherTs when other person sends new message', () => {
    const task = makeTask({ lastOtherTs: 0 })
    const changed = updateWatchFromContext(task, [
      { who: 'alice', ts: '100' },
      { who: 'bob', ts: '200' },
    ])
    expect(changed).toBe(true)
    expect(task.slackWatch.lastOtherTs).toBe(200)
  })

  it('sets surfaceContext to last 5 messages', () => {
    const task = makeTask()
    const msgs = Array.from({ length: 8 }, (_, i) => ({
      who: i % 2 === 0 ? 'alice' : 'me',
      ts: String(100 + i),
    }))
    updateWatchFromContext(task, msgs)
    expect(task.slackWatch.surfaceContext.length).toBe(5)
    expect(task.slackWatch.surfaceContext[0].ts).toBe('103') // last 5 of 8
  })

  it('updates lastMyReplyTs when I send a new message', () => {
    const task = makeTask({ lastMyReplyTs: 0 })
    const changed = updateWatchFromContext(task, [
      { who: 'me', ts: '150' },
    ])
    expect(changed).toBe(true)
    expect(task.slackWatch.lastMyReplyTs).toBe(150)
  })

  it('does not downgrade lastOtherTs', () => {
    const task = makeTask({ lastOtherTs: 500 })
    const changed = updateWatchFromContext(task, [
      { who: 'alice', ts: '100' },
    ])
    expect(changed).toBe(false)
    expect(task.slackWatch.lastOtherTs).toBe(500)
  })

  it('does not downgrade lastMyReplyTs', () => {
    const task = makeTask({ lastMyReplyTs: 500 })
    const changed = updateWatchFromContext(task, [
      { who: 'me', ts: '100' },
    ])
    expect(changed).toBe(false)
    expect(task.slackWatch.lastMyReplyTs).toBe(500)
  })

  it('updates both lastOtherTs and lastMyReplyTs in one call', () => {
    const task = makeTask()
    const changed = updateWatchFromContext(task, [
      { who: 'me', ts: '100' },
      { who: 'alice', ts: '200' },
    ])
    expect(changed).toBe(true)
    expect(task.slackWatch.lastMyReplyTs).toBe(100)
    expect(task.slackWatch.lastOtherTs).toBe(200)
  })

  // --- DM relevance gating ---

  it('skips lastOtherTs update when checkRelevance=true and isRelevant=false', () => {
    const task = makeTask({ lastOtherTs: 0 })
    const changed = updateWatchFromContext(task, [
      { who: 'alice', ts: '200' },
      { who: 'me', ts: '100' },
    ], { checkRelevance: true, isRelevant: false })

    // lastOtherTs should NOT be updated (irrelevant DM)
    expect(task.slackWatch.lastOtherTs).toBe(0)
    // But lastMyReplyTs SHOULD be updated (own replies always tracked)
    expect(task.slackWatch.lastMyReplyTs).toBe(100)
    expect(changed).toBe(true) // because myReplyTs changed
  })

  it('updates lastOtherTs when checkRelevance=true and isRelevant=true', () => {
    const task = makeTask({ lastOtherTs: 0 })
    const changed = updateWatchFromContext(task, [
      { who: 'alice', ts: '200' },
    ], { checkRelevance: true, isRelevant: true })

    expect(changed).toBe(true)
    expect(task.slackWatch.lastOtherTs).toBe(200)
  })

  it('updates lastOtherTs when checkRelevance is not set (thread mode)', () => {
    const task = makeTask({ lastOtherTs: 0 })
    const changed = updateWatchFromContext(task, [
      { who: 'alice', ts: '200' },
    ])
    expect(changed).toBe(true)
    expect(task.slackWatch.lastOtherTs).toBe(200)
  })
})
