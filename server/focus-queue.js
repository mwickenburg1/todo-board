/**
 * Focus Queue — server-side ranking + action endpoints.
 *
 * Computes the top-priority item from all lists, then acts on it.
 * Triggered via curl from global macOS hotkeys.
 *
 * Endpoints:
 *   GET  /api/focus           → current top item + queue depth
 *   POST /api/focus/done      → mark top item done (or dismiss pulse item)
 *   POST /api/focus/wait      → move top item to waiting
 *   POST /api/focus/snooze    → hide top item for 30 minutes
 *   POST /api/focus/promote    → override: pull item to top (or create + promote)
 *   POST /api/focus/reschedule → LLM-parsed reschedule to a specific time
 *   GET  /api/focus/searchable  → all items for Cmd+K search
 */

import { Router } from 'express'
import { execSync } from 'child_process'
import { readData, saveData, findTask, createTask } from './store.js'
import { acknowledgeDigest, dismissSlackItem } from './slack-digest.js'
import { markRoutineChecked, isRoutineCheckedToday } from './routine-state.js'
import { ROUTINE_ITEMS } from './routine-items.js'
import { snoozeItem, unsnooze, isSnoozed, getSnoozedIds, getSnoozeInfo } from './snooze-state.js'
import { parseNaturalTime } from './time-parser.js'
import { hasUnread } from './slack-extract.js'

const router = Router()

const SELF_AUTHORS = ['matthias', 'mwickenburg']
function isSelfEvent(author) {
  const lower = (author || '').toLowerCase()
  return SELF_AUTHORS.some(s => lower.includes(s))
}

// Promoted item: overrides queue ordering. Only one at a time.
let promotedId = null

// When set, inject a priority-sort view after creating a new item so user can position it.
let pendingPrioritySort = false

// When set, inject a fleet view on demand (independent of routine schedule).
let pendingFleet = false

// When set, inject a deadline view on demand.
let pendingDeadlines = false

// When set, inject a PR dashboard view on demand.
let pendingPRs = false
let cachedPRs = null
let prCacheTime = 0
const PR_CACHE_TTL = 60_000 // 1 min

// Linear project cache: ticketId → { id, name } | null
const linearProjectCache = new Map()
const LINEAR_PROJECT_CACHE_TTL = 5 * 60_000 // 5 min
let linearProjectCacheTime = 0

// Slack PR share cache: PR number → { channel, user } or null
let slackPRCache = new Map()
let slackPRCacheTime = 0
const SLACK_PR_CACHE_TTL = 5 * 60_000 // 5 min

function fetchSlackPRs() {
  const SLACK_USER_TOKEN = process.env.SLACK_USER_TOKEN
  if (!SLACK_USER_TOKEN) {
    try {
      const envContent = execSync('grep SLACK_USER_TOKEN ~/.claude/env', { encoding: 'utf8', timeout: 2000 }).trim()
      const match = envContent.match(/SLACK_USER_TOKEN="?([^"\s]+)"?/)
      if (match) return fetchSlackPRsWithToken(match[1])
    } catch {}
    return
  }
  fetchSlackPRsWithToken(SLACK_USER_TOKEN)
}

function fetchSlackPRsWithToken(token) {
  const newCache = new Map()
  for (const repo of ['streamer', 'widget']) {
    try {
      const encoded = encodeURIComponent(`github.com/attentiontech/${repo}/pull/ from:mwickenburg`)
      const out = execSync(
        `curl -s "https://slack.com/api/search.messages?query=${encoded}&count=50&sort=timestamp&sort_dir=desc" -H "Authorization: Bearer ${token}"`,
        { encoding: 'utf8', timeout: 10000 }
      )
      const data = JSON.parse(out)
      const matches = data.messages?.matches || []
      for (const m of matches) {
        const nums = (m.text || '').match(new RegExp(`${repo}/pull/(\\d+)`, 'g')) || []
        for (const n of nums) {
          const prNum = parseInt(n.replace(`${repo}/pull/`, ''))
          const key = `${repo}:${prNum}`
          if (!newCache.has(key)) {
            // Use latest_reply timestamp if thread has replies, otherwise message ts
            const latestActivity = m.latest_reply || m.ts || '0'
            newCache.set(key, { channel: m.channel?.name || '?', user: m.username || '?', permalink: m.permalink || null, latestActivity: parseFloat(latestActivity), text: (m.text || '').slice(0, 500) })
          }
        }
      }
    } catch (err) {
      console.error(`[prs] Slack ${repo} search failed:`, err.message?.slice(0, 80))
    }
  }
  slackPRCache = newCache
  slackPRCacheTime = Date.now()
}

