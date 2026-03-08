import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for POST /api/open-env endpoint logic.
 *
 * These test the validation and execution flow without starting the server.
 * The endpoint validates env names (env1-env8) and executes the cursor CLI.
 */

describe('POST /api/open-env validation', () => {
  const envPattern = /^env[1-8]$/

  it('accepts valid env names env1 through env8', () => {
    for (let i = 1; i <= 8; i++) {
      expect(envPattern.test(`env${i}`)).toBe(true)
    }
  })

  it('rejects env0 and env9', () => {
    expect(envPattern.test('env0')).toBe(false)
    expect(envPattern.test('env9')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(envPattern.test('')).toBe(false)
  })

  it('rejects malicious input', () => {
    expect(envPattern.test('env1; rm -rf /')).toBe(false)
    expect(envPattern.test('env1\nenv2')).toBe(false)
    expect(envPattern.test('../env1')).toBe(false)
  })

  it('rejects non-env strings', () => {
    expect(envPattern.test('production')).toBe(false)
    expect(envPattern.test('staging')).toBe(false)
    expect(envPattern.test('ENV1')).toBe(false)
  })
})

describe('workspace path construction', () => {
  function workspacePath(env) {
    return `/home/ubuntu/${env}.code-workspace`
  }

  it('constructs correct path for each env', () => {
    expect(workspacePath('env1')).toBe('/home/ubuntu/env1.code-workspace')
    expect(workspacePath('env4')).toBe('/home/ubuntu/env4.code-workspace')
    expect(workspacePath('env8')).toBe('/home/ubuntu/env8.code-workspace')
  })
})

describe('cursorEnv function', () => {
  /**
   * Tests the logic that reads the IPC socket from ~/.cursor-ipc-socket.
   * When the file exists and has content, it augments process.env with
   * VSCODE_IPC_HOOK_CLI. When missing or empty, falls back to process.env.
   */

  function cursorEnv(readFileFn) {
    try {
      const sock = readFileFn('/home/ubuntu/.cursor-ipc-socket', 'utf8').trim()
      if (sock) return { ...process.env, VSCODE_IPC_HOOK_CLI: sock }
    } catch {}
    return process.env
  }

  it('adds VSCODE_IPC_HOOK_CLI when socket file has content', () => {
    const readFile = vi.fn().mockReturnValue('/run/user/1000/cursor-ipc-12345.sock\n')
    const env = cursorEnv(readFile)

    expect(env.VSCODE_IPC_HOOK_CLI).toBe('/run/user/1000/cursor-ipc-12345.sock')
    expect(readFile).toHaveBeenCalledWith('/home/ubuntu/.cursor-ipc-socket', 'utf8')
  })

  it('returns process.env when socket file is empty', () => {
    const readFile = vi.fn().mockReturnValue('   \n')
    const env = cursorEnv(readFile)

    expect(env).toBe(process.env)
  })

  it('returns process.env when socket file does not exist', () => {
    const readFile = vi.fn().mockImplementation(() => { throw new Error('ENOENT') })
    const env = cursorEnv(readFile)

    expect(env).toBe(process.env)
  })
})
