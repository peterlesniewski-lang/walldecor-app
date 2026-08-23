import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  attachPilotShutdownHandlers,
  parsePilotCommand,
  runPilot,
  validatePilotConfig,
} from '../../../scripts/pilot-installations'

const safeEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'file:/tmp/walldecor-installations-pilot-demo.db',
  PILOT_MEDIA_ROOT: '/tmp/walldecor-installations-e2e-media-pilot-demo',
  PILOT_BASE_URL: 'http://192.168.1.42:3100',
  PILOT_ADMIN_PASSWORD: 'PilotOnly-Password9!',
  PILOT_AUTH_SECRET: 'pilot-auth-secret-that-is-long-and-unique-2026',
}

describe('installations pilot launcher', () => {
  it('refuses production before it can create a pilot configuration', () => {
    expect(() => validatePilotConfig({ ...safeEnv, NODE_ENV: 'production' })).toThrow('NODE_ENV=production')
  })

  it.each([
    ['a database outside the pilot prefix', { DATABASE_URL: 'file:/tmp/walldecor.db' }],
    ['a media root outside the pilot prefix', { PILOT_MEDIA_ROOT: '/tmp/walldecor-installations-e2e-media-shared' }],
    ['localhost as the phone-facing URL', { PILOT_BASE_URL: 'http://localhost:3100' }],
    ['a public host as the phone-facing URL', { PILOT_BASE_URL: 'http://203.0.113.9:3100' }],
    ['HTTPS as the phone-facing URL', { PILOT_BASE_URL: 'https://192.168.1.42:3100' }],
    ['a weak administrator password', { PILOT_ADMIN_PASSWORD: 'weak' }],
    ['a short auth secret', { PILOT_AUTH_SECRET: 'short' }],
    ['an auth secret reused as the administrator password', { PILOT_AUTH_SECRET: safeEnv.PILOT_ADMIN_PASSWORD }],
  ])('refuses %s', (_label, override) => {
    expect(() => validatePilotConfig({ ...safeEnv, ...override })).toThrow()
  })

  it('maps only validated pilot values into the runtime environment', () => {
    const config = validatePilotConfig(safeEnv)

    expect(config).toMatchObject({
      baseUrl: 'http://192.168.1.42:3100',
      port: 3100,
      databasePath: '/tmp/walldecor-installations-pilot-demo.db',
      mediaRoot: '/tmp/walldecor-installations-e2e-media-pilot-demo',
      adminUsername: 'pilotadmin',
    })
    expect(config.runtimeEnv).toMatchObject({
      NODE_ENV: 'development',
      DATABASE_URL: safeEnv.DATABASE_URL,
      NEXTAUTH_URL: safeEnv.PILOT_BASE_URL,
      INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem',
      INSTALLATION_MEDIA_TEST_ROOT: safeEnv.PILOT_MEDIA_ROOT,
    })
    expect(config.runtimeEnv.NEXTAUTH_SECRET).toBe(safeEnv.PILOT_AUTH_SECRET)
  })

  it('parses check and reset as explicit non-server commands', () => {
    expect(parsePilotCommand(['--check'])).toBe('check')
    expect(parsePilotCommand(['--reset'])).toBe('reset')
    expect(parsePilotCommand([])).toBe('start')
    expect(() => parsePilotCommand(['--check', '--reset'])).toThrow('Użycie')
  })

  it('checks configuration without migrating, seeding, or starting Next', async () => {
    const migrate = vi.fn()
    const seed = vi.fn()
    const start = vi.fn()
    const print = vi.fn()

    await runPilot('check', safeEnv, { migrate, seed, start, waitForReady: vi.fn(), print, remove: vi.fn() })

    expect(migrate).not.toHaveBeenCalled()
    expect(seed).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    const output = print.mock.calls.flat().join('\n')
    expect(output).toContain(safeEnv.PILOT_BASE_URL)
    expect(output).toContain('pilotadmin')
    expect(output).not.toContain(safeEnv.PILOT_ADMIN_PASSWORD)
    expect(output).not.toContain(safeEnv.PILOT_AUTH_SECRET)
  })

  it('waits for the local health endpoint before printing the usable pilot URL', async () => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null })
    const sequence: string[] = []
    const dependencies = {
      migrate: vi.fn(async () => { sequence.push('migrate') }),
      seed: vi.fn(async () => { sequence.push('seed') }),
      start: vi.fn(() => child),
      waitForReady: vi.fn(async () => {
        sequence.push('ready')
        setTimeout(() => child.emit('exit', 0, null), 0)
      }),
      print: vi.fn(() => { sequence.push('print') }),
      remove: vi.fn(),
    }

    await runPilot('start', safeEnv, dependencies)

    expect(sequence).toEqual(['migrate', 'seed', 'ready', 'print', 'print', 'print'])
    expect(dependencies.waitForReady).toHaveBeenCalledWith(expect.objectContaining({ port: 3100 }), child)
  })

  it('labels the filesystem adapter as a UX-only upload test, not production media protection', async () => {
    const print = vi.fn()

    await runPilot('help', {}, { migrate: vi.fn(), seed: vi.fn(), start: vi.fn(), waitForReady: vi.fn(), print, remove: vi.fn() })

    expect(print.mock.calls.flat().join('\n')).toContain('nie weryfikuje ClamAV')
  })

  it('requires an explicit confirmation before deleting validated pilot paths', async () => {
    const remove = vi.fn()

    await expect(runPilot('reset', safeEnv, { migrate: vi.fn(), seed: vi.fn(), start: vi.fn(), waitForReady: vi.fn(), print: vi.fn(), remove })).rejects.toThrow('PILOT_CONFIRM_RESET')
    expect(remove).not.toHaveBeenCalled()

    await runPilot('reset', { ...safeEnv, PILOT_CONFIRM_RESET: 'DELETE_PILOT_DATA' }, { migrate: vi.fn(), seed: vi.fn(), start: vi.fn(), waitForReady: vi.fn(), print: vi.fn(), remove })
    expect(remove).toHaveBeenCalledWith([
      '/tmp/walldecor-installations-pilot-demo.db',
      '/tmp/walldecor-installations-pilot-demo.db-journal',
      '/tmp/walldecor-installations-pilot-demo.db-shm',
      '/tmp/walldecor-installations-pilot-demo.db-wal',
      '/tmp/walldecor-installations-e2e-media-pilot-demo',
    ])
  })

  it('forwards SIGINT and SIGTERM to the Next child without deleting pilot data', () => {
    const signals = new EventEmitter()
    const child = { kill: vi.fn() }
    const detach = attachPilotShutdownHandlers(child, signals)

    signals.emit('SIGINT')
    signals.emit('SIGTERM')

    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    detach()
  })
})
