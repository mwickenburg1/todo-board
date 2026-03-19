import { describe, it, expect } from 'vitest'
import { resolveSlackView } from '../../src/shared/slack-view-resolver.ts'

describe('resolveSlackView', () => {
  // --- DMs ---

  it('DM: fetches channel history, reply placeholder uses person name', () => {
    const config = resolveSlackView({
      slackRef: 'D0AFYSQMY0M',
      context: 'slack-dms',
      label: 'Sergey',
    })
    expect(config.fetchMode).toBe('channel')
    expect(config.channelId).toBe('D0AFYSQMY0M')
    expect(config.threadTs).toBeNull()
    expect(config.replyThreadTs).toBeNull() // determined at render time
    expect(config.replyPlaceholder).toBe('Message Sergey...')
    expect(config.headerLabel).toBe('Sergey')
  })

  it('DM: fallback label when no name provided', () => {
    const config = resolveSlackView({
      slackRef: 'D0AFYSQMY0M',
      context: 'slack-dms',
    })
    expect(config.replyPlaceholder).toBe('Message DM...')
    expect(config.headerLabel).toBe('DM')
  })

  // --- Group DMs ---

  it('Group DM: friendly name and group placeholder', () => {
    const config = resolveSlackView({
      slackRef: 'G0AAD95AS7M',
      context: 'slack-dms',
      channelName: 'mpdm-alice--bob--charlie-1',
    })
    expect(config.fetchMode).toBe('channel')
    expect(config.replyPlaceholder).toBe('Message group...')
    expect(config.headerLabel).toBe('Group DM: Alice, Bob, Charlie')
  })

  // --- Mentions: in-thread ---

  it('Mention in thread: fetches thread only, replies to thread', () => {
    const config = resolveSlackView({
      slackRef: 'C05QFV7KVJ7/1773272725.817379',
      context: 'slack-mentions',
      channelName: 'tally-submissions',
    })
    expect(config.fetchMode).toBe('thread')
    expect(config.channelId).toBe('C05QFV7KVJ7')
    expect(config.threadTs).toBe('1773272725.817379')
    expect(config.replyThreadTs).toBe('1773272725.817379')
    expect(config.replyPlaceholder).toBe('Reply in thread...')
    expect(config.headerLabel).toBe('#tally-submissions')
  })

  // --- Mentions: top-level (no threadTs) ---

  it('Mention top-level: fetches channel history', () => {
    const config = resolveSlackView({
      slackRef: 'C05QFV7KVJ7',
      context: 'slack-mentions',
      channelName: 'sales-eng-ops',
    })
    expect(config.fetchMode).toBe('channel')
    expect(config.channelId).toBe('C05QFV7KVJ7')
    expect(config.threadTs).toBeNull()
    expect(config.replyThreadTs).toBeNull()
    expect(config.replyPlaceholder).toBe('Message #sales-eng-ops...')
    expect(config.headerLabel).toBe('#sales-eng-ops')
  })

  // --- Thread activity ---

  it('Thread activity: fetches thread, replies to thread', () => {
    const config = resolveSlackView({
      slackRef: 'C08JRK5G0L8/1773255857.062909',
      context: 'slack-threads',
      channelName: 'dev-agent-builder',
    })
    expect(config.fetchMode).toBe('thread')
    expect(config.channelId).toBe('C08JRK5G0L8')
    expect(config.threadTs).toBe('1773255857.062909')
    expect(config.replyThreadTs).toBe('1773255857.062909')
    expect(config.replyPlaceholder).toBe('Reply in thread...')
    expect(config.headerLabel).toBe('#dev-agent-builder')
  })

  // --- Private channel ---

  it('Private channel mention: same as public channel mention', () => {
    const config = resolveSlackView({
      slackRef: 'G09K7EJU70S/1772820896.156409',
      context: 'slack-mentions',
      channelName: 'dev-crm-improvements',
    })
    expect(config.fetchMode).toBe('thread')
    expect(config.replyThreadTs).toBe('1772820896.156409')
    expect(config.headerLabel).toBe('#dev-crm-improvements')
  })

  // --- Edge cases ---

  it('Raw channel ID as name: falls back to label', () => {
    const config = resolveSlackView({
      slackRef: 'C05QFV7KVJ7/1234.5678',
      context: 'slack-mentions',
      channelName: 'C05QFV7KVJ7',
      label: '#sales-eng-ops',
    })
    expect(config.headerLabel).toBe('#sales-eng-ops')
  })

  it('Unknown context: defaults to channel view', () => {
    const config = resolveSlackView({
      slackRef: 'C123',
      context: 'slack-unknown',
    })
    expect(config.fetchMode).toBe('channel')
  })
})
