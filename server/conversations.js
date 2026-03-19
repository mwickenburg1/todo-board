/**
 * Task Conversations — persistent LLM chat threads tied to individual tasks.
 *
 * Stored in a separate file (~todos-repo/.task-conversations.json) to keep
 * the main todos.json lean and avoid polluting it with chat history.
 *
 * Each task can have one conversation. Messages are { role, content, ts }.
 * Memory events (recalled/saved) are returned alongside messages.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { findTask, readData } from './store.js'
import { callOpus } from './slack-llm.js'
import {
  recallMemories,
  saveMemory,
  parseMemoryTags,
  buildMemoryPrompt,
  memoryInstruction,
  getAllMemories,
  deleteMemory,
} from './memory.js'

const CONVO_PATH = join(process.env.HOME, 'todos-repo', '.task-conversations.json')

let conversations = {}
try { conversations = JSON.parse(readFileSync(CONVO_PATH, 'utf-8')) } catch {}

function persist() {
  writeFileSync(CONVO_PATH, JSON.stringify(conversations, null, 2))
}

export function getConversation(taskId) {
  return conversations[taskId] || { messages: [] }
}

function buildSystemPrompt(task, memories) {
  const parts = [`You are a concise thinking partner helping me work through a task.`]
  parts.push(`\nTask: "${task.text}"`)
  if (task.notes) parts.push(`\nNotes:\n${task.notes}`)
  const watches = task.slackWatches || (task.slackWatch ? [task.slackWatch] : [])
  if (watches.length > 0) {
    const modes = watches.map(sw => sw.delegateOnly ? 'delegated' : 'own work')
    parts.push(`\nThis task is watching ${watches.length} Slack thread(s) (${modes.join(', ')}).`)
  }
  if (task.deadline) parts.push(`\nDeadline: ${task.deadline}`)
  if (task.env) parts.push(`\nEnvironment: ${task.env}`)
  // Inject recalled memories
  parts.push(buildMemoryPrompt(memories))
  parts.push(`\nBe brief and direct. Ask clarifying questions when needed. Help me think, don't lecture.`)
  // Memory extraction instruction
  parts.push(memoryInstruction())
  return parts.join('')
}

export async function addMessage(taskId, userMessage) {
  const data = readData()
  const result = findTask(data, taskId)
  if (!result) throw new Error('Task not found')

  if (!conversations[taskId]) {
    conversations[taskId] = { messages: [] }
  }
  const convo = conversations[taskId]

  // Add user message
  convo.messages.push({
    role: 'user',
    content: userMessage,
    ts: Date.now(),
  })

  // Recall relevant memories
  const recalled = await recallMemories(result.task.text, result.task.notes)

  // Build prompt for LLM
  const systemPrompt = buildSystemPrompt(result.task, recalled)
  const transcript = convo.messages.map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n\n')

  const fullPrompt = `${systemPrompt}\n\n${transcript}\n\nAssistant:`

  const response = await callOpus(fullPrompt)
  const rawContent = (response || 'Sorry, I couldn\'t generate a response.').trim()

  // Parse memory tags from response
  const { cleanContent, newMemories } = parseMemoryTags(rawContent)

  // Save extracted memories
  const savedMemories = []
  for (const memContent of newMemories) {
    const saved = await saveMemory(memContent, taskId)
    if (saved) savedMemories.push(saved)
  }

  const assistantMessage = {
    role: 'assistant',
    content: cleanContent,
    ts: Date.now(),
  }
  convo.messages.push(assistantMessage)

  persist()

  // Return convo + memory events for the UI
  return {
    messages: convo.messages,
    memory_events: {
      recalled: recalled.map(m => ({ id: m.id, content: m.content })),
      saved: savedMemories.map(m => ({ id: m.id, content: m.content })),
    },
  }
}

export function clearConversation(taskId) {
  delete conversations[taskId]
  persist()
}

export { getAllMemories, deleteMemory }

/** Test-only: reset all in-memory state */
export function _resetAll() {
  for (const key of Object.keys(conversations)) delete conversations[key]
}
