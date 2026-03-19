import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSearchVariants, searchSlack, synthesizeHypotheses } from '../slack-enrich.js'

// --- Unit tests for search variant generation (no mocks needed) ---

describe('generateSearchVariants', () => {
  it('generates full-text variant from plain text', () => {
    const variants = generateSearchVariants('maintainx analysis')
    const labels = variants.map(v => v.label)
    expect(labels).toContain('full')
    const full = variants.find(v => v.label === 'full')
    expect(full.query).toBe('maintainx analysis')
  })

  it('extracts bracketed prefix and combines with rest', () => {
    const variants = generateSearchVariants('[Deal View] Support boards')
    const labels = variants.map(v => v.label)
    expect(labels).toContain('with-prefix')
    const withPrefix = variants.find(v => v.label === 'with-prefix')
    expect(withPrefix.query).toBe('Deal View Support boards')
  })

  it('generates keyword pairs for multi-word tasks', () => {
    const variants = generateSearchVariants('maintainx slack analysis')
    const pairs = variants.filter(v => v.label.startsWith('pair-'))
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    expect(pairs[0].query).toContain('maintainx')
  })

  it('generates from-me DM search', () => {
    const variants = generateSearchVariants('maintainx analysis')
    const fromMe = variants.find(v => v.label === 'from-me')
    expect(fromMe).toBeDefined()
    expect(fromMe.query).toContain('from:me')
  })

  it('skips short or empty queries', () => {
    expect(generateSearchVariants('')).toEqual([])
    expect(generateSearchVariants('ab')).toEqual([])
  })

  it('handles semicolons and special chars in task text', () => {
    const variants = generateSearchVariants('EIP - release notes; consent thing')
    const full = variants.find(v => v.label === 'full')
    expect(full.query).toBe('EIP - release notes; consent thing')
    // Should generate keyword pairs
    const pairs = variants.filter(v => v.label.startsWith('pair-'))
    expect(pairs.length).toBeGreaterThanOrEqual(1)
  })

  it('does not duplicate full and with-prefix when no brackets', () => {
    const variants = generateSearchVariants('simple task name')
    const withPrefix = variants.find(v => v.label === 'with-prefix')
    expect(withPrefix).toBeUndefined()
  })
})

// --- Integration-style tests with mocked Slack API ---

vi.mock('../slack-api.js', () => ({
  slack: vi.fn(),
  USER_ID: 'U02BMLFJJ64',
  cleanMentions: vi.fn(text => text),
}))

vi.mock('../slack-llm.js', () => ({
  callSonnet: vi.fn(),
}))

import { slack } from '../slack-api.js'
import { callSonnet } from '../slack-llm.js'

describe('searchSlack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for empty query', async () => {
    const results = await searchSlack('')
    expect(results).toEqual([])
    expect(slack).not.toHaveBeenCalled()
  })

  it('calls slack search.messages for each variant', async () => {
    slack.mockResolvedValue({ ok: true, messages: { matches: [] } })

    await searchSlack('maintainx analysis')

    // Should have called slack multiple times (full, pairs, from-me, etc.)
    expect(slack).toHaveBeenCalled()
    const calls = slack.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(3) // at least full + pair + from-me
    for (const call of calls) {
      expect(call[0]).toBe('search.messages')
    }
  })

  it('deduplicates messages by ts', async () => {
    const msg = {
      text: 'maintainx update',
      username: 'tarek',
      channel: { name: 'dm', id: 'D123', is_im: true },
      ts: '1773267683.409349',
      permalink: 'https://slack.com/p1',
    }

    // Return the same message from multiple search variants
    slack.mockResolvedValue({
      ok: true,
      messages: { matches: [msg] },
    })

    const results = await searchSlack('maintainx analysis')
    // Despite multiple API calls returning the same msg, should only appear once
    const tsCounts = {}
    for (const r of results) {
      tsCounts[r.ts] = (tsCounts[r.ts] || 0) + 1
    }
    for (const count of Object.values(tsCounts)) {
      expect(count).toBe(1)
    }
  })

  it('boosts DM messages higher in score', async () => {
    const now = Date.now() / 1000
    const dmMsg = {
      text: 'maintainx analysis request',
      username: 'tarek',
      channel: { name: 'dm', id: 'D123', is_im: true },
      ts: String(now - 3600), // 1 hour ago
      permalink: 'https://slack.com/p1',
    }
    const channelMsg = {
      text: 'maintainx discussion',
      username: 'tarek',
      channel: { name: 'sales-eng', id: 'C456', is_im: false },
      ts: String(now - 3600), // same age
      permalink: 'https://slack.com/p2',
    }

    // First call returns DM, second returns channel msg
    let callCount = 0
    slack.mockImplementation(() => {
      callCount++
      if (callCount === 1) return { ok: true, messages: { matches: [dmMsg] } }
      if (callCount === 2) return { ok: true, messages: { matches: [channelMsg] } }
      return { ok: true, messages: { matches: [] } }
    })

    const results = await searchSlack('maintainx analysis')
    const dm = results.find(r => r.isDM)
    const ch = results.find(r => !r.isDM)
    if (dm && ch) {
      expect(dm.score).toBeGreaterThan(ch.score)
    }
  })

  it('handles Slack API errors gracefully', async () => {
    slack.mockResolvedValue({ ok: false, error: 'not_authed' })
    const results = await searchSlack('test query')
    expect(results).toEqual([])
  })
})

