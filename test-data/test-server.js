/**
 * Test server launcher — starts the todo-board server with:
 * - HOME pointed at test-data dir (so todos.json, snooze, routine files are isolated)
 * - SLACK_USER_TOKEN cleared (so slack digest doesn't run)
 * - Port patched to 5182
 */
import { readFileSync, writeFileSync } from 'fs'
import { execFile } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'

// Override HOME before importing store (which reads TODOS_PATH at import time)
process.env.HOME = resolve(dirname(fileURLToPath(import.meta.url)))
process.env.SLACK_USER_TOKEN = ''

// Now dynamically import the modules that use HOME
const { readData, saveData, popUndo, createTask } = await import('../server/store.js')
const { parseInput, placeSectionBefore } = await import('../server/helpers.js')
const todosRouter = (await import('../server/routes/todos.js')).default
const listsRouter = (await import('../server/routes/lists.js')).default
const focusQueueRouter = (await import('../server/focus-queue.js')).default

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/todos', (req, res) => {
  try { res.json(readData()) } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/capture', (req, res) => {
  try {
    const { text, horizon = 'queue', status = 'pending' } = req.body
    if (!text) return res.status(400).json({ error: 'text is required' })
    const data = readData()
    const newTask = createTask(data, { text, priority: 1, status })
    if (!data.lists[horizon]) data.lists[horizon] = []
    data.lists[horizon].unshift(newTask)
    saveData(data)
    res.json({ success: true, task: newTask })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.use('/api/todos', todosRouter)
app.use('/api/lists', listsRouter)
app.use('/api/focus', focusQueueRouter)

const PORT = 5182
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Test server running on http://0.0.0.0:${PORT}`)
  console.log(`Data dir: ${process.env.HOME}/todos-repo/`)
})
