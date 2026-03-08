import { describe, it, expect, vi } from 'vitest'

/**
 * Tests for the onEnterSplit callback wired in StackSection's renderItems.
 *
 * The logic under test (StackSection.tsx lines 164-179):
 *   - Empty `before` → insert empty item BEFORE this one
 *   - Empty `after` (cursor at end) → just save text, don't create empty item
 *   - Both non-empty → split into two items
 *
 * The "cursor at end" branch is the bug fix: previously pressing Enter at
 * the end of text created an empty item that visually "deleted" the next item.
 */

type SplitHandler = (id: number, before: string, after: string) => void

/**
 * Recreates the exact onEnterSplit logic from StackSection renderItems.
 * This allows us to unit-test the branching without rendering the full component.
 */
function createOnEnterSplit(opts: {
  onSplitItem?: (id: number, before: string, after: string, stack: string, column: 'actionable' | 'waiting') => void
  onInsertItem?: (stack: string, column: 'actionable' | 'waiting', text: string, beforeId?: number) => void
  onUpdate: (id: number, updates: { text?: string }) => void
  items: { id: number }[]
  idx: number
  name: string
  column: 'actionable' | 'waiting'
}): SplitHandler | undefined {
  const { onSplitItem, onInsertItem, onUpdate, items, idx, name, column } = opts
  if (!onSplitItem && !onInsertItem) return undefined

  return (id: number, before: string, after: string) => {
    if (!before) {
      // Cursor at start → insert empty item BEFORE this one
      if (onInsertItem) onInsertItem(name, column, '', id)
    } else if (!after.trim()) {
      // Cursor at end → just save the text, don't create empty item
      onUpdate(id, { text: before.trim() })
    } else if (onSplitItem) {
      // Atomic split: update current text + create new after it
      onSplitItem(id, before.trim(), after.trim(), name, column)
    } else if (onInsertItem) {
      onUpdate(id, { text: before.trim() })
      const nextItem = items[idx + 1]
      onInsertItem(name, column, after.trim(), nextItem?.id ?? undefined)
    }
  }
}

describe('onEnterSplit logic', () => {
  const name = 'test-stack'
  const column = 'actionable' as const

  it('cursor at start (empty before) → inserts empty item before current', () => {
    const onInsertItem = vi.fn()
    const onUpdate = vi.fn()
    const handler = createOnEnterSplit({
      onInsertItem,
      onUpdate,
      items: [{ id: 1 }, { id: 2 }],
      idx: 0,
      name,
      column,
    })!

    handler(1, '', 'Hello world')

    expect(onInsertItem).toHaveBeenCalledWith(name, column, '', 1)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('cursor at end (empty after) → saves text without creating new item', () => {
    const onSplitItem = vi.fn()
    const onInsertItem = vi.fn()
    const onUpdate = vi.fn()
    const handler = createOnEnterSplit({
      onSplitItem,
      onInsertItem,
      onUpdate,
      items: [{ id: 1 }, { id: 2 }],
      idx: 0,
      name,
      column,
    })!

    handler(1, 'Datadog Consent', '')

    expect(onUpdate).toHaveBeenCalledWith(1, { text: 'Datadog Consent' })
    expect(onSplitItem).not.toHaveBeenCalled()
    expect(onInsertItem).not.toHaveBeenCalled()
  })

  it('cursor at end with whitespace-only after → treated same as empty after', () => {
    const onSplitItem = vi.fn()
    const onUpdate = vi.fn()
    const handler = createOnEnterSplit({
      onSplitItem,
      onUpdate,
      items: [{ id: 1 }],
      idx: 0,
      name,
      column,
    })!

    handler(1, 'Some text', '   ')

    expect(onUpdate).toHaveBeenCalledWith(1, { text: 'Some text' })
    expect(onSplitItem).not.toHaveBeenCalled()
  })

  it('cursor in middle → uses onSplitItem for atomic split', () => {
    const onSplitItem = vi.fn()
    const onUpdate = vi.fn()
    const handler = createOnEnterSplit({
      onSplitItem,
      onUpdate,
      items: [{ id: 1 }, { id: 2 }],
      idx: 0,
      name,
      column,
    })!

    handler(1, 'Datadog', ' Consent')

    expect(onSplitItem).toHaveBeenCalledWith(1, 'Datadog', 'Consent', name, column)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('cursor in middle without onSplitItem → uses onInsertItem fallback', () => {
    const onInsertItem = vi.fn()
    const onUpdate = vi.fn()
    const handler = createOnEnterSplit({
      onInsertItem,
      onUpdate,
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      idx: 0,
      name,
      column,
    })!

    handler(1, 'Data', 'dog Consent')

    expect(onUpdate).toHaveBeenCalledWith(1, { text: 'Data' })
    expect(onInsertItem).toHaveBeenCalledWith(name, column, 'dog Consent', 2)
  })

  it('cursor in middle, last item → onInsertItem with no beforeId', () => {
    const onInsertItem = vi.fn()
    const onUpdate = vi.fn()
    const handler = createOnEnterSplit({
      onInsertItem,
      onUpdate,
      items: [{ id: 5 }],
      idx: 0,
      name,
      column,
    })!

    handler(5, 'First part', ' second part')

    expect(onUpdate).toHaveBeenCalledWith(5, { text: 'First part' })
    expect(onInsertItem).toHaveBeenCalledWith(name, column, 'second part', undefined)
  })

  it('returns undefined when neither onSplitItem nor onInsertItem provided', () => {
    const handler = createOnEnterSplit({
      onUpdate: vi.fn(),
      items: [{ id: 1 }],
      idx: 0,
      name,
      column,
    })

    expect(handler).toBeUndefined()
  })

  it('trims whitespace from before and after in split case', () => {
    const onSplitItem = vi.fn()
    const onUpdate = vi.fn()
    const handler = createOnEnterSplit({
      onSplitItem,
      onUpdate,
      items: [{ id: 1 }],
      idx: 0,
      name,
      column,
    })!

    handler(1, '  Hello  ', '  World  ')

    expect(onSplitItem).toHaveBeenCalledWith(1, 'Hello', 'World', name, column)
  })
})
