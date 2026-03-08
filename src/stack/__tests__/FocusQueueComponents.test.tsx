import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

// ── slackUrl helper (extracted from FocusQueue.tsx for direct testing) ──

function slackUrl(ref: string): string {
  const [channel, ts] = ref.split('/')
  if (channel && ts) {
    return `https://slack.com/app_redirect?channel=${channel}&message_ts=${ts}`
  }
  return `https://slack.com/app_redirect?channel=${ref}`
}

// ── Minimal NewItemFlow replica for testing keyboard/render logic ──
// We import the real component so tests exercise actual behavior.
import { NewItemFlow } from '../NewItemFlow'

describe('slackUrl helper', () => {
  it('builds a channel-only URL when ref has no slash', () => {
    expect(slackUrl('D097L806MTQ')).toBe(
      'https://slack.com/app_redirect?channel=D097L806MTQ'
    )
  })

  it('builds a channel+message_ts URL when ref contains a slash', () => {
    expect(slackUrl('C0ABC123/1234567890.123456')).toBe(
      'https://slack.com/app_redirect?channel=C0ABC123&message_ts=1234567890.123456'
    )
  })

  it('handles a DM channel ref', () => {
    expect(slackUrl('D12345')).toBe(
      'https://slack.com/app_redirect?channel=D12345'
    )
  })

  it('handles a thread ref with typical Slack timestamp', () => {
    expect(slackUrl('C999ZZZ/1700000000.000100')).toBe(
      'https://slack.com/app_redirect?channel=C999ZZZ&message_ts=1700000000.000100'
    )
  })
})

describe('NewItemFlow keyboard navigation', () => {
  let onClose: ReturnType<typeof vi.fn>
  let onCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onClose = vi.fn()
    onCreate = vi.fn()
  })

  it('Enter from text input moves focusArea to type picker', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')

    // Type something first (empty text blocks navigation)
    await userEvent.type(input, 'test task')

    // Press Enter to move to type picker
    fireEvent.keyDown(input, { key: 'Enter' })

    // Type picker should now be visible
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Fire drill')).toBeInTheDocument()
    expect(screen.getByText('Backlog')).toBeInTheDocument()
  })

  it('Enter from text input does nothing when text is empty', () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')

    fireEvent.keyDown(input, { key: 'Enter' })

    // Type picker should NOT appear
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('Left/Right arrows in type picker cycle through options', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'test')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Initially "Today" is selected (index 0)
    const todayBtn = screen.getByText('Today')
    expect(todayBtn.className).toContain('bg-blue-100')

    // ArrowRight -> selects "Fire drill" (index 1)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const fireDrillBtn = screen.getByText('Fire drill')
    expect(fireDrillBtn.className).toContain('bg-red-100')

    // ArrowRight -> selects "Backlog" (index 2)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const backlogBtn = screen.getByText('Backlog')
    expect(backlogBtn.className).toContain('bg-gray-200')

    // ArrowRight at the end stays at "Backlog"
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Backlog').className).toContain('bg-gray-200')

    // ArrowLeft -> back to "Fire drill"
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('Fire drill').className).toContain('bg-red-100')

    // ArrowLeft -> back to "Today"
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('Today').className).toContain('bg-blue-100')

    // ArrowLeft at the start stays at "Today"
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('Today').className).toContain('bg-blue-100')
  })

  it('ArrowDown from type picker goes to snooze when fire-drill is selected', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'urgent task')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Select fire-drill
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // index 1 = fire-drill

    // Snooze picker should appear when fire-drill is selected
    expect(screen.getByText('Snooze original')).toBeInTheDocument()

    // ArrowDown should move focus to snooze
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    // Verify snooze options are present: 5m, 10m, 15m
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(screen.getByText('10m')).toBeInTheDocument()
    expect(screen.getByText('15m')).toBeInTheDocument()
  })

  it('ArrowDown from type picker is a no-op when fire-drill is NOT selected', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'normal task')
    fireEvent.keyDown(input, { key: 'Enter' })

    // "Today" is selected (not fire-drill), snooze should NOT appear
    expect(screen.queryByText('Snooze original')).not.toBeInTheDocument()

    // ArrowDown should not cause errors
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    // Still no snooze
    expect(screen.queryByText('Snooze original')).not.toBeInTheDocument()
  })

  it('ArrowUp from type picker goes back to text input', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'my task')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Type picker is visible
    expect(screen.getByText('Today')).toBeInTheDocument()

    // ArrowUp goes back to text
    fireEvent.keyDown(window, { key: 'ArrowUp' })

    // Type picker should disappear (focusArea back to 'text')
    expect(screen.queryByText('Type')).not.toBeInTheDocument()
  })

  it('ArrowUp from snooze goes back to type picker', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'fire task')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Select fire-drill and move to snooze
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // fire-drill
    fireEvent.keyDown(window, { key: 'ArrowDown' }) // snooze

    // Now ArrowUp should go back to type picker
    fireEvent.keyDown(window, { key: 'ArrowUp' })

    // Snooze options and type options should still be visible
    // (focusArea is 'type' now, both type and snooze pickers render when focusArea !== 'text')
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Fire drill')).toBeInTheDocument()
  })

  it('Cmd+Enter submits from text focusArea', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'submit me')

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })

    expect(onCreate).toHaveBeenCalledWith('submit me', 'today', undefined, undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('Cmd+Enter submits from type picker focusArea', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'submit from type')
    fireEvent.keyDown(input, { key: 'Enter' }) // move to type picker

    // Select fire-drill
    fireEvent.keyDown(window, { key: 'ArrowRight' })

    // Cmd+Enter to submit
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(onCreate).toHaveBeenCalledWith('submit from type', 'fire-drill', 5, undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('Cmd+Enter submits from snooze focusArea', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'fire thing')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Select fire-drill and go to snooze
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    // Change snooze to 10m
    fireEvent.keyDown(window, { key: 'ArrowRight' })

    // Cmd+Enter to submit
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(onCreate).toHaveBeenCalledWith('fire thing', 'fire-drill', 10, undefined)
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes the flow from text input', () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes the flow from type picker', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'something')
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shortcut keys T/F/B select corresponding types', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'shortcut test')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Press F -> selects Fire drill
    fireEvent.keyDown(window, { key: 'f' })
    expect(screen.getByText('Fire drill').className).toContain('bg-red-100')

    // Press B -> selects Backlog
    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.getByText('Backlog').className).toContain('bg-gray-200')

    // Press T -> selects Today
    fireEvent.keyDown(window, { key: 't' })
    expect(screen.getByText('Today').className).toContain('bg-blue-100')
  })

  it('Left/Right in snooze cycles through 5m/10m/15m options', async () => {
    render(<NewItemFlow onClose={onClose} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'snooze test')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Select fire-drill and go to snooze
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // fire-drill
    fireEvent.keyDown(window, { key: 'ArrowDown' }) // snooze

    // Default is 5m - it should have highlighted styling
    const btn5 = screen.getByText('5m')
    expect(btn5.className).toContain('bg-red-100')

    // ArrowRight -> 10m
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const btn10 = screen.getByText('10m')
    expect(btn10.className).toContain('bg-red-100')

    // ArrowRight -> 15m
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const btn15 = screen.getByText('15m')
    expect(btn15.className).toContain('bg-red-100')

    // ArrowRight at end stays at 15m
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('15m').className).toContain('bg-red-100')

    // ArrowLeft -> back to 10m
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('10m').className).toContain('bg-red-100')
  })
})

