import express from 'express'
import cors from 'cors'
import { readData, saveData, popUndo, findTask, createTask, insertInList, createEmptySlot, getEnvStatus, setEnvStatus } from './store.js'

const app = express()
app.use(cors())
app.use(express.json())

// Undo last action
app.post('/api/undo', (req, res) => {
  try {
    const remaining = popUndo()
    if (remaining === null) return res.status(400).json({ error: 'Nothing to undo' })
    res.json({ success: true, remaining })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/todos', (req, res) => {
  try {
    res.json(readData())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Mark a task as done - moves it to done list (optionally recursive)
app.post('/api/todos/:id/done', (req, res) => {
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

// Delete a task permanently
app.delete('/api/todos/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const data = readData()
    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { list: foundList } = result

    data.lists[foundList] = data.lists[foundList].filter(t => t.id !== id)
    // Also remove children
    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (tasks) data.lists[listName] = tasks.filter(t => t.parent_id !== id)
    }
    saveData(data)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Move a task to a different list
app.post('/api/todos/:id/move', (req, res) => {
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

    // Case 1: Adding as a subtask of a focus item
    if (asSubtaskOf) {
      task.parent_id = asSubtaskOf
      delete task.focus_slot
      delete task.is_empty_slot
      if (!data.lists.today) data.lists.today = []
      insertInList(data.lists.today, task, insertBefore)
      saveData(data)
      return res.json({ success: true, task, from: sourceList, to: 'today', asSubtaskOf, insertBefore })
    }

    // Case 2: Replacing a focus slot
    if (targetList === 'now' && focusSlot && replaceFocus) {
      const existingTask = data.lists.now?.find(t => t.focus_slot === focusSlot && t.id && !t.is_empty_slot)

      if (existingTask && existingTask.id !== id) {
        const movedTask = { ...existingTask }
        delete movedTask.focus_slot
        data.lists.now = data.lists.now.filter(t => t.id !== existingTask.id)
        if (!data.lists.today) data.lists.today = []
        data.lists.today.push(movedTask)
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

    // Case 3: Moving to a regular list
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
app.patch('/api/todos/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { text, context, status, in_progress_order } = req.body
    const data = readData()

    const result = findTask(data, id)
    if (!result) return res.status(404).json({ error: 'Task not found' })
    const { task } = result

    if (text !== undefined) task.text = text
    if (context !== undefined) task.context = context
    if (status !== undefined) task.status = status
    if (in_progress_order !== undefined) task.in_progress_order = in_progress_order

    saveData(data)
    res.json({ success: true, task })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Add a new task
app.post('/api/todos', (req, res) => {
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

// Split a task at cursor position (Enter key) — atomic update+create+position
app.post('/api/todos/split', (req, res) => {
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

// Quick capture - adds to the beginning of a list
app.post('/api/capture', (req, res) => {
  try {
    const { text, horizon = 'today', status = 'pending' } = req.body
    if (!text) return res.status(400).json({ error: 'text is required' })

    const data = readData()
    const newTask = createTask(data, {
      text, priority: 1, status,
      started: status === 'in_progress' ? new Date().toISOString() : null
    })

    if (!data.lists[horizon]) data.lists[horizon] = []
    data.lists[horizon].unshift(newTask)

    saveData(data)
    res.json({ success: true, task: newTask })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Reorder - move item to a specific position within its list
app.post('/api/todos/:id/reorder', (req, res) => {
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

// Create an empty list (optionally positioned before another section)
app.post('/api/lists', (req, res) => {
  try {
    const { name, beforeSection } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    const data = readData()
    if (!data.lists[name]) data.lists[name] = []

    if (beforeSection && data.lists[beforeSection]) {
      const entries = Object.entries(data.lists)
      const newIdx = entries.findIndex(([k]) => k === name)
      const [entry] = entries.splice(newIdx, 1)
      const beforeIdx = entries.findIndex(([k]) => k === beforeSection)
      if (beforeIdx !== -1) entries.splice(beforeIdx, 0, entry)
      else entries.push(entry)
      data.lists = Object.fromEntries(entries)
    }

    saveData(data)
    res.json({ success: true, name })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Rename a list
app.post('/api/lists/rename', (req, res) => {
  try {
    const { oldName, newName } = req.body
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' })
    const reserved = ['now', 'monitoring', 'done']
    if (reserved.includes(newName)) return res.status(400).json({ error: `"${newName}" is a reserved name` })

    const data = readData()
    if (!data.lists[oldName]) return res.status(404).json({ error: 'List not found' })

    // Rebuild lists object to preserve position
    const entries = Object.entries(data.lists).map(([k, v]) =>
      k === oldName ? [newName, v] : [k, v]
    )
    data.lists = Object.fromEntries(entries)
    saveData(data)
    res.json({ success: true, from: oldName, to: newName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a list (moves items to today)
app.delete('/api/lists/:name', (req, res) => {
  try {
    const { name } = req.params
    const data = readData()
    if (!data.lists[name]) return res.status(404).json({ error: 'List not found' })

    const items = data.lists[name]
    if (items.length > 0) {
      if (!data.lists.today) data.lists.today = []
      data.lists.today.push(...items)
    }
    delete data.lists[name]
    saveData(data)
    res.json({ success: true, name, movedItems: items.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Reorder sections
app.post('/api/lists/reorder', (req, res) => {
  try {
    const { name, beforeName } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    const data = readData()
    if (!data.lists[name]) return res.status(404).json({ error: 'List not found' })

    const entries = Object.entries(data.lists)
    const draggedIdx = entries.findIndex(([k]) => k === name)
    const [dragged] = entries.splice(draggedIdx, 1)

    if (beforeName) {
      const beforeIdx = entries.findIndex(([k]) => k === beforeName)
      if (beforeIdx !== -1) entries.splice(beforeIdx, 0, dragged)
      else entries.push(dragged)
    } else {
      entries.push(dragged)
    }

    data.lists = Object.fromEntries(entries)
    saveData(data)
    res.json({ success: true, order: entries.map(([k]) => k) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Insert a new section (with an empty item) before another section
app.post('/api/lists/insert-above', (req, res) => {
  try {
    const { beforeSection } = req.body
    if (!beforeSection) return res.status(400).json({ error: 'beforeSection is required' })

    const data = readData()
    const sectionName = `untitled-${Date.now()}`
    const newTask = createTask(data, { text: '', status: 'pending' })

    // Create the section with the item
    data.lists[sectionName] = [newTask]

    // Reorder: place it before the target section
    const entries = Object.entries(data.lists)
    const newIdx = entries.findIndex(([k]) => k === sectionName)
    const [entry] = entries.splice(newIdx, 1)
    const beforeIdx = entries.findIndex(([k]) => k === beforeSection)
    if (beforeIdx !== -1) entries.splice(beforeIdx, 0, entry)
    else entries.push(entry)
    data.lists = Object.fromEntries(entries)

    saveData(data)
    res.json({ success: true, section: sectionName, task: newTask })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Env status
app.post('/api/env-status', (req, res) => {
  try {
    const { vm, env, branch, status, task, lastActivity } = req.body
    const key = `${vm || 'vm1'}/${env}`
    setEnvStatus(key, { vm: vm || 'vm1', env, branch, status, task, lastActivity })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/env-status', (req, res) => {
  res.json(getEnvStatus())
})

const PORT = 5181
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Todo API server running on http://0.0.0.0:${PORT}`)
})
