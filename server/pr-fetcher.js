/**
 * PR Fetcher — fetches open PRs from GitHub, enriches with Linear projects,
 * Slack share status, env assignments, and semgrep analysis.
 */

import { execSync } from 'child_process'

// PR cache
let cachedPRs = null
let prCacheTime = 0
const PR_CACHE_TTL = 60_000 // 1 min

// Linear project cache: ticketId → { id, name } | null
const linearProjectCache = new Map()
const LINEAR_PROJECT_CACHE_TTL = 5 * 60_000 // 5 min
let linearProjectCacheTime = 0

// Slack PR share cache
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
  const clean = text.replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1')
  const noUrls = clean.replace(/https?:\/\/\S+/g, '').trim()
  const noMentions = noUrls.replace(/@\w+/g, '').trim()
  const collapsed = noMentions.replace(/\s+/g, ' ').trim()
  if (collapsed.length < 5) return null
  return collapsed.length > 120 ? collapsed.slice(0, 117) + '...' : collapsed
}

function fetchLinearProjects(ticketIds) {
  if (!ticketIds.length) return
  const LINEAR_API_KEY = process.env.LINEAR_API_KEY
  const aliases = ticketIds.map((id, i) => `t${i}: issue(id: "${id}") { identifier project { id name } }`)
  const query = `{ ${aliases.join(' ')} }`
  try {
    const out = execSync(
      `curl -s -X POST https://api.linear.app/graphql -H "Content-Type: application/json" -H "Authorization: ${LINEAR_API_KEY}" -d '${JSON.stringify({ query })}'`,
      { encoding: 'utf8', timeout: 10000 }
    )
    const result = JSON.parse(out)
    linearProjectCacheTime = Date.now()
    if (result.data) {
      for (let i = 0; i < ticketIds.length; i++) {
        const issue = result.data[`t${i}`]
        if (issue) {
          const proj = issue.project ? { id: issue.project.id, name: issue.project.name } : null
          linearProjectCache.set(ticketIds[i], proj)
          if (issue.identifier && issue.identifier !== ticketIds[i]) {
            linearProjectCache.set(issue.identifier, proj)
          }
        }
      }
    }
  } catch (err) {
    console.error('[prs] Linear project fetch failed:', err.message)
  }
}

function fetchPRsFromRepo(repoDir, repoLabel) {
  const ghJq = `[.[] | {number, title: .title, branch: .headRefName, base: .baseRefName, review: .reviewDecision, url, mergeable, updatedAt, ci: ((.statusCheckRollup | group_by(.name) | map(last)) as $checks | if ($checks | length) == 0 then "none" elif ($checks | map(select(.conclusion == "FAILURE" or .conclusion == "ACTION_REQUIRED")) | length) > 0 then "failing" elif ($checks | map(select(.status == "IN_PROGRESS" or .status == "QUEUED")) | length) > 0 then "running" elif ($checks | all(.conclusion == "SUCCESS" or .conclusion == "SKIPPED" or .conclusion == "NEUTRAL")) then "passing" else "mixed" end), failingChecks: [(.statusCheckRollup | group_by(.name) | map(last))[] | select(.conclusion == "FAILURE" or .conclusion == "ACTION_REQUIRED") | .name]}]`
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

function isSemgrepUnrelated(repoDir, prNumber) {
  try {
    const prFiles = execSync(
      `cd ${repoDir} && gh pr diff ${prNumber} --name-only`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim().split('\n').filter(Boolean)
    if (prFiles.length === 0) return false
    const prFileSet = new Set(prFiles)

    const checkLink = execSync(
      `cd ${repoDir} && gh pr checks ${prNumber} --json name,link --jq '.[] | select(.name=="semgrep") | .link'`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim()
    const runMatch = checkLink.match(/runs\/(\d+)/)
    if (!runMatch) return false

    const log = execSync(
      `cd ${repoDir} && gh run view ${runMatch[1]} --log 2>&1 | grep "^semgrep" | grep -oP '\\s{4,}(pkg/\\S+\\.go|internal/\\S+\\.go|cmd/\\S+\\.go)' | sed 's/^\\s*//' | sort -u`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim()
    const findingFiles = log ? log.split('\n').filter(Boolean) : []
    if (findingFiles.length === 0) return false

    const unrelated = findingFiles.every(f => !prFileSet.has(f))
    if (unrelated) console.log(`[prs] PR #${prNumber}: semgrep findings in ${findingFiles.join(', ')} — not in PR, ignoring`)
    return unrelated
  } catch {
    return false
  }
}

export function fetchPRs() {
  try {
    const streamerPRs = fetchPRsFromRepo('/home/ubuntu/env1/streamer', 'streamer')
    const widgetPRs = fetchPRsFromRepo('/home/ubuntu/env1/streamer/repos/widget', 'widget')
    const allPRs = [...streamerPRs, ...widgetPRs]

    const branchToBase = new Map()
    for (const pr of allPRs) branchToBase.set(pr.branch, pr.base)
    const inStack = new Set()
    for (const pr of allPRs) {
      if (inStack.has(pr.branch)) continue
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

    for (const pr of prs) {
      pr.stacked = pr.base !== 'production'
    }

    for (const pr of prs) {
      if (pr.ci === 'failing' && pr.failingChecks?.length === 1 && pr.failingChecks[0] === 'semgrep') {
        const repoDir = pr.repo === 'widget' ? '/home/ubuntu/env1/streamer/repos/widget' : '/home/ubuntu/env1/streamer'
        if (isSemgrepUnrelated(repoDir, pr.number)) {
          pr.ci = 'passing'
          pr.ciNote = 'semgrep findings in unrelated files'
        }
      }
    }

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

    for (const pr of prs) {
      if (pr.ticket && linearProjectCache.has(pr.ticket)) {
        const proj = linearProjectCache.get(pr.ticket)
        pr.project = proj ? proj.name : null
      }
    }

    const branchToEnv = new Map()
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

export function getPRs() {
  if (cachedPRs && Date.now() - prCacheTime < PR_CACHE_TTL) return cachedPRs
  return fetchPRs()
}
