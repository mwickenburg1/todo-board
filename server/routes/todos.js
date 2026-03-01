import { Router } from 'express'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readData, saveData, findTask, createTask, insertInList, createEmptySlot } from '../store.js'
import { parseInput, placeSectionBefore } from '../helpers.js'

// Load .env for Slack token (used in thread root resolution)
const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  const envFile = readFileSync(resolve(__dirname, '..', '..', '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    const val = trimmed.slice(eq + 1)
    if (!process.env[key]) process.env[key] = val
  }
} catch {}

const router = Router()

// --- Static routes MUST come before /:id parameterized routes ---

// Split a task at cursor position (Enter key) — atomic update+create+position
router.post('/split', (req, res) => {
  try {
    const { id, before, after, list, status = 'pending', beforeId } = req.body
    const data = readData()

    if (id && before !== undefined) {
      const result = findTask(data, id)
      if (result) result.task.text = before
    }

    const newTask = createTask(data, { text: after || '', status })

    if (!data.lists[list]) data.lists[list] = []

    if (beforeId) {
      const insertIndex = data.lists[list].findIndex(t => t.id === beforeId)
      if (insertIndex !== -1) {
        const target = data.lists[list][insertIndex]
        if (target.parent_id) newTask.parent_id = target.parent_id
        data.lists[list].splice(insertIndex, 0, newTask)
      } else {
        data.lists[list].push(newTask)
      }
    } else if (id) {
      const afterIndex = data.lists[list].findIndex(t => t.id === id)
      if (afterIndex !== -1) {
        const source = data.lists[list][afterIndex]
        if (source.parent_id) newTask.parent_id = source.parent_id
        data.lists[list].splice(afterIndex + 1, 0, newTask)
      } else {
        data.lists[list].push(newTask)
      }
    } else {
      data.lists[list].push(newTask)
    }

    saveData(data)
    res.json({ success: true, task: newTask })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Add a new task
router.post('/', (req, res) => {
  try {
    const { text, list, priority = 2, parent_id, status = 'pending' } = req.body
    if (!list) return res.status(400).json({ error: 'list is required' })

    const data = readData()
    const newTask = createTask(data, { text: text || '', priority, status, parent_id: parent_id || null })

    if (!data.lists[list]) data.lists[list] = []
    data.lists[list].push(newTask)

    saveData(data)
    res.json({ success: true, task: newTask })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Parameterized /:id routes ---

// Mark a task as done
router.post('/:id/done', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { recursive } = req.body || {}
    const data = readData()

    const result = findTask(data, id, { skipDone: true })
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { list: foundList, task } = result

    const now = new Date().toISOString()
    const completedTasks = []

    if (recursive) {
      for (const [listName, tasks] of Object.entries(data.lists)) {
        if (!tasks || listName === 'done') continue
        const children = tasks.filter(t => t.parent_id === id)
        for (const child of children) {
          child.status = 'done'
          child.completed = now
          child.from_list = listName
          completedTasks.push({ ...child })
        }
        data.lists[listName] = tasks.filter(t => t.parent_id !== id)
      }
    }

    const sourceFocusSlot = task.focus_slot
    data.lists[foundList] = data.lists[foundList].filter(t => t.id !== id)

    if (sourceFocusSlot && foundList === 'now') {
      data.lists.now.push(createEmptySlot(sourceFocusSlot))
    }

    task.status = 'done'
    task.completed = now
    task.from_list = foundList

    if (!data.lists.done) data.lists.done = []
    data.lists.done.push(...completedTasks, task)

    if (!data.completed_log) data.completed_log = []
    data.completed_log.push(...completedTasks, task)

    saveData(data)
    res.json({ success: true, task, childrenCompleted: completedTasks.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Move a task to a different list
router.post('/:id/move', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { targetList, focusSlot, asSubtaskOf, replaceFocus, category, insertBefore } = req.body

    if (!targetList) return res.status(400).json({ error: 'targetList is required' })

    const data = readData()
    const result = findTask(data, id, { copy: true })
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { list: sourceList, task } = result

    const sourceFocusSlot = task.focus_slot
    data.lists[sourceList] = data.lists[sourceList].filter(t => t.id !== id)

    if (sourceFocusSlot && sourceList === 'now' && !(targetList === 'now' && focusSlot === sourceFocusSlot)) {
      data.lists.now.push(createEmptySlot(sourceFocusSlot))
    }

    if (asSubtaskOf) {
      task.parent_id = asSubtaskOf
      delete task.focus_slot
      delete task.is_empty_slot
      if (!data.lists.queue) data.lists.queue = []
      insertInList(data.lists.queue, task, insertBefore)
      saveData(data)
      return res.json({ success: true, task, from: sourceList, to: 'queue', asSubtaskOf, insertBefore })
    }

    if (targetList === 'now' && focusSlot && replaceFocus) {
      const existingTask = data.lists.now?.find(t => t.focus_slot === focusSlot && t.id && !t.is_empty_slot)

      if (existingTask && existingTask.id !== id) {
        const movedTask = { ...existingTask }
        delete movedTask.focus_slot
        data.lists.now = data.lists.now.filter(t => t.id !== existingTask.id)
        if (!data.lists.queue) data.lists.queue = []
        data.lists.queue.push(movedTask)
      }

      if (data.lists.now) {
        data.lists.now = data.lists.now.filter(t => t.focus_slot !== focusSlot || (t.id && t.id !== id))
      }

      task.focus_slot = focusSlot
      delete task.is_empty_slot
      data.lists.now.push(task)
      saveData(data)
      return res.json({ success: true, task, from: sourceList, to: 'now', replaced: existingTask?.id })
    }

    delete task.focus_slot
    delete task.is_empty_slot

    if (sourceList === 'done') {
      task.status = 'pending'
      delete task.completed
      delete task.from_list
    }

    if (category && targetList !== 'monitoring') {
      const targetTasks = data.lists[targetList] || []
      const categoryParent = targetTasks.find(t =>
        !t.parent_id && t.text && t.text.toLowerCase().includes(category.toLowerCase())
      )
      if (categoryParent) {
        task.parent_id = categoryParent.id
        delete task.stored_category
      } else {
        task.stored_category = category
        delete task.parent_id
      }
    } else if (targetList === 'monitoring') {
      delete task.parent_id
      delete task.stored_category
    }

    if (!data.lists[targetList]) data.lists[targetList] = []
    insertInList(data.lists[targetList], task, insertBefore)

    saveData(data)
    res.json({ success: true, task, from: sourceList, to: targetList, category, insertBefore })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update a task
router.patch('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { text, context, status, in_progress_order, escalation } = req.body
    const data = readData()

    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { task, list: sourceList } = result

    if (text !== undefined) {
      const parsed = parseInput(text)
      if (parsed.type === 'section') {
        const listArr = data.lists[sourceList]
        const idx = listArr.indexOf(task)
        if (idx !== -1) listArr.splice(idx, 1)
        if (!data.lists[parsed.normalized]) data.lists[parsed.normalized] = []
        placeSectionBefore(data, parsed.normalized, sourceList)
        saveData(data)
        return res.json({ success: true, section: parsed.normalized })
      }
    }

    if (text !== undefined) task.text = text
    if (context !== undefined) task.context = context
    if (status !== undefined) {
      // Moving from in_progress → pending: move to bottom of list
      if (status === 'pending' && task.status === 'in_progress') {
        const listArr = data.lists[sourceList]
        const idx = listArr.indexOf(task)
        if (idx !== -1) {
          listArr.splice(idx, 1)
          listArr.push(task)
        }
      }
      task.status = status
    }
    if (in_progress_order !== undefined) task.in_progress_order = in_progress_order
    if (escalation !== undefined) {
      // Only one item per escalation level — clear others first
      if (escalation > 0) {
        for (const [, items] of Object.entries(data.lists)) {
          if (!items) continue
          for (const t of items) {
            if (t.escalation === escalation && t.id !== id) t.escalation = 0
          }
        }
      }
      task.escalation = escalation
    }

    saveData(data)
    res.json({ success: true, task })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Reorder - move item to a specific position within its list
router.post('/:id/reorder', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { beforeId, targetList } = req.body
    const data = readData()

    const result = findTask(data, id, { copy: true })
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { list: sourceList, task } = result

    const destList = targetList || sourceList
    data.lists[sourceList] = data.lists[sourceList].filter(t => t.id !== id)
    if (!data.lists[destList]) data.lists[destList] = []
    insertInList(data.lists[destList], task, beforeId)

    saveData(data)
    res.json({ success: true, task, from: sourceList, to: destList })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a task permanently
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const data = readData()
    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { list: foundList } = result

    data.lists[foundList] = data.lists[foundList].filter(t => t.id !== id)
    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (tasks) data.lists[listName] = tasks.filter(t => t.parent_id !== id)
    }
    saveData(data)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Add a link to a task
router.post('/:id/links', async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    let { type, ref, label, icon } = req.body
    if (!type || !ref) return res.status(400).json({ error: 'type and ref are required' })

    // For slack_thread links, resolve to actual thread root ts
    if (type === 'slack_thread' && ref.includes('/')) {
      const slackToken = process.env.SLACK_USER_TOKEN
      if (slackToken) {
        const [channel, msgTs] = ref.split('/')
        try {
          const url = new URL('https://slack.com/api/conversations.replies')
          url.searchParams.set('channel', channel)
          url.searchParams.set('ts', msgTs)
          url.searchParams.set('limit', '1')
          const slackRes = await fetch(url, { headers: { Authorization: `Bearer ${slackToken}` } })
          const slackData = await slackRes.json()
          if (slackData.ok && slackData.messages?.[0]?.thread_ts) {
            const rootTs = slackData.messages[0].thread_ts
            if (rootTs !== msgTs) {
              console.log(`[links] Resolved thread root: ${msgTs} → ${rootTs}`)
              ref = `${channel}/${rootTs}`
              if (label) label = label.replace('thread', 'thread')
            }
          }
        } catch (err) {
          console.error(`[links] Failed to resolve thread root:`, err.message)
          // Continue with original ref
        }
      }
    }

    const data = readData()
    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { task } = result

    if (!task.links) task.links = []
    if (task.links.some(l => l.type === type && l.ref === ref)) {
      return res.json({ success: true, task, duplicate: true })
    }
    const link = { type, ref, label: label || ref, icon: icon || type, added: new Date().toISOString() }
    task.links.push(link)

    saveData(data)
    res.json({ success: true, task, link })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Remove a link from a task
router.delete('/:id/links/:idx', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const idx = parseInt(req.params.idx)
    const data = readData()
    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { task } = result

    if (!task.links || idx < 0 || idx >= task.links.length) {
      return res.status(400).json({ error: 'Invalid link index' })
    }
    const removed = task.links.splice(idx, 1)[0]
    if (task.links.length === 0) delete task.links

    // Also remove events from this link's source+ref
    if (task.events && removed) {
      task.events = task.events.filter(e => !(e.source === removed.type && e.ref === removed.ref))
      if (task.events.length === 0) delete task.events
    }

    saveData(data)
    res.json({ success: true, removed })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get events for a task
router.get('/:id/events', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const data = readData()
    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    res.json({ events: result.task.events || [], links: result.task.links || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