describe('NewItemFlow create task mode', () => {
  it('shows "Create task" label instead of "New item" when isCreateTask=true', () => {
    render(
      <NewItemFlow
        onClose={vi.fn()}
        onCreate={vi.fn()}
        isCreateTask={true}
      />
    )
    expect(screen.getByText('Create task')).toBeInTheDocument()
    expect(screen.queryByText('New item')).not.toBeInTheDocument()
  })

  it('shows "New item" label when isCreateTask is false/default', () => {
    render(<NewItemFlow onClose={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.getByText('New item')).toBeInTheDocument()
    expect(screen.queryByText('Create task')).not.toBeInTheDocument()
  })

  it('shows amber color for "Create task" label', () => {
    render(
      <NewItemFlow
        onClose={vi.fn()}
        onCreate={vi.fn()}
        isCreateTask={true}
      />
    )
    const label = screen.getByText('Create task')
    expect(label.className).toContain('text-amber-500')
  })

  it('shows gray color for "New item" label', () => {
    render(<NewItemFlow onClose={vi.fn()} onCreate={vi.fn()} />)
    const label = screen.getByText('New item')
    expect(label.className).toContain('text-gray-400')
  })

  it('prefill prop populates the text input', () => {
    render(
      <NewItemFlow
        onClose={vi.fn()}
        onCreate={vi.fn()}
        isCreateTask={true}
        prefill="Prefilled text here"
      />
    )
    const input = screen.getByPlaceholderText('What needs doing?') as HTMLInputElement
    expect(input.value).toBe('Prefilled text here')
  })
})

describe('NewItemFlow type picker styling', () => {
  it('selected type shows colored highlight - Today (blue)', async () => {
    render(<NewItemFlow onClose={vi.fn()} onCreate={vi.fn()} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'style test')
    fireEvent.keyDown(input, { key: 'Enter' })

    // "Today" is selected by default
    const todayBtn = screen.getByText('Today')
    expect(todayBtn.className).toContain('bg-blue-100')
    expect(todayBtn.className).toContain('text-blue-600')

    // Other types should be muted
    const fireDrillBtn = screen.getByText('Fire drill')
    expect(fireDrillBtn.className).toContain('text-gray-400')
    expect(fireDrillBtn.className).toContain('bg-gray-50')

    const backlogBtn = screen.getByText('Backlog')
    expect(backlogBtn.className).toContain('text-gray-400')
    expect(backlogBtn.className).toContain('bg-gray-50')
  })

  it('selected type shows colored highlight - Fire drill (red)', async () => {
    render(<NewItemFlow onClose={vi.fn()} onCreate={vi.fn()} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'style test')
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.keyDown(window, { key: 'ArrowRight' }) // fire-drill

    const fireDrillBtn = screen.getByText('Fire drill')
    expect(fireDrillBtn.className).toContain('bg-red-100')
    expect(fireDrillBtn.className).toContain('text-red-600')
  })

  it('selected type shows colored highlight - Backlog (gray)', async () => {
    render(<NewItemFlow onClose={vi.fn()} onCreate={vi.fn()} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'style test')
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.keyDown(window, { key: 'ArrowRight' }) // fire-drill
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // backlog

    const backlogBtn = screen.getByText('Backlog')
    expect(backlogBtn.className).toContain('bg-gray-200')
    expect(backlogBtn.className).toContain('text-gray-600')
  })

  it('snooze picker only appears when fire-drill is selected', async () => {
    render(<NewItemFlow onClose={vi.fn()} onCreate={vi.fn()} />)
    const input = screen.getByPlaceholderText('What needs doing?')
    await userEvent.type(input, 'test')
    fireEvent.keyDown(input, { key: 'Enter' })

    // Today selected - no snooze
    expect(screen.queryByText('Snooze original')).not.toBeInTheDocument()

    // Switch to fire-drill - snooze appears
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('Snooze original')).toBeInTheDocument()

    // Switch to backlog - snooze disappears
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.queryByText('Snooze original')).not.toBeInTheDocument()

    // Switch back to fire-drill - snooze reappears
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('Snooze original')).toBeInTheDocument()
  })
})

