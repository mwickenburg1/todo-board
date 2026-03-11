import { Router } from 'express'
import { readData, saveData } from '../store.js'

const router = Router()

// Ingest an event — routes to tasks that have matching links
router.post('/', (req, res) => {
  try {
    const { source, ref, summary, author, ts, metadata } = req.body
    if (!source || !ref) return res.status(400).json({ error: 'source and ref are required' })

    const data = readData()
    const event = {
      source, ref, summary: summary || '', author: author || '',
      ts: ts || new Date().toISOString(), metadata
    }
    const isLabelOnly = metadata?.is_root === true
    const isClaim = metadata?.action === 'claim'
    const isSelf = author === 'Matthias' || author === 'mwickenburg' || metadata?.user_id === 'U02BMLFJJ64'

    const moves = []
    let matched = 0
    let bumped = 0

    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks) continue
      for (const task of tasks) {
        if (!task.links) continue
        const matchingLink = task.links.find(l => l.type === source && l.ref === ref)
        if (!matchingLink) continue

        if (event.summary) {
          matchingLink.label = event.author
            ? `${event.author}: ${event.summary}`.slice(0, 100)
            : event.summary.slice(0, 100)
        }

        if (isClaim) {
          // Claim: set to waiting (in_progress) — e.g. Claude is now working on it
          if (task.status === 'pending') {
            task.status = 'in_progress'
            bumped++
            console.log(`[events] Claimed "${task.text}" → waiting in ${listName}`)
          }
        } else if (isSelf) {
          // My own message — keep/set as waiting (in_progress), don't bump to actionable
          if (task.status === 'pending') {
            task.status = 'in_progress'
            bumped++
            console.log(`[events] Self-message on "${task.text}" → waiting in ${listName}`)
          }
        } else if (listName === 'monitoring') {
          moves.push({ task, fromList: listName })
        } else if (task.status === 'in_progress') {
          task.status = 'pending'
          // Keep task at its current position — priority order is set by user
          bumped++
          console.log(`[events] Returned "${task.text}" to actionable in ${listName} (kept position)`)
        }

        if (isLabelOnly) {
          matched++
          continue
        }

        if (!task.events) task.events = []
        const isDupe = task.events.some(e => e.source === event.source && e.ts === event.ts)
        if (isDupe) continue
        // Keep only the most recent event per source+ref
        task.events = task.events.filter(e => !(e.source === event.source && e.ref === event.ref))
        task.events.push(event)
        matched++
      }
    }

    for (const { task, fromList } of moves) {
      const fromArr = data.lists[fromList]
      const idx = fromArr.indexOf(task)
      if (idx !== -1) fromArr.splice(idx, 1)
      if (!data.lists.today) data.lists.today = []
      task.status = 'pending'
      data.lists.today.unshift(task)
      bumped++
      console.log(`[events] Moved "${task.text}" from monitoring → today/actionable`)
    }

    if (matched > 0 || bumped > 0) saveData(data)
    res.json({ success: true, matched, bumped })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
