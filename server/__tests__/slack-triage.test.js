/**
 * Eval tests for unified Slack triage.
 *
 * Tests the pure functions (buildTriagePrompt, parseTriageResult) deterministically,
 * then runs LLM-as-judge evals against real conversation fixtures to catch regressions
 * in the prompt quality.
 *
 * Run: cd /home/ubuntu/todo-board && npx vitest run server/__tests__/slack-triage.test.js
 */

import { describe, it, expect } from 'vitest'
import { buildTriagePrompt, parseTriageResult } from '../slack-triage.js'

// ─── Fixtures: real Slack conversations ───

const FIXTURES = {
  // Case 1: @Matthias mention where Kevin already handled it → should be FYI
  mentionKevinHandledIt: {
    source: 'mention',
    opts: {
      channel: 'sales-eng-ops',
      messages: [
        { who: 'Tarek', text: 'can we increase the agent context window for MaintainX?', ts: '1773070983' },
        { who: 'Tarek', text: 'cc @Matthias', ts: '1773070990' },
        { who: 'me', text: 'Can you give more details? what specifically', ts: '1773071033' },
        { who: 'Tarek', text: 'They sent me some documents to feed it. Tried adding it but it\'s capped', ts: '1773071100' },
        { who: 'Tarek', text: 'And they\'re likely going to send more', ts: '1773071107' },
        { who: 'me', text: '@Kevin file uploads / attachments are key', ts: '1773071147' },
        { who: 'me', text: '@Tarek how much more do you need', ts: '1773071164' },
        { who: 'me', text: 'character-wise', ts: '1773071166' },
        { who: 'Tarek', text: 'atleast double for now', ts: '1773071170' },
        { who: 'Kevin', text: 'The files are already working — at least I tested with images. I\'ll show you examples shortly, we could deploy today or tomorrow', ts: '1773071656' },
        { who: 'Tarek', text: '@Matthias can we get triple for now? so 30,000 - there\'s some additional adjustments we need to make', ts: '1773072718' },
        { who: 'Kevin', text: 'Tarek, if you share the context with me, I can include it directly while the attachments feature is being released', ts: '1773072917' },
        { who: 'me', text: 'For now we just need to raise the character cap to 30k, it\'s hardcoded @Kevin', ts: '1773073241' },
        { who: 'Kevin', text: 'I was going to add the context myself directly in the DB. But I can also deploy an increase from 5k to 30k so they can do it themselves — one sec', ts: '1773073354' },
        { who: 'Tarek', text: '@Kevin you want the text or the docs?', ts: '1773076483' },
        { who: 'Kevin', text: 'I already have the hotfix, but deployments broke just now. If you want to solve it quickly, share the text with me', ts: '1773076665' },
        { who: 'Tarek', text: 'here you go (google doc link)', ts: '1773077564' },
        { who: 'Kevin', text: 'On it', ts: '1773078970' },
        { who: 'Kevin', text: 'It\'s done. The hotfix will also be deployed in a few minutes', ts: '1773080235' },
        { who: 'me', text: 'Remember to pls first validate if sales having demo', ts: '1773080579' },
        { who: 'Kevin', text: 'Sure!', ts: '1773080602' },
      ],
    },
    // The @Matthias mention was at ts 1773072718, but Kevin handled it and it's done.
    // Matthias already responded. This should be FYI.
    expect: { urgency: 'FYI' },
  },

  // Case 2: Direct question in DM, waiting on Matthias → should be ACTION_NEEDED
  dmDirectQuestion: {
    source: 'dm',
    opts: {
      person: 'Kevin',
      messages: [
        { who: 'me', text: 'so we can present the LLM with cases in the simpler representation, to help it pattern match', ts: '1773090000' },
        { who: 'me', text: 'like a lookup table almost', ts: '1773090010' },
        { who: 'Kevin', text: 'That makes sense, like a few-shot approach', ts: '1773090020' },
        { who: 'Kevin', text: 'What interface is that? I want to try it', ts: '1773090030' },
      ],
    },
    expect: { urgency: 'ACTION_NEEDED' },
  },

  // Case 3: Someone acknowledged and is handling it → FYI
  dmAcknowledged: {
    source: 'dm',
    opts: {
      person: 'Kevin',
      messages: [
        { who: 'me', text: 'Can you take a look at the deploy pipeline? It seems stuck', ts: '1773091000' },
        { who: 'Kevin', text: 'On it, I\'ll check right now', ts: '1773091010' },
        { who: 'Kevin', text: 'Found the issue — it was a flaky test. Restarted the pipeline, should be green in 5 min', ts: '1773091020' },
      ],
    },
    expect: { urgency: 'FYI' },
  },

  // Case 4: Thread where someone else was asked to do something → FYI for me
  threadDirectedAtOther: {
    source: 'thread',
    opts: {
      channel: 'sales-eng-ops',
      messages: [
        { who: 'Sara', text: 'FR, requested by many, ability for the gmail connector in builder to send emails on behalf of users', ts: '1773050000' },
        { who: 'support-router', text: 'Filed as feature request. Area: Workflow/Agent Builder', ts: '1773050010' },
        { who: 'Karim', text: '@Kevin can you look into this? I think we discussed it last week', ts: '1773050020' },
        { who: 'Kevin', text: 'Yes, I have a plan for this. Will share an update tomorrow', ts: '1773050030' },
      ],
    },
    expect: { urgency: 'FYI' },
  },

  // Case 5: Mention where I'm directly asked a question and nobody answered yet → ACTION_NEEDED
  mentionDirectQuestion: {
    source: 'mention',
    opts: {
      channel: 'engineering',
      messages: [
        { who: 'Sergey', text: 'Hey @Matthias, are we shipping the search fix to production today or waiting for the full QA cycle?', ts: '1773100000' },
      ],
    },
    expect: { urgency: 'ACTION_NEEDED' },
  },

  // Case 6: Group DM where two others are talking to each other → FYI
  groupDmOthersConversing: {
    source: 'dm',
    opts: {
      person: 'Chris Weatherly',
      messages: [
        { who: 'me', text: 'morning @Chris Weatherly - Kevin, can we take a look?', ts: '1773040000' },
        { who: 'Chris Weatherly', text: 'Hey Kevin — the agent task for the shared Slack channel isn\'t picking up new messages', ts: '1773050000' },
        { who: 'Kevin', text: 'What channel is it? Let me check the config', ts: '1773050100' },
        { who: 'Chris Weatherly', text: 'It\'s the #acme-support channel we set up last week', ts: '1773050200' },
        { who: 'Kevin', text: 'Ah I see the issue — the destination channel ID is wrong. Could you please write me the channel name so I can update it?', ts: '1773050300' },
        { who: 'Chris Weatherly', text: 'Sure, it\'s acme-customer-support', ts: '1773050400' },
        { who: 'Kevin', text: 'Updated. Try it now', ts: '1773050500' },
        { who: 'Chris Weatherly', text: 'Works! Thanks Kevin', ts: '1773050600' },
      ],
    },
    // Matthias delegated to Kevin early on, the rest is between Kevin and Chris → FYI
    expect: { urgency: 'FYI' },
  },
}

