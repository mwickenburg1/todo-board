/**
 * Chat Memory — persistent memory layer using Mem0 cloud API.
 *
 * Memories are extracted from conversations via [MEMORY: ...] tags,
 * stored in Mem0's cloud, and recalled via semantic search.
 *
 * API: https://api.mem0.ai/v1/memories/
 */

const MEM0_API_KEY = process.env.MEM0_API_KEY
const MEM0_BASE = 'https://api.mem0.ai'
const MEM0_USER_ID = 'todo-board-user'

function headers() {
  return {
    'Authorization': `Token ${MEM0_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Save a new memory via Mem0 API.
 */
export async function saveMemory(content, sourceTaskId = null) {
  if (!MEM0_API_KEY) {
    console.error('[memory] MEM0_API_KEY not set, skipping save')
    return null
  }
  try {
    const res = await fetch(`${MEM0_BASE}/v1/memories/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        messages: [{ role: 'user', content: content.trim() }],
        user_id: MEM0_USER_ID,
        metadata: sourceTaskId ? { source_task_id: String(sourceTaskId) } : {},
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[memory] Mem0 save error:', data)
      return null
    }
    // data is an array of memory events
    const added = Array.isArray(data) ? data.find(e => e.event === 'ADD' || e.event === 'UPDATE') : null
    return added ? { id: added.id, content: added.data?.memory || content.trim() } : { id: 'pending', content: content.trim() }
  } catch (err) {
    console.error('[memory] Mem0 save failed:', err.message)
    return null
  }
}

/**
 * Retrieve memories relevant to a query via Mem0 semantic search.
 */
export async function recallMemories(taskText, notes, maxResults = 5) {
  if (!MEM0_API_KEY) return []
  const query = `${taskText} ${notes || ''}`.trim()
  if (!query) return []

  try {
    const res = await fetch(`${MEM0_BASE}/v2/memories/search/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        query,
        filters: { user_id: MEM0_USER_ID },
        top_k: maxResults,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[memory] Mem0 search error:', data)
      return []
    }
    // data is an array of memory objects
    const results = Array.isArray(data) ? data : (data.results || [])
    return results.map(m => ({
      id: m.id,
      content: m.memory,
    }))
  } catch (err) {
    console.error('[memory] Mem0 search failed:', err.message)
    return []
  }
}

/**
 * Get all memories (for UI display).
 */
export async function getAllMemories() {
  if (!MEM0_API_KEY) return []
  try {
    const res = await fetch(`${MEM0_BASE}/v2/memories/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        filters: { AND: [{ user_id: MEM0_USER_ID }] },
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[memory] Mem0 getAll error:', data)
      return []
    }
    const results = data.results || (Array.isArray(data) ? data : [])
    return results.map(m => ({
      id: m.id,
      content: m.memory,
      created: m.created_at,
    }))
  } catch (err) {
    console.error('[memory] Mem0 getAll failed:', err.message)
    return []
  }
}

/**
 * Delete a memory by ID.
 */
export async function deleteMemory(id) {
  if (!MEM0_API_KEY) return
  try {
    await fetch(`${MEM0_BASE}/v1/memories/${id}/`, {
      method: 'DELETE',
      headers: headers(),
    })
  } catch (err) {
    console.error('[memory] Mem0 delete failed:', err.message)
  }
}

/**
 * Parse [MEMORY: ...] tags from LLM response.
 * Returns { cleanContent, newMemories: string[] }
 */
export function parseMemoryTags(response) {
  const memoryPattern = /\[MEMORY:\s*(.+?)\]/g
  const newMemories = []
  let match
  while ((match = memoryPattern.exec(response)) !== null) {
    newMemories.push(match[1].trim())
  }
  const cleanContent = response.replace(memoryPattern, '').replace(/\n{3,}/g, '\n\n').trim()
  return { cleanContent, newMemories }
}

/**
 * Build the memory section for the system prompt.
 */
export function buildMemoryPrompt(memories) {
  if (memories.length === 0) return ''
  const lines = memories.map(m => `- ${m.content}`)
  return `\n\nYour memory (facts you've remembered from previous conversations):\n${lines.join('\n')}`
}

/**
 * Build memory extraction instruction for the LLM.
 */
export function memoryInstruction() {
  return `\n\nIMPORTANT — Memory system:
You have persistent memory across conversations. When the user shares a fact, preference, decision, or context worth remembering for future conversations, embed it in your response as [MEMORY: <fact>]. Examples:
- User says "I always use env2 for forecasting" → include [MEMORY: User prefers env2 for forecasting work]
- User shares a decision → [MEMORY: Decided to use Kafka instead of RabbitMQ for event processing]
- User corrects you → [MEMORY: The deploy script is at scripts/deploy.sh, not scripts/release.sh]
Only save genuinely useful facts — not task-specific ephemera. 0-2 memories per response is typical. Many responses need zero.`
}

/** Test-only: reset */
export function _resetAll() {}
