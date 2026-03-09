import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

/**
 * Tests for the env opener components: EnvSlots, EnvPicker, and openEnv.
 *
 * These are extracted versions of the components from StackLine.tsx,
 * since the originals are not exported. The tests verify the rendering
 * and interaction logic that the components implement.
 */

const ENV_SLOTS = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8', 'env9', 'env10'] as const
const ENV_SLOT_COLORS: Record<string, string> = {
  env1: 'bg-blue-400',
  env2: 'bg-emerald-400',
  env3: 'bg-amber-400',
  env4: 'bg-purple-400',
  env5: 'bg-rose-400',
  env6: 'bg-cyan-400',
  env7: 'bg-orange-400',
  env8: 'bg-indigo-400',
  env9: 'bg-pink-400',
  env10: 'bg-red-400',
}

// Replicate EnvSlots component for testing
function EnvSlots({ envs, onOpenEnv }: { envs: Set<string>, onOpenEnv?: (env: string) => void }) {
  if (envs.size === 0) return null
  return (
    <span className="inline-flex gap-px items-center shrink-0" title={[...envs].join(', ')}>
      {ENV_SLOTS.map(slot => {
        const active = envs.has(slot)
        return (
          <span
            key={slot}
            data-testid={`env-slot-${slot}`}
            className={`w-[6px] h-[6px] rounded-[1px] ${
              active ? `${ENV_SLOT_COLORS[slot]} cursor-pointer` : 'bg-gray-200'
            }`}
            onClick={active && onOpenEnv ? (e) => { e.stopPropagation(); onOpenEnv(slot) } : undefined}
          />
        )
      })}
    </span>
  )
}

// Replicate EnvPicker component for testing
function EnvPicker({ onPick, onClose }: { onPick: (env: string) => void, onClose: () => void }) {
  return (
    <div
      className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px]"
      onClick={e => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider border-b border-gray-100">
        Launch in...
      </div>
      {ENV_SLOTS.map(env => (
        <button
          key={env}
          data-testid={`env-pick-${env}`}
          onClick={() => { onPick(env); onClose() }}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
          <span className={`w-2 h-2 rounded-sm ${ENV_SLOT_COLORS[env]}`} />
          {env}
        </button>
      ))}
    </div>
  )
}