// ─── Unit tests: parseTriageResult (deterministic) ───

describe('parseTriageResult', () => {
  it('parses a full ACTION_NEEDED response', () => {
    const raw = `URGENCY: ACTION_NEEDED
SUMMARY: Kevin asked what interface you use
ACTION: Reply telling Kevin it's Arc browser with split view
DRAFT: That's Arc browser! The split view makes it super easy to keep stuff organized.`
    const result = parseTriageResult(raw)
    expect(result.urgency).toBe('ACTION_NEEDED')
    expect(result.summary).toMatch(/Kevin/)
    expect(result.action).toBeTruthy()
    expect(result.draft).toBeTruthy()
    expect(result.draft).not.toBe('none')
  })

  it('parses a full FYI response', () => {
    const raw = `URGENCY: FYI
SUMMARY: Kevin handled the 30k character cap increase
ACTION: No action needed — Kevin deployed the hotfix
DRAFT: none`
    const result = parseTriageResult(raw)
    expect(result.urgency).toBe('FYI')
    expect(result.summary).toMatch(/Kevin/)
    expect(result.action).toMatch(/No action needed/)
    expect(result.draft).toBeNull()
  })

  it('handles null input', () => {
    const result = parseTriageResult(null)
    expect(result.urgency).toBeNull()
    expect(result.summary).toBeNull()
    expect(result.action).toBeNull()
    expect(result.draft).toBeNull()
  })

  it('handles malformed input gracefully', () => {
    const result = parseTriageResult('Just some random text without the expected format')
    expect(result.urgency).toBeNull()
    expect(result.summary).toBeNull()
  })

  it('normalizes ACTION_NEEDED variants', () => {
    const raw = `URGENCY: ACTION_NEEDED (direct question)
SUMMARY: Sergey needs deployment decision
ACTION: Reply with your preference
DRAFT: Let's ship it today, the QA cycle can run in parallel on staging.`
    const result = parseTriageResult(raw)
    expect(result.urgency).toBe('ACTION_NEEDED')
  })

  it('normalizes FYI variants', () => {
    const raw = `URGENCY: FYI (informational)
SUMMARY: Thread resolved without you
ACTION: No action needed — resolved
DRAFT: none`
    const result = parseTriageResult(raw)
    expect(result.urgency).toBe('FYI')
  })
})

