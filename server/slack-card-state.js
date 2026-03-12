/**
 * Pure functions to derive Slack card UI state from LLM triage actions.
 *
 * The LLM returns a ranked list of actions (reply, track, watch, done, snooze).
 * This module maps those actions to concrete UI decisions:
 *   - Should the Slack thread preview be emphasized or faded?
 *   - Which hotkeys should be primary/secondary?
 *   - What's the "next best action" after a reply is sent?
 */

/**
 * @typedef {'reply' | 'track' | 'watch' | 'done' | 'snooze'} ActionType
 * @typedef {{ type: ActionType, draft?: string, taskText?: string, delegateOnly?: boolean, checkHours?: number }} TriageAction
 *
 * @typedef {'emphasized' | 'faded'} SlackEmphasis
 * @typedef {'primary' | 'secondary' | 'default'} HotkeyEmphasis
 *
 * @typedef {Object} SlackCardState
 * @property {SlackEmphasis} slackPanelEmphasis - whether the Slack thread preview is emphasized or faded
 * @property {string[]} emphasizedHotkeys - [primary, secondary] hotkey labels
 * @property {boolean} replyFirst - true if the user should reply before doing anything else
 */

/**
 * Derive the full UI state for a Slack focus card from LLM actions.
 *
 * @param {TriageAction[] | null} actions - ranked actions from LLM triage
 * @returns {SlackCardState}
 */
export function deriveSlackCardState(actions) {
  if (!actions || actions.length === 0) {
    return {
      slackPanelEmphasis: 'faded',
      emphasizedHotkeys: ['done', 'track'],
      replyFirst: false,
    }
  }

  const firstType = actions[0]?.type
  const replyFirst = firstType === 'reply'

  // When reply is first action, the Slack panel is the primary UI element.
  // The hotkey strip should emphasize what comes AFTER the reply (the next action).
  // When reply is NOT first, the hotkey strip drives the primary action.
  const slackPanelEmphasis = replyFirst ? 'emphasized' : 'faded'

  // Map action types to hotkey labels
  const hotkeyLabel = { reply: 'done', track: 'track', watch: 'track', done: 'done', snooze: 'snooze' }

  let primary, secondary
  if (replyFirst) {
    // Reply is handled by the Slack panel, so hotkeys show what to do after replying
    const afterReply = actions.slice(1)
    primary = hotkeyLabel[afterReply[0]?.type] || 'track'
    secondary = hotkeyLabel[afterReply[1]?.type] || 'done'
  } else {
    primary = hotkeyLabel[firstType] || 'done'
    secondary = hotkeyLabel[actions[1]?.type] || 'track'
  }

  // Ensure primary and secondary are different
  if (secondary === primary) {
    secondary = primary === 'done' ? 'track' : 'done'
  }

  return {
    slackPanelEmphasis,
    emphasizedHotkeys: [primary, secondary],
    replyFirst,
  }
}

/**
 * Derive the card state after a reply has been sent.
 * Removes the "reply" action and re-derives from remaining actions.
 *
 * @param {TriageAction[] | null} actions - original ranked actions
 * @returns {SlackCardState}
 */
export function deriveStateAfterReply(actions) {
  if (!actions) return deriveSlackCardState(null)
  const remaining = actions.filter(a => a.type !== 'reply')
  return deriveSlackCardState(remaining)
}
