import { describe, it, expect } from 'vitest'
import { deriveSlackCardState, deriveStateAfterReply } from '../slack-card-state.js'

describe('deriveSlackCardState', () => {
  // --- Reply-first scenarios (ACTION_NEEDED, needs my response) ---

  it('reply first → slack panel emphasized, hotkeys show post-reply actions', () => {
    const actions = [
      { type: 'reply', draft: 'Sure, I can look at that' },
      { type: 'track', taskText: 'Review PR #123', delegateOnly: false },
      { type: 'done' },
    ]
    const state = deriveSlackCardState(actions)
    expect(state.slackPanelEmphasis).toBe('emphasized')
    expect(state.replyFirst).toBe(true)
    // After replying, primary action is to create a task
    expect(state.emphasizedHotkeys[0]).toBe('track')
    expect(state.emphasizedHotkeys[1]).toBe('done')
  })

  it('reply first with only done after → track still appears as secondary', () => {
    const actions = [
      { type: 'reply', draft: 'Thanks!' },
      { type: 'done' },
    ]
    const state = deriveSlackCardState(actions)
    expect(state.slackPanelEmphasis).toBe('emphasized')
    expect(state.replyFirst).toBe(true)
    expect(state.emphasizedHotkeys[0]).toBe('done')
    expect(state.emphasizedHotkeys[1]).toBe('track')
  })

  // --- FYI scenarios (no reply needed) ---

  it('done first → slack panel faded, done is primary', () => {
    const actions = [
      { type: 'done' },
      { type: 'snooze' },
    ]
    const state = deriveSlackCardState(actions)
    expect(state.slackPanelEmphasis).toBe('faded')
    expect(state.replyFirst).toBe(false)
    expect(state.emphasizedHotkeys[0]).toBe('done')
    expect(state.emphasizedHotkeys[1]).toBe('snooze')
  })

  it('done first with reply second → faded panel, done primary', () => {
    const actions = [
      { type: 'done' },
      { type: 'reply', draft: 'Optional reply' },
      { type: 'snooze' },
    ]
    const state = deriveSlackCardState(actions)
    expect(state.slackPanelEmphasis).toBe('faded')
    expect(state.replyFirst).toBe(false)
    // reply maps to 'done' in hotkey labels, so secondary dedupes
    expect(state.emphasizedHotkeys[0]).toBe('done')
    expect(state.emphasizedHotkeys[1]).toBe('track')
  })

  // --- Track-first scenarios (already replied, need to create task) ---

  it('track first → slack panel faded, track is primary', () => {
    const actions = [
      { type: 'track', taskText: 'Follow up with Jacob', delegateOnly: false },
      { type: 'done' },
    ]
    const state = deriveSlackCardState(actions)
    expect(state.slackPanelEmphasis).toBe('faded')
    expect(state.replyFirst).toBe(false)
    expect(state.emphasizedHotkeys[0]).toBe('track')
    expect(state.emphasizedHotkeys[1]).toBe('done')
  })

  it('watch first → slack panel faded, track is primary (watch maps to track)', () => {
    const actions = [
      { type: 'watch', taskText: 'Monitor deploy', checkHours: 24 },
      { type: 'done' },
    ]
    const state = deriveSlackCardState(actions)
    expect(state.slackPanelEmphasis).toBe('faded')
    expect(state.replyFirst).toBe(false)
    expect(state.emphasizedHotkeys[0]).toBe('track')
    expect(state.emphasizedHotkeys[1]).toBe('done')
  })

  // --- Edge cases ---

  it('null actions → faded panel, default hotkeys', () => {
    const state = deriveSlackCardState(null)
    expect(state.slackPanelEmphasis).toBe('faded')
    expect(state.replyFirst).toBe(false)
    expect(state.emphasizedHotkeys).toEqual(['done', 'track'])
  })

  it('empty actions → faded panel, default hotkeys', () => {
    const state = deriveSlackCardState([])
    expect(state.slackPanelEmphasis).toBe('faded')
    expect(state.replyFirst).toBe(false)
    expect(state.emphasizedHotkeys).toEqual(['done', 'track'])
  })

  it('primary and secondary are always different', () => {
    // track then watch both map to 'track'
    const actions = [
      { type: 'track', taskText: 'Task A' },
      { type: 'watch', taskText: 'Task B' },
    ]
    const state = deriveSlackCardState(actions)
    expect(state.emphasizedHotkeys[0]).not.toBe(state.emphasizedHotkeys[1])
  })
})

describe('deriveStateAfterReply', () => {
  it('removes reply action and re-derives — panel fades, next action becomes primary', () => {
    const actions = [
      { type: 'reply', draft: 'On it' },
      { type: 'track', taskText: 'Fix the bug', delegateOnly: false },
      { type: 'done' },
    ]
    const after = deriveStateAfterReply(actions)
    expect(after.slackPanelEmphasis).toBe('faded')
    expect(after.replyFirst).toBe(false)
    expect(after.emphasizedHotkeys[0]).toBe('track')
    expect(after.emphasizedHotkeys[1]).toBe('done')
  })

  it('removes reply when reply was the only action besides done', () => {
    const actions = [
      { type: 'reply', draft: 'Got it' },
      { type: 'done' },
    ]
    const after = deriveStateAfterReply(actions)
    expect(after.slackPanelEmphasis).toBe('faded')
    expect(after.replyFirst).toBe(false)
    expect(after.emphasizedHotkeys[0]).toBe('done')
  })

  it('null actions → default state', () => {
    const after = deriveStateAfterReply(null)
    expect(after.slackPanelEmphasis).toBe('faded')
    expect(after.emphasizedHotkeys).toEqual(['done', 'track'])
  })

  it('no reply in actions → state unchanged', () => {
    const actions = [
      { type: 'track', taskText: 'Follow up' },
      { type: 'done' },
    ]
    const before = deriveSlackCardState(actions)
    const after = deriveStateAfterReply(actions)
    expect(after).toEqual(before)
  })
})
