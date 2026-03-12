/**
 * Tests for conversations.js — task conversation persistence and LLM integration.
 *
 * Run: cd /home/ubuntu/todo-board && npx vitest run server/__tests__/conversations.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// --- Mock fs before importing conversations.js ---
// Node's fs module needs both named and default exports mocked
const _readFileSync = vi.fn(() => '{}')
const _writeFileSync = vi.fn()

vi.mock('fs', () => {
  const mock = {
    readFileSync: _readFileSync,
    writeFileSync: _writeFileSync,
  }
  return { ...mock, default: mock }
})

// Mock store.js
const mockData = {
  lists: {
    'daily-goals': [
      { id: 1, text: 'Fix login bug', notes: 'User reports 500 error', status: 'pending' },
      { id: 2, text: 'Write docs', status: 'pending', slackWatch: { ref: 'C123/ts', delegateOnly: true } },
      { id: 3, text: 'Deploy v2', status: 'pending', deadline: '2026-03-15', env: 'env1' },
    ],
  },
}

vi.mock('../store.js', () => ({
  readData: vi.fn(() => mockData),
  saveData: vi.fn(),
  findTask: vi.fn((data, id) => {
    for (const [listName, tasks] of Object.entries(data.lists)) {
      const task = tasks.find(t => t.id === id)
      if (task) return { list: listName, task }
    }
    return null
  }),
}))

// Mock slack-llm — capture prompt, return canned response
let llmResponse = 'That sounds like a session management issue. Check the auth middleware first.'
vi.mock('../slack-llm.js', () => ({
  callSonnet: vi.fn(async (prompt) => llmResponse),
}))

const { getConversation, addMessage, clearConversation, _resetAll } = await import('../conversations.js')
const { callSonnet } = await import('../slack-llm.js')

beforeEach(() => {
  vi.clearAllMocks()
  llmResponse = 'That sounds like a session management issue. Check the auth middleware first.'
  _resetAll()
})

describe('getConversation', () => {
  it('returns empty messages for a task with no conversation', () => {
    const convo = getConversation(999)
    expect(convo).toEqual({ messages: [] })
  })
})

describe('addMessage', () => {
  it('adds user message and gets LLM response', async () => {
    const convo = await addMessage(1, 'Where should I start debugging?')

    expect(convo.messages).toHaveLength(2)
    expect(convo.messages[0].role).toBe('user')
    expect(convo.messages[0].content).toBe('Where should I start debugging?')
    expect(convo.messages[0].ts).toBeTypeOf('number')
    expect(convo.messages[1].role).toBe('assistant')
    expect(convo.messages[1].content).toContain('session management')
  })

  it('builds system prompt with task context', async () => {
    await addMessage(1, 'test')

    const prompt = callSonnet.mock.calls[0][0]
    expect(prompt).toContain('Fix login bug')
    expect(prompt).toContain('User reports 500 error') // notes included
    expect(prompt).toContain('User: test')
  })

  it('includes slackWatch context in system prompt', async () => {
    await addMessage(2, 'test')

    const prompt = callSonnet.mock.calls[0][0]
    expect(prompt).toContain('Write docs')
    expect(prompt).toContain('Slack thread')
    expect(prompt).toContain('delegated')
  })

  it('includes deadline and env in system prompt', async () => {
    await addMessage(3, 'test')

    const prompt = callSonnet.mock.calls[0][0]
    expect(prompt).toContain('Deploy v2')
    expect(prompt).toContain('2026-03-15')
    expect(prompt).toContain('env1')
  })

  it('persists conversation to disk after each message', async () => {
    await addMessage(1, 'Hello')

    expect(_writeFileSync).toHaveBeenCalled()
    const writtenData = JSON.parse(_writeFileSync.mock.calls[0][1])
    expect(writtenData['1']).toBeDefined()
    expect(writtenData['1'].messages).toHaveLength(2)
  })

  it('accumulates messages across calls', async () => {
    await addMessage(1, 'first question')

    llmResponse = 'Follow-up answer here.'
    await addMessage(1, 'second question')

    const convo = getConversation(1)
    expect(convo.messages).toHaveLength(4)
    expect(convo.messages[0].content).toBe('first question')
    expect(convo.messages[2].content).toBe('second question')
    expect(convo.messages[3].content).toBe('Follow-up answer here.')
  })

  it('includes full conversation history in prompt', async () => {
    await addMessage(1, 'first')
    await addMessage(1, 'second')

    const secondPrompt = callSonnet.mock.calls[1][0]
    expect(secondPrompt).toContain('User: first')
    expect(secondPrompt).toContain('User: second')
  })

  it('throws for non-existent task', async () => {
    await expect(addMessage(999, 'hello')).rejects.toThrow('Task not found')
  })

  it('handles LLM returning null gracefully', async () => {
    llmResponse = null
    const convo = await addMessage(1, 'test')

    expect(convo.messages).toHaveLength(2)
    expect(convo.messages[1].content).toContain("couldn't generate")
  })
})

describe('clearConversation', () => {
  it('removes conversation and persists', async () => {
    await addMessage(1, 'hello')
    expect(getConversation(1).messages.length).toBeGreaterThan(0)

    clearConversation(1)
    expect(getConversation(1)).toEqual({ messages: [] })
    // Should have persisted the deletion
    const lastWrite = _writeFileSync.mock.calls.at(-1)
    const data = JSON.parse(lastWrite[1])
    expect(data['1']).toBeUndefined()
  })
})