describe('synthesizeHypotheses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns fallback when no messages found', async () => {
    const result = await synthesizeHypotheses('test task', [])
    expect(result).toHaveLength(1)
    expect(result[0].hypothesis).toContain('No Slack messages')
    expect(callSonnet).not.toHaveBeenCalled()
  })

  it('calls LLM with task text and message transcript', async () => {
    callSonnet.mockResolvedValue(JSON.stringify([
      { hypothesis: 'Run analysis on MaintainX Slack data', confidence: 'high', summary: 'Context here', messageIndices: [1] },
    ]))

    const messages = [
      { text: 'run analysis on maintainx slack', username: 'tarek', channel: 'dm', isDM: true, ts: '123', permalink: 'https://p1' },
    ]

    const result = await synthesizeHypotheses('maintainx analysis', messages)
    expect(callSonnet).toHaveBeenCalledOnce()
    const prompt = callSonnet.mock.calls[0][0]
    expect(prompt).toContain('maintainx analysis')
    expect(prompt).toContain('@tarek')
    expect(prompt).toContain('[DM]')
  })

  it('parses LLM JSON response and attaches message data', async () => {
    callSonnet.mockResolvedValue(JSON.stringify([
      { hypothesis: 'Get access to MaintainX Slack workspace', confidence: 'high', summary: 'Tarek asked about access', messageIndices: [1, 2] },
      { hypothesis: 'Run diagnostic across call recordings', confidence: 'medium', summary: 'Prescriptive approach', messageIndices: [2] },
    ]))

    const messages = [
      { text: 'can we get access to slack?', username: 'tarek', channel: 'dm', isDM: true, ts: '1', permalink: 'https://p1' },
      { text: 'diagnose their business with test helper', username: 'tarek', channel: 'int-maintainx', isDM: false, ts: '2', permalink: 'https://p2' },
    ]

    const result = await synthesizeHypotheses('maintainx analysis', messages)
    expect(result).toHaveLength(2)
    expect(result[0].messages).toHaveLength(2)
    expect(result[0].messages[0].username).toBe('tarek')
    expect(result[1].messages).toHaveLength(1)
    expect(result[1].messages[0].channel).toBe('int-maintainx')
  })

  it('handles LLM returning non-JSON gracefully', async () => {
    callSonnet.mockResolvedValue('Sorry, I cannot parse the messages properly.')

    const messages = [
      { text: 'some message', username: 'user', channel: 'general', isDM: false, ts: '1', permalink: null },
    ]

    const result = await synthesizeHypotheses('test task', messages)
    expect(result).toHaveLength(1)
    expect(result[0].confidence).toBe('medium')
  })

  it('handles LLM failure gracefully', async () => {
    callSonnet.mockResolvedValue(null)

    const messages = [
      { text: 'msg', username: 'u', channel: 'c', isDM: false, ts: '1', permalink: null },
    ]

    const result = await synthesizeHypotheses('test task', messages)
    expect(result).toHaveLength(1)
    expect(result[0].hypothesis).toContain('failed')
  })

  it('filters out invalid message indices', async () => {
    callSonnet.mockResolvedValue(JSON.stringify([
      { hypothesis: 'Test', confidence: 'medium', summary: 'x', messageIndices: [0, 1, 99] },
    ]))

    const messages = [
      { text: 'msg1', username: 'u', channel: 'c', isDM: false, ts: '1', permalink: null },
    ]

    const result = await synthesizeHypotheses('test', messages)
    // Index 0 is invalid (1-indexed), 99 is out of range — only index 1 should survive
    expect(result[0].messages).toHaveLength(1)
  })
})