// ─── Unit tests: buildTriagePrompt (deterministic) ───

describe('buildTriagePrompt', () => {
  it('includes DM source label', () => {
    const prompt = buildTriagePrompt('dm', { person: 'Kevin', messages: [{ who: 'Kevin', text: 'Hey', ts: '1' }] })
    expect(prompt).toContain('DM conversation with Kevin')
    expect(prompt).toContain('I am Matthias')
  })

  it('detects group DM with multiple participants', () => {
    const prompt = buildTriagePrompt('dm', {
      person: 'Chris',
      messages: [
        { who: 'me', text: 'Hey', ts: '1' },
        { who: 'Chris', text: 'Hi', ts: '2' },
        { who: 'Kevin', text: 'Hello', ts: '3' },
      ],
    })
    expect(prompt).toContain('Group DM with Chris, Kevin')
    expect(prompt).not.toContain('DM conversation with')
  })

  it('includes mention source label', () => {
    const prompt = buildTriagePrompt('mention', { channel: 'sales-eng-ops', messages: [{ who: 'Tarek', text: 'Hey', ts: '1' }] })
    expect(prompt).toContain('@mention in #sales-eng-ops')
  })

  it('includes thread source label', () => {
    const prompt = buildTriagePrompt('thread', { channel: 'engineering', messages: [{ who: 'Sergey', text: 'Hey', ts: '1' }] })
    expect(prompt).toContain('thread in #engineering')
  })

  it('includes transcript', () => {
    const prompt = buildTriagePrompt('dm', {
      person: 'Kevin',
      messages: [
        { who: 'me', text: 'Hello there', ts: '1' },
        { who: 'Kevin', text: 'What interface is that?', ts: '2' },
      ],
    })
    expect(prompt).toContain('me: Hello there')
    expect(prompt).toContain('Kevin: What interface is that?')
  })

  it('truncates long messages at 200 chars', () => {
    const longText = 'x'.repeat(300)
    const prompt = buildTriagePrompt('dm', {
      person: 'Kevin',
      messages: [{ who: 'Kevin', text: longText, ts: '1' }],
    })
    expect(prompt).not.toContain('x'.repeat(300))
    expect(prompt).toContain('x'.repeat(200))
  })

  it('includes the required output format instructions', () => {
    const prompt = buildTriagePrompt('dm', { person: 'Kevin', messages: [{ who: 'Kevin', text: 'Hey', ts: '1' }] })
    expect(prompt).toContain('URGENCY:')
    expect(prompt).toContain('SUMMARY:')
    expect(prompt).toContain('ACTION:')
    expect(prompt).toContain('DRAFT:')
  })
})

