import { Router } from 'express'
import { readData, saveData, createTask, PINNED_LISTS } from '../store.js'
import { placeSectionBefore } from '../helpers.js'

const router = Router()

// Create an empty list (optionally positioned before another section)
router.post('/', (req, res) => {
  try {
    const { name, beforeSection } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    const data = readData()
    if (!data.lists[name]) data.lists[name] = []

    if (beforeSection && data.lists[beforeSection]) {
      placeSectionBefore(data, name, beforeSection)
    }

    saveData(data)
    res.json({ success: true, name })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Rename a list (updates display label only, key stays stable)
router.post('/rename', (req, res) => {
  try {
    const { oldName, newName } = req.body
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' })

    const data = readData()
    if (!data.lists[oldName]) return res.status(404).json({ error: 'List not found' })

    if (!data.section_labels) data.section_labels = {}
    data.section_labels[oldName] = newName
    saveData(data)
    res.json({ success: true, key: oldName, label: newName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a list (moves items to today)
router.delete('/:name', (req, res) => {
  try {
    const { name } = req.params
    if (PINNED_LISTS.includes(name)) return res.status(403).json({ error: 'Cannot delete pinned section' })
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
router.post('/reorder', (req, res) => {
  try {
    const { name, beforeName } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })
    if (PINNED_LISTS.includes(name)) return res.status(403).json({ error: 'Cannot reorder pinned section' })

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
router.post('/insert-above', (req, res) => {
  try {
    const { beforeSection } = req.body
    if (!beforeSection) return res.status(400).json({ error: 'beforeSection is required' })

    const data = readData()
    const sectionName = `untitled-${Date.now()}`
    const newTask = createTask(data, { text: '', status: 'pending' })

    data.lists[sectionName] = [newTask]
    placeSectionBefore(data, sectionName, beforeSection)

    saveData(data)
    res.json({ success: true, section: sectionName, task: newTask })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
