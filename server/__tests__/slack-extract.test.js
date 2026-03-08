import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock slack-api.js
vi.mock('../slack-api.js', () => ({
  slack: vi.fn(),
  resolveUser: vi.fn((uid) => Promise.resolve(uid)),
  extractBlockText: vi.fn((blocks) => ''),
  SLACK_TOKEN: 'xoxp-test',
  ANTHROPIC_API_KEY: 'test-key',
  USER_ID: 'U02BMLFJJ64',
}))

// Mock slack-llm.js
vi.mock('../slack-llm.js', () => ({
  callSonnet: vi.fn(),
}))

import { parseSlackUrl, extractThreadContext } from '../slack-extract.js'
import { slack, resolveUser } from '../slack-api.js'
import { callSonnet } from '../slack-llm.js'

describe('parseSlackUrl', () => {
  it('parses a standard slack archive URL', () => {
    const result = parseSlackUrl('https://attentiontech.slack.com/archives/C07QTH1005N/p1709234567000100')
    expect(result).toEqual({
      channel: 'C07QTH1005N',
      ts: '1709234567.000100',
    })
  })

  it('parses a URL with 10-digit p-value (no microseconds)', () => {
    const result = parseSlackUrl('https://attentiontech.slack.com/archives/C123ABC/p1234567890')
    expect(result).toEqual({
      channel: 'C123ABC',
      ts: '1234567890.000000',
    })
  })

  it('parses a URL with 16-digit p-value', () => {
    const result = parseSlackUrl('https://attentiontech.slack.com/archives/C123ABC/p1234567890123456')
    expect(result).toEqual({
      channel: 'C123ABC',
      ts: '1234567890.123456',
    })
  })

  it('parses a URL with ?thread_ts= query param', () => {
    const result = parseSlackUrl('https://attentiontech.slack.com/archives/C123ABC/p1234567890?thread_ts=1234567800.000000')
    expect(result).toEqual({
      channel: 'C123ABC',
      ts: '1234567800.000000',
    })
  })

  it('returns null for non-slack URLs', () => {
    expect(parseSlackUrl('https://google.com')).toBeNull()
    expect(parseSlackUrl('not a url')).toBeNull()
    expect(parseSlackUrl('')).toBeNull()
  })

  it('returns null for slack URLs without archive path', () => {
    expect(parseSlackUrl('https://attentiontech.slack.com/channels/general')).toBeNull()
  })

  it('handles any slack workspace domain', () => {
    const result = parseSlackUrl('https://other-workspace.slack.com/archives/CABC123/p1709234567000100')
    expect(result).toEqual({
      channel: 'CABC123',
      ts: '1709234567.000100',
    })
  })
})

describe('extractThreadContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches thread and returns summary with metadata', async () => {
    slack.mockResolvedValueOnce({
      ok: true,
      messages: [
        { user: 'U001', text: 'We need to fix the deploy pipeline', ts: '1709234567.000100' },
        { user: 'U002', text: 'I can look into it', ts: '1709234568.000100' },
        { user: 'U001', text: 'Thanks, the staging env is broken', ts: '1709234569.000100' },
      ],
    })
    // Channel info
    slack.mockResolvedValueOnce({
      ok: true,
      channel: { name: 'engineering' },
    })
    resolveUser.mockImplementation((uid) => {
      if (uid === 'U001') return Promise.resolve('Alice')
      if (uid === 'U002') return Promise.resolve('Bob')
      return Promise.resolve(uid)
    })
    callSonnet.mockResolvedValueOnce('Deploy pipeline broken, staging env down — needs fix')

    const result = await extractThreadContext('C07QTH1005N', '1709234567.000100')

    expect(result.channel).toBe('C07QTH1005N')
    expect(result.ts).toBe('1709234567.000100')
    expect(result.channelName).toBe('engineering')
    expect(result.messageCount).toBe(3)
    expect(result.participants).toContain('Alice')
    expect(result.participants).toContain('Bob')
    expect(result.summary).toBe('Deploy pipeline broken, staging env down — needs fix')
    expect(result.threadPreview).toBeTruthy()
  })

  it('handles single message (no thread)', async () => {
    slack.mockResolvedValueOnce({
      ok: true,
      messages: [
        { user: 'U001', text: 'Quick question about the API', ts: '1709234567.000100' },
      ],
    })
    slack.mockResolvedValueOnce({
      ok: true,
      channel: { name: 'general' },
    })
    resolveUser.mockResolvedValue('Alice')
    callSonnet.mockResolvedValueOnce('Question about API usage')

    const result = await extractThreadContext('C123', '1709234567.000100')

    expect(result.messageCount).toBe(1)
    expect(result.summary).toBe('Question about API usage')
  })

  it('falls back to first message text when LLM fails', async () => {
    slack.mockResolvedValueOnce({
      ok: true,
      messages: [
        { user: 'U001', text: 'The build is failing on main', ts: '1709234567.000100' },
      ],
    })
    slack.mockResolvedValueOnce({
      ok: true,
      channel: { name: 'builds' },
    })
    resolveUser.mockResolvedValue('Alice')
    callSonnet.mockResolvedValueOnce(null)

    const result = await extractThreadContext('C123', '1709234567.000100')

    expect(result.summary).toBe('The build is failing on main')
  })

  it('throws on Slack API failure', async () => {
    slack.mockResolvedValueOnce({ ok: false, error: 'channel_not_found' })

    await expect(extractThreadContext('C999', '123.456'))
      .rejects.toThrow('Failed to fetch thread')
  })
})
