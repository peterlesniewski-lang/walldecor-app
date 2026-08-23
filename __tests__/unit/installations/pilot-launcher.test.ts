import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as pilotLauncher from '../../../scripts/pilot-installations'

const { assertPilotPortAvailable, attachPilotShutdownHandlers, parsePilotCommand, runPilot, validatePilotConfig } = pilotLauncher
const localIpv4Addresses = () => ['192.168.1.42']

const safeEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'file:/tmp/walldecor-installations-pilot-demo/pilot.db',
  PILOT_MEDIA_ROOT: '/tmp/walldecor-installations-e2e-media-pilot-demo',
  PILOT_BASE_URL: 'http://192.168.1.42:3100',
  PILOT_ADMIN_PASSWORD: 'PilotOnly-Password9!',
  PILOT_AUTH_SECRET: 'pilot-auth-secret-that-is-long-and-unique-2026',
}

function isolatedPilotPaths() {
  const suffix = randomUUID()
  const databaseRoot = path.join('/tmp', `walldecor-installations-pilot-fs-${suffix}`)
  return {
    outsideDirectory: mkdtempSync('/tmp/walldecor-installations-pilot-outside-'),
    databaseRoot,
    databasePath: path.join(databaseRoot, 'pilot.db'),
    markerPath: path.join(databaseRoot, '.pilot01.marker'),
    mediaRoot: path.join('/tmp', `walldecor-installations-e2e-media-pilot-fs-${suffix}`),
  }
}

function pilotEnv(paths: ReturnType<typeof isolatedPilotPaths>) {
  return { ...safeEnv, DATABASE_URL: `file:${paths.databasePath}`, PILOT_MEDIA_ROOT: paths.mediaRoot }
}

function markerContent(paths: ReturnType<typeof isolatedPilotPaths>, overrides: Record<string, unknown> = {}) {
  return `${JSON.stringify({
    version: 2,
    databaseRoot: paths.databaseRoot,
    databasePath: paths.databasePath,
    mediaRoot: paths.mediaRoot,
    bindIp: '192.168.1.42',
    port: 3100,
    ...overrides,
  })}\n`
}

function createResettablePilot(paths: ReturnType<typeof isolatedPilotPaths>, marker = markerContent(paths)) {
  mkdirSync(paths.databaseRoot, { mode: 0o700 })
  mkdirSync(paths.mediaRoot, { mode: 0o700 })
  writeFileSync(paths.markerPath, marker, { mode: 0o600 })
}

function cleanupPilotPaths(paths: ReturnType<typeof isolatedPilotPaths>) {
  rmSync(paths.databaseRoot, { recursive: true, force: true })
  rmSync(paths.mediaRoot, { recursive: true, force: true })
  rmSync(paths.outsideDirectory, { recursive: true, force: true })
}

function unsafeStartDependencies() {
  return {
    migrate: vi.fn(),
    seed: vi.fn(),
    start: vi.fn(),
    waitForReady: vi.fn(),
    preflightPort: vi.fn(async () => undefined),
    localIpv4Addresses,
    print: vi.fn(),
    remove: vi.fn(),
  }
}

function readyDependencies(onMigrate: (config: unknown) => Promise<void> | void = () => undefined) {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null as number | null })
  return {
    child,
    dependencies: {
      migrate: vi.fn(onMigrate),
      seed: vi.fn(async () => undefined),
      start: vi.fn(() => child),
      waitForReady: vi.fn(async () => { setTimeout(() => child.emit('exit', 0, null), 0) }),
      preflightPort: vi.fn(async () => undefined),
      localIpv4Addresses,
      print: vi.fn(),
      remove: vi.fn(),
    },
  }
}