describe('FocusQueue slack context rendering', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders collapsible slack context sections when data has slackContext', async () => {
    const focusResponse = {
      empty: false,
      depth: 1,
      snoozeMinutes: 30,
      top: {
        id: 42,
        kind: 'task',
        label: 'Review PR',
        actionVerb: 'DO',
        slackContext: [
          { label: 'thread from alice', ref: 'D097L806MTQ' },
          { label: '#engineering', ref: 'C0ABC123/1234567890.123456' },
        ],
      },
    }

    // Mock fetch to return our data
    const fetchMock = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify(focusResponse)),
    })
    vi.stubGlobal('fetch', fetchMock)

    // Dynamically import FocusQueue to use the mocked fetch
    const { FocusQueue } = await import('../FocusQueue')
    render(<FocusQueue />)

    // Wait for the slack context labels to appear (inside collapsible headers)
    const threadLabel = await screen.findByText('thread from alice')
    expect(threadLabel).toBeTruthy()

    const channelLabel = screen.getByText('#engineering')
    expect(channelLabel).toBeTruthy()

    // Each should have an external link arrow that opens in Slack
    const links = document.querySelectorAll('a[target="_blank"]')
    expect(links.length).toBeGreaterThanOrEqual(2)

    vi.unstubAllGlobals()
  })
})

describe('Snooze hint shows duration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('hotkey hint displays "snooze 30m" with snoozeMinutes from data', async () => {
    const focusResponse = {
      empty: false,
      depth: 1,
      snoozeMinutes: 30,
      top: {
        id: 1,
        kind: 'task',
        label: 'Some task',
        actionVerb: 'DO',
        emphasizedHotkeys: [],
      },
    }

    const fetchMock = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify(focusResponse)),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { FocusQueue } = await import('../FocusQueue')
    render(<FocusQueue />)

    // Wait for the snooze hint to appear with the correct duration
    const snoozeHint = await screen.findByText('snooze 30m')
    expect(snoozeHint).toBeInTheDocument()

    vi.unstubAllGlobals()
  })

  it('hotkey hint defaults to "snooze 30m" when snoozeMinutes is not set', async () => {
    const focusResponse = {
      empty: false,
      depth: 1,
      top: {
        id: 2,
        kind: 'task',
        label: 'Another task',
        actionVerb: 'DO',
        emphasizedHotkeys: [],
      },
    }

    const fetchMock = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify(focusResponse)),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { FocusQueue } = await import('../FocusQueue')
    render(<FocusQueue />)

    // Default snoozeMinutes is 30 (via `|| 30`)
    const snoozeHint = await screen.findByText('snooze 30m')
    expect(snoozeHint).toBeInTheDocument()

    vi.unstubAllGlobals()
  })
})
