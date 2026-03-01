/**
 * Parse user input text — detects `>` prefix for section creation vs regular task text.
 */
export function parseInput(text) {
  const trimmed = (text || '').trim()
  if (trimmed.startsWith('>')) {
    const value = trimmed.slice(1).trim()
    if (value) return { type: 'section', value, normalized: value.toLowerCase().replace(/\s+/g, '-') }
  }
  return { type: 'task', value: trimmed }
}

/**
 * Reorder entries in data.lists so that `sectionName` appears before `beforeSection`.
 * Mutates data.lists in place.
 */
export function placeSectionBefore(data, sectionName, beforeSection) {
  const entries = Object.entries(data.lists)
  const idx = entries.findIndex(([k]) => k === sectionName)
  if (idx === -1) return
  const [entry] = entries.splice(idx, 1)
  const beforeIdx = entries.findIndex(([k]) => k === beforeSection)
  if (beforeIdx !== -1) entries.splice(beforeIdx, 0, entry)
  else entries.push(entry)
  data.lists = Object.fromEntries(entries)
}