function extractShareNote(text, prNumber) {
  if (!text) return null
  // Strip Slack link markup: <url|label> → label, <url> → url
  const clean = text.replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1')
  // Remove URLs
  const noUrls = clean.replace(/https?:\/\/\S+/g, '').trim()
  // Remove @mentions
  const noMentions = noUrls.replace(/@\w+/g, '').trim()
  // Collapse whitespace
  const collapsed = noMentions.replace(/\s+/g, ' ').trim()
  // Skip if nothing meaningful left
  if (collapsed.length < 5) return null
  // Cap length
  return collapsed.length > 120 ? collapsed.slice(0, 117) + '...' : collapsed
}

function fetchLinearProjects(ticketIds) {
  if (!ticketIds.length) return
  const LINEAR_API_KEY = process.env.LINEAR_API_KEY
  // Use issue(id:) for exact lookup — handles moved/renamed tickets correctly
  const aliases = ticketIds.map((id, i) => `t${i}: issue(id: "${id}") { identifier project { id name } }`)
  const query = `{ ${aliases.join(' ')} }`
  try {
    const out = execSync(
      `curl -s -X POST https://api.linear.app/graphql -H "Authorization: ${LINEAR_API_KEY}" -H "Content-Type: application/json" -d '${JSON.stringify({ query }).replace(/'/g, "'\\''")}'`,
      { encoding: 'utf8', timeout: 10000 }
    )
    const result = JSON.parse(out)
    if (result.data) {
      // Cache by both the original ticket ID (from branch) and the current identifier
      ticketIds.forEach((origId, i) => {
        const node = result.data[`t${i}`]
        if (node) {
          linearProjectCache.set(origId, node.project || null)
          if (node.identifier !== origId) {
            linearProjectCache.set(node.identifier, node.project || null)
          }
        }
      })
    }
    linearProjectCacheTime = Date.now()
  } catch (err) {
    console.error('[prs] Linear project fetch failed:', err.message)
  }
}

function fetchPRsFromRepo(repoDir, repoLabel) {
  const ghJq = `[.[] | {number, title: .title, branch: .headRefName, base: .baseRefName, review: .reviewDecision, url, mergeable, updatedAt, ci: ((.statusCheckRollup | group_by(.name) | map(last)) as $checks | if ($checks | length) == 0 then "none" elif ($checks | map(select(.conclusion == "FAILURE" or .conclusion == "ACTION_REQUIRED")) | length) > 0 then "failing" elif ($checks | map(select(.status == "IN_PROGRESS" or .status == "QUEUED")) | length) > 0 then "running" elif ($checks | all(.conclusion == "SUCCESS" or .conclusion == "SKIPPED" or .conclusion == "NEUTRAL")) then "passing" else "mixed" end)}]`
  try {
    const out = execSync(
      `cd ${repoDir} && gh pr list --author @me --state open --json number,title,headRefName,baseRefName,reviewDecision,url,statusCheckRollup,mergeable,updatedAt --jq '${ghJq}'`,
      { encoding: 'utf8', timeout: 15000 }
    )
    return JSON.parse(out).map(pr => ({ ...pr, repo: repoLabel }))
  } catch (err) {
    console.error(`[prs] Failed to fetch ${repoLabel}:`, err.message?.slice(0, 80))
    return []
  }
}

