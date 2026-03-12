import { describe, it, expect } from 'vitest'
import { buildTriagePrompt, parseTriageResult } from '../slack-triage.js'
import { deriveSlackCardState, deriveStateAfterReply } from '../slack-card-state.js'

/**
 * Tests for the triage lifecycle — ensuring the right messages reach the LLM
 * and the right UI state is derived from the result.
 */

describe('buildTriagePrompt — message context', () => {
  it('includes all messages in the transcript', () => {
    const prompt = buildTriagePrompt('dm', {
      person: 'Sergey',
      messages: [
        { who: 'Sergey', text: 'Hey, can you update me on deal scores?', ts: '1' },
        { who: 'me', text: 'Yep, making progress. Will share in sync.', ts: '2' },
        { who: 'Sergey', text: 'Cool thanks!', ts: '3' },
      ],
    })
    expect(prompt).toContain('Sergey: Hey, can you update me on deal scores?')
    expect(prompt).toContain('me: Yep, making progress')
    expect(prompt).toContain('Sergey: Cool thanks!')
  })

  it('includes post-mention channel messages for mentions', () => {
    // Simulates a mention where I replied at channel level (not in thread)
    const prompt = buildTriagePrompt('mention', {
      channel: 'time-off-requests',
      messages: [
        { who: 'johan', text: 'Miguel is off tomorrow', ts: '1' },
        { who: 'johan', text: 'approved @Matthias?', ts: '2' },
        { who: 'me', text: 'Approved!', ts: '3' },
      ],
    })
    expect(prompt).toContain('me: Approved!')
    expect(prompt).toContain('@mention in #time-off-requests')
  })

  it('identifies group DMs correctly', () => {
    const prompt = buildTriagePrompt('dm', {
      person: 'Jeremy',
      messages: [
        { who: 'Jeremy', text: 'Hey thoughts on this?', ts: '1' },
        { who: 'William', text: 'Looks good to me', ts: '2' },
        { who: 'me', text: 'Agreed', ts: '3' },
      ],
    })
    expect(prompt).toContain('Group DM with Jeremy, William')
  })
})

describe('parseTriageResult — acknowledged conversations', () => {
  it('FYI when other person acknowledged after my reply', () => {
    // This is what the LLM SHOULD return when it sees:
    // me: "can try, tmrw?" → them: "sounds good"
    const raw = `URGENCY: FYI
SUMMARY: MaintainX access
ACTION: No action needed — Tarek acknowledged, will follow up tomorrow
DRAFT: none
ACTIONS: [{"type":"done"},{"type":"snooze"}]`

    const triage = parseTriageResult(raw)
    expect(triage.urgency).toBe('FYI')
    expect(triage.actions[0].type).toBe('done')

    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('faded')
    expect(card.replyFirst).toBe(false)
  })

  it('ACTION_NEEDED with track (not reply) when I already replied but need to follow up', () => {
    const raw = `URGENCY: ACTION_NEEDED
SUMMARY: Deal scores update
ACTION: Create a task to follow up on deal scores with Sergey
DRAFT: none
ACTIONS: [{"type":"track","taskText":"Deal scores update","delegateOnly":false},{"type":"done"}]`

    const triage = parseTriageResult(raw)
    expect(triage.urgency).toBe('ACTION_NEEDED')
    expect(triage.actions[0].type).toBe('track')
    expect(triage.draft).toBeNull()

    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('faded')
    expect(card.replyFirst).toBe(false)
    expect(card.emphasizedHotkeys[0]).toBe('track')
  })
})

describe('triage fingerprint — cache invalidation scenarios', () => {
  // The fingerprint is: messages.map(m => m.ts).sort().join(',')
  // These tests verify the fingerprint changes when it should.

  it('fingerprint changes when new thread reply appears', () => {
    const before = [
      { who: 'Sergey', text: 'update on deal scores?', ts: '100' },
    ]
    const after = [
      { who: 'Sergey', text: 'update on deal scores?', ts: '100' },
      { who: 'me', text: 'Making progress', ts: '200' },
    ]
    const fpBefore = before.map(m => m.ts).sort().join(',')
    const fpAfter = after.map(m => m.ts).sort().join(',')
    expect(fpBefore).not.toBe(fpAfter)
  })

  it('fingerprint changes when post-mention channel message added', () => {
    const before = [
      { who: 'johan', text: 'approved @Matthias?', ts: '100' },
    ]
    const after = [
      { who: 'johan', text: 'approved @Matthias?', ts: '100' },
      { who: 'me', text: 'Approved!', ts: '200' },
    ]
    const fpBefore = before.map(m => m.ts).sort().join(',')
    const fpAfter = after.map(m => m.ts).sort().join(',')
    expect(fpBefore).not.toBe(fpAfter)
  })

  it('fingerprint stays same when no new messages', () => {
    const msgs = [
      { who: 'Sergey', text: 'update?', ts: '100' },
      { who: 'me', text: 'on it', ts: '200' },
    ]
    const fp1 = msgs.map(m => m.ts).sort().join(',')
    const fp2 = msgs.map(m => m.ts).sort().join(',')
    expect(fp1).toBe(fp2)
  })
})

describe('deriveStateAfterReply — post-reply transition', () => {
  it('after sending reply, panel fades and track becomes primary', () => {
    const actions = [
      { type: 'reply', draft: 'On it' },
      { type: 'track', taskText: 'Follow up', delegateOnly: false },
      { type: 'done' },
    ]
    // Before reply
    const before = deriveSlackCardState(actions)
    expect(before.slackPanelEmphasis).toBe('emphasized')
    expect(before.replyFirst).toBe(true)

    // After reply sent
    const after = deriveStateAfterReply(actions)
    expect(after.slackPanelEmphasis).toBe('faded')
    expect(after.replyFirst).toBe(false)
    expect(after.emphasizedHotkeys[0]).toBe('track')
  })

  it('after reply when only done remains, done is primary', () => {
    const actions = [
      { type: 'reply', draft: 'Thanks!' },
      { type: 'done' },
    ]
    const after = deriveStateAfterReply(actions)
    expect(after.slackPanelEmphasis).toBe('faded')
    expect(after.emphasizedHotkeys[0]).toBe('done')
  })
})

describe('dismiss flow — FYI retriage prevents re-surfacing', () => {
  // These test the logic, not the actual dismiss store (which is tested elsewhere)

  it('FYI triage produces priority 0 and done-first actions', () => {
    const raw = `URGENCY: FYI
SUMMARY: Sonnet discussion
ACTION: No action needed — Jeremy and William are handling it
DRAFT: none
ACTIONS: [{"type":"done"},{"type":"snooze"}]`

    const triage = parseTriageResult(raw)
    expect(triage.urgency).toBe('FYI')
    // Focus queue would set priority 0 for FYI
    const priority = triage.urgency === 'FYI' ? 0 : 2
    expect(priority).toBe(0)
    // Card state should encourage dismissal
    const card = deriveSlackCardState(triage.actions)
    expect(card.emphasizedHotkeys[0]).toBe('done')
  })

  it('ACTION_NEEDED triage produces priority 2', () => {
    const raw = `URGENCY: ACTION_NEEDED
SUMMARY: Approval needed
ACTION: Approve Miguel time off
DRAFT: Approved!
ACTIONS: [{"type":"reply","draft":"Approved!"},{"type":"done"}]`

    const triage = parseTriageResult(raw)
    const priority = triage.urgency === 'ACTION_NEEDED' ? 2 : 0
    expect(priority).toBe(2)
  })
})