describe('installations pilot launcher', () => {
  it('accepts only pilot.db inside a dedicated pilot database root', () => {
    const config = validatePilotConfig(safeEnv, localIpv4Addresses())
    expect(config).toMatchObject({
      databaseRoot: '/tmp/walldecor-installations-pilot-demo',
      databasePath: '/tmp/walldecor-installations-pilot-demo/pilot.db',
      markerPath: '/tmp/walldecor-installations-pilot-demo/.pilot01.marker',
      mediaRoot: safeEnv.PILOT_MEDIA_ROOT,
      bindIp: '192.168.1.42',
    })
  })

  it.each([
    ['a database outside the pilot root', { DATABASE_URL: 'file:/tmp/walldecor.db' }],
    ['a database file other than pilot.db', { DATABASE_URL: 'file:/tmp/walldecor-installations-pilot-demo/other.db' }],
    ['a nested database root', { DATABASE_URL: 'file:/tmp/walldecor-installations-pilot-demo/nested/pilot.db' }],
    ['a media root outside the pilot prefix', { PILOT_MEDIA_ROOT: '/tmp/walldecor-installations-e2e-media-shared' }],
    ['localhost as the phone-facing URL', { PILOT_BASE_URL: 'http://localhost:3100' }],
    ['a public host as the phone-facing URL', { PILOT_BASE_URL: 'http://203.0.113.9:3100' }],
    ['HTTPS as the phone-facing URL', { PILOT_BASE_URL: 'https://192.168.1.42:3100' }],
    ['a weak administrator password', { PILOT_ADMIN_PASSWORD: 'weak' }],
    ['a short auth secret', { PILOT_AUTH_SECRET: 'short' }],
    ['an auth secret reused as the administrator password', { PILOT_AUTH_SECRET: safeEnv.PILOT_ADMIN_PASSWORD }],
  ])('refuses %s', (_label, override) => {
    expect(() => validatePilotConfig({ ...safeEnv, ...override }, localIpv4Addresses())).toThrow()
  })

  it('refuses production before it can create a pilot configuration', () => {
    expect(() => validatePilotConfig({ ...safeEnv, NODE_ENV: 'production' }, localIpv4Addresses())).toThrow('NODE_ENV=production')
  })

  it('refuses a private URL address that is not assigned to this host', () => {
    expect(() => validatePilotConfig(safeEnv, [])).toThrow('przypisany do tego hosta')
  })

  it('maps only validated pilot values into the runtime environment', () => {
    const config = validatePilotConfig(safeEnv, localIpv4Addresses())
    expect(config.runtimeEnv).toMatchObject({
      NODE_ENV: 'development',
      DATABASE_URL: safeEnv.DATABASE_URL,
      NEXTAUTH_URL: safeEnv.PILOT_BASE_URL,
      INSTALLATION_MEDIA_TEST_ADAPTER: 'filesystem',
      INSTALLATION_MEDIA_TEST_ROOT: safeEnv.PILOT_MEDIA_ROOT,
    })
    expect(config.runtimeEnv.NEXTAUTH_SECRET).toBe(safeEnv.PILOT_AUTH_SECRET)
  })

  it('rejects an occupied port on the exact requested interface', async () => {
    const listener = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        listener.once('error', onError)
        listener.listen(0, '127.0.0.1', () => {
          listener.removeListener('error', onError)
          resolve()
        })
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    const address = listener.address()
    if (!address || typeof address === 'string') throw new Error('test listener did not expose a TCP port')
    try {
      await expect(assertPilotPortAvailable('127.0.0.1', address.port)).rejects.toThrow('PILOT_BASE_URL')
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('parses check and reset as explicit non-server commands', () => {
    expect(parsePilotCommand(['--check'])).toBe('check')
    expect(parsePilotCommand(['--reset'])).toBe('reset')
    expect(parsePilotCommand([])).toBe('start')
    expect(() => parsePilotCommand(['--check', '--reset'])).toThrow('Użycie')
  })

  it('checks configuration without migrating, seeding, or starting Next', async () => {
    const dependencies = unsafeStartDependencies()
    await runPilot('check', safeEnv, dependencies)
    expect(dependencies.migrate).not.toHaveBeenCalled()
    expect(dependencies.seed).not.toHaveBeenCalled()
    expect(dependencies.start).not.toHaveBeenCalled()
    const output = dependencies.print.mock.calls.flat().join('\n')
    expect(output).toContain(safeEnv.PILOT_BASE_URL)
    expect(output).toContain('pilotadmin')
    expect(output).not.toContain(safeEnv.PILOT_ADMIN_PASSWORD)
    expect(output).not.toContain(safeEnv.PILOT_AUTH_SECRET)
  })

  it.each([
    ['a database-root symlink', (paths: ReturnType<typeof isolatedPilotPaths>) => symlinkSync(paths.outsideDirectory, paths.databaseRoot)],
    ['a media-root symlink', (paths: ReturnType<typeof isolatedPilotPaths>) => symlinkSync(paths.outsideDirectory, paths.mediaRoot)],
    ['a database-root hardlinked file', (paths: ReturnType<typeof isolatedPilotPaths>) => {
      const outside = path.join(paths.outsideDirectory, 'outside-file')
      writeFileSync(outside, 'outside')
      linkSync(outside, paths.databaseRoot)
    }],
  ])('refuses an existing %s before port preflight or mutations', async (_label, createUnsafePath) => {
    const paths = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    try {
      createUnsafePath(paths)
      await expect(runPilot('start', pilotEnv(paths), dependencies)).rejects.toThrow('już istnieje')
      expect(dependencies.preflightPort).not.toHaveBeenCalled()
      expect(dependencies.migrate).not.toHaveBeenCalled()
      expect(dependencies.seed).not.toHaveBeenCalled()
      expect(dependencies.start).not.toHaveBeenCalled()
      expect(dependencies.remove).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('creates private 0700 roots before migration and keeps the outside sibling untouched', async () => {
    const paths = isolatedPilotPaths()
    const outsideSentinel = path.join(paths.outsideDirectory, 'sentinel')
    writeFileSync(outsideSentinel, 'outside remains untouched')
    const { dependencies } = readyDependencies(async (unknownConfig) => {
      const config = unknownConfig as { databaseRoot: string, databasePath: string, mediaRoot: string, markerPath: string }
      expect(config.databaseRoot).toBe(paths.databaseRoot)
      expect(config.databasePath).toBe(path.join(paths.databaseRoot, 'pilot.db'))
      expect(statSync(config.databaseRoot).mode & 0o777).toBe(0o700)
      expect(statSync(config.mediaRoot).mode & 0o777).toBe(0o700)
      expect(lstatSync(config.markerPath).isFile()).toBe(true)
      writeFileSync(config.databasePath, 'migration output')
      expect(readFileSync(outsideSentinel, 'utf8')).toBe('outside remains untouched')
    })
    try {
      await runPilot('start', pilotEnv(paths), dependencies)
      expect(readFileSync(outsideSentinel, 'utf8')).toBe('outside remains untouched')
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('does not create either private root when port preflight fails', async () => {
    const paths = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    dependencies.preflightPort.mockRejectedValueOnce(new Error('port unavailable'))
    try {
      await expect(runPilot('start', pilotEnv(paths), dependencies)).rejects.toThrow('port unavailable')
      expect(existsSync(paths.databaseRoot)).toBe(false)
      expect(existsSync(paths.mediaRoot)).toBe(false)
      expect(dependencies.migrate).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('preserves private roots and a complete marker after migration begins and fails', async () => {
    const paths = isolatedPilotPaths()
    const { dependencies } = readyDependencies(async () => { throw new Error('migration failed') })
    try {
      await expect(runPilot('start', pilotEnv(paths), dependencies)).rejects.toThrow('jawnego --reset')
      expect(existsSync(paths.databaseRoot)).toBe(true)
      expect(existsSync(paths.mediaRoot)).toBe(true)
      expect(JSON.parse(readFileSync(paths.markerPath, 'utf8'))).toMatchObject({ version: 2, databaseRoot: paths.databaseRoot, databasePath: paths.databasePath, mediaRoot: paths.mediaRoot })
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('fails promptly when the child exits synchronously during readiness', async () => {
    const paths = isolatedPilotPaths()
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true), exitCode: null as number | null })
    const dependencies = {
      migrate: vi.fn(async () => writeFileSync(paths.databasePath, 'migration output')),
      seed: vi.fn(async () => undefined),
      start: vi.fn(() => child),
      waitForReady: vi.fn(() => {
        child.exitCode = 1
        child.emit('exit', 1, null)
        return new Promise<void>(() => {})
      }),
      preflightPort: vi.fn(async () => undefined),
      localIpv4Addresses,
      print: vi.fn(),
      remove: vi.fn(),
    }
    const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('test timeout')), 250))
    try {
      await expect(Promise.race([runPilot('start', pilotEnv(paths), dependencies), timeout])).rejects.toThrow('Serwer pilota zakończył się')
      expect(dependencies.print).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('requires a complete bound marker and explicit confirmation before reset', async () => {
    const paths = isolatedPilotPaths()
    const remove = vi.fn()
    try {
      await expect(runPilot('reset', pilotEnv(paths), { ...unsafeStartDependencies(), remove })).rejects.toThrow('PILOT_CONFIRM_RESET')
      createResettablePilot(paths)
      await runPilot('reset', { ...pilotEnv(paths), PILOT_CONFIRM_RESET: 'DELETE_PILOT_DATA' }, { ...unsafeStartDependencies(), remove })
      expect(remove).toHaveBeenCalledWith(expect.objectContaining({ databaseRoot: paths.databaseRoot, markerPath: paths.markerPath }))
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('refuses reset when a private root is not mode 0700', async () => {
    const paths = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    try {
      createResettablePilot(paths)
      chmodSync(paths.mediaRoot, 0o755)
      await expect(runPilot('reset', { ...pilotEnv(paths), PILOT_CONFIRM_RESET: 'DELETE_PILOT_DATA' }, dependencies)).rejects.toThrow('0700')
      expect(dependencies.remove).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('refuses a reset that mixes a valid marker from another pilot root', async () => {
    const first = isolatedPilotPaths()
    const second = isolatedPilotPaths()
    const dependencies = unsafeStartDependencies()
    try {
      createResettablePilot(first)
      mkdirSync(second.mediaRoot, { mode: 0o700 })
      const mixedEnv = { ...pilotEnv(first), PILOT_MEDIA_ROOT: second.mediaRoot, PILOT_CONFIRM_RESET: 'DELETE_PILOT_DATA' }
      await expect(runPilot('reset', mixedEnv, dependencies)).rejects.toThrow('nie należy do wskazanego pilota')
      expect(dependencies.remove).not.toHaveBeenCalled()
    } finally {
      cleanupPilotPaths(first)
      cleanupPilotPaths(second)
    }
  })

  it('removes only the two bound private roots and never follows an internal symlink', () => {
    const paths = isolatedPilotPaths()
    const outsideSentinel = path.join(paths.outsideDirectory, 'sentinel')
    writeFileSync(outsideSentinel, 'outside remains untouched')
    createResettablePilot(paths)
    symlinkSync(paths.outsideDirectory, path.join(paths.mediaRoot, 'escape'))
    const config = validatePilotConfig(pilotEnv(paths), localIpv4Addresses())
    const removePilotRoots = (pilotLauncher as Record<string, unknown>).removePilotRoots as ((value: typeof config) => void) | undefined
    try {
      expect(removePilotRoots).toBeTypeOf('function')
      removePilotRoots?.(config)
      expect(existsSync(paths.databaseRoot)).toBe(false)
      expect(existsSync(paths.mediaRoot)).toBe(false)
      expect(readFileSync(outsideSentinel, 'utf8')).toBe('outside remains untouched')
    } finally {
      cleanupPilotPaths(paths)
    }
  })

  it('labels the filesystem adapter as a UX-only upload test, not production media protection', async () => {
    const print = vi.fn()
    await runPilot('help', {}, { ...unsafeStartDependencies(), print })
    expect(print.mock.calls.flat().join('\n')).toContain('nie weryfikuje ClamAV')
  })

  it('escalates a repeated shutdown signal to the Next child without deleting pilot data', () => {
    const signals = new EventEmitter()
    const child = { kill: vi.fn() }
    const detach = attachPilotShutdownHandlers(child, signals)
    signals.emit('SIGINT')
    signals.emit('SIGTERM')
    expect(child.kill).toHaveBeenCalledTimes(2)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    detach()
  })
})
