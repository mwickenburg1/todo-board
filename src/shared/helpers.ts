/**
 * Parse user input text — detects `>` prefix for section creation vs regular task text.
 */
export function parseInput(text: string): { type: 'section'; value: string } | { type: 'task'; value: string } {
  const trimmed = text.trim()
  if (trimmed.startsWith('>')) {
    const value = trimmed.slice(1).trim()
    if (value) return { type: 'section', value }
  }
  return { type: 'task', value: trimmed }
}

/**
 * Map column name to task status.
 */
export function columnToStatus(column: 'actionable' | 'waiting'): 'pending' | 'in_progress' {
  return column === 'waiting' ? 'in_progress' : 'pending'
}

/**
 * Map task status to column name.
 */
export function statusToColumn(status: string): 'actionable' | 'waiting' {
  return status === 'in_progress' ? 'waiting' : 'actionable'
}
