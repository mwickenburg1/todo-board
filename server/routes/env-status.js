import { Router } from 'express'
import { getEnvStatus, setEnvStatus } from '../store.js'

const router = Router()

router.post('/', (req, res) => {
  try {
    const { vm, env, branch, status, task, lastActivity } = req.body
    const key = `${vm || 'vm1'}/${env}`
    setEnvStatus(key, { vm: vm || 'vm1', env, branch, status, task, lastActivity })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/', (req, res) => {
  res.json(getEnvStatus())
})

export default router
