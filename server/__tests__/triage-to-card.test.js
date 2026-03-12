import { describe, it, expect } from 'vitest'
import { parseTriageResult } from '../slack-triage.js'
import { deriveSlackCardState } from '../slack-card-state.js'

/**
 * End-to-end tests: LLM raw output → parseTriageResult → deriveSlackCardState
 * Validates the full pipeline from LLM text to UI decisions.
 */

describe('LLM output → card state pipeline', () => {
  it('ACTION_NEEDED DM with reply → emphasized panel, track after reply', () => {
    const raw = `URGENCY: ACTION_NEEDED
SUMMARY: Jacob asking about Datadog setup
ACTION: Reply with the config details he needs
DRAFT: Hey Jacob, the Datadog config is in /etc/datadog/conf.d — lmk if you need access
ACTIONS: [{"type":"reply","draft":"Hey Jacob, the Datadog config is in /etc/datadog/conf.d — lmk if you need access"},{"type":"track","taskText":"Datadog setup for Jacob","delegateOnly":false},{"type":"done"}]`

    const triage = parseTriageResult(raw)
    expect(triage.urgency).toBe('ACTION_NEEDED')
    expect(triage.actions).toHaveLength(3)
    expect(triage.actions[0].type).toBe('reply')

    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('emphasized')
    expect(card.replyFirst).toBe(true)
    expect(card.emphasizedHotkeys[0]).toBe('track')
  })

  it('FYI thread → faded panel, done primary', () => {
    const raw = `URGENCY: FYI
SUMMARY: Deploy completed successfully
ACTION: No action needed — deploy was handled by the team
DRAFT: none
ACTIONS: [{"type":"done"},{"type":"snooze"}]`

    const triage = parseTriageResult(raw)
    expect(triage.urgency).toBe('FYI')

    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('faded')
    expect(card.replyFirst).toBe(false)
    expect(card.emphasizedHotkeys[0]).toBe('done')
  })

  it('ACTION_NEEDED but already replied → track first, panel faded', () => {
    const raw = `URGENCY: ACTION_NEEDED
SUMMARY: Need to follow up on Elise account fix
ACTION: Create a task to track the account fix
DRAFT: none
ACTIONS: [{"type":"track","taskText":"Elise account fix","delegateOnly":false},{"type":"done"}]`

    const triage = parseTriageResult(raw)
    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('faded')
    expect(card.replyFirst).toBe(false)
    expect(card.emphasizedHotkeys[0]).toBe('track')
  })

  it('fallback synthesis when LLM omits ACTIONS line — ACTION_NEEDED with draft', () => {
    const raw = `URGENCY: ACTION_NEEDED
SUMMARY: Question about API keys
ACTION: Reply with the API key location
DRAFT: Check 1Password under "API Keys" vault`

    const triage = parseTriageResult(raw)
    // Parser should synthesize actions from urgency + draft
    expect(triage.actions).toBeTruthy()
    expect(triage.actions[0].type).toBe('reply')
    expect(triage.actions[0].draft).toBe('Check 1Password under "API Keys" vault')

    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('emphasized')
    expect(card.replyFirst).toBe(true)
  })

  it('fallback synthesis when LLM omits ACTIONS line — FYI no draft', () => {
    const raw = `URGENCY: FYI
SUMMARY: Status update from team
ACTION: No action needed — informational
DRAFT: none`

    const triage = parseTriageResult(raw)
    expect(triage.actions[0].type).toBe('done')

    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('faded')
    expect(card.replyFirst).toBe(false)
    expect(card.emphasizedHotkeys[0]).toBe('done')
  })

  it('delegate scenario — track with delegateOnly, panel faded', () => {
    const raw = `URGENCY: FYI
SUMMARY: Rory handling Teramind investigation
ACTION: Rory is on it, just track progress
DRAFT: none
ACTIONS: [{"type":"track","taskText":"Teramind investigation","delegateOnly":true},{"type":"done"},{"type":"snooze"}]`

    const triage = parseTriageResult(raw)
    const card = deriveSlackCardState(triage.actions)
    expect(card.slackPanelEmphasis).toBe('faded')
    expect(card.emphasizedHotkeys[0]).toBe('track')
    // delegateOnly flag preserved for NewItemFlow
    expect(triage.actions[0].delegateOnly).toBe(true)
  })
})
