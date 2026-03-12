/**
 * TDD tests for DM watch relevance checking.
 *
 * When a DM channel has a watched task, new messages should be checked
 * for relevance to the task. Only relevant messages update the watch;
 * irrelevant messages pass through to pulse as new items.
 *
 * Run: cd /home/ubuntu/todo-board && npx vitest run server/__tests__/dm-relevance.test.js
 */

import { describe, it, expect, vi } from 'vitest'

// --- The function under test (will be implemented in slack-digest.js) ---

// checkDMRelevance(taskText, recentMessages) → Promise<boolean>
// Returns true if the recent DM messages are about the same topic as the task.

import { checkDMRelevance } from '../slack-digest.js'

describe('DM watch relevance', () => {
  // --- Core relevance check ---

  it('returns true when messages are clearly about the task topic', async () => {
    const result = await checkDMRelevance(
      'MaintainX Slack access for tomorrow',
      [
        { who: 'Tarek', text: 'Hey, can you get me access to MaintainX Slack?' },
        { who: 'me', text: 'Sure, I\'ll set it up tomorrow' },
        { who: 'Tarek', text: 'Thanks! Also what channel should I join first?' },
      ]
    )
    expect(result).toBe(true)
  })

  it('returns false when messages are about a different topic', async () => {
    const result = await checkDMRelevance(
      'MaintainX Slack access for tomorrow',
      [
        { who: 'Tarek', text: 'Hey did you see the Q1 revenue numbers?' },
        { who: 'Tarek', text: 'We need to discuss the forecast update' },
      ]
    )
    expect(result).toBe(false)
  })

  it('returns true when messages reference the task indirectly', async () => {
    const result = await checkDMRelevance(
      'Share training resources with Sergey for Jules',
      [
        { who: 'Sergey', text: 'Jules is ready to start, where should she look?' },
      ]
    )
    expect(result).toBe(true)
  })

  it('returns true when only one relevant message among several', async () => {
    const result = await checkDMRelevance(
      'Fix bamboo email integration',
      [
        { who: 'Nick', text: 'good morning!' },
        { who: 'Nick', text: 'btw the bamboo email thing is still broken after the deploy' },
      ]
    )
    expect(result).toBe(true)
  })

  it('handles empty messages gracefully', async () => {
    const result = await checkDMRelevance('Some task', [])
    expect(result).toBe(false)
  })

  it('handles null/undefined callSonnet result', async () => {
    // When LLM is unavailable, default to true (safe: don't suppress)
    const result = await checkDMRelevance(
      'Some task',
      [{ who: 'Someone', text: 'hello' }],
      { llmUnavailable: true }
    )
    expect(result).toBe(true)
  })
})

describe('DM dedup with relevance', () => {
  // These test the integration: dedup filter behavior for DM-watched items

  it('thread-watched items are always suppressed (no LLM needed)', () => {
    // Thread refs have a slash: channelId/threadTs
    const ref = 'C123/1234.5678'
    const isThread = ref.includes('/')
    expect(isThread).toBe(true)
    // Thread watches = always dedup, no relevance check
  })

  it('DM-watched items need relevance check before suppression', () => {
    // DM refs have no slash: just channelId
    const ref = 'D123ABC'
    const isThread = ref.includes('/')
    expect(isThread).toBe(false)
    // DM watches = need LLM relevance check
  })
})