// ─── LLM eval tests (call real LLM, judge the result) ───

// These tests are slow (~2-5s each) and require API keys.
// Run with: OPENAI_API_KEY=... npx vitest run server/__tests__/slack-triage.test.js
// They are skipped in CI (no API keys).

const hasApiKey = !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY

describe.skipIf(!hasApiKey)('LLM evals: triage accuracy', () => {
  // Import the real callSonnet for eval tests
  let callSonnet

  beforeAll(async () => {
    const mod = await import('../slack-llm.js')
    callSonnet = mod.callSonnet
  })

  async function evalTriage(fixture) {
    const prompt = buildTriagePrompt(fixture.source, fixture.opts)
    const raw = await callSonnet(prompt)
    return parseTriageResult(raw)
  }

  // LLM-as-judge: ask a second LLM call to verify the result makes sense
  async function judgeResult(fixture, result) {
    const judgePrompt = `You are evaluating a Slack triage system. Given this conversation and the system's output, is the urgency classification correct?

Conversation context: ${fixture.source} in ${fixture.opts.channel || fixture.opts.person}
Messages:
${fixture.opts.messages.map(m => `${m.who}: ${m.text}`).join('\n')}

System output:
- Urgency: ${result.urgency}
- Summary: ${result.summary}
- Action: ${result.action}
- Draft: ${result.draft}

Expected urgency: ${fixture.expect.urgency}

Respond with ONLY "CORRECT" or "INCORRECT: <reason>".`
    return callSonnet(judgePrompt)
  }

  it('mention: Kevin handled the 30k cap → FYI', async () => {
    const f = FIXTURES.mentionKevinHandledIt
    const result = await evalTriage(f)
    expect(result.urgency).toBe('FYI')
    expect(result.action).toMatch(/[Nn]o action|handled|done|Kevin/)
    expect(result.draft).toBeNull()
  }, 15000)

  it('dm: direct question waiting on me → ACTION_NEEDED', async () => {
    const f = FIXTURES.dmDirectQuestion
    const result = await evalTriage(f)
    expect(result.urgency).toBe('ACTION_NEEDED')
    expect(result.draft).toBeTruthy()

    // LLM judge as secondary verification
    const judgment = await judgeResult(f, result)
    expect(judgment).toMatch(/CORRECT/)
  }, 15000)

  it('dm: acknowledged and chatting → FYI', async () => {
    const f = FIXTURES.dmAcknowledged
    const result = await evalTriage(f)
    expect(result.urgency).toBe('FYI')
  }, 15000)

  it('thread: question directed at someone else → FYI', async () => {
    const f = FIXTURES.threadDirectedAtOther
    const result = await evalTriage(f)
    expect(result.urgency).toBe('FYI')
  }, 15000)

  it('mention: direct question, no one answered → ACTION_NEEDED', async () => {
    const f = FIXTURES.mentionDirectQuestion
    const result = await evalTriage(f)
    expect(result.urgency).toBe('ACTION_NEEDED')
    expect(result.draft).toBeTruthy()
  }, 15000)

  it('group dm: others conversing without me → FYI', async () => {
    const f = FIXTURES.groupDmOthersConversing
    const result = await evalTriage(f)
    expect(result.urgency).toBe('FYI')
    expect(result.draft).toBeNull()
  }, 15000)

  // Consistency test: run the same fixture 3 times, all should agree
  it('consistency: mention FYI case returns FYI at least 2/3 times', async () => {
    const f = FIXTURES.mentionKevinHandledIt
    const results = await Promise.all([evalTriage(f), evalTriage(f), evalTriage(f)])
    const fyiCount = results.filter(r => r.urgency === 'FYI').length
    expect(fyiCount).toBeGreaterThanOrEqual(2)
  }, 30000)
})