function fetchPRs() {
  try {
    // Fetch from both streamer and widget repos
    const streamerPRs = fetchPRsFromRepo('/home/ubuntu/env1/streamer', 'streamer')
    const widgetPRs = fetchPRsFromRepo('/home/ubuntu/env1/streamer/repos/widget', 'widget')
    const allPRs = [...streamerPRs, ...widgetPRs]

    // Build set of branches in the production stack (transitive)
    const branchToBase = new Map()
    for (const pr of allPRs) branchToBase.set(pr.branch, pr.base)
    const inStack = new Set()
    for (const pr of allPRs) {
      if (inStack.has(pr.branch)) continue
      // Walk the base chain to see if it reaches production
      const chain = [pr.branch]
      let base = pr.base
      const visited = new Set([pr.branch])
      while (base && base !== 'production' && !visited.has(base)) {
        visited.add(base)
        chain.push(base)
        base = branchToBase.get(base) || null
      }
      if (base === 'production') {
        for (const b of chain) inStack.add(b)
      }
    }

    const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000
    const prs = allPRs.filter(pr => inStack.has(pr.branch) && (!pr.updatedAt || Date.now() - new Date(pr.updatedAt).getTime() < TWO_WEEKS))

    // Mark stacked PRs (base is not production)
    for (const pr of prs) {
      pr.stacked = pr.base !== 'production'
    }

    // Extract ticket IDs from branches and fetch Linear projects
    const ticketIds = []
    for (const pr of prs) {
      const m = pr.branch.match(/([A-Z]{2,}-\d+)/)
      if (m) {
        pr.ticket = m[1]
        if (!linearProjectCache.has(m[1]) || Date.now() - linearProjectCacheTime > LINEAR_PROJECT_CACHE_TTL) {
          ticketIds.push(m[1])
        }
      }
    }
    if (ticketIds.length) fetchLinearProjects([...new Set(ticketIds)])

    // Enrich PRs with project info
    for (const pr of prs) {
      if (pr.ticket && linearProjectCache.has(pr.ticket)) {
        const proj = linearProjectCache.get(pr.ticket)
        pr.project = proj ? proj.name : null
      }
    }

    // Match PRs to envs by checked-out branch (check both streamer and widget)
    const branchToEnv = new Map() // key: "repo:branch" or just "branch"
    // Local envs (1-4)
    for (const n of [1, 2, 3, 4]) {
      try {
        const sb = execSync(`git -C /home/ubuntu/env${n}/streamer branch --show-current 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim()
        if (sb) { branchToEnv.set(`streamer:${sb}`, `env${n}`); branchToEnv.set(sb, `env${n}`) }
      } catch {}
      try {
        const wb = execSync(`git -C /home/ubuntu/env${n}/streamer/repos/widget branch --show-current 2>/dev/null`, { encoding: 'utf8', timeout: 3000 }).trim()
        if (wb) { branchToEnv.set(`widget:${wb}`, `env${n}`); branchToEnv.set(wb, `env${n}`) }
      } catch {}
    }
    // Remote envs (5-8) via SSH to dev-vm2
    try {
      const remote = execSync(
        `ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no dev-vm2 'for i in 5 6 7 8; do echo "env\${i}:s:$(git -C /home/ubuntu/env\${i}/streamer branch --show-current 2>/dev/null)"; echo "env\${i}:w:$(git -C /home/ubuntu/env\${i}/streamer/repos/widget branch --show-current 2>/dev/null)"; done'`,
        { encoding: 'utf8', timeout: 8000 }
      )
      for (const line of remote.trim().split('\n')) {
        const parts = line.split(':')
        if (parts.length < 3) continue
        const [env, type, branch] = [parts[0], parts[1], parts.slice(2).join(':')]
        if (branch && branch !== 'production') {
          const repo = type === 'w' ? 'widget' : 'streamer'
          branchToEnv.set(`${repo}:${branch}`, env)
          branchToEnv.set(branch, env)
        }
      }
    } catch (err) {
      console.error('[prs] Remote env branch fetch failed:', err.message?.slice(0, 80))
    }
    for (const pr of prs) {
      pr.env = branchToEnv.get(`${pr.repo}:${pr.branch}`) || branchToEnv.get(pr.branch) || null
    }

    // Enrich with Slack share status
    if (!slackPRCacheTime || Date.now() - slackPRCacheTime > SLACK_PR_CACHE_TTL) {
      fetchSlackPRs()
    }
    for (const pr of prs) {
      const slack = slackPRCache.get(`${pr.repo}:${pr.number}`)
      pr.slackShared = slack ? slack.channel : null
      pr.slackPermalink = slack ? slack.permalink : null
      pr.slackLatestActivity = slack ? slack.latestActivity : null
      pr.slackNote = slack ? extractShareNote(slack.text, pr.number) : null
    }

    cachedPRs = prs
    prCacheTime = Date.now()
    return cachedPRs
  } catch (err) {
    console.error('[prs] Failed to fetch:', err.message)
    return cachedPRs || []
  }
}

function getPRs() {
  if (cachedPRs && Date.now() - prCacheTime < PR_CACHE_TTL) return cachedPRs
  return fetchPRs()
}

function computeFleet(data) {
  const envMap = {} // env label -> [{ id, text, list, status, hasClaudeLink }]
  // Only show tasks from the "today" list (daily-goals)
  const allowedLists = new Set(['daily-goals'])

  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (!tasks || !allowedLists.has(listName)) continue
    for (const t of tasks) {
      if (!t.id || !t.env) continue
      const env = t.env
      if (!envMap[env]) envMap[env] = []
      const claudeLinks = (t.links || [])
        .map((l, idx) => ({ ...l, idx }))
        .filter(l => l.type === 'claude_code')
      envMap[env].push({
        id: t.id, text: t.text, list: listName,
        status: t.status || 'pending',
        escalation: t.escalation || 0,
        hasClaudeLink: claudeLinks.length > 0,
        claudeLinks: claudeLinks.map(l => ({ label: l.label, ref: l.ref, idx: l.idx })),
        deadline: t.deadline || null,
      })
    }
  }

  // Sort tasks within each env: escalation descending, then list position (insertion order)
  for (const tasks of Object.values(envMap)) {
    tasks.sort((a, b) => (b.escalation || 0) - (a.escalation || 0))
  }

  // Sort by env number, return as array
  return Object.entries(envMap)
    .sort(([a], [b]) => {
      const na = parseInt(a.replace('env', ''))
      const nb = parseInt(b.replace('env', ''))
      return na - nb
    })
    .map(([env, tasks]) => ({ env, tasks }))
}

function computeQueue(data) {
  const items = []
  const pulse = (data.lists.pulse || []).filter(t => t.id && t.status !== 'done')

  // --- Pulse items ---
  const slackItems = []
  for (const p of pulse) {
    if (!p.context) continue

    if (p.context === 'routine') {
      // Skip if already checked off today (defensive — repopulateRoutine should handle this)
      if (isRoutineCheckedToday(p.text)) continue
      // Small bonus by position in ROUTINE_ITEMS so earlier routines rank higher
      const routineIdx = ROUTINE_ITEMS.findIndex(r => r.text === p.text)
      const posBonus = routineIdx >= 0 ? (ROUTINE_ITEMS.length - routineIdx) : 0
      const routine = routineIdx >= 0 ? ROUTINE_ITEMS[routineIdx] : null
      const dayOfWeek = new Date().getDay()
      const emphasizedHotkeys = routine?.hotkeys
        ? (routine.hotkeys[dayOfWeek] || routine.hotkeys.default || ['done', 'reschedule'])
        : ['done', 'reschedule']
      const kind = routine?.isFleet ? 'fleet' : routine?.isPrioritySort ? 'priority-sort' : 'pulse'
      // Exercise stays above Slack (10000+), other routines sit below Slack DMs/mentions (9200) but above threads (3000)
      const baseScore = p.text === 'Exercise' ? 10000 : 8000
      const item = {
        id: p.id, kind,
        score: baseScore + posBonus, label: p.text,
        sublabel: routine?.sublabel, actionVerb: 'Routine',
        list: 'pulse', emphasizedHotkeys,
        _isFleet: !!routine?.isFleet,
        _isPrioritySort: !!routine?.isPrioritySort,
      }
      items.push(item)
      continue
    }
    // time-blocks disabled — skip them
    if (p.context === 'time-block') continue
    if (p.context === 'slack-header' || p.context === 'time-next') continue
    if (!p.context.startsWith('slack-') || p.priority <= 0) continue

    let score
    if (p.context === 'slack-incidents') score = 9500
    else if (p.context === 'slack-dms' || p.context === 'slack-mentions') score = 9200
    else if (p.context === 'slack-threads') score = 3000
    else if (p.context === 'slack-crashes') score = 1000
    else continue

    let suggestion = p.suggestion || null
    let draftReply = null
    if (suggestion) {
      try {
        const parsed = JSON.parse(suggestion)
        suggestion = parsed.action || suggestion
        draftReply = parsed.draft || null
      } catch {}
    }
    slackItems.push({ id: p.id, score: score + (p.priority * 10), text: p.text, slackThread: p.slackThread, slackRef: p.slackRef, context: p.context, from: p.from || null, channelLabel: p.channelLabel || null, suggestion, draftReply })
  }

  // Each urgent Slack item is its own card
  for (const s of slackItems) {
    const colonIdx = s.text.indexOf(': ')
    const from = s.from || (colonIdx > 0 ? s.text.slice(0, colonIdx) : null)
    const summary = colonIdx > 0 ? s.text.slice(colonIdx + 2) : s.text
    const verbMap = { 'slack-dms': 'DM', 'slack-mentions': 'Mention', 'slack-threads': 'Thread', 'slack-incidents': 'Incident', 'slack-crashes': 'Crashes' }
    // Clean Slack user mention markup: <@U123|Name> → @Name, <@U123> → @user
    const cleanLabel = summary.replace(/<@[A-Z0-9]+\|([^>]+)>/g, '@$1').replace(/<@[A-Z0-9]+>/g, '@user').replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1').replace(/<#[A-Z0-9]+>/g, '#channel')
    items.push({
      id: s.id, kind: 'slack', score: s.score,
      label: cleanLabel,
      actionVerb: verbMap[s.context] || 'Slack',
      from, channelLabel: s.channelLabel || null,
      list: 'pulse',
      emphasizedHotkeys: ['done', 'create task'],
      slackThread: s.slackThread || null,
      slackRef: s.slackRef || null,
      suggestion: s.suggestion || null,
      draftReply: s.draftReply || null,
    })
  }

  // --- Task items from daily-goals only ---
  for (const [listName, tasks] of Object.entries(data.lists)) {
    if (listName !== 'daily-goals' || !tasks) continue
    const pending = tasks.filter(t => t.id && t.status === 'pending')

    for (let i = 0; i < pending.length; i++) {
      const t = pending[i]
      const posBonus = 100 - Math.min(i, 99)

      // Collect slack context from links — include ref for URL building
      const slackLinks = (t.links || []).filter(l => l.type === 'slack_thread')
      const slackContext = slackLinks.length > 0 ? slackLinks.map(l => ({
        label: l.label || l.ref,
        ref: l.ref,
      })) : null

      // Collect claude_code links with their indices for unlink
      const claudeLinks = (t.links || [])
        .map((l, idx) => ({ ...l, idx }))
        .filter(l => l.type === 'claude_code')
        .map(l => ({ label: l.label, ref: l.ref, idx: l.idx }))

      // Claude Code finished — detect but score purely by position
      const hasClaudeLink = (t.links || []).some(l => l.type === 'claude_code')
      const hasClaudeEvent = hasClaudeLink && (t.events || []).some(e =>
        e.source === 'claude_code' && !isSelfEvent(e.author) && e.metadata?.action !== 'claim'
      )
      let claudeSublabel = undefined
      let claudeActionVerb = 'Do'
      if (hasClaudeEvent) {
        let env = null
        for (const l of (t.links || [])) {
          if (l.type === 'claude_code' && l.label) {
            const m = l.label.match(/env(\d+)/)
            if (m) { env = m[0]; break }
          }
        }
        claudeSublabel = env ? `Claude finished in ${env}` : 'Claude finished'
        claudeActionVerb = 'Claude Code'
      }

      // All daily-goals items scored purely by position — priority order is king
      if (listName === 'daily-goals') {
        items.push({
          id: t.id, kind: 'task', score: 1000 + posBonus,
          label: t.text, sublabel: claudeSublabel,
          actionVerb: hasClaudeEvent ? claudeActionVerb : (t.isFireDrill ? 'Fire drill' : 'Do'),
          list: listName, isFireDrill: t.isFireDrill || false,
          slackContext, env: t.env || null, claudeLinks,
          notes: t.notes || '',
        })
      }
    }
  }

  // --- Fleet management: inject fleet data into routine fleet item if present ---
  const fleetItem = items.find(item => item._isFleet)
  if (fleetItem) {
    const fleet = computeFleet(data)
    fleetItem.fleet = fleet
    fleetItem.label = 'Manage fleet'
  }

  // --- Priority sort: inject all daily-goals tasks (pending + in_progress) as flat list ---
  const prioritySortItem = items.find(item => item._isPrioritySort)
  if (prioritySortItem) {
    const dailyGoals = (data.lists['daily-goals'] || [])
      .filter(t => t.id && (t.status === 'pending' || t.status === 'in_progress'))
      .map(t => ({
        id: t.id, text: t.text, env: t.env || null,
        escalation: t.escalation || 0, isFireDrill: !!t.isFireDrill,
        deadline: t.deadline || null, status: t.status,
      }))
    prioritySortItem.priorityTasks = dailyGoals
    prioritySortItem.label = 'Set priorities'
  }

  // --- Pending priority sort: injected after creating a new item ---
  if (pendingPrioritySort && !prioritySortItem) {
    const dailyGoals = (data.lists['daily-goals'] || [])
      .filter(t => t.id && (t.status === 'pending' || t.status === 'in_progress'))
      .map(t => ({
        id: t.id, text: t.text, env: t.env || null,
        escalation: t.escalation || 0, isFireDrill: !!t.isFireDrill,
        deadline: t.deadline || null, status: t.status,
      }))
    items.push({
      id: -1, kind: 'priority-sort', score: 15001,
      label: 'Set priorities', actionVerb: 'Reorder',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isPrioritySort: true, priorityTasks: dailyGoals,
    })
  }

  // --- On-demand fleet: triggered by hotkey independent of routine ---
  if (pendingFleet && !fleetItem) {
    const fleet = computeFleet(data)
    items.push({
      id: -2, kind: 'fleet', score: 15002,
      label: 'Manage fleet', actionVerb: 'Fleet',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isFleet: true, fleet,
    })
  }

  // --- On-demand Deadline view: triggered by hotkey ---
  if (pendingDeadlines) {
    const deadlineItems = []
    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks || listName === 'done') continue
      for (const t of tasks) {
        if (t.done) continue
        deadlineItems.push({ id: t.id, text: t.text, list: listName, deadline: t.deadline || null, status: t.status || 'pending', env: t.env || null, escalation: t.escalation || 0, created: t.created || null })
      }
    }
    items.push({
      id: -5, kind: 'deadlines', score: 15004,
      label: 'Deadlines', actionVerb: 'Deadlines',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isDeadlines: true, deadlineItems,
    })
  }

  // --- On-demand PR dashboard: triggered by hotkey ---
  if (pendingPRs) {
    const prs = getPRs()
    items.push({
      id: -4, kind: 'prs', score: 15003,
      label: 'Pull Requests', actionVerb: 'PRs',
      list: 'pulse', emphasizedHotkeys: ['done'],
      _isPRs: true, prs,
    })
  }

  // Morning overlay — inject as top synthetic item so done hotkey dismisses it
  if (!isRoutineCheckedToday('__morning_dismissed')) {
    items.push({
      id: -3, kind: 'morning', score: 20000,
      label: 'peak · don\'t waste it', actionVerb: 'Morning',
      list: 'pulse', emphasizedHotkeys: ['done'],
    })
  }

  // Filter snoozed items, sort by score
  const effective = items
    .filter(item => !isSnoozed(item.id) && !(item.slackRef && isSnoozed(item.slackRef)) && item.score > 0)
    .sort((a, b) => b.score - a.score)

  // If there's a promoted item, force it to position 0 (skip when priority sort is pending)
  if (promotedId && !pendingPrioritySort) {
    const idx = effective.findIndex(item => item.id === promotedId)
    if (idx > 0) {
      const [item] = effective.splice(idx, 1)
      effective.unshift(item)
    } else if (idx === -1) {
      // Not in computed queue — find in raw data and inject
      for (const [listName, tasks] of Object.entries(data.lists)) {
        if (!tasks) continue
        const task = tasks.find(t => t.id === promotedId)
        if (task) {
          const claudeLinks = (task.links || [])
            .map((l, idx) => ({ ...l, idx }))
            .filter(l => l.type === 'claude_code')
            .map(l => ({ label: l.label, ref: l.ref, idx: l.idx }))
          const slackLinks = (task.links || []).filter(l => l.type === 'slack_thread')
          effective.unshift({
            id: task.id, kind: 'task', score: 15000,
            label: task.text, actionVerb: task.isFireDrill ? 'Fire drill' : 'Do', list: listName,
            isFireDrill: !!task.isFireDrill,
            env: task.env || null, claudeLinks,
            slackContext: slackLinks.length > 0 ? slackLinks.map(l => ({ label: l.label || l.ref, ref: l.ref })) : null,
          })
          break
        }
      }
    }
  }

  return effective
}

// GET /api/focus — current top item + queue depth
router.get('/', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) {
      return res.json({ empty: true, depth: 0, message: 'Nothing needs you right now.' })
    }
    const top = queue[0]
    const snoozeInfo = getSnoozeInfo(top.id)
    if (snoozeInfo) {
      top.rescheduledUntilMs = snoozeInfo.until
      top.rescheduledReason = snoozeInfo.reason
    }
    // Use task's custom snooze duration if set, otherwise global default
    const topTask = findTask(data, top.id)?.task
    const effectiveSnooze = topTask?.snoozeMins || SNOOZE_MINUTES
    res.json({ empty: false, depth: queue.length, position: 1, top, snoozedIds: getSnoozedIds(), snoozeMinutes: effectiveSnooze })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/done — complete top item
router.post('/done', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    unsnooze(top.id)
    if (promotedId === top.id) promotedId = null

    // Morning overlay — dismiss via done hotkey
    if (top.id === -3 && top.kind === 'morning') {
      markRoutineChecked('__morning_dismissed')
      return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
    }

    if (top.kind === 'slack' || top.kind === 'pulse' || top.kind === 'fleet' || top.kind === 'priority-sort' || top.kind === 'prs') {
      // Synthetic priority-sort (from item creation or hotkey) — just clear the flag
      if (top.id === -1 && top.kind === 'priority-sort') {
        pendingPrioritySort = false
        promotedId = null
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Synthetic fleet (from hotkey) — just clear the flag
      if (top.id === -2 && top.kind === 'fleet') {
        pendingFleet = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Synthetic PRs (from hotkey) — just clear the flag
      if (top.id === -4 && top.kind === 'prs') {
        pendingPRs = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      // Find the pulse item to check if it's a routine
      const pulseItem = (data.lists.pulse || []).find(t => t.id === top.id)
      if (pulseItem?.context === 'routine') {
        markRoutineChecked(pulseItem.text)
        console.log(`[focus] Routine checked off: "${pulseItem.text}"`)
      }
      // Individually dismiss slack items so digest doesn't re-add them
      if (top.kind === 'slack' && pulseItem) {
        dismissSlackItem(pulseItem.slackRef, pulseItem.text)
      }
      data.lists.pulse = (data.lists.pulse || []).filter(t => t.id !== top.id)
      saveData(data)
      return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
    }

    // Task item — move to done
    const result = findTask(data, top.id, { skipDone: true })
    if (!result) return res.json({ success: false, reason: 'task not found' })

    const { list: fromList, task } = result
    data.lists[fromList] = data.lists[fromList].filter(t => t.id !== top.id)
    task.status = 'done'
    task.completed = new Date().toISOString()
    task.from_list = fromList
    if (!data.lists.done) data.lists.done = []
    data.lists.done.unshift(task)
    saveData(data)

    res.json({ success: true, action: 'done', item: top.label, remaining: queue.length - 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/wait — move top item to waiting (in_progress)
router.post('/wait', (req, res) => {
  try {
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    unsnooze(top.id)
    if (promotedId === top.id) promotedId = null

    if (top.kind === 'slack' || top.kind === 'pulse' || top.kind === 'fleet' || top.kind === 'priority-sort' || top.kind === 'prs') {
      if (top.id === -1 && top.kind === 'priority-sort') {
        pendingPrioritySort = false
        promotedId = null
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      if (top.id === -2 && top.kind === 'fleet') {
        pendingFleet = false
        return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
      }
      if (top.kind === 'slack') {
        const pulseItem = (data.lists.pulse || []).find(t => t.id === top.id)
        if (pulseItem) dismissSlackItem(pulseItem.slackRef, pulseItem.text)
      }
      data.lists.pulse = (data.lists.pulse || []).filter(t => t.id !== top.id)
      saveData(data)
      return res.json({ success: true, action: 'dismissed', item: top.label, remaining: queue.length - 1 })
    }

    const result = findTask(data, top.id, { skipDone: true })
    if (!result) return res.json({ success: false, reason: 'task not found' })

    result.task.status = 'in_progress'
    result.task.started = result.task.started || new Date().toISOString()
    saveData(data)

    res.json({ success: true, action: 'waiting', item: top.label, remaining: queue.length - 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/snooze — hide item for N minutes (default 30)
const SNOOZE_MINUTES = 30

router.post('/snooze', (req, res) => {
  try {
    const { id: targetId, minutes } = req.body || {}
    const snoozeLen = minutes || SNOOZE_MINUTES

    if (targetId) {
      // Snooze a specific item by ID
      if (promotedId === targetId) promotedId = null
      const until = Date.now() + snoozeLen * 60 * 1000
      snoozeItem(targetId, until, 'snooze')
      return res.json({ success: true, action: 'snoozed', id: targetId, minutes: snoozeLen })
    }

    // Default: snooze the current top item
    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    if (promotedId === top.id) promotedId = null
    // Use task's custom snoozeMins if set, otherwise request minutes, otherwise default
    const task = findTask(data, top.id)?.task
    const effectiveMins = minutes || task?.snoozeMins || SNOOZE_MINUTES
    const until = Date.now() + effectiveMins * 60 * 1000
    snoozeItem(top.id, until, 'snooze')
    // For slack items, also snooze by slackRef so it survives digest rescans (IDs change)
    if (top.slackRef) snoozeItem(top.slackRef, until, 'snooze')

    res.json({ success: true, action: 'snoozed', item: top.label, minutes: effectiveMins, remaining: queue.length - 1 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/promote — override queue: pull item to top or create new
// itemType: 'fire-drill' | 'today' | 'backlog' (default: 'today')
router.post('/promote', (req, res) => {
  try {
    const { id, text, itemType, snoozeMins } = req.body

    if (id) {
      promotedId = id
      unsnooze(id) // Unsnooze if snoozed
      return res.json({ success: true, promoted: id })
    }

    if (text) {
      const data = readData()
      const list = itemType === 'backlog' ? 'backlog' : 'daily-goals'
      const overrides = { text, priority: 1, status: 'pending' }
      if (itemType === 'fire-drill') {
        overrides.isFireDrill = true
        overrides.escalation = 3
        if (snoozeMins) overrides.snoozeMins = snoozeMins
      }
      const newTask = createTask(data, overrides)
      if (!data.lists[list]) data.lists[list] = []
      data.lists[list].unshift(newTask)
      saveData(data)
      promotedId = newTask.id
      if (list !== 'backlog') pendingPrioritySort = true
      return res.json({ success: true, promoted: newTask.id, created: true, itemType })
    }

    return res.status(400).json({ error: 'id or text required' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/focus/searchable — all items for Cmd+K search overlay
router.get('/searchable', (req, res) => {
  try {
    const data = readData()
    const items = []

    for (const [listName, tasks] of Object.entries(data.lists)) {
      if (!tasks || listName === 'done') continue
      for (const t of tasks) {
        if (!t.id) continue
        if (listName === 'pulse') {
          // Only include routine pulse items in search
          if (t.context !== 'routine') continue
          items.push({ id: t.id, text: t.text, list: 'routine', status: 'active' })
        } else {
          items.push({ id: t.id, text: t.text, list: listName, status: t.status || 'pending' })
        }
      }
    }

    res.json({ items, routines: ROUTINE_ITEMS })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/parse-date — parse natural language date+time for deadlines
// Input like "tomorrow", "friday 2pm", "march 20 EOD", "next week"
// Default time is 5:00 PM (EOD) if no time specified
router.post('/parse-date', async (req, res) => {
  try {
    const { text } = req.body
    if (!text) return res.status(400).json({ error: 'text is required' })
    // Expand shorthand: EOD → 5pm, midday → 1pm, AM → 9am, PM → 5pm
    let expanded = text
      .replace(/\bEOD\b/i, '5:00 PM')
      .replace(/\bmidday\b/i, '1:00 PM')
      .replace(/\bAM\b(?!\s*\d)/i, '9:00 AM')
      .replace(/\bPM\b(?!\s*\d)/i, '5:00 PM')
    // If no time indicator at all, append EOD
    if (!/\d{1,2}(:\d{2})?\s*(am|pm)|noon|midnight|morning|evening|night|eod|midday/i.test(expanded)) {
      expanded += ' 5:00 PM'
    }
    const untilMs = await parseNaturalTime(expanded)
    if (!untilMs) return res.json({ success: false, reason: 'could not parse' })
    const d = new Date(untilMs)
    const label = d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    // Store as ISO datetime string
    const iso = d.toISOString()
    res.json({ success: true, label, iso })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/reschedule — LLM-parsed reschedule to a specific time
// Two-phase: { text } → preview, { text, confirm: true } → apply
router.post('/reschedule', async (req, res) => {
  try {
    const { text, confirm } = req.body
    if (!text) return res.status(400).json({ error: 'text is required' })

    const data = readData()
    const queue = computeQueue(data)
    if (queue.length === 0) return res.json({ success: false, reason: 'queue empty' })

    const top = queue[0]
    const untilMs = await parseNaturalTime(text)
    if (!untilMs) return res.json({ success: false, reason: 'could not parse time' })

    const untilStr = new Date(untilMs).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })

    if (!confirm) {
      return res.json({ success: true, action: 'preview', item: top.label, until: untilStr, untilMs })
    }

    if (promotedId === top.id) promotedId = null
    snoozeItem(top.id, untilMs, 'reschedule')
    // Also snooze by slackRef so it survives digest rescans (IDs change each cycle)
    if (top.slackRef) snoozeItem(top.slackRef, untilMs, 'reschedule')

    res.json({ success: true, action: 'rescheduled', item: top.label, until: untilStr })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/focus/trigger-fleet — toggle on-demand fleet view
router.post('/trigger-fleet', (req, res) => {
  pendingFleet = !pendingFleet
  if (pendingFleet) { pendingPrioritySort = false; pendingPRs = false; pendingDeadlines = false }
  res.json({ success: true, active: pendingFleet })
})

// POST /api/focus/trigger-priority — toggle on-demand priority sort view
router.post('/trigger-priority', (req, res) => {
  pendingPrioritySort = !pendingPrioritySort
  if (pendingPrioritySort) { pendingFleet = false; pendingPRs = false; pendingDeadlines = false }
  res.json({ success: true, active: pendingPrioritySort })
})

// POST /api/focus/trigger-prs — toggle on-demand PR dashboard view
router.post('/trigger-prs', (req, res) => {
  pendingPRs = !pendingPRs
  if (pendingPRs) { pendingFleet = false; pendingPrioritySort = false; pendingDeadlines = false; fetchPRs() }
  res.json({ success: true, active: pendingPRs })
})

// POST /api/focus/trigger-deadlines — toggle on-demand deadline view
router.post('/trigger-deadlines', (req, res) => {
  pendingDeadlines = !pendingDeadlines
  if (pendingDeadlines) { pendingFleet = false; pendingPrioritySort = false; pendingPRs = false }
  res.json({ success: true, active: pendingDeadlines })
})

// GET /api/focus/fleet — current fleet status
router.get('/fleet', (req, res) => {
  try {
    const data = readData()
    const fleet = computeFleet(data)
    res.json({ fleet })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/focus/snoozed — list currently snoozed item IDs
router.get('/snoozed', (req, res) => {
  res.json({ snoozedIds: getSnoozedIds() })
})

// One-time migration: backfill task.env from claude_code link labels
function migrateEnvFromLinks() {
  const data = readData()
  let migrated = 0
  for (const [, tasks] of Object.entries(data.lists)) {
    if (!tasks) continue
    for (const t of tasks) {
      if (t.env) continue // already has env
      for (const l of (t.links || [])) {
        if (l.type === 'claude_code' && l.label) {
          const m = l.label.match(/env(\d+)/)
          if (m) { t.env = m[0]; migrated++; break }
        }
      }
    }
  }
  if (migrated > 0) {
    saveData(data)
    console.log(`[fleet] Migrated ${migrated} tasks: backfilled task.env from claude_code links`)
  }
}
migrateEnvFromLinks()

export default router
