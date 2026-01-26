import express from 'express'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const TODOS_PATH = join(process.env.HOME, 'todos-repo', 'todos.json')

app.get('/api/todos', (req, res) => {
  try {
    const data = readFileSync(TODOS_PATH, 'utf-8')
    res.json(JSON.parse(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Mark a task as done - moves it to done list
app.post('/api/todos/:id/done', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const data = JSON.parse(readFileSync(TODOS_PATH, 'utf-8'))

    // Find the task in any list
    let foundList = null
    let task = null
    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks || listName === 'done') continue
      const found = tasks.find(t => t.id === id)
      if (found) {
        foundList = listName
        task = found
        break
      }
    }

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Remove from original list
    data.lists[foundList] = data.lists[foundList].filter(t => t.id !== id)

    // Update task and add to done list
    task.status = 'done'
    task.completed = new Date().toISOString()
    task.from_list = foundList

    if (!data.lists.done) data.lists.done = []
    data.lists.done.push(task)

    // Add to completion log
    if (!data.completed_log) data.completed_log = []
    data.completed_log.push(task)

    writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
    res.json({ success: true, task })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Move a task to a different list
app.post('/api/todos/:id/move', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { targetList, focusSlot, asSubtaskOf, replaceFocus, category, insertBefore } = req.body

    if (!targetList) {
      return res.status(400).json({ error: 'targetList is required' })
    }

    const data = JSON.parse(readFileSync(TODOS_PATH, 'utf-8'))

    // Find the task in any list
    let sourceList = null
    let task = null
    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks) continue
      const found = tasks.find(t => t.id === id)
      if (found) {
        sourceList = listName
        task = { ...found }
        break
      }
    }

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Remember if source was a focus slot (to create empty placeholder)
    const sourceFocusSlot = task.focus_slot

    // Remove from source list first
    data.lists[sourceList] = data.lists[sourceList].filter(t => t.id !== id)

    // If source was a focus slot and we're not moving to the same slot, create empty placeholder
    if (sourceFocusSlot && sourceList === 'now' && !(targetList === 'now' && focusSlot === sourceFocusSlot)) {
      data.lists.now.push({
        id: null,
        text: '',
        priority: 2,
        context: '',
        status: 'pending',
        created: null,
        started: null,
        completed: null,
        parent_id: null,
        focus_slot: sourceFocusSlot,
        is_empty_slot: true
      })
    }

    // Case 1: Adding as a subtask of a focus item
    if (asSubtaskOf) {
      task.parent_id = asSubtaskOf
      delete task.focus_slot
      delete task.is_empty_slot
      if (!data.lists.today) data.lists.today = []
      data.lists.today.push(task)
      writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
      return res.json({ success: true, task, from: sourceList, to: 'today', asSubtaskOf })
    }

    // Case 2: Replacing a focus slot (move existing + subtasks back to today)
    if (targetList === 'now' && focusSlot && replaceFocus) {
      const existingTask = data.lists.now?.find(t => t.focus_slot === focusSlot && t.id && !t.is_empty_slot)

      if (existingTask && existingTask.id !== id) {
        // Move existing task back to today
        const movedTask = { ...existingTask }
        delete movedTask.focus_slot
        data.lists.now = data.lists.now.filter(t => t.id !== existingTask.id)
        if (!data.lists.today) data.lists.today = []
        data.lists.today.push(movedTask)
      }

      // Remove any empty slot with same focus_slot
      if (data.lists.now) {
        data.lists.now = data.lists.now.filter(t => t.focus_slot !== focusSlot || (t.id && t.id !== id))
      }

      task.focus_slot = focusSlot
      delete task.is_empty_slot
      data.lists.now.push(task)
      writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
      return res.json({ success: true, task, from: sourceList, to: 'now', replaced: existingTask?.id })
    }

    // Case 3: Moving to a regular list (today, tomorrow, monitoring, etc.)
    delete task.focus_slot
    delete task.is_empty_slot

    // If moving from done list, reset status to pending
    if (sourceList === 'done') {
      task.status = 'pending'
      delete task.completed
      delete task.from_list
    }

    // If a category is specified, find the parent task that matches it
    if (category && targetList !== 'monitoring') {
      const targetTasks = data.lists[targetList] || []
      const categoryParent = targetTasks.find(t =>
        !t.parent_id && t.text && t.text.toLowerCase().includes(category.toLowerCase())
      )
      if (categoryParent) {
        task.parent_id = categoryParent.id
      }
    } else if (targetList === 'monitoring') {
      // Monitoring is a flat list, clear parent_id
      delete task.parent_id
    }

    if (!data.lists[targetList]) data.lists[targetList] = []

    // If insertBefore is specified, insert at that position
    if (insertBefore !== undefined && insertBefore !== null) {
      const insertIndex = data.lists[targetList].findIndex(t => t.id === insertBefore)
      if (insertIndex !== -1) {
        data.lists[targetList].splice(insertIndex, 0, task)
      } else {
        data.lists[targetList].push(task)
      }
    } else {
      data.lists[targetList].push(task)
    }

    writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
    res.json({ success: true, task, from: sourceList, to: targetList, category, insertBefore })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update a task (text, context, etc.)
app.patch('/api/todos/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { text, context, status } = req.body

    const data = JSON.parse(readFileSync(TODOS_PATH, 'utf-8'))

    // Find the task in any list
    let foundList = null
    let task = null
    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks) continue
      const found = tasks.find(t => t.id === id)
      if (found) {
        foundList = listName
        task = found
        break
      }
    }

    if (!task) {
      return res.status(404).json({ error: 'Task not found' })
    }

    // Update fields if provided
    if (text !== undefined) task.text = text
    if (context !== undefined) task.context = context
    if (status !== undefined) task.status = status

    writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
    res.json({ success: true, task })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Add a new task
app.post('/api/todos', (req, res) => {
  try {
    const { text, list, priority = 2, parent_id } = req.body

    if (!text || !list) {
      return res.status(400).json({ error: 'text and list are required' })
    }

    const data = JSON.parse(readFileSync(TODOS_PATH, 'utf-8'))

    const newTask = {
      id: data.next_id || 1,
      text,
      priority,
      context: '',
      status: 'pending',
      created: new Date().toISOString(),
      started: null,
      completed: null,
      parent_id: parent_id || null
    }

    data.next_id = (data.next_id || 1) + 1

    if (!data.lists[list]) data.lists[list] = []
    data.lists[list].push(newTask)

    writeFileSync(TODOS_PATH, JSON.stringify(data, null, 2))
    res.json({ success: true, task: newTask })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const PORT = 5181
app.listen(PORT, () => {
  console.log(`Todo API server running on http://localhost:${PORT}`)
  console.log(`Reading from: ${TODOS_PATH}`)
})
