/**
 * Slack Watch — helpers for updating slackWatch state on tasks.
 *
 * Extracts the duplicated "context → lastOtherTs / lastMyReplyTs" logic
 * from slack-digest.js so it can be reused by any caller (digest, reply handler, etc.)
 */

/**
 * Build a normalized message-context array from raw scanner context.
 * Returns { who, text, ts } entries sorted by ts ascending.
 */
export function buildMessageContext(rawContext) {
  if (!rawContext || rawContext.length === 0) return []
  return rawContext
    .map(m => ({ who: m.who, text: (m.text || '').slice(0, 200), ts: m.ts }))
    .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))
}

/**
 * Update a task's slackWatch state from scanner context messages.
 *
 * @param {object} task - the task object (mutated in place)
 * @param {Array<{who: string, ts: string}>} context - message context from scanner
 * @param {object} [opts]
 * @param {boolean} [opts.checkRelevance] - if true, only update lastOtherTs (DM relevance gating)
 * @param {boolean} [opts.isRelevant] - whether DM messages are relevant to this task
 * @returns {boolean} true if anything changed
 */
export function updateWatchFromContext(task, context, opts = {}) {
  if (!task.slackWatch || !context || context.length === 0) return false

  let changed = false
  const sw = task.slackWatch

  // Update lastOtherTs — only for relevant messages
  if (!opts.checkRelevance || opts.isRelevant) {
    const otherMsgs = context.filter(m => m.who !== 'me')
    const latestTs = otherMsgs.length > 0
      ? Math.max(...otherMsgs.map(m => parseFloat(m.ts) || 0))
      : 0
    if (latestTs > (sw.lastOtherTs || 0)) {
      sw.lastOtherTs = latestTs
      sw.surfaceContext = context.slice(-5)
      changed = true
    }
  }

  // Update lastMyReplyTs — always check (own replies reset nudge timer regardless)
  const myMsgs = context.filter(m => m.who === 'me')
  const myLatestTs = myMsgs.length > 0
    ? Math.max(...myMsgs.map(m => parseFloat(m.ts) || 0))
    : 0
  if (myLatestTs > (sw.lastMyReplyTs || 0)) {
    sw.lastMyReplyTs = myLatestTs
    changed = true
  }

  return changed
}