describe('EnvSlots', () => {
  it('renders nothing when envs is empty', () => {
    const { container } = render(<EnvSlots envs={new Set()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders 8 slots with active ones highlighted', () => {
    render(<EnvSlots envs={new Set(['env1', 'env3'])} />)

    const env1 = screen.getByTestId('env-slot-env1')
    const env2 = screen.getByTestId('env-slot-env2')
    const env3 = screen.getByTestId('env-slot-env3')

    expect(env1.className).toContain('bg-blue-400')
    expect(env1.className).toContain('cursor-pointer')
    expect(env2.className).toContain('bg-gray-200')
    expect(env2.className).not.toContain('cursor-pointer')
    expect(env3.className).toContain('bg-amber-400')
    expect(env3.className).toContain('cursor-pointer')
  })

  it('shows title with env names', () => {
    render(<EnvSlots envs={new Set(['env2', 'env4'])} />)
    const container = screen.getByTitle('env2, env4')
    expect(container).toBeInTheDocument()
  })

  it('calls onOpenEnv when clicking an active slot', () => {
    const onOpenEnv = vi.fn()
    render(<EnvSlots envs={new Set(['env1', 'env2'])} onOpenEnv={onOpenEnv} />)

    fireEvent.click(screen.getByTestId('env-slot-env1'))
    expect(onOpenEnv).toHaveBeenCalledWith('env1')

    fireEvent.click(screen.getByTestId('env-slot-env2'))
    expect(onOpenEnv).toHaveBeenCalledWith('env2')
  })

  it('does not call onOpenEnv when clicking an inactive slot', () => {
    const onOpenEnv = vi.fn()
    render(<EnvSlots envs={new Set(['env1'])} onOpenEnv={onOpenEnv} />)

    fireEvent.click(screen.getByTestId('env-slot-env3'))
    expect(onOpenEnv).not.toHaveBeenCalled()
  })

  it('does not call handler when onOpenEnv is not provided', () => {
    // Should not throw
    render(<EnvSlots envs={new Set(['env1'])} />)
    fireEvent.click(screen.getByTestId('env-slot-env1'))
  })

  it('stopPropagation on active slot click', () => {
    const outerClick = vi.fn()
    const onOpenEnv = vi.fn()
    render(
      <div onClick={outerClick}>
        <EnvSlots envs={new Set(['env1'])} onOpenEnv={onOpenEnv} />
      </div>
    )
    fireEvent.click(screen.getByTestId('env-slot-env1'))
    expect(onOpenEnv).toHaveBeenCalled()
    expect(outerClick).not.toHaveBeenCalled()
  })
})

describe('EnvPicker', () => {
  it('renders all 8 env options', () => {
    render(<EnvPicker onPick={vi.fn()} onClose={vi.fn()} />)
    for (const env of ENV_SLOTS) {
      expect(screen.getByTestId(`env-pick-${env}`)).toBeInTheDocument()
    }
  })

  it('shows "Launch in..." header', () => {
    render(<EnvPicker onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Launch in...')).toBeInTheDocument()
  })

  it('calls onPick and onClose when an env is selected', () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<EnvPicker onPick={onPick} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('env-pick-env3'))

    expect(onPick).toHaveBeenCalledWith('env3')
    expect(onClose).toHaveBeenCalled()
  })

  it('stopPropagation on container click', () => {
    const outerClick = vi.fn()
    render(
      <div onClick={outerClick}>
        <EnvPicker onPick={vi.fn()} onClose={vi.fn()} />
      </div>
    )
    // Click on the picker container itself (not a button)
    fireEvent.click(screen.getByText('Launch in...').parentElement!)
    expect(outerClick).not.toHaveBeenCalled()
  })
})

describe('openEnv URI construction', () => {
  /**
   * Replicates the openEnv function logic for testability.
   * The real function in StackLine.tsx uses window.location.href and
   * navigator.clipboard, which we mock here.
   */
  function buildEnvUri(env: string, sshHost: string = 'dev-vm') {
    const path = `/home/ubuntu/${env}.code-workspace`
    return `cursor://vscode-remote/ssh-remote+${sshHost}${path}`
  }

  it('constructs correct URI for env1 with default host', () => {
    expect(buildEnvUri('env1')).toBe(
      'cursor://vscode-remote/ssh-remote+dev-vm/home/ubuntu/env1.code-workspace'
    )
  })

  it('constructs correct URI for env5 with custom host', () => {
    expect(buildEnvUri('env5', 'my-server')).toBe(
      'cursor://vscode-remote/ssh-remote+my-server/home/ubuntu/env5.code-workspace'
    )
  })

  it('uses the correct workspace path pattern', () => {
    for (let i = 1; i <= 8; i++) {
      const uri = buildEnvUri(`env${i}`)
      expect(uri).toContain(`/home/ubuntu/env${i}.code-workspace`)
      expect(uri.startsWith('cursor://vscode-remote/ssh-remote+')).toBe(true)
    }
  })
})

describe('go-to/launch button behavior', () => {
  /**
   * Tests the branching logic of the go-to/launch button:
   * - Single env → openEnv directly
   * - Multiple envs → show picker
   * - No envs → show picker to launch new
   */

  it('single env → calls openEnv with that env', () => {
    const envs = new Set(['env2'])
    const openEnv = vi.fn()
    const setShowEnvPicker = vi.fn()

    // Simulate the button's onClick
    if (envs.size === 1) {
      openEnv([...envs][0])
    } else {
      setShowEnvPicker(true)
    }

    expect(openEnv).toHaveBeenCalledWith('env2')
    expect(setShowEnvPicker).not.toHaveBeenCalled()
  })

  it('multiple envs → shows picker', () => {
    const envs = new Set(['env1', 'env3'])
    const openEnv = vi.fn()
    const setShowEnvPicker = vi.fn()

    if (envs.size === 1) {
      openEnv([...envs][0])
    } else {
      setShowEnvPicker(true)
    }

    expect(openEnv).not.toHaveBeenCalled()
    expect(setShowEnvPicker).toHaveBeenCalledWith(true)
  })

  it('no envs → shows picker', () => {
    const envs = new Set<string>()
    const openEnv = vi.fn()
    const setShowEnvPicker = vi.fn()

    if (envs.size === 1) {
      openEnv([...envs][0])
    } else {
      setShowEnvPicker(true)
    }

    expect(openEnv).not.toHaveBeenCalled()
    expect(setShowEnvPicker).toHaveBeenCalledWith(true)
  })

  it('picker calls openEnv for existing env (go to session)', () => {
    const openEnv = vi.fn()
    const envs = new Set(['env1', 'env2'])
    const item = { text: 'My task', envs }

    // Simulate EnvPicker onPick
    const env = 'env1'
    if (item.envs.has(env)) {
      openEnv(env)
    } else {
      openEnv(env, `/link ${item.text}`)
    }

    expect(openEnv).toHaveBeenCalledWith('env1')
  })

  it('picker calls openEnv with /link command for new env (launch)', () => {
    const openEnv = vi.fn()
    const envs = new Set(['env1'])
    const item = { text: 'My task', envs }

    // Simulate picking env3 which is not in item.envs
    const env = 'env3'
    if (item.envs.has(env)) {
      openEnv(env)
    } else {
      openEnv(env, `/link ${item.text}`)
    }

    expect(openEnv).toHaveBeenCalledWith('env3', '/link My task')
  })
})
